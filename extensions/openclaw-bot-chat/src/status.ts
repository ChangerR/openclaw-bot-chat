import type { ChannelStatusAdapter, ResolvedBotChatAccount } from "./channel-api.js";
import {
  buildBotChatStatePath,
  collectBotChatConfigIssues,
  resolveBotChatAccount,
} from "./runtime.js";

export const botChatStatus: ChannelStatusAdapter<ResolvedBotChatAccount> = {
  getSnapshot: ({ cfg, accountId, runtimeState }) => {
    const account = resolveBotChatAccount(cfg, accountId);
    return {
      accountId: account.accountId,
      configured: account.configured,
      connected: Boolean(runtimeState?.connected),
      botId: account.botId,
      backendUrl: account.backendUrl,
      mqttTcpUrl: account.mqttTcpUrl,
      lastError:
        typeof runtimeState?.lastError === "string" ? runtimeState.lastError : undefined,
      approvalMode: "pairing",
      allowFromCount: account.config.allowFrom?.length ?? 0,
      hasDefaultTo: Boolean(account.config.defaultTo),
      historyCatchupLimit: account.config.historyCatchupLimit ?? 100,
      statePathConfigured: Boolean(buildBotChatStatePath(account.config as Record<string, unknown>)),
      issues: collectBotChatConfigIssues(account.config as Record<string, unknown>),
    };
  },
  describeAccount: (account) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    backendUrl: account.backendUrl,
    mqttTcpUrl: account.mqttTcpUrl,
    approvalMode: "pairing",
    allowFromCount: account.config.allowFrom?.length ?? 0,
  }),
};
