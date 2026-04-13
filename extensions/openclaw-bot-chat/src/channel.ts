import { getBotChatRuntime } from "./runtime.js";

/**
 * 该对象以 OpenClaw bundled channel plugin 暴露给 host。
 * 为避免与主仓库版本绑定过深，这里保持最小运行时表面。
 */
export const botChatPlugin = {
  id: "bot-chat",
  async initialize(ctx: {
    logger: {
      info(msg: string, fields?: Record<string, unknown>): void;
      warn(msg: string, fields?: Record<string, unknown>): void;
      error(msg: string, fields?: Record<string, unknown>): void;
    };
    config?: Record<string, unknown>;
    emitMessage?: (message: {
      channelId: string;
      userId: string;
      text: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
  }) {
    const runtime = getBotChatRuntime();
    await runtime.start(ctx.config ?? {}, ctx.logger, {
      emitMessage: ctx.emitMessage,
    });
    return {
      async shutdown() {
        await runtime.stop();
      },
      async handleInboundMessage(message: {
        channelId: string;
        userId: string;
        text: string;
        metadata?: Record<string, unknown>;
      }) {
        await runtime.onInboundMessage(message);
      },
      async sendOutboundMessage(message: {
        channelId: string;
        userId: string;
        text: string;
        metadata?: Record<string, unknown>;
      }) {
        await runtime.sendToChannel(message);
      },
    };
  },
};
