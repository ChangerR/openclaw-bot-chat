export const botChatSetupPlugin = {
  id: "bot-chat-setup",
  async run() {
    return {
      ok: true,
      message:
        "BotChat setup plugin scaffold is ready. Configure backendUrl/botKey and restart OpenClaw.",
    };
  },
};
