module.exports = {
  async approve(request) {
    if (request?.channel?.type === "dm") {
      return { approved: true, reason: "dm-default-allow" };
    }
    return {
      approved: false,
      reason: "approval-required",
      notify_user: true,
      notify_message: "当前频道需要管理员审批后才能使用机器人。",
    };
  },
};
