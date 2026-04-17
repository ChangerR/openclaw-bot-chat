# clawchat iOS notes

## Realtime stack (MQTT over WebSocket)

The iOS client uses **CocoaMQTT** as the realtime MQTT-over-WebSocket implementation.

### Add CocoaMQTT in Xcode

1. Open `clawchat.xcodeproj`
2. `File` → `Add Package Dependencies...`
3. Add: `https://github.com/emqx/CocoaMQTT.git`
4. Use the latest stable version and link it to the `clawchat` target

> This dependency is required for realtime messaging.
