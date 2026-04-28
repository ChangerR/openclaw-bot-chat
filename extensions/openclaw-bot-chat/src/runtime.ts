import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BOT_CHAT_DEFAULT_ACCOUNT_ID,
  type BotChatChannelConfig,
  type BotChatConfigIssue,
  type BotChatTarget,
  type ResolvedBotChatAccount,
} from "./channel-api.js";

export type BotChatMessage = {
  channelId: string;
  userId: string;
  text: string;
  metadata?: Record<string, unknown>;
};

type RuntimeLogger = {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  debug?(msg: string, fields?: Record<string, unknown>): void;
};

interface RuntimeHooks {
  emitMessage?: (message: BotChatMessage) => Promise<void>;
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
  onInboundMessage(message: BotChatMessage): Promise<void>;
  sendToChannel(message: BotChatMessage): Promise<void>;
}

export function parseBotChatTarget(raw: string): BotChatTarget {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("BotChat target is required");
  }

  const match = /^(dm|direct|user|channel|conversation):(.+)$/i.exec(trimmed);
  if (!match) {
    return { kind: "channel", id: trimmed, raw: trimmed };
  }

  const kind = match[1].toLowerCase();
  const id = match[2].trim();
  if (!id) {
    throw new Error("BotChat target id is required");
  }

  if (kind === "dm" || kind === "direct" || kind === "user") {
    return { kind: "direct", id, raw: trimmed };
  }
  return { kind: "channel", id, raw: trimmed };
}

export function normalizeBotChatTarget(raw: string): string {
  const parsed = parseBotChatTarget(raw);
  return `${parsed.kind === "direct" ? "dm" : "channel"}:${parsed.id}`;
}

export function inferBotChatTargetChatType(raw: string): "direct" | "channel" {
  return parseBotChatTarget(raw).kind === "direct" ? "direct" : "channel";
}

export function buildBotChatOutboundMessageTarget(params: {
  raw: string;
  account: ResolvedBotChatAccount;
  metadata?: Record<string, unknown>;
}): { channelId: string; userId: string; normalizedTarget: string; chatType: "direct" | "channel" } {
  const parsed = parseBotChatTarget(params.raw);
  if (parsed.kind === "direct") {
    return {
      channelId: parsed.id,
      userId: parsed.id,
      normalizedTarget: `dm:${parsed.id}`,
      chatType: "direct",
    };
  }

  const userId = readString(params.metadata?.userId) ?? params.account.botId;
  return {
    channelId: parsed.id,
    userId,
    normalizedTarget: `channel:${parsed.id}`,
    chatType: "channel",
  };
}

export function normalizeAllowFromEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "*") {
    return "*";
  }
  return trimmed.replace(/^(?:user|botchat|sender):/i, "").trim();
}

export function normalizeAllowFromEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) => normalizeAllowFromEntry(String(entry))).filter(Boolean);
}

export function isBotChatSenderAllowed(params: {
  allowFrom?: string[];
  userId: string;
}): boolean {
  const normalizedUserId = normalizeAllowFromEntry(params.userId);
  if (!normalizedUserId) {
    return false;
  }
  const entries = (params.allowFrom ?? []).map((entry) => normalizeAllowFromEntry(entry));
  if (entries.includes("*")) {
    return true;
  }
  return entries.includes(normalizedUserId);
}

export function evaluateBotChatAccess(params: {
  config: Record<string, unknown>;
  message: BotChatMessage;
}): { allowed: boolean; reason?: string; requiresCustomApproval: boolean } {
  const normalized = normalizeBotChatConfig(params.config);
  const allowFrom = normalized.allowFrom ?? [];
  const allowlistEnabled = allowFrom.length > 0;
  const senderAllowed = allowlistEnabled
    ? isBotChatSenderAllowed({ allowFrom, userId: params.message.userId })
    : true;

  if (!senderAllowed) {
    return {
      allowed: false,
      reason: "sender not approved in allowFrom",
      requiresCustomApproval: false,
    };
  }

  const blocked = Boolean(params.message.metadata?.blocked);
  if (blocked) {
    return {
      allowed: false,
      reason: "message blocked by metadata",
      requiresCustomApproval: normalized.permissionApprovalEnabled === true,
    };
  }

  return {
    allowed: true,
    requiresCustomApproval: false,
  };
}

export function collectBotChatConfigIssues(config: Record<string, unknown>): BotChatConfigIssue[] {
  const normalized = normalizeBotChatConfig(config, {});
  const issues: BotChatConfigIssue[] = [];
  const hasConfiguredBotKey = Boolean(normalized.botKey) || isBotChatSecretRef(config.botKey);

  if (!normalized.backendUrl) {
    issues.push({
      severity: "error",
      code: "missing_backend_url",
      message: "backendUrl is required",
      path: "backendUrl",
    });
  }
  if (!hasConfiguredBotKey) {
    issues.push({
      severity: "error",
      code: "missing_bot_key",
      message: "botKey is required",
      path: "botKey",
    });
  }

  if (config.historyCatchupLimit !== undefined) {
    const rawLimit = readNumber(config.historyCatchupLimit);
    if (rawLimit === undefined || rawLimit <= 0) {
      issues.push({
        severity: "error",
        code: "invalid_history_catchup_limit",
        message: "historyCatchupLimit must be a positive number",
        path: "historyCatchupLimit",
      });
    }
  }

  if (
    normalized.permissionApprovalEnabled === true &&
    !normalized.permissionApprovalHandler &&
    !normalized.permissionApprovalUrl
  ) {
    issues.push({
      severity: "warning",
      code: "approval_without_handler",
      message: "permissionApprovalEnabled is true but no approval handler or URL is configured",
      path: "permissionApprovalEnabled",
    });
  }

  if ((normalized.allowFrom ?? []).length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_allow_from",
      message: "allowFrom is empty; BotChat currently allows all senders until pairing writes allowFrom entries",
      path: "allowFrom",
    });
  }

  return issues;
}

function isBotChatSecretRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    typeof value.provider === "string" &&
    typeof value.id === "string"
  );
}

export function normalizeBotChatConfig(
  input: Record<string, unknown> = {},
  env: Record<string, string | undefined> = process.env,
): BotChatChannelConfig {
  const normalized: BotChatChannelConfig = {
    enabled: readBoolean(input.enabled) ?? true,
    name: readString(input.name) ?? "BotChat",
    backendUrl: readString(input.backendUrl) ?? env.BOT_CHAT_BACKEND_URL,
    botKey: readString(input.botKey) ?? env.BOT_CHAT_BOT_KEY,
    botId: readString(input.botId) ?? env.BOT_CHAT_BOT_ID ?? BOT_CHAT_DEFAULT_ACCOUNT_ID,
    mqttTcpUrl: readString(input.mqttTcpUrl) ?? env.BOT_CHAT_MQTT_TCP_URL,
    stateDir: readString(input.stateDir),
    historyCatchupLimit: readNumber(input.historyCatchupLimit) ?? 100,
    defaultTo: readString(input.defaultTo),
    allowFrom: normalizeAllowFromEntries(input.allowFrom),
    permissionApprovalEnabled: readBoolean(input.permissionApprovalEnabled) ?? false,
    permissionApprovalHandler: readString(input.permissionApprovalHandler),
    permissionApprovalUrl: readString(input.permissionApprovalUrl),
    permissionApprovalTimeoutMs: readNumber(input.permissionApprovalTimeoutMs),
    permissionDeniedReply: readString(input.permissionDeniedReply),
  };

  return normalized;
}

export function resolveBotChatAccount(
  cfg: Record<string, unknown> = {},
  accountId: string = BOT_CHAT_DEFAULT_ACCOUNT_ID,
  env: Record<string, string | undefined> = process.env,
): ResolvedBotChatAccount {
  const channels = isRecord(cfg.channels) ? cfg.channels : undefined;
  const channelCfg = isRecord(channels?.["bot-chat"])
    ? (channels?.["bot-chat"] as Record<string, unknown>)
    : cfg;
  const normalized = normalizeBotChatConfig(channelCfg, env);
  const configured = Boolean(normalized.backendUrl && normalized.botKey);
  return {
    accountId,
    name: normalized.name ?? "BotChat",
    enabled: normalized.enabled !== false,
    configured,
    backendUrl: normalized.backendUrl,
    botId: normalized.botId ?? BOT_CHAT_DEFAULT_ACCOUNT_ID,
    mqttTcpUrl: normalized.mqttTcpUrl,
    config: normalized,
  };
}

export function listBotChatAccountIds(_cfg: Record<string, unknown> = {}): string[] {
  return [BOT_CHAT_DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultBotChatAccountId(_cfg: Record<string, unknown> = {}): string {
  return BOT_CHAT_DEFAULT_ACCOUNT_ID;
}

export function hasBotChatConfiguredState(params: {
  cfg?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
} = {}): boolean {
  const account = resolveBotChatAccount(
    params.cfg ?? {},
    BOT_CHAT_DEFAULT_ACCOUNT_ID,
    params.env ?? process.env,
  );
  return account.configured;
}

export function normalizeBotChatInboundMessage(raw: unknown, topic: string): BotChatMessage | null {
  return toInboundMessage(raw, topic);
}

export function buildBotChatStatePath(config: Record<string, unknown>): string | undefined {
  const stateDir = readString(config.stateDir);
  const botId = readString(config.botId) ?? BOT_CHAT_DEFAULT_ACCOUNT_ID;
  if (!stateDir) {
    return undefined;
  }
  return path.join(stateDir, `botchat-${botId}-state.json`);
}

export function buildBotChatOutboundPayload(message: BotChatMessage): string {
  const threadId = readString(message.metadata?.threadId);
  const replyToId = readString(message.metadata?.replyToId);
  return JSON.stringify({
    id: randomId(),
    conversation_id: message.channelId,
    ...(threadId ? { thread_id: threadId } : {}),
    ...(replyToId ? { reply_to_id: replyToId } : {}),
    from: { type: "bot", id: "openclaw" },
    to: { type: "user", id: message.userId },
    content: { type: "text", body: message.text, meta: message.metadata ?? {} },
    timestamp: Math.floor(Date.now() / 1000),
  });
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
    const brokerUrl = readString(config.mqttTcpUrl) ?? readString(bootstrap.broker?.tcp_url);
    if (!brokerUrl) {
      throw new Error("mqtt broker url is required");
    }

    this.publishTopic = readString(bootstrap.publish_topics?.[0]);
    const subscriptions = readStringArray(bootstrap.subscriptions?.map((item) => item.topic));

    this.statePath = buildBotChatStatePath(config);
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
      void this.handleInbound(topic, payload.toString("utf8"), config);
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

  async onInboundMessage(message: BotChatMessage): Promise<void> {
    await this.hooks?.emitMessage?.(message);
  }

  async sendToChannel(message: BotChatMessage): Promise<void> {
    if (!this.mqttClient) {
      throw new Error("mqtt client is not ready");
    }

    const topic = readString(message.metadata?.topic) ?? this.publishTopic;
    if (!topic) {
      throw new Error("publish topic is not configured");
    }

    this.mqttClient.publish(topic, buildBotChatOutboundPayload(message), { qos: this.qos });
    this.logger?.debug?.("botchat.runtime.outbound", {
      topic,
      channelId: message.channelId,
    });
  }

  private async handleInbound(
    topic: string,
    payload: string,
    config: Record<string, unknown>,
  ): Promise<void> {
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

    const access = evaluateBotChatAccess({ config, message });
    if (!access.allowed) {
      if (access.requiresCustomApproval) {
        const approved = await this.approver?.approve({
          topic,
          message,
          permission: { allowed: false, reason: access.reason },
        });
        if (approved?.approved) {
          await this.acceptInboundMessage(message);
          return;
        }
        logger.warn("botchat.inbound.permission_denied", {
          topic,
          reason: access.reason,
          approvalReason: approved?.reason,
        });
      } else {
        logger.warn("botchat.inbound.allowlist_denied", {
          topic,
          reason: access.reason,
          userId: message.userId,
        });
      }

      if (this.permissionDeniedReply) {
        await this.sendToChannel({
          channelId: message.channelId,
          userId: message.userId,
          text: this.permissionDeniedReply,
          metadata: {
            topic,
            reason: access.reason,
          },
        });
      }
      return;
    }

    await this.acceptInboundMessage(message);
  }

  private async acceptInboundMessage(message: BotChatMessage): Promise<void> {
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

interface PermissionApprover {
  approve(request: {
    topic: string;
    message: BotChatMessage;
    permission: { allowed: boolean; reason?: string };
  }): Promise<{ approved: boolean; reason?: string }>;
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

function toInboundMessage(raw: unknown, topic: string): BotChatMessage | null {
  if (!isRecord(raw)) {
    return null;
  }

  const channelId = readString(raw.conversation_id) ?? readString(raw.dialog_id) ?? topic;
  const from = isRecord(raw.from) ? raw.from : undefined;
  const content = isRecord(raw.content) ? raw.content : undefined;
  const contentMeta = isRecord(content?.meta) ? content.meta : undefined;
  const messageId = readString(raw.id) ?? readString(raw.message_id);
  const seq = readNumber(raw.seq);
  const userId = readString(from?.id) ?? readString(raw.from_id);
  const text = readString(content?.body) ?? readString(raw.body);
  const threadId =
    readString(raw.thread_id) ?? readString(contentMeta?.threadId) ?? readString(contentMeta?.thread_id);
  const replyToId =
    readString(raw.reply_to_id) ??
    readString(contentMeta?.replyToId) ??
    readString(contentMeta?.reply_to_id);

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
      ...(contentMeta ?? {}),
      ...(threadId ? { threadId } : {}),
      ...(replyToId ? { replyToId } : {}),
    },
  };
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
  return value.map((item) => readString(item)).filter((item): item is string => Boolean(item));
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

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
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
