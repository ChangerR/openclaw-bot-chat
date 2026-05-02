import { randomUUID } from "node:crypto";

const DEFAULTS = Object.freeze({
  skillPath: "/home/admin/.openclaw/workspace/memory-layers-skill",
  vaultPath: "/home/admin/.openclaw/workspace/mymem",
  transcriptLimit: 96,
  transcriptCharLimit: 32000,
  timeoutMs: 180000
});

const activeSessions = new Set();

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolvePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function resolvePluginConfig(pluginConfig) {
  const config = pluginConfig && typeof pluginConfig === "object" ? pluginConfig : {};
  const skillPath = isNonEmptyString(config.skillPath) ? config.skillPath.trim() : DEFAULTS.skillPath;
  const vaultPath = isNonEmptyString(config.vaultPath) ? config.vaultPath.trim() : DEFAULTS.vaultPath;

  return {
    skillPath,
    vaultPath,
    scriptsPath: `${skillPath}/scripts`,
    vaultConfigPath: `${vaultPath}/.config.json`,
    transcriptLimit: Math.min(resolvePositiveInteger(config.transcriptLimit, DEFAULTS.transcriptLimit), 200),
    transcriptCharLimit: Math.min(
      resolvePositiveInteger(config.transcriptCharLimit, DEFAULTS.transcriptCharLimit),
      120000
    ),
    timeoutMs: Math.min(resolvePositiveInteger(config.timeoutMs, DEFAULTS.timeoutMs), 900000)
  };
}

function isMainQqbotDirectSession(sessionKey) {
  return isNonEmptyString(sessionKey) && sessionKey.startsWith("agent:main:") && sessionKey.includes("qqbot:direct:");
}

function readNumericContext(context, key) {
  return typeof context?.[key] === "number" && Number.isFinite(context[key]) ? context[key] : undefined;
}

function squashWhitespace(value) {
  return value.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function blockToText(value) {
  if (typeof value === "string") return squashWhitespace(value);
  if (Array.isArray(value)) {
    return squashWhitespace(value.map((item) => blockToText(item)).filter(Boolean).join("\n"));
  }
  if (!value || typeof value !== "object") return "";

  if (typeof value.text === "string") return squashWhitespace(value.text);
  if (typeof value.input === "string") return squashWhitespace(value.input);
  if (typeof value.output === "string") return squashWhitespace(value.output);
  if (typeof value.transcript === "string") return squashWhitespace(value.transcript);
  if (typeof value.content === "string") return squashWhitespace(value.content);
  if (Array.isArray(value.content)) return blockToText(value.content);
  if (typeof value.message === "string") return squashWhitespace(value.message);
  if (typeof value.aggregated === "string") return squashWhitespace(value.aggregated);
  if (typeof value.reasoning === "string") return squashWhitespace(value.reasoning);

  if (typeof value.type === "string" && typeof value.name === "string") {
    return `[${value.type}:${value.name}]`;
  }

  return "";
}

function extractRole(entry) {
  const payload = entry && typeof entry === "object" && entry.message && typeof entry.message === "object"
    ? entry.message
    : entry;

  const candidates = [
    payload?.role,
    entry?.role,
    payload?.senderRole,
    entry?.senderRole,
    entry?.type
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) return candidate.trim();
  }

  return "unknown";
}

function extractText(entry) {
  const payload = entry && typeof entry === "object" && entry.message && typeof entry.message === "object"
    ? entry.message
    : entry;

  const candidates = [
    payload?.content,
    payload?.parts,
    payload?.text,
    payload?.body,
    entry?.content,
    entry?.text,
    entry?.details?.aggregated
  ];

  for (const candidate of candidates) {
    const text = blockToText(candidate);
    if (text) return text;
  }

  return "";
}

function formatTranscript(messages, charLimit) {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  const lines = [];
  let used = 0;

  for (const entry of messages) {
    const text = extractText(entry);
    if (!text) continue;

    const role = extractRole(entry);
    const line = `[${role}] ${text}`;
    const nextSize = used + line.length + 1;

    if (nextSize > charLimit) {
      const remaining = Math.max(charLimit - used - "[truncated]".length - 1, 0);
      if (remaining > 32) {
        lines.push(`${line.slice(0, remaining).trimEnd()}...`);
      }
      lines.push("[truncated]");
      break;
    }

    lines.push(line);
    used = nextSize;
  }

  return lines.join("\n");
}

function buildCompactionSummary(context) {
  const parts = [];
  const compactedCount = readNumericContext(context, "compactedCount");
  const summaryLength = readNumericContext(context, "summaryLength");
  const tokensBefore = readNumericContext(context, "tokensBefore");
  const tokensAfter = readNumericContext(context, "tokensAfter");

  if (compactedCount !== undefined) parts.push(`compactedCount=${compactedCount}`);
  if (summaryLength !== undefined) parts.push(`summaryLength=${summaryLength}`);
  if (tokensBefore !== undefined) parts.push(`tokensBefore=${tokensBefore}`);
  if (tokensAfter !== undefined) parts.push(`tokensAfter=${tokensAfter}`);

  return parts.length > 0 ? parts.join(", ") : "unavailable";
}

function buildPrompt({ sessionKey, context, transcript, config }) {
  return [
    "You are the background distill worker triggered by OpenClaw after session compaction.",
    "",
    "Source session:",
    sessionKey,
    "",
    "Compaction stats:",
    buildCompactionSummary(context),
    "",
    "Read and follow these local files before acting:",
    `- Skill: ${config.skillPath}/SKILL.md`,
    `- Auto-distill workflow: ${config.skillPath}/workflows/auto-distill.md`,
    `- Distill workflow: ${config.skillPath}/workflows/distill.md`,
    `- Vault config: ${config.vaultConfigPath}`,
    `- Vault root: ${config.vaultPath}`,
    `- Index script: ${config.scriptsPath}/memory-layers-index.sh`,
    "",
    "Task:",
    "1. Inspect the provided transcript and decide whether it contains durable value worth distilling.",
    "   Worth distilling means at least one of:",
    "   - a user decision with future value",
    "   - a concrete pitfall or failure lesson",
    "   - a breakthrough insight or clarified principle",
    "2. If nothing is worth distilling:",
    "   - do not write any file",
    "   - do not send any message",
    "   - end with exactly: NO_DISTILL",
    "3. If the transcript is worth distilling:",
    "   - execute the memory-layers full five-layer distill flow (L1-L5)",
    "   - ground every layer in evidence from the transcript and any relevant existing vault files",
    "   - write or update markdown files under the vault's layers directories",
    "   - keep filenames specific and reusable",
    "   - update layers/.index.json if you create or materially update L3/L4 knowledge",
    "   - index every written layer item with memory-layers-index.sh",
    "   - after successful writes, use the shared message tool exactly once to report back to the current qqbot chat",
    "   - that qqbot report must be brief and include what was distilled plus written file paths",
    "   - after that tool call, end with exactly: DISTILLED",
    "4. Never ask the user follow-up questions. This is a background job.",
    "",
    "Transcript follows:",
    "```text",
    transcript,
    "```"
  ].join("\n");
}

function buildExtraSystemPrompt() {
  return [
    "You are a deterministic OpenClaw memory-distillation worker.",
    "Use the local memory-layers skill workflow, not your own improvised process.",
    "Stay silent when there is no durable value to keep.",
    "When there is durable value, write the vault artifacts first, then send one short message with the shared message tool, then end with DISTILLED."
  ].join(" ");
}

async function readFinalSubagentText(subagentRuntime, sessionKey) {
  try {
    const { messages } = await subagentRuntime.getSessionMessages({ sessionKey, limit: 8 });
    if (!Array.isArray(messages)) return "";

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      const role = extractRole(entry);
      if (!role.includes("assistant")) continue;

      const text = extractText(entry);
      if (text) return text;
    }
  } catch {
    return "";
  }

  return "";
}

export default {
  id: "openclaw-distill-hook",
  name: "OpenClaw Distill Hook",
  description: "Run memory distillation after main QQBot direct-session compaction.",
  register(api) {
    const subagentRuntime = api.runtime?.subagent;
    if (!subagentRuntime) {
      api.logger.warn("openclaw-distill-hook: api.runtime.subagent is unavailable; hook will stay inactive.");
      return;
    }

    api.registerHook(
      "session:compact:after",
      async (event) => {
        const sessionKey = isNonEmptyString(event?.sessionKey) ? event.sessionKey.trim() : "";
        if (!isMainQqbotDirectSession(sessionKey)) return;
        if (activeSessions.has(sessionKey)) return;

        const config = resolvePluginConfig(api.pluginConfig);
        const context = event?.context && typeof event.context === "object" ? event.context : {};
        let childSessionKey = "";

        activeSessions.add(sessionKey);

        try {
          const { messages } = await subagentRuntime.getSessionMessages({
            sessionKey,
            limit: config.transcriptLimit
          });

          const transcript = formatTranscript(messages, config.transcriptCharLimit);
          if (!transcript) {
            api.logger.info(`openclaw-distill-hook: skipped ${sessionKey} because the transcript was empty.`);
            return;
          }

          childSessionKey = `openclaw-distill-hook:${Date.now()}:${randomUUID()}`;

          const { runId } = await subagentRuntime.run({
            sessionKey: childSessionKey,
            message: buildPrompt({ sessionKey, context, transcript, config }),
            extraSystemPrompt: buildExtraSystemPrompt(),
            deliver: false
          });

          const result = await subagentRuntime.waitForRun({
            runId,
            timeoutMs: config.timeoutMs
          });

          const finalText = await readFinalSubagentText(subagentRuntime, childSessionKey);
          const normalizedFinalText = finalText.trim().toUpperCase();

          if (result.status !== "ok") {
            api.logger.warn(
              `openclaw-distill-hook: subagent ended with status=${result.status} for ${sessionKey}${
                result.error ? ` error=${result.error}` : ""
              }`
            );
            return;
          }

          if (normalizedFinalText === "NO_DISTILL") {
            api.logger.info(`openclaw-distill-hook: no durable content detected for ${sessionKey}.`);
            return;
          }

          if (normalizedFinalText === "DISTILLED") {
            api.logger.info(`openclaw-distill-hook: distillation completed for ${sessionKey}.`);
            return;
          }

          api.logger.info(
            `openclaw-distill-hook: subagent completed for ${sessionKey} with unexpected final marker: ${
              finalText || "<empty>"
            }`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          api.logger.warn(`openclaw-distill-hook: failed for ${sessionKey}: ${message}`);
        } finally {
          activeSessions.delete(sessionKey);

          if (childSessionKey) {
            try {
              await subagentRuntime.deleteSession({ sessionKey: childSessionKey });
            } catch {
              // Best-effort cleanup only.
            }
          }
        }
      },
      {
        name: "openclaw-distill-hook",
        description: "Spawn a background memory distillation worker after QQBot direct-session compaction."
      }
    );
  }
};
