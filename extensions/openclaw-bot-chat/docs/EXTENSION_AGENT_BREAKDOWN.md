# OpenClaw BotChat Extension Agent 拆分

## Agent A - Extension Scaffold
- 对齐 OpenClaw extension 生命周期（activate/deactivate）
- 管理扩展实例与基础日志

## Agent B - Transport
- HTTP bootstrap/history client
- MQTT connect/subscribe/publish/reconnect

## Agent C - Message Adapter
- BotChat 入站消息归一化
- OpenClaw 出站消息映射

## Agent D - Permission & Approval
- 本地策略检查（bot/channel/user/action）
- 审批器（handler/http）

## Agent E - State & Recovery
- session/checkpoint 管理
- 去重与按会话串行
- 重连后历史补偿

## Agent F - Docs & Integration
- 配置样例、联调文档、故障排查
- 接入 OpenClaw 主仓库步骤
