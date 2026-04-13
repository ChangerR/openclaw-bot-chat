module.exports = {
  async respond(request) {
    return {
      content: `收到消息：${request.content}`,
      metadata: {
        source: "openclaw-bot-chat-extension-example",
      },
    };
  },
};
