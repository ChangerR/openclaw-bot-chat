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
  base: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
  },
  attachedResults: {
    channel: BOT_CHAT_CHANNEL_ID,
    sendText: async ({ cfg, to, text, accountId, metadata }) => {
      const account = resolveBotChatAccount(cfg, accountId);
      const target = buildBotChatOutboundMessageTarget({ raw: to, account, metadata });
      await getBotChatRuntime().sendToChannel({
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
        ok: true,
        channel: BOT_CHAT_CHANNEL_ID,
        channelId: target.channelId,
        text,
      };
    },
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
        emitMessage: ctx.channelRuntime?.emitMessage,
      });
      ctx.setStatus?.({
        connected: true,
        accountId: ctx.account.accountId,
        botId: ctx.account.botId,
      });
      return {
        stop: async () => {
          await getBotChatRuntime().stop();
          ctx.setStatus?.({ connected: false, accountId: ctx.account.accountId });
        },
      };
    },
  },
  outbound: botChatOutboundAdapter,
  approvalCapability: {
    mode: "pairing",
    description: "BotChat uses allowFrom/pairing as the primary gate and optional custom approval as a secondary blocked-message gate.",
    secondaryGate: "custom-approval",
  },
};
