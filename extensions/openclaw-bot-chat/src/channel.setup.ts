import type { ChannelSetupAdapter } from "./channel-api.js";
import { BOT_CHAT_CHANNEL_ID, type ChannelPlugin, type ResolvedBotChatAccount } from "./channel-api.js";
import { createBotChatPluginBase, coerceBotChatSetupInput } from "./shared.js";

export const botChatSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, input }) => {
    const channels =
      cfg.channels && typeof cfg.channels === "object" && !Array.isArray(cfg.channels)
        ? { ...(cfg.channels as Record<string, unknown>) }
        : {};
    channels[BOT_CHAT_CHANNEL_ID] = {
      ...(typeof channels[BOT_CHAT_CHANNEL_ID] === "object" &&
      channels[BOT_CHAT_CHANNEL_ID] !== null &&
      !Array.isArray(channels[BOT_CHAT_CHANNEL_ID])
        ? (channels[BOT_CHAT_CHANNEL_ID] as Record<string, unknown>)
        : {}),
      ...input,
    };
    return {
      ...cfg,
      channels,
    };
  },
  validateConfig: (input) => {
    const normalized = coerceBotChatSetupInput(input);
    const errors: string[] = [];
    if (!normalized.backendUrl) {
      errors.push("backendUrl is required");
    }
    if (!normalized.botKey) {
      errors.push("botKey is required");
    }
    return {
      ok: errors.length === 0,
      errors,
    };
  },
};

export const botChatSetupPlugin: Pick<
  ChannelPlugin<ResolvedBotChatAccount>,
  "id" | "meta" | "capabilities" | "reload" | "configSchema" | "config" | "setup" | "messaging" | "security"
> = {
  ...createBotChatPluginBase({ setup: botChatSetupAdapter }),
};
