import type {
  ChannelSecretsAdapter,
  SecretRef,
  SecretTargetRegistryEntry,
} from "./channel-api.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretRef(value: unknown): value is SecretRef {
  return (
    isRecord(value) &&
    (value.source === "env" || value.source === "file" || value.source === "exec") &&
    typeof value.provider === "string" &&
    typeof value.id === "string"
  );
}

function getBotChatChannelConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const channels = isRecord(config.channels) ? config.channels : undefined;
  if (isRecord(channels?.["bot-chat"])) {
    return channels["bot-chat"] as Record<string, unknown>;
  }
  return isRecord(config) ? config : null;
}

export const secretTargetRegistryEntries = [
  {
    id: "channels.bot-chat.botKey",
    targetType: "channels.bot-chat.botKey",
    configFile: "openclaw.json",
    pathPattern: "channels.bot-chat.botKey",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
] satisfies SecretTargetRegistryEntry[];

export function collectRuntimeConfigAssignments(params: Parameters<NonNullable<ChannelSecretsAdapter["collectRuntimeConfigAssignments"]>>[0]): void {
  const botChat = getBotChatChannelConfig(params.config);
  if (!botChat || !isSecretRef(botChat.botKey)) {
    return;
  }
  params.context.assignments.push({
    ref: botChat.botKey,
    path: "channels.bot-chat.botKey",
    expected: "string",
    apply: (value) => {
      if (typeof value === "string") {
        botChat.botKey = value;
      }
    },
  });
}

export const botChatSecrets: ChannelSecretsAdapter = {
  secretTargetRegistryEntries,
  collectRuntimeConfigAssignments,
};
