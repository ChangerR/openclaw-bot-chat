"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SYSTEM_PROMPT = [
  "You are a lightweight test bot inside OpenClaw Bot Chat.",
  "Keep replies short, clear, and helpful.",
  "If the user asks what system you are in, explain that you are a test agent connected through Bot Chat.",
].join(" ");

const DEBUG_ENABLED = readBooleanEnv("BOT_CHAT_RUNTIME_DEBUG", true);
const BODY_MAX_LENGTH = readInt("BOT_CHAT_LOG_BODY_MAX_LEN", 600);
const HISTORY_TURNS = readInt("OPENAI_COMPAT_HISTORY_TURNS", 8);
const MAX_TOOL_ROUNDS = readInt("OPENAI_COMPAT_MCP_MAX_TOOL_ROUNDS", 6);
const conversationHistory = new Map();
let mcpRuntimePromise;

exports.respond = async function respond(request) {
  const startedAt = Date.now();
  const content = String(request && request.content ? request.content : "").trim();
  const metadata = isRecord(request && request.metadata) ? request.metadata : {};
  const sessionId = readString(request && request.session_id) || readString(metadata.dialog_id) || "default";
  const logBase = {
    session_id: sessionId,
    dialog_id: readString(metadata.dialog_id),
    message_id: readString(metadata.message_id),
  };

  debugLog("handler.request.start", {
    ...logBase,
    content_preview: previewText(content),
    metadata: summarizeValue(metadata),
  });

  if (shouldSkipReply(metadata)) {
    debugLog("handler.request.skipped_unmentioned_group", logBase);
    return {
      content: "",
      metadata: {
        content_type: "text",
        skip_reply: true,
      },
    };
  }

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

  if (content === "/reset") {
    conversationHistory.delete(sessionId);
    const response = {
      content: "上下文已清空。",
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
  const mcpRuntime = await getMcpRuntime();
  const requestState = buildRequestState(systemPrompt, sessionId, content, metadata);

  debugLog("handler.model_request.start", {
    ...logBase,
    endpoint,
    model,
    timeout_ms: readInt("OPENAI_COMPAT_TIMEOUT_MS", 60000),
    payload: summarizeValue(buildPayload(model, requestState.messages, mcpRuntime)),
  });

  try {
    const text = await runModelLoop({
      endpoint,
      apiKey,
      model,
      requestState,
      mcpRuntime,
      timeoutMs: readInt("OPENAI_COMPAT_TIMEOUT_MS", 60000),
      logBase,
      startedAt,
    });

    debugLog("handler.model_request.success", {
      ...logBase,
      endpoint,
      model,
      duration_ms: Date.now() - startedAt,
      response_preview: previewText(text),
    });

    appendConversationTurn(sessionId, "user", content);
    appendConversationTurn(sessionId, "assistant", text);

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

async function runModelLoop(options) {
  const {
    endpoint,
    apiKey,
    model,
    requestState,
    mcpRuntime,
    timeoutMs,
    logBase,
    startedAt,
  } = options;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const payload = buildPayload(model, requestState.messages, mcpRuntime);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
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

    const assistantMessage = extractAssistantMessage(parsed);
    if (!assistantMessage) {
      errorLog("handler.model_request.empty_response", {
        ...logBase,
        endpoint,
        model,
        duration_ms: Date.now() - startedAt,
        response_body: summarizeValue(parsed !== undefined ? parsed : rawText),
      });
      throw new Error("OpenAI-compatible response did not contain assistant message");
    }

    if (
      assistantMessage.tool_calls &&
      assistantMessage.tool_calls.length > 0 &&
      mcpRuntime
    ) {
      debugLog("handler.model_request.tool_calls", {
        ...logBase,
        round,
        tools: assistantMessage.tool_calls.map((toolCall) => toolCall.function?.name),
      });

      requestState.messages.push(assistantMessage.raw);
      for (const toolCall of assistantMessage.tool_calls) {
        const toolResult = await callMcpTool(mcpRuntime, toolCall);
        requestState.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
      continue;
    }

    const text = sanitizeAssistantText(readContentText(assistantMessage.content)).trim();
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

    return text;
  }

  throw new Error(`MCP tool loop exceeded ${MAX_TOOL_ROUNDS} rounds`);
}

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

function buildRequestState(systemPrompt, sessionId, content, metadata) {
  const metadataSummary = JSON.stringify(summarizeMetadata(metadata));
  const history = conversationHistory.get(sessionId) || [];
  const userContent = buildUserContent(content, metadata);
  const messages = [
    {
      role: "system",
      content: `${systemPrompt}\n\nSession metadata: ${metadataSummary}`,
    },
    ...history,
    { role: "user", content: userContent },
  ];

  return { messages };
}

function buildPayload(model, messages, mcpRuntime) {
  const payload = {
    model,
    messages,
    stream: false,
  };

  if (mcpRuntime && mcpRuntime.tools.length > 0) {
    payload.tools = mcpRuntime.tools;
    payload.tool_choice = "auto";
  }

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

async function getMcpRuntime() {
  if (mcpRuntimePromise) {
    return mcpRuntimePromise;
  }

  mcpRuntimePromise = createMcpRuntime().catch((error) => {
    mcpRuntimePromise = undefined;
    throw error;
  });
  return mcpRuntimePromise;
}

async function createMcpRuntime() {
  const config = loadMcpConfig();
  if (!config || !isRecord(config.mcpServers)) {
    return null;
  }

  const sdk = await import("@modelcontextprotocol/sdk/client/index.js");
  const stdio = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const runtime = {
    servers: new Map(),
    tools: [],
  };

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    if (!isRecord(serverConfig)) {
      continue;
    }
    const command = readString(serverConfig.command);
    if (!command) {
      continue;
    }

    const args = Array.isArray(serverConfig.args)
      ? serverConfig.args.map((item) => String(item))
      : [];
    const env = resolveMcpEnv(serverConfig.env);
    const cwd = readString(serverConfig.cwd)
      ? path.resolve(readString(serverConfig.cwd))
      : process.cwd();

    const transport = new stdio.StdioClientTransport({
      command,
      args,
      env,
      cwd,
    });
    const client = new sdk.Client(
      {
        name: "openclaw-bot-chat-openai-handler",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await client.connect(transport);
    const listed = await client.listTools();
    for (const tool of listed.tools || []) {
      const exposedName = `${sanitizeToolPrefix(serverName)}__${tool.name}`;
      runtime.servers.set(exposedName, {
        client,
        originalName: tool.name,
        serverName,
      });
      runtime.tools.push({
        type: "function",
        function: {
          name: exposedName,
          description: tool.description || `MCP tool ${tool.name} from ${serverName}`,
          parameters: tool.inputSchema || {
            type: "object",
            additionalProperties: true,
          },
        },
      });
    }
  }

  if (runtime.tools.length === 0) {
    return null;
  }

  debugLog("handler.mcp.initialized", {
    servers: runtime.tools.map((tool) => tool.function.name),
  });

  return runtime;
}

function loadMcpConfig() {
  const rawJson = readString(process.env.OPENAI_COMPAT_MCP_SERVERS_JSON);
  if (rawJson) {
    const parsed = tryParseJson(rawJson);
    if (!isRecord(parsed)) {
      throw new Error("OPENAI_COMPAT_MCP_SERVERS_JSON must be a JSON object");
    }
    return normalizeMcpConfig(parsed);
  }

  const configPath = readString(process.env.OPENAI_COMPAT_MCP_CONFIG);
  if (!configPath) {
    return null;
  }

  const resolvedPath = resolveConfigPath(configPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const parsed = tryParseJson(raw);
  if (!isRecord(parsed)) {
    throw new Error(`OPENAI_COMPAT_MCP_CONFIG must point to a JSON object: ${resolvedPath}`);
  }
  return normalizeMcpConfig(parsed);
}

function resolveConfigPath(rawPath) {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const candidates = [
    path.resolve(process.cwd(), rawPath),
    path.resolve(process.cwd(), "..", rawPath),
    path.resolve(process.cwd(), "..", "..", rawPath),
    path.resolve(process.cwd(), "..", "..", "..", rawPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function normalizeMcpConfig(config) {
  if (isRecord(config.mcpServers)) {
    return config;
  }
  return { mcpServers: config };
}

function resolveMcpEnv(rawEnv) {
  const baseEnv = { ...process.env };
  if (!isRecord(rawEnv)) {
    return baseEnv;
  }

  for (const [key, value] of Object.entries(rawEnv)) {
    const text = String(value);
    if (process.env[text]) {
      baseEnv[key] = process.env[text];
      continue;
    }
    baseEnv[key] = text;
  }

  return baseEnv;
}

function sanitizeToolPrefix(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

async function callMcpTool(runtime, toolCall) {
  const functionName = toolCall.function && toolCall.function.name;
  const target = functionName ? runtime.servers.get(functionName) : undefined;
  if (!target) {
    throw new Error(`Unknown MCP tool: ${functionName || "<empty>"}`);
  }

  let args = {};
  const rawArgs = toolCall.function && toolCall.function.arguments;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    args = JSON.parse(rawArgs);
  }

  const result = await target.client.callTool({
    name: target.originalName,
    arguments: args,
  });
  return stringifyToolResult(result);
}

function stringifyToolResult(result) {
  if (!isRecord(result)) {
    return typeof result === "string" ? result : safeJsonStringify(result);
  }

  if (Array.isArray(result.content)) {
    const text = result.content
      .map((item) => {
        if (isRecord(item) && typeof item.text === "string") {
          return item.text;
        }
        return safeJsonStringify(item);
      })
      .filter(Boolean)
      .join("\n");
    if (text) {
      return text;
    }
  }

  if (isRecord(result.structuredContent)) {
    return safeJsonStringify(result.structuredContent);
  }

  return safeJsonStringify(result);
}

function buildUserContent(content, metadata) {
  const imageUrl = readImageUrlFromMetadata(metadata);
  if (!imageUrl) {
    return content;
  }

  const blocks = [];
  const trimmedContent = typeof content === "string" ? content.trim() : "";
  if (trimmedContent) {
    blocks.push({
      type: "text",
      text: trimmedContent,
    });
  } else {
    blocks.push({
      type: "text",
      text: "Please analyze the attached image and reply briefly.",
    });
  }

  blocks.push({
    type: "image_url",
    image_url: {
      url: imageUrl,
    },
  });

  return blocks;
}

function shouldSkipReply(metadata) {
  if (!isRecord(metadata)) {
    return false;
  }

  const channelContext = isRecord(metadata.channel_context) ? metadata.channel_context : undefined;
  if (!channelContext) {
    return false;
  }

  const channelType = readString(channelContext.type);
  if (channelType !== "group" && channelType !== "channel") {
    return false;
  }

  if (metadata.mentioned_current_bot === false) {
    return true;
  }

  const botId = readString(channelContext.botId);
  if (!botId) {
    return false;
  }

  const messageMeta = isRecord(metadata.message_meta) ? metadata.message_meta : undefined;
  const mentionedBotIds = Array.isArray(messageMeta && messageMeta.mentioned_bot_ids)
    ? messageMeta.mentioned_bot_ids.filter((item) => typeof item === "string")
    : [];

  return mentionedBotIds.length > 0 && !mentionedBotIds.includes(botId);
}

function readImageUrlFromMetadata(metadata) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const contentType = readString(
    metadata.content_type,
    isRecord(metadata.message_meta) ? metadata.message_meta.content_type : undefined,
  );
  if (contentType !== "image") {
    return undefined;
  }

  const messageMeta = isRecord(metadata.message_meta) ? metadata.message_meta : undefined;
  const asset = messageMeta && isRecord(messageMeta.asset) ? messageMeta.asset : undefined;
  return readString(
    asset && asset.download_url,
    asset && asset.external_url,
    asset && asset.source_url,
    messageMeta && messageMeta.image_url,
    messageMeta && messageMeta.url,
  );
}

function appendConversationTurn(sessionId, role, content) {
  if (!sessionId || !content) {
    return;
  }

  const history = conversationHistory.get(sessionId) || [];
  history.push({ role, content });

  const maxMessages = Math.max(0, HISTORY_TURNS * 2);
  const trimmed =
    maxMessages > 0 && history.length > maxMessages
      ? history.slice(history.length - maxMessages)
      : history;

  conversationHistory.set(sessionId, trimmed);
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

function extractAssistantMessage(payload) {
  if (!isRecord(payload)) {
    return null;
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const firstChoice = payload.choices[0];
    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      const message = firstChoice.message;
      return {
        raw: {
          role: "assistant",
          ...(message.content !== undefined ? { content: message.content } : {}),
          ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}),
        },
        content: message.content,
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      };
    }
  }

  return null;
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
