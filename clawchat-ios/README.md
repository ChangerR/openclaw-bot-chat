# clawchat iOS notes

## Realtime stack (MQTT over WebSocket)

The iOS client uses **CocoaMQTT** as the realtime MQTT-over-WebSocket implementation.

### Add CocoaMQTT in Xcode

1. Open `clawchat.xcodeproj`
2. `File` → `Add Package Dependencies...`
3. Add: `https://github.com/emqx/CocoaMQTT.git`
4. Use the latest stable version and link it to the `clawchat` target

> This dependency is required for realtime messaging.

## Realtime notes

- iOS 真机不能使用 backend bootstrap 里指向 `127.0.0.1` / `localhost` 的 `ws_url`。
- 部署时请优先把 `MQTT_WS_PUBLIC_URL` 配成公网地址，例如 `ws://your-domain/mqtt` 或 `wss://your-domain/mqtt`。
- 当前 iOS 客户端会在 bootstrap 返回 loopback 地址时，自动回退到 API 域名对应的 `/mqtt`。
