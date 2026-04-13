import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RuntimeLogger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  debug?(msg: string, fields?: Record<string, unknown>): void;
};

interface RuntimeHooks {
  emitMessage?: (message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
}

interface BootstrapResponse {
  client_id?: string;
  broker?: {
    tcp_url?: string;
    username?: string;
    password?: string;
    qos?: number;
  };
  subscriptions?: Array<{ topic?: string; qos?: number }>;
  publish_topics?: string[];
}

interface CheckpointRecord {
  channelId: string;
  lastMessageId?: string;
  lastSeq?: number;
  updatedAt: number;
}

type MqttQos = 0 | 1 | 2;

export interface BotChatRuntime {
  start(
    config: Record<string, unknown>,
    logger: RuntimeLogger,
    hooks?: RuntimeHooks,
  ): Promise<void>;
  stop(): Promise<void>;
  onInboundMessage(message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  sendToChannel(message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

class DefaultBotChatRuntime implements BotChatRuntime {
  private started = false;
  private mqttClient?: import("mqtt").MqttClient;
  private logger?: RuntimeLogger;
  private hooks?: RuntimeHooks;
  private publishTopic?: string;
  private permissionDeniedReply?: string;
  private approver?: PermissionApprover;
  private statePath?: string;
  private checkpoints = new Map<string, CheckpointRecord>();
  private qos: MqttQos = 1;
  private backendUrl?: string;
  private botKey?: string;

  async start(
    config: Record<string, unknown>,
    logger: RuntimeLogger,
    hooks?: RuntimeHooks,
  ): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.logger = logger;
    this.hooks = hooks;
    this.approver = await createApprover(config);
    this.permissionDeniedReply = readString(config.permissionDeniedReply);

    const backendUrl = readString(config.backendUrl);
    const botKey = readString(config.botKey);
    if (!backendUrl || !botKey) {
      throw new Error("backendUrl and botKey are required");
    }

    logger.info("botchat.runtime.started", {
      backendUrl,
      botId: readString(config.botId),
    });

    const bootstrap = await bootstrapBot(backendUrl, botKey);
    this.qos = normalizeQos(bootstrap.broker?.qos);
    this.backendUrl = backendUrl;
    this.botKey = botKey;
    const brokerUrl =
      readString(config.mqttTcpUrl) ?? readString(bootstrap.broker?.tcp_url);
    if (!brokerUrl) {
      throw new Error("mqtt broker url is required");
    }

    this.publishTopic = readString(bootstrap.publish_topics?.[0]);
    const subscriptions = readStringArray(
      bootstrap.subscriptions?.map((item) => item.topic),
    );

    this.statePath = buildStatePath(config);
    await this.loadState();

    const mqtt = await import("mqtt");
    this.mqttClient = mqtt.connect(brokerUrl, {
      clientId: readString(bootstrap.client_id),
      username: readString(bootstrap.broker?.username),
      password: readString(bootstrap.broker?.password),
    });

    this.mqttClient.on("connect", () => {
      logger.info("botchat.mqtt.connected", {
        brokerUrl,
        subscriptions: subscriptions.length,
        qos: this.qos,
      });
      for (const topic of subscriptions) {
        this.mqttClient?.subscribe(topic, { qos: this.qos });
      }
      void this.recoverHistory(config);
    });

    this.mqttClient.on("message", (topic, payload) => {
      void this.handleInbound(topic, payload.toString("utf8"));
    });

    this.mqttClient.on("error", (error) => {
      logger.error("botchat.mqtt.error", {
        error: error.message,
      });
    });

    await this.recoverHistory(config);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    await new Promise<void>((resolve) => {
      if (!this.mqttClient) {
        resolve();
        return;
      }
      this.mqttClient.end(false, {}, () => resolve());
    });

    this.mqttClient = undefined;
    await this.flushState();
    this.logger?.info("botchat.runtime.stopped");
  }

  async onInboundMessage(message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.hooks?.emitMessage?.(message);
  }

  async sendToChannel(message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.mqttClient) {
      throw new Error("mqtt client is not ready");
    }

    const topic = readString(message.metadata?.topic) ?? this.publishTopic;
    if (!topic) {
      throw new Error("publish topic is not configured");
    }

    const payload = JSON.stringify({
      id: randomId(),
      conversation_id: message.channelId,
      from: { type: "bot", id: "openclaw" },
      to: { type: "user", id: message.userId },
      content: { type: "text", body: message.text, meta: message.metadata ?? {} },
      timestamp: Math.floor(Date.now() / 1000),
    });

    this.mqttClient.publish(topic, payload, { qos: this.qos });
    this.logger?.debug?.("botchat.runtime.outbound", {
      topic,
      channelId: message.channelId,
    });
  }

  private async handleInbound(topic: string, payload: string): Promise<void> {
    const logger = this.logger;
    if (!logger) {
      return;
    }

    const parsed = tryParseJson(payload);
    const message = toInboundMessage(parsed, topic);
    if (!message) {
      logger.warn("botchat.inbound.invalid_payload", { topic });
      return;
    }

    const permission = checkLocalPermission(message);
    if (!permission.allowed) {
      const approved = await this.approver?.approve({
        topic,
        message,
        permission,
      });
      if (!approved?.approved) {
        logger.warn("botchat.inbound.permission_denied", {
          topic,
          reason: permission.reason,
          approvalReason: approved?.reason,
        });
        if (this.permissionDeniedReply) {
          await this.sendToChannel({
            channelId: message.channelId,
            userId: message.userId,
            text: this.permissionDeniedReply,
            metadata: {
              topic,
              reason: permission.reason,
            },
          });
        }
        return;
      }
    }

    await this.onInboundMessage(message);
    const messageId = readString(message.metadata?.message_id);
    this.checkpoints.set(message.channelId, {
      channelId: message.channelId,
      lastMessageId: messageId,
      lastSeq: readNumber(message.metadata?.seq),
      updatedAt: Date.now(),
    });
    await this.flushState();
  }

  private async recoverHistory(config: Record<string, unknown>): Promise<void> {
    if (!this.backendUrl || !this.botKey || this.checkpoints.size === 0) {
      return;
    }
    const limit = readNumber(config.historyCatchupLimit) ?? 100;
    for (const checkpoint of this.checkpoints.values()) {
      const messages = await fetchConversationMessages(
        this.backendUrl,
        this.botKey,
        checkpoint.channelId,
        checkpoint.lastSeq,
        limit,
      );
      for (const message of messages) {
        const normalized = toInboundMessage(message, checkpoint.channelId);
        if (!normalized) {
          continue;
        }
        await this.onInboundMessage(normalized);
      }
    }
  }

  private async loadState(): Promise<void> {
    if (!this.statePath) {
      return;
    }
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as {
        checkpoints?: CheckpointRecord[];
      };
      for (const item of parsed.checkpoints ?? []) {
        if (!item.channelId) {
          continue;
        }
        this.checkpoints.set(item.channelId, item);
      }
    } catch {
      return;
    }
  }

  private async flushState(): Promise<void> {
    if (!this.statePath) {
      return;
    }
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const payload = JSON.stringify(
      {
        checkpoints: [...this.checkpoints.values()],
      },
      null,
      2,
    );
    await writeFile(this.statePath, payload, "utf8");
  }
}

let runtimeInstance: BotChatRuntime = new DefaultBotChatRuntime();

export function setBotChatRuntime(runtime: BotChatRuntime): void {
  runtimeInstance = runtime;
}

export function getBotChatRuntime(): BotChatRuntime {
  return runtimeInstance;
}

interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

interface PermissionApprover {
  approve(request: {
    topic: string;
    message: {
      channelId: string;
      userId: string;
      text: string;
      metadata?: Record<string, unknown>;
    };
    permission: PermissionResult;
  }): Promise<{ approved: boolean; reason?: string }>;
}

function checkLocalPermission(message: {
  metadata?: Record<string, unknown>;
}): PermissionResult {
  const blocked = Boolean(message.metadata?.blocked);
  return blocked
    ? { allowed: false, reason: "message blocked by metadata" }
    : { allowed: true };
}

async function createApprover(
  config: Record<string, unknown>,
): Promise<PermissionApprover | undefined> {
  const enabled = Boolean(config.permissionApprovalEnabled);
  if (!enabled) {
    return undefined;
  }

  const handlerPath = readString(config.permissionApprovalHandler);
  if (handlerPath) {
    const loaded = await import(handlerPath);
    const approve = loaded.approve ?? loaded.default?.approve;
    if (typeof approve === "function") {
      return { approve };
    }
  }

  const approvalUrl = readString(config.permissionApprovalUrl);
  if (approvalUrl) {
    return {
      async approve(request) {
        const response = await fetch(approvalUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const json = await response.json();
        return (json?.data ?? json) as { approved: boolean; reason?: string };
      },
    };
  }

  return undefined;
}

async function bootstrapBot(
  backendUrl: string,
  botKey: string,
): Promise<BootstrapResponse> {
  const url = `${backendUrl.replace(/\/+$/, "")}/api/v1/bot-runtime/bootstrap`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Bot-Key": botKey,
    },
  });

  if (!response.ok) {
    throw new Error(`bootstrap failed: ${response.status}`);
  }

  const json = (await response.json()) as { data?: BootstrapResponse };
  return json.data ?? {};
}

function toInboundMessage(
  raw: unknown,
  topic: string,
): {
  channelId: string;
  userId: string;
  text: string;
  metadata?: Record<string, unknown>;
} | null {
  if (!isRecord(raw)) {
    return null;
  }

  const channelId =
    readString(raw.conversation_id) ?? readString(raw.dialog_id) ?? topic;
  const from = isRecord(raw.from) ? raw.from : undefined;
  const content = isRecord(raw.content) ? raw.content : undefined;
  const messageId = readString(raw.id) ?? readString(raw.message_id);
  const seq = readNumber(raw.seq);
  const userId = readString(from?.id) ?? readString(raw.from_id);
  const text = readString(content?.body) ?? readString(raw.body);

  if (!userId || !text) {
    return null;
  }

  return {
    channelId,
    userId,
    text,
    metadata: {
      topic,
      ...(messageId ? { message_id: messageId } : {}),
      ...(seq !== undefined ? { seq } : {}),
      ...(isRecord(content?.meta) ? content.meta : {}),
    },
  };
}

function buildStatePath(config: Record<string, unknown>): string | undefined {
  const stateDir = readString(config.stateDir);
  const botId = readString(config.botId) ?? "default";
  if (!stateDir) {
    return undefined;
  }
  return path.join(stateDir, `botchat-${botId}-state.json`);
}

async function fetchConversationMessages(
  backendUrl: string,
  botKey: string,
  conversationId: string,
  afterSeq: number | undefined,
  limit: number,
): Promise<unknown[]> {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  if (afterSeq !== undefined) {
    query.set("after_seq", String(afterSeq));
  }
  const base = backendUrl.replace(/\/+$/, "");
  const url = `${base}/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Bot-Key": botKey,
    },
  });
  if (!response.ok) {
    return [];
  }
  const json = (await response.json()) as { data?: unknown[] };
  return Array.isArray(json.data) ? json.data : [];
}

function randomId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeQos(value: unknown): MqttQos {
  const parsed = readNumber(value);
  if (parsed === 0 || parsed === 2) {
    return parsed;
  }
  return 1;
}
