import path from "node:path";

import {
  getEnabledBots,
  type PluginConfig,
  type ResolvedBotConfig,
} from "../config";
import { BotChatHttpClient, BotChatHttpError } from "../client/http";
import {
  createRuntimeLogger,
  isRuntimeDebugEnabled,
  previewText,
  summarizeValue,
} from "../logger";
import {
  BotChatWebSocketClient,
  MultiBotWebSocketClient,
} from "../client/websocket";
import {
  buildBotSubscriptionTopics,
  normalizeBotChatMessage,
  resolveChannelContextFromDialog,
  routeIncomingMessage,
  shouldProcessMessage,
  toBotChatOutgoingMessage,
  toOpenClawRequest,
  toRealtimePublishPayload,
} from "../router/message";
import type {
  BootstrapResponse,
  BotChatMessage,
  Checkpoint,
  DialogInfo,
  OpenClawAgent,
} from "../types";
import {
  buildChannelScopeKey,
  ChannelState,
  type ChannelContext,
} from "../types/channel";
import type { PermissionCheck } from "../types/permissions";
import { CheckpointStore } from "./checkpoint";
import { SessionManager } from "./session";

const RECENT_MESSAGE_CACHE_SIZE = 2_000;

export class OpenClawBotRuntime {
  private readonly wsPool: MultiBotWebSocketClient;
  private readonly runtimes: ManagedBotRuntime[];

  constructor(
    private readonly config: PluginConfig,
    private readonly agent: OpenClawAgent,
  ) {
    const enabledBots = getEnabledBots(config);
    if (enabledBots.length === 0) {
      throw new Error("At least one enabled bot is required");
    }

    this.wsPool = new MultiBotWebSocketClient(config.botChatBaseUrl);
    this.runtimes = enabledBots.map(
      (botConfig) =>
        new ManagedBotRuntime(config, botConfig, agent, this.wsPool),
    );
  }

  async start(): Promise<void> {
    const started: ManagedBotRuntime[] = [];
    try {
      for (const runtime of this.runtimes) {
        await runtime.start();
        started.push(runtime);
      }
    } catch (error) {
      await Promise.allSettled(started.map((runtime) => runtime.stop()));
      await this.wsPool.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.runtimes.map((runtime) => runtime.stop()));
    await this.wsPool.close();
  }
}

class ManagedBotRuntime {
  private readonly checkpointStore: CheckpointStore;
  private readonly channelState = new ChannelState();
  private readonly httpClient: BotChatHttpClient;
  private readonly logger: ReturnType<typeof createRuntimeLogger>;
  private readonly sessionManager: SessionManager;
  private readonly wsClient: BotChatWebSocketClient;

  private readonly processedMessages = new Map<string, number>();
  private readonly dialogQueues = new Map<string, Promise<void>>();

  private bootstrap?: BootstrapResponse;
  private botId?: string;
  private stopped = false;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: PluginConfig,
    private readonly botConfig: ResolvedBotConfig,
    private readonly agent: OpenClawAgent,
    wsPool: MultiBotWebSocketClient,
  ) {
    const botStateDir = path.join(
      config.stateDir,
      sanitizeStateKey(botConfig.key),
    );
    this.logger = createRuntimeLogger(this.logPrefix());

    this.httpClient = new BotChatHttpClient(
      config.botChatBaseUrl,
      botConfig.accessKey,
      config.httpTimeoutMs,
    );
    this.checkpointStore = new CheckpointStore(
      path.join(botStateDir, "checkpoints.json"),
    );
    this.sessionManager = new SessionManager(
      path.join(botStateDir, "sessions.json"),
    );
    this.wsClient = wsPool.register(botConfig.key, {
      accessKey: botConfig.accessKey,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      reconnectBaseDelayMs: config.reconnectBaseDelayMs,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs,
      onError: (error) => {
        this.logger.error("websocket.error", undefined, error);
      },
      onHello: () => {
        this.logger.info("websocket.hello", {
          sessionId: this.wsClient.getSessionId(),
          heartbeatIntervalMs: this.wsClient.getHeartbeatIntervalMs(),
        });
        this.scheduleHeartbeat();
      },
      onMessage: async (frame) => {
        const message = normalizeBotChatMessage(frame.payload, frame.topic);
        if (message) {
          await this.handleIncomingMessage(message);
        }
      },
      onReconnect: async () => {
        this.logger.warn("websocket.reconnected", {
          sessionId: this.wsClient.getSessionId(),
        });
        await this.recoverPendingMessages();
      },
      onStateChange: (state) => {
        this.logger.info("websocket.state_changed", { state });
      },
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.logger.info("runtime.starting", {
      serviceUrl: this.config.botChatBaseUrl,
      stateDir: this.config.stateDir,
      botId: this.botConfig.id,
    });
    await this.sessionManager.load();
    await this.checkpointStore.load();

    this.bootstrap = await this.loadBootstrap();
    this.botId = this.botConfig.id ?? this.bootstrap.bot.id;
    if (!this.botId) {
      throw new Error(
        `${this.logPrefix()} BOT_ID is required when bootstrap does not return a bot id`,
      );
    }

    await this.checkpointStore.merge(this.bootstrap.checkpoints);
    await this.sessionManager.restoreFromCheckpoints(
      this.bootstrap.checkpoints,
    );
    this.hydrateChannelState();

    const topics = buildBotSubscriptionTopics(
      this.botId,
      this.bootstrap.groups,
      this.bootstrap.subscriptions,
      this.bootstrap.dialogs,
      this.bootstrap.transport_policy,
    );
    this.logger.info("runtime.bootstrap.loaded", {
      resolvedBotId: this.botId,
      groups: this.bootstrap.groups.length,
      dialogs: this.bootstrap.dialogs.length,
      subscriptions: this.bootstrap.subscriptions.length,
      checkpoints: this.bootstrap.checkpoints.length,
      topics: topics.length,
    });
    for (const topic of topics) {
      this.wsClient.subscribe(topic);
    }

    await this.wsClient.connect();
    this.scheduleHeartbeat();
    await this.recoverPendingMessages();
    this.logger.info("runtime.started", {
      resolvedBotId: this.botId,
      sessionId: this.wsClient.getSessionId(),
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    await this.checkpointStore.flush();
    await this.sessionManager.flush();
    await this.wsClient.close();
    this.logger.info("runtime.stopped", {
      resolvedBotId: this.botId,
      sessionId: this.wsClient.getSessionId(),
    });
  }

  private async loadBootstrap(): Promise<BootstrapResponse> {
    try {
      return await this.httpClient.bootstrap();
    } catch (error) {
      if (error instanceof BotChatHttpError && error.status === 404) {
        if (!this.botConfig.id) {
          throw new Error(
            `${this.logPrefix()} bootstrap endpoint is unavailable and bot id is not configured`,
          );
        }
        return {
          bot: {
            id: this.botConfig.id,
          },
          groups: [],
          dialogs: [],
          subscriptions: [],
          checkpoints: [],
          transport_policy: {
            heartbeat_interval_ms: this.config.heartbeatIntervalMs,
            base_reconnect_delay_ms: this.config.reconnectBaseDelayMs,
            max_reconnect_delay_ms: this.config.reconnectMaxDelayMs,
          },
        };
      }
      throw error;
    }
  }

  private hydrateChannelState(): void {
    const botId = this.botId;
    if (!botId) {
      return;
    }

    for (const dialog of this.bootstrap?.dialogs ?? []) {
      this.trackDialog(dialog, botId);
    }

    for (const [dialogId, sessionId] of this.sessionManager.entries()) {
      const channel = resolveChannelContextFromDialog(dialogId, botId);
      this.channelState.setSession(channel, dialogId, sessionId);
    }

    for (const checkpoint of this.checkpointStore.values()) {
      const channel = resolveChannelContextFromDialog(
        checkpoint.dialog_id,
        botId,
      );
      this.channelState.setCheckpoint(channel, checkpoint);
    }
  }

  private async handleIncomingMessage(message: BotChatMessage): Promise<void> {
    if (!this.botId) {
      this.logger.warn("message.skipped.no_bot_id", {
        messageId: message.message_id,
        dialogId: message.dialog_id,
      });
      return;
    }
    if (!shouldProcessMessage(message, this.botId)) {
      if (isRuntimeDebugEnabled()) {
        this.logger.debug("message.skipped.filtered", this.summarizeIncomingMessage(message));
      }
      return;
    }
    if (this.isMessageProcessed(message.message_id)) {
      if (isRuntimeDebugEnabled()) {
        this.logger.debug("message.skipped.duplicate", this.summarizeIncomingMessage(message));
      }
      return;
    }

    const routed = routeIncomingMessage(message, this.botId, this.botConfig);
    const queueKey = `${buildChannelScopeKey(routed.channel)}::${message.dialog_id}`;

    this.logger.debug("message.received", {
      ...this.summarizeIncomingMessage(message),
      action: routed.action,
      queueKey,
      permissionAllowed: routed.permission.allowed,
    });

    await this.enqueueByDialog(queueKey, async () => {
      const startedAt = Date.now();
      try {
        const botId = this.botId;
        if (!botId || this.isMessageProcessed(message.message_id)) {
          return;
        }

        this.trackDialog(buildDialogInfo(message), botId, routed.channel);
        const checkpoint =
          this.channelState.getCheckpoint(routed.channel, message.dialog_id) ??
          this.checkpointStore.get(message.dialog_id);

        if (!routed.permission.allowed) {
          this.logPermissionDenied(routed.permission, routed.channel, message);
          const existingSessionId =
            this.channelState.getSession(routed.channel, message.dialog_id) ??
            this.sessionManager.get(message.dialog_id) ??
            checkpoint?.session_id;
          await this.saveCheckpoint(message, existingSessionId, routed.channel);
          this.markMessageProcessed(message.message_id);
          return;
        }

        const sessionId =
          this.channelState.getSession(routed.channel, message.dialog_id) ??
          (await this.sessionManager.getOrCreate(
            message.dialog_id,
            checkpoint?.session_id,
          ));
        this.channelState.setSession(
          routed.channel,
          message.dialog_id,
          sessionId,
        );

        const request = toOpenClawRequest(message, sessionId, routed.channel);
        this.logger.debug("agent.request.prepared", {
          ...this.summarizeIncomingMessage(message),
          sessionId,
          requestMetadata: summarizeValue(request.metadata),
        });

        const response = await this.agent.respond(request);
        const outgoing = toBotChatOutgoingMessage(response, message, botId);

        this.logger.debug("agent.response.received", {
          messageId: message.message_id,
          dialogId: message.dialog_id,
          sessionId,
          responsePreview: previewText(response.content),
          responseMetadata: summarizeValue(response.metadata),
          hasOutgoingMessage: Boolean(outgoing),
        });

        if (outgoing) {
          await this.dispatchReply(outgoing, message, botId);
        } else {
          this.logger.warn("reply.skipped.empty", {
            messageId: message.message_id,
            dialogId: message.dialog_id,
            sessionId,
          });
        }

        await this.saveCheckpoint(message, sessionId, routed.channel);
        this.markMessageProcessed(message.message_id);
        this.logger.info("message.processed", {
          ...this.summarizeIncomingMessage(message),
          sessionId,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        this.logger.error(
          "message.processing_failed",
          {
            ...this.summarizeIncomingMessage(message),
            queueKey,
            durationMs: Date.now() - startedAt,
          },
          error,
        );
        throw error;
      }
    });
  }

  private async dispatchReply(
    outgoing: NonNullable<ReturnType<typeof toBotChatOutgoingMessage>>,
    sourceMessage: BotChatMessage,
    botId: string,
  ): Promise<void> {
    const startedAt = Date.now();
    this.logger.debug("reply.dispatch.start", {
      sourceMessageId: sourceMessage.message_id,
      dialogId: sourceMessage.dialog_id,
      replyMessageId: outgoing.message_id,
      topic: outgoing.topic,
      contentType: outgoing.content_type,
      bodyPreview: previewText(outgoing.body),
    });

    try {
      await this.httpClient.sendMessage(outgoing);
      this.logger.info("reply.dispatch.http_success", {
        sourceMessageId: sourceMessage.message_id,
        dialogId: sourceMessage.dialog_id,
        replyMessageId: outgoing.message_id,
        durationMs: Date.now() - startedAt,
      });
      return;
    } catch (error) {
      const shouldFallback =
        error instanceof BotChatHttpError &&
        (error.status === 404 || error.status === 405 || error.status >= 500);

      if (!shouldFallback) {
        this.logger.error(
          "reply.dispatch.http_failed",
          {
            sourceMessageId: sourceMessage.message_id,
            dialogId: sourceMessage.dialog_id,
            replyMessageId: outgoing.message_id,
            durationMs: Date.now() - startedAt,
            status: error instanceof BotChatHttpError ? error.status : undefined,
            responseBody:
              error instanceof BotChatHttpError
                ? summarizeValue(error.responseBody)
                : undefined,
          },
          error,
        );
        throw error;
      }

      this.logger.warn("reply.dispatch.http_fallback", {
        sourceMessageId: sourceMessage.message_id,
        dialogId: sourceMessage.dialog_id,
        replyMessageId: outgoing.message_id,
        durationMs: Date.now() - startedAt,
        status: error.status,
        responseBody: summarizeValue(error.responseBody),
      });
    }

    const publishFrame = toRealtimePublishPayload(
      outgoing,
      sourceMessage,
      botId,
    );
    this.wsClient.publish(
      publishFrame.topic,
      publishFrame.payload,
      outgoing.message_id,
    );
    this.logger.info("reply.dispatch.ws_publish", {
      sourceMessageId: sourceMessage.message_id,
      dialogId: sourceMessage.dialog_id,
      replyMessageId: outgoing.message_id,
      topic: publishFrame.topic,
      durationMs: Date.now() - startedAt,
    });
  }

  private async recoverPendingMessages(): Promise<void> {
    const dialogIds = new Set<string>();

    for (const dialog of this.bootstrap?.dialogs ?? []) {
      dialogIds.add(dialog.dialog_id);
    }
    for (const checkpoint of this.checkpointStore.values()) {
      dialogIds.add(checkpoint.dialog_id);
    }

    this.logger.info("recovery.start", {
      dialogs: dialogIds.size,
    });
    for (const dialogId of dialogIds) {
      await this.recoverDialog(dialogId);
    }
    this.logger.info("recovery.complete", {
      dialogs: dialogIds.size,
    });
  }

  private async recoverDialog(dialogId: string): Promise<void> {
    const checkpoint = this.checkpointStore.get(dialogId);

    let rawMessages: unknown[];
    try {
      rawMessages = await this.httpClient.getDialogMessages(dialogId, {
        ...(checkpoint?.last_seq !== undefined
          ? { afterSeq: checkpoint.last_seq }
          : {}),
        limit: 200,
      });
    } catch (error) {
      if (error instanceof BotChatHttpError && error.status === 404) {
        return;
      }
      throw error;
    }

    const messages = rawMessages
      .map((item) => normalizeBotChatMessage(item))
      .filter((item): item is BotChatMessage => item !== null)
      .filter((item) => {
        if (item.dialog_id !== dialogId) {
          return false;
        }
        if (checkpoint?.last_seq !== undefined && item.seq !== undefined) {
          return item.seq > checkpoint.last_seq;
        }
        return !this.isMessageProcessed(item.message_id);
      })
      .sort((left, right) => {
        const leftSeq = left.seq ?? 0;
        const rightSeq = right.seq ?? 0;
        if (leftSeq !== rightSeq) {
          return leftSeq - rightSeq;
        }
        return left.timestamp - right.timestamp;
      });

    if (messages.length > 0 || isRuntimeDebugEnabled()) {
      this.logger.debug("recovery.dialog_messages", {
        dialogId,
        fetched: rawMessages.length,
        replaying: messages.length,
        checkpointSeq: checkpoint?.last_seq,
        checkpointMessageId: checkpoint?.last_message_id,
      });
    }

    for (const message of messages) {
      await this.handleIncomingMessage(message);
    }
  }

  private async saveCheckpoint(
    message: BotChatMessage,
    sessionId: string | undefined,
    channel: ChannelContext,
  ): Promise<void> {
    const nextCheckpoint: Checkpoint = {
      dialog_id: message.dialog_id,
      last_message_id: message.message_id,
      updated_at: Date.now(),
      ...(message.seq !== undefined ? { last_seq: message.seq } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    };

    this.channelState.setCheckpoint(channel, nextCheckpoint);
    await this.checkpointStore.update(nextCheckpoint);
    if (sessionId) {
      this.channelState.setSession(channel, message.dialog_id, sessionId);
      await this.sessionManager.set(message.dialog_id, sessionId);
    }

    this.logger.debug("checkpoint.saved", {
      dialogId: message.dialog_id,
      messageId: message.message_id,
      sessionId,
      seq: message.seq,
      channelId: channel.id,
      channelType: channel.type,
    });
  }

  private scheduleHeartbeat(): void {
    if (!this.botId) {
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    const interval = Math.max(
      5_000,
      Math.floor(this.wsClient.getHeartbeatIntervalMs() * 0.8),
    );

    const runHeartbeat = async (): Promise<void> => {
      if (!this.botId || this.stopped) {
        return;
      }

      try {
        await this.httpClient.sendHeartbeat({
          session_id: this.wsClient.getSessionId(),
          bot_id: this.botId,
          subscriptions: this.wsClient.getSubscribedTopics(),
          checkpoints: this.checkpointStore.values(),
          timestamp: Date.now(),
        });
        // if (isRuntimeDebugEnabled()) {
        //   this.logger.debug("heartbeat.sent", {
        //     botId: this.botId,
        //     sessionId: this.wsClient.getSessionId(),
        //     subscriptions: this.wsClient.getSubscribedTopics().length,
        //     checkpoints: this.checkpointStore.values().length,
        //   });
        // }
      } catch (error) {
        if (error instanceof BotChatHttpError && error.status === 404) {
          return;
        }
        this.logger.error(
          "heartbeat.failed",
          {
            botId: this.botId,
            sessionId: this.wsClient.getSessionId(),
          },
          error,
        );
      }
    };

    this.heartbeatTimer = setInterval(() => {
      void runHeartbeat();
    }, interval);

    void runHeartbeat();
  }

  private isMessageProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  private markMessageProcessed(messageId: string): void {
    this.processedMessages.set(messageId, Date.now());
    if (this.processedMessages.size <= RECENT_MESSAGE_CACHE_SIZE) {
      return;
    }

    const entries = [...this.processedMessages.entries()].sort(
      (left, right) => left[1] - right[1],
    );
    for (const [id] of entries.slice(
      0,
      entries.length - RECENT_MESSAGE_CACHE_SIZE,
    )) {
      this.processedMessages.delete(id);
    }
  }

  private async enqueueByDialog(
    queueKey: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const current = this.dialogQueues.get(queueKey) ?? Promise.resolve();
    const next = current
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.dialogQueues.get(queueKey) === next) {
          this.dialogQueues.delete(queueKey);
        }
      });

    this.dialogQueues.set(queueKey, next);
    return next;
  }

  private trackDialog(
    dialog: DialogInfo,
    botId: string,
    channel?: ChannelContext,
  ): void {
    const resolvedChannel =
      channel ??
      resolveChannelContextFromDialog(
        dialog.dialog_id,
        botId,
        dialog.topic ? { topic: dialog.topic } : undefined,
      );
    this.channelState.trackDialog(resolvedChannel, dialog);
  }

  private logPermissionDenied(
    permission: PermissionCheck,
    channel: ChannelContext,
    message: BotChatMessage,
  ): void {
    this.logger.warn("message.permission_denied", {
      code: permission.code ?? "PERMISSION_DENIED",
      reason: permission.reason ?? "permission denied",
      required: permission.required ?? [],
      botId: this.botId,
      dialogId: message.dialog_id,
      messageId: message.message_id,
      channelId: channel.id,
      channelType: channel.type,
      userId: message.from_id,
    });
  }

  private logPrefix(): string {
    return `[openclaw-bot-chat:${this.botConfig.key}]`;
  }

  private summarizeIncomingMessage(
    message: BotChatMessage,
  ): Record<string, unknown> {
    return {
      messageId: message.message_id,
      dialogId: message.dialog_id,
      fromType: message.from_type,
      fromId: message.from_id,
      toType: message.to_type,
      toId: message.to_id,
      contentType: message.content_type,
      seq: message.seq,
      timestamp: message.timestamp,
      bodyPreview: previewText(message.body),
      metadata: summarizeValue(message.meta),
    };
  }
}

function buildDialogInfo(message: BotChatMessage): DialogInfo {
  const topic = readString(message.meta?.["topic"]);
  return {
    dialog_id: message.dialog_id,
    ...(topic ? { topic } : {}),
    ...(message.seq !== undefined ? { last_seq: message.seq } : {}),
    last_message_id: message.message_id,
    updated_at: message.timestamp,
  };
}

function sanitizeStateKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
