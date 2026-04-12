"use strict";

const DEFAULT_SYSTEM_PROMPT = [
  "You are a lightweight test bot inside OpenClaw Bot Chat.",
  "Keep replies short, clear, and helpful.",
  "If the user asks what system you are in, explain that you are a test agent connected through Bot Chat.",
].join(" ");

const DEBUG_ENABLED = readBooleanEnv("BOT_CHAT_RUNTIME_DEBUG", true);
const BODY_MAX_LENGTH = readInt("BOT_CHAT_LOG_BODY_MAX_LEN", 600);

exports.respond = async function respond(request) {
  const startedAt = Date.now();
  const content = String(request && request.content ? request.content : "").trim();
  const metadata = isRecord(request && request.metadata) ? request.metadata : {};
  const logBase = {
    session_id: readString(request && request.session_id),
    dialog_id: readString(metadata.dialog_id),
    message_id: readString(metadata.message_id),
  };

  debugLog("handler.request.start", {
    ...logBase,
    content_preview: previewText(content),
    metadata: summarizeValue(metadata),
  });

  if (!content) {
    const response = {
      content: "收到空消息。",
      metadata: { content_type: "text" },
    };
    debugLog("handler.request.success", {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      response_preview: previewText(response.content),
    });
    return response;
  }

  if (content === "/ping") {
    const response = {
      content: "pong",
      metadata: { content_type: "text" },
    };
    debugLog("handler.request.success", {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      response_preview: previewText(response.content),
    });
    return response;
  }

  if (content === "/meta") {
    const response = {
      content: JSON.stringify(metadata, null, 2),
      metadata: { content_type: "text" },
    };
    debugLog("handler.request.success", {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      response_preview: previewText(response.content),
    });
    return response;
  }

  const endpoint = resolveChatCompletionsUrl(requiredEnv("OPENAI_COMPAT_BASE_URL"));
  const apiKey = requiredEnv("OPENAI_COMPAT_API_KEY");
  const model = process.env.OPENAI_COMPAT_MODEL || "gpt-4o-mini";
  const systemPrompt = process.env.OPENAI_COMPAT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const payload = buildPayload(model, systemPrompt, content, metadata);

  debugLog("handler.model_request.start", {
    ...logBase,
    endpoint,
    model,
    timeout_ms: readInt("OPENAI_COMPAT_TIMEOUT_MS", 60000),
    payload: summarizeValue(payload),
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(readInt("OPENAI_COMPAT_TIMEOUT_MS", 60000)),
    });

    const rawText = await response.text();
    const parsed = tryParseJson(rawText);

    if (!response.ok) {
      errorLog("handler.model_request.failed", {
        ...logBase,
        endpoint,
        model,
        duration_ms: Date.now() - startedAt,
        status: response.status,
        response_body: summarizeValue(parsed !== undefined ? parsed : rawText),
      });
      throw new Error(`OpenAI-compatible request failed with ${response.status}: ${rawText}`);
    }

    const text = extractAssistantText(parsed).trim();
    if (!text) {
      errorLog("handler.model_request.empty_response", {
        ...logBase,
        endpoint,
        model,
        duration_ms: Date.now() - startedAt,
        response_body: summarizeValue(parsed !== undefined ? parsed : rawText),
      });
      throw new Error("OpenAI-compatible response did not contain assistant text");
    }

    debugLog("handler.model_request.success", {
      ...logBase,
      endpoint,
      model,
      duration_ms: Date.now() - startedAt,
      response_preview: previewText(text),
    });

    return {
      content: text,
      metadata: { content_type: "text" },
    };
  } catch (error) {
    errorLog("handler.request.failed", {
      ...logBase,
      duration_ms: Date.now() - startedAt,
      endpoint,
      model,
      content_preview: previewText(content),
    }, error);
    throw error;
  }
};

function buildHeaders(apiKey) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const extraHeaders = process.env.OPENAI_COMPAT_EXTRA_HEADERS;
  if (!extraHeaders) {
    return headers;
  }

  const parsed = tryParseJson(extraHeaders);
  if (!isRecord(parsed)) {
    throw new Error("OPENAI_COMPAT_EXTRA_HEADERS must be a JSON object");
  }

  for (const [key, value] of Object.entries(parsed)) {
    headers[key] = String(value);
  }
  return headers;
}

function buildPayload(model, systemPrompt, content, metadata) {
  const metadataSummary = JSON.stringify(summarizeMetadata(metadata));
  const messages = [
    {
      role: "system",
      content: `${systemPrompt}\n\nSession metadata: ${metadataSummary}`,
    },
    {
      role: "user",
      content,
    },
  ];

  const payload = {
    model,
    messages,
    stream: false,
  };

  const temperature = readFloat("OPENAI_COMPAT_TEMPERATURE");
  if (temperature !== undefined) {
    payload.temperature = temperature;
  }

  const maxTokens = readInt("OPENAI_COMPAT_MAX_TOKENS");
  if (maxTokens !== undefined) {
    payload.max_tokens = maxTokens;
  }

  return payload;
}

function summarizeMetadata(metadata) {
  const summary = {
    session_id: readString(metadata.session_id),
    dialog_id: readString(metadata.dialog_id),
    message_id: readString(metadata.message_id),
    from_id: readString(metadata.from_id),
    content_type: readString(metadata.content_type),
  };

  const channelContext = isRecord(metadata.channel_context) ? metadata.channel_context : undefined;
  if (channelContext) {
    summary.channel_context = {
      id: readString(channelContext.id),
      type: readString(channelContext.type),
      userId: readString(channelContext.userId),
      guildId: readString(channelContext.guildId),
      groupId: readString(channelContext.groupId),
    };
  }

  return summary;
}

function resolveChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/chat/completions")) {
    return url.toString();
  }

  if (pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/chat/completions`;
    return url.toString();
  }

  url.pathname = `${pathname}/v1/chat/completions`;
  return url.toString();
}

function extractAssistantText(payload) {
  if (!isRecord(payload)) {
    return "";
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const firstChoice = payload.choices[0];
    if (isRecord(firstChoice)) {
      const message = firstChoice.message;
      if (isRecord(message)) {
        return sanitizeAssistantText(readContentText(message.content));
      }
      if (typeof firstChoice.text === "string") {
        return sanitizeAssistantText(firstChoice.text);
      }
    }
  }

  if (Array.isArray(payload.output) && payload.output.length > 0) {
    return sanitizeAssistantText(payload.output.map(readContentText).filter(Boolean).join("\n").trim());
  }

  return "";
}

function sanitizeAssistantText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/^<think>[\s\S]*?<\/think>\s*/i, "").trim();
}

function readContentText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (isRecord(item)) {
          return readString(item.text, item.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (isRecord(value)) {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (Array.isArray(value.content)) {
      return readContentText(value.content);
    }
  }

  return "";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function readString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function readFloat(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function debugLog(event, fields) {
  if (!DEBUG_ENABLED) {
    return;
  }
  emitLog("debug", event, fields);
}

function errorLog(event, fields, error) {
  emitLog("error", event, fields, error);
}

function emitLog(level, event, fields, error) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(fields || {}),
    ...(error ? { error: serializeError(error) } : {}),
  };
  const line = `[openclaw-bot-chat:handler] ${safeJsonStringify(payload) || JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  console.debug(line);
}

function previewText(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= BODY_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, BODY_MAX_LENGTH)}...<truncated>`;
}

function summarizeValue(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return previewText(value);
  }
  const serialized = safeJsonStringify(value);
  if (!serialized) {
    return undefined;
  }
  if (serialized.length <= BODY_MAX_LENGTH * 2) {
    return serialized;
  }
  return `${serialized.slice(0, BODY_MAX_LENGTH * 2)}...<truncated>`;
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: typeof error === "string" ? error : safeJsonStringify(error) || String(error),
  };
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
