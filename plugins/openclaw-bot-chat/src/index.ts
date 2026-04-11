import path from "node:path";

import { loadConfig, type PluginConfig } from "./config";
import { OpenClawBotRuntime } from "./runtime/bot";
import type { OpenClawAgent, OpenClawRequest, OpenClawResponse } from "./types";

export async function main(): Promise<void> {
  const config = await loadConfig();
  const agent = await createOpenClawAgent(config);
  const runtime = new OpenClawBotRuntime(config, agent);

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[openclaw-bot-chat] shutting down on ${signal}`);
    await runtime.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await runtime.start();
  console.info("[openclaw-bot-chat] runtime started");
}

export async function createOpenClawAgent(
  config: PluginConfig,
): Promise<OpenClawAgent> {
  if (config.openClawAgentHandler) {
    return loadHandlerAgent(config.openClawAgentHandler);
  }
  if (config.openClawAgentUrl) {
    return createHttpAgent(config.openClawAgentUrl, config.openClawAgentTimeoutMs);
  }

  return {
    async respond(): Promise<OpenClawResponse> {
      return {
        content:
          "OpenClaw agent is not configured. Set OPENCLAW_AGENT_HANDLER or OPENCLAW_AGENT_URL.",
      };
    },
  };
}

async function loadHandlerAgent(handlerPath: string): Promise<OpenClawAgent> {
  const resolvedPath = path.isAbsolute(handlerPath)
    ? handlerPath
    : path.resolve(process.cwd(), handlerPath);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require(resolvedPath) as unknown;

  const candidate =
    readRespondFunction(loaded) ??
    (loaded &&
    typeof loaded === "object" &&
    "default" in loaded
      ? readRespondFunction((loaded as { default?: unknown }).default)
      : undefined);

  if (!candidate) {
    throw new Error(
      `agent handler module ${resolvedPath} must export respond(request)`,
    );
  }

  return {
    respond: async (request) => candidate(request),
  };
}

function createHttpAgent(url: string, timeoutMs: number): OpenClawAgent {
  return {
    async respond(request: OpenClawRequest): Promise<OpenClawResponse> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = await response.text();
      const parsed = rawText ? parseJson(rawText) : undefined;

      if (!response.ok) {
        throw new Error(
          `OpenClaw agent request failed with ${response.status}: ${rawText}`,
        );
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "data" in parsed
      ) {
        return parsed["data"] as OpenClawResponse;
      }
      return parsed as OpenClawResponse;
    },
  };
}

function readRespondFunction(
  value: unknown,
): ((request: OpenClawRequest) => Promise<OpenClawResponse> | OpenClawResponse) | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if ("respond" in value && typeof value["respond"] === "function") {
    return value["respond"] as (
      request: OpenClawRequest,
    ) => Promise<OpenClawResponse> | OpenClawResponse;
  }
  return undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error("[openclaw-bot-chat] fatal error:", error);
    process.exit(1);
  });
}
