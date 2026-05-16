import {
  BOT_CHAT_CHANNEL_ID,
  type ChannelPlugin,
  type ChannelOutboundAdapter,
  type ResolvedBotChatAccount,
} from "./channel-api.js";
import { createBotChatPluginBase } from "./shared.js";
import { botChatStatus } from "./status.js";
import { botChatSetupAdapter } from "./channel.setup.js";
import { botChatDoctor } from "./doctor.js";
import { botChatSecrets } from "./secret-config-contract.js";
import {
  buildBotChatOutboundMessageTarget,
  getBotChatRuntime,
  resolveBotChatAccount,
} from "./runtime.js";

const botChatOutboundAdapter: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, metadata }) => {
    const account = resolveBotChatAccount(cfg, accountId ?? undefined);
    const target = buildBotChatOutboundMessageTarget({ raw: to, account, metadata });
    const result = await getBotChatRuntime().sendToChannel({
      channelId: target.channelId,
      userId: target.userId,
      text,
      metadata: {
        ...(metadata ?? {}),
        target: target.normalizedTarget,
        chatType: target.chatType,
        botId: account.botId,
        toType: target.recipientType,
        publishTopic: target.publishTopic,
      },
    });
    return {
      channel: BOT_CHAT_CHANNEL_ID,
      messageId: result.messageId,
      channelId: target.channelId,
      conversationId: target.channelId,
      timestamp: Date.now(),
      meta: {
        target: target.normalizedTarget,
        chatType: target.chatType,
        recipientType: target.recipientType,
        publishTopic: target.publishTopic,
      },
    };
  },
};

export const botChatPlugin: ChannelPlugin<ResolvedBotChatAccount> = {
  ...createBotChatPluginBase({ setup: botChatSetupAdapter }),
  doctor: botChatDoctor,
  secrets: botChatSecrets,
  status: botChatStatus,
  gateway: {
    startAccount: async (ctx) => {
      const logger = {
        info: (message: string, fields?: Record<string, unknown>) => ctx.log?.info?.(message, fields),
        warn: (message: string, fields?: Record<string, unknown>) => ctx.log?.warn?.(message, fields),
        error: (message: string, fields?: Record<string, unknown>) => ctx.log?.error?.(message, fields),
        debug: (message: string, fields?: Record<string, unknown>) => ctx.log?.debug?.(message, fields),
      };
      await getBotChatRuntime().start(ctx.account.config as Record<string, unknown>, logger, {
        emitMessage: async (message) => {
          if (message.metadata?.senderType === "bot") {
            return;
          }
          await dispatchBotChatReply({
            cfg: ctx.cfg,
            account: ctx.account,
            channelRuntime: ctx.channelRuntime,
            log: ctx.log,
            message,
          });
        },
      });
      ctx.setStatus?.({
        connected: true,
        accountId: ctx.account.accountId,
        botId: ctx.account.botId,
      });
      const stop = async () => {
        await getBotChatRuntime().stop();
        ctx.setStatus?.({ connected: false, accountId: ctx.account.accountId });
      };
      if (ctx.abortSignal) {
        await waitForAbort(ctx.abortSignal);
        await stop();
        return;
      }
      return { stop };
    },
  },
  outbound: botChatOutboundAdapter,
  approvalCapability: {
    mode: "pairing",
    description: "BotChat uses allowFrom/pairing as the primary gate and optional custom approval as a secondary blocked-message gate.",
    secondaryGate: "custom-approval",
  },
};

async function dispatchBotChatReply(params: {
  cfg: Record<string, unknown>;
  account: ResolvedBotChatAccount;
  channelRuntime?: {
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: (params: {
        ctx: Record<string, unknown>;
        cfg: Record<string, unknown>;
        dispatcherOptions: {
          deliver: (payload: { text?: string }, info?: { kind?: string }) => Promise<void>;
          onError?: (error: unknown, info?: { kind?: string }) => void;
          onSkip?: (payload: unknown, info?: { kind?: string; reason?: string }) => void;
        };
      }) => Promise<unknown>;
    };
  };
  log?: {
    warn?(message: string, fields?: Record<string, unknown>): void;
    error?(message: string, fields?: Record<string, unknown>): void;
    debug?(message: string, fields?: Record<string, unknown>): void;
  };
  message: {
    channelId: string;
    userId: string;
    text: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<void> {
  const dispatch = params.channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatch) {
    params.log?.warn?.("botchat.inbound.no_channel_runtime", {
      channelId: params.message.channelId,
      userId: params.message.userId,
    });
    return;
  }

  params.log?.debug?.("botchat.reply.dispatch_start", {
    channelId: params.message.channelId,
    userId: params.message.userId,
  });
  const replyChunks: string[] = [];
  await dispatch({
    cfg: params.cfg,
    ctx: {
      Body: params.message.text,
      CommandBody: params.message.text,
      BodyForCommands: params.message.text,
      From: params.message.userId,
      To: params.account.botId,
      SenderId: params.message.userId,
      MessageSid: String(params.message.metadata?.message_id ?? ""),
      SessionKey: `bot-chat:${params.message.channelId}`,
      ChatType: "direct",
      Provider: "BotChat",
      Surface: "BotChat",
      OriginatingChannel: BOT_CHAT_CHANNEL_ID,
      OriginatingTo: params.message.channelId,
      ExplicitDeliverRoute: true,
      NativeChannelId: params.message.channelId,
      Timestamp: Date.now(),
    },
    dispatcherOptions: {
      deliver: async (payload) => {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          return;
        }
        replyChunks.push(text);
        params.log?.debug?.("botchat.reply.buffered", {
          channelId: params.message.channelId,
          userId: params.message.userId,
          chunks: replyChunks.length,
        });
      },
      onError: (error, info) => {
        params.log?.error?.("botchat.reply.dispatch_error", {
          error: error instanceof Error ? error.message : String(error),
          kind: info?.kind,
        });
      },
      onSkip: (_payload, info) => {
        params.log?.debug?.("botchat.reply.skipped", {
          kind: info?.kind,
          reason: info?.reason,
        });
      },
    },
  });
  const replyText = mergeBotChatReplyChunks(replyChunks);
  if (replyText) {
    params.log?.debug?.("botchat.reply.deliver", {
      channelId: params.message.channelId,
      userId: params.message.userId,
      chunks: replyChunks.length,
    });
    await getBotChatRuntime().sendToChannel({
      channelId: params.message.channelId,
      userId: params.message.userId,
      text: replyText,
      metadata: {
        ...buildBotChatReplyMetadata(params.message.metadata),
        botId: params.account.botId,
        toType: "user",
        publishTopic: params.message.metadata?.topic ?? params.message.channelId,
      },
    });
  }
  params.log?.debug?.("botchat.reply.dispatch_done", {
    channelId: params.message.channelId,
    userId: params.message.userId,
  });
}

function mergeBotChatReplyChunks(chunks: string[]): string {
  const merged: string[] = [];
  for (const chunk of chunks) {
    const text = chunk.trim();
    if (!text || merged[merged.length - 1] === text) {
      continue;
    }
    merged.push(text);
  }
  return merged.join("\n\n").trim();
}

function buildBotChatReplyMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const {
    message_id: inboundMessageId,
    messageId: _messageId,
    seq: _seq,
    senderType: _senderType,
    ...replyMetadata
  } = metadata ?? {};
  const existingReplyToId =
    typeof replyMetadata.replyToId === "string" ? replyMetadata.replyToId.trim() : "";
  const sourceMessageId = typeof inboundMessageId === "string" ? inboundMessageId.trim() : "";
  const replyToId = existingReplyToId || sourceMessageId;
  return {
    ...replyMetadata,
    ...(replyToId ? { replyToId } : {}),
  };
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  if (!signal) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
