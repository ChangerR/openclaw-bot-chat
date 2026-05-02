import type { ChannelDoctorAdapter } from "./channel-api.js";
import { collectBotChatConfigIssues } from "./runtime.js";

function formatIssue(issue: ReturnType<typeof collectBotChatConfigIssues>[number]): string {
  const prefix = issue.severity === "error" ? "error" : "warning";
  return `- BotChat ${prefix} ${issue.code} at ${issue.path}: ${issue.message}`;
}

export const botChatDoctor: ChannelDoctorAdapter = {
  dmAllowFromMode: "topOnly",
  groupModel: "sender",
  groupAllowFromFallbackToAllowFrom: true,
  warnOnEmptyGroupSenderAllowlist: false,
  collectPreviewWarnings: ({ cfg }) =>
    collectBotChatConfigIssues(cfg)
      .filter((issue) => issue.severity === "warning")
      .map(formatIssue),
  repairConfig: ({ cfg }) => ({
    config: cfg,
    changes: [],
    warnings: collectBotChatConfigIssues(cfg).map(formatIssue),
  }),
  runConfigSequence: ({ cfg }) => ({
    changeNotes: [],
    warningNotes: collectBotChatConfigIssues(cfg).map(formatIssue),
  }),
};
