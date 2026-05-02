import Foundation
import Combine
import CocoaMQTT
import CocoaMQTTWebSocket

enum RealtimeConnectionState {
    case idle, connecting, connected, disconnected
}

class RealtimeService: NSObject, ObservableObject {
    static let shared = RealtimeService()

    @Published var connectionState: RealtimeConnectionState = .idle
    @Published var lastMessagesByConversation: [String: Message] = [:]

    let messagePublisher = PassthroughSubject<Message, Never>()

    private var bootstrap: RealtimeBootstrapResponse?
    private var cancellables = Set<AnyCancellable>()
    private var mqttClient: CocoaMQTT5?
    private var activeConversationID: String?
    private var retryWorkItem: DispatchWorkItem?
    private let retryDelay: TimeInterval = 3

    var historyMaxCatchupBatch: Int {
        bootstrap?.history.maxCatchupBatch ?? 200
    }

    override init() {
        super.init()
    }

    func start() {
        guard AuthManager.shared.isAuthenticated else { return }
        guard connectionState != .connected && connectionState != .connecting else { return }

        cancelRetry()

        fetchBootstrap()
            .sink { [weak self] completion in
                if case .failure(let error) = completion {
                    print("Realtime bootstrap failed: \(error)")
                    DispatchQueue.main.async {
                        self?.connectionState = .disconnected
                    }
                    self?.scheduleRetry(reason: "bootstrap_failed")
                }
            } receiveValue: { [weak self] bootstrap in
                self?.bootstrap = bootstrap
                self?.connect(using: bootstrap)
            }
            .store(in: &cancellables)
    }

    func stop() {
        cancelRetry()
        mqttClient?.disconnect()
        mqttClient = nil
        activeConversationID = nil
        connectionState = .idle
    }

    func setActiveConversation(_ conversationID: String?) {
        activeConversationID = conversationID
        if let conversationID {
            LocalMessageStore.shared.markConversationRead(conversationId: conversationID)
        }
    }

    private func fetchBootstrap() -> AnyPublisher<RealtimeBootstrapResponse, Error> {
        APIClient.shared.request("/api/v1/realtime/bootstrap")
    }

    private func connect(using bootstrap: RealtimeBootstrapResponse) {
        cancelRetry()
        guard let url = resolvedBrokerWebSocketURL(from: bootstrap.broker.wsPublicURL), let host = url.host else {
            print("Realtime MQTT URL invalid: \(bootstrap.broker.wsPublicURL)")
            connectionState = .disconnected
            return
        }

        connectionState = .connecting

        mqttClient?.disconnect()
        mqttClient = nil

        let secureSchemes = Set(["wss", "https"])
        let isSecure = secureSchemes.contains((url.scheme ?? "").lowercased())
        let defaultPort = isSecure ? 443 : 80
        let port = url.port ?? defaultPort

        let websocket = CocoaMQTTWebSocket(uri: url.path.isEmpty ? "/mqtt" : url.path)
        websocket.enableSSL = isSecure

        let mqtt = CocoaMQTT5(clientID: bootstrap.clientId, host: host, port: UInt16(port), socket: websocket)
        mqtt.username = bootstrap.broker.username
        mqtt.password = bootstrap.broker.password
        mqtt.keepAlive = 60
        mqtt.autoReconnect = true
        mqtt.didReceiveTrust = { _, _, completionHandler in
            completionHandler(true)
        }
        mqtt.delegate = self

        mqttClient = mqtt
        print("Connecting MQTT via \(url.absoluteString) as \(bootstrap.clientId)")
        _ = mqtt.connect()
    }

    private func resolvedBrokerWebSocketURL(from rawValue: String) -> URL? {
        guard let url = URL(string: rawValue) else {
            return APIClient.shared.brokerWebSocketFallbackURL
        }

        guard shouldFallbackFromBrokerURL(url) else {
            return url
        }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let fallbackURL = APIClient.shared.brokerWebSocketFallbackURL,
              let fallbackComponents = URLComponents(url: fallbackURL, resolvingAgainstBaseURL: false)
        else {
            return url
        }

        components.scheme = fallbackComponents.scheme
        components.host = fallbackComponents.host
        components.port = fallbackComponents.port
        if components.path.isEmpty || components.path == "/" {
            components.path = fallbackComponents.path
        }

        let resolved = components.url ?? fallbackURL
        print("Realtime broker ws_url \(rawValue) is loopback-only; fallback to \(resolved.absoluteString)")
        return resolved
    }

    private func shouldFallbackFromBrokerURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else {
            return true
        }

        if ["localhost", "127.0.0.1", "0.0.0.0", "::1"].contains(host) {
            return true
        }

        return false
    }

    @discardableResult
    func sendMessage(conversationId: String, text: String, topic: String) -> Bool {
        sendMessage(
            conversationId: conversationId,
            content: RealtimeContentPayload(type: "text", body: text),
            topic: topic
        )
    }

    @discardableResult
    func sendMessage(conversationId: String, content: RealtimeContentPayload, topic: String) -> Bool {
        guard let mqttClient, let user = AuthManager.shared.currentUser else { return false }

        let route = MessageRoute(topic: topic)
        guard let target = route.targetForSender(type: "user", id: user.id.uuidString.lowercased()) else {
            print("Cannot resolve message target for topic: \(topic)")
            return false
        }

        let normalizedBody = normalizedMessageBody(for: content)
        let outgoingContent = RealtimeContentPayload(
            type: content.type,
            body: normalizedBody,
            url: content.url,
            name: content.name,
            size: content.size,
            meta: content.meta
        )

        let payload = RealtimeMessagePayload(
            id: UUID().uuidString.lowercased(),
            topic: topic,
            conversationId: conversationId,
            timestamp: Int64(Date().timeIntervalSince1970),
            from: MessagePeerPayload(type: "user", id: user.id.uuidString.lowercased(), name: user.username),
            to: MessagePeerPayload(type: target.type, id: target.id, name: nil),
            content: outgoingContent,
            seq: nil
        )

        let optimisticMessage = Message(from: payload)
        let isActiveConversation = normalizeConversationID(activeConversationID) == normalizeConversationID(conversationId)

        LocalMessageStore.shared.upsert(messages: [optimisticMessage])
        LocalMessageStore.shared.syncConversationPreview(
            for: optimisticMessage,
            currentUserID: user.id.uuidString,
            isActiveConversation: isActiveConversation
        )

        DispatchQueue.main.async {
            self.messagePublisher.send(optimisticMessage)
            self.lastMessagesByConversation[conversationId] = optimisticMessage
        }

        guard let jsonData = try? JSONEncoder().encode(payload) else { return false }
        mqttClient.publish(topic, withString: String(decoding: jsonData, as: UTF8.self), qos: .qos1, properties: MqttPublishProperties())
        return true
    }

    private func handleRealtimePayload(_ payload: RealtimeMessagePayload) {
        let message = Message(from: payload)
        LocalMessageStore.shared.upsert(messages: [message])
        LocalMessageStore.shared.syncConversationPreview(
            for: message,
            currentUserID: AuthManager.shared.currentUser?.id.uuidString,
            isActiveConversation: normalizeConversationID(activeConversationID) == normalizeConversationID(message.conversationId)
        )
        DispatchQueue.main.async {
            self.messagePublisher.send(message)
            self.lastMessagesByConversation[message.conversationId] = message
        }
    }

    private func normalizeConversationID(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    }

    private func normalizedMessageBody(for content: RealtimeContentPayload) -> String {
        let trimmedBody = content.body?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedBody, !trimmedBody.isEmpty {
            return trimmedBody
        }

        let trimmedName = content.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedName, !trimmedName.isEmpty {
            return trimmedName
        }

        switch normalizeConversationID(content.type) {
        case "image":
            return "Image"
        default:
            return ""
        }
    }


    private func scheduleRetry(reason: String) {
        guard AuthManager.shared.isAuthenticated else { return }
        guard connectionState != .connected && connectionState != .connecting else { return }
        guard retryWorkItem == nil else { return }

        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.retryWorkItem = nil
            print("Realtime retry triggered: \(reason)")
            self.start()
        }
        retryWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + retryDelay, execute: workItem)
    }

    private func cancelRetry() {
        retryWorkItem?.cancel()
        retryWorkItem = nil
    }
}

extension RealtimeService: CocoaMQTT5Delegate {
    func mqtt5(_ mqtt5: CocoaMQTT5, didConnectAck ack: CocoaMQTTCONNACKReasonCode, connAckData: MqttDecodeConnAck?) {
        guard ack == .success else {
            print("MQTT connect rejected with reason: \(ack.rawValue)")
            DispatchQueue.main.async {
                self.connectionState = .disconnected
            }
            scheduleRetry(reason: "connect_rejected")
            return
        }

        cancelRetry()
        DispatchQueue.main.async {
            self.connectionState = .connected
        }

        guard let bootstrap else { return }
        for sub in bootstrap.subscriptions {
            mqtt5.subscribe(sub.topic, qos: CocoaMQTTQoS(rawValue: UInt8(sub.qos)) ?? .qos1)
        }
    }

    func mqtt5(_ mqtt5: CocoaMQTT5, didStateChangeTo state: CocoaMQTTConnState) {
        if state == .disconnected {
            DispatchQueue.main.async {
                self.connectionState = .disconnected
            }
            scheduleRetry(reason: "state_disconnected")
        }
    }

    func mqtt5(_ mqtt5: CocoaMQTT5, didReceiveMessage message: CocoaMQTT5Message, id: UInt16, publishData: MqttDecodePublish?) {
        guard let stringPayload = message.string,
              let payloadData = stringPayload.data(using: .utf8),
              let payload = try? JSONDecoder().decode(RealtimeMessagePayload.self, from: payloadData)
        else { return }

        handleRealtimePayload(payload)
    }

    func mqtt5(_ mqtt5: CocoaMQTT5, didSubscribeTopics success: NSDictionary, failed: [String], subAckData: MqttDecodeSubAck?) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didUnsubscribeTopics topics: [String], unsubAckData: MqttDecodeUnsubAck?) {}
    func mqtt5DidPing(_ mqtt5: CocoaMQTT5) {}
    func mqtt5DidReceivePong(_ mqtt5: CocoaMQTT5) {}
    func mqtt5DidDisconnect(_ mqtt5: CocoaMQTT5, withError err: Error?) {
        if let err {
            print("MQTT disconnected with error: \(err.localizedDescription)")
        }
        DispatchQueue.main.async {
            self.connectionState = .disconnected
        }
        scheduleRetry(reason: "socket_disconnected")
    }
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishMessage message: CocoaMQTT5Message, id: UInt16) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishAck id: UInt16, pubAckData: MqttDecodePubAck?) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishRec id: UInt16, pubRecData: MqttDecodePubRec?) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didReceiveDisconnectReasonCode reasonCode: CocoaMQTTDISCONNECTReasonCode) {
        print("MQTT broker disconnect reason: \(reasonCode.rawValue)")
    }
    func mqtt5(_ mqtt5: CocoaMQTT5, didReceiveAuthReasonCode reasonCode: CocoaMQTTAUTHReasonCode) {}
}

private struct MessageRoute {
    struct Peer {
        let type: String
        let id: String
    }

    let parts: [String]

    init(topic: String) {
        self.parts = topic.split(separator: "/").map(String.init)
    }

    func targetForSender(type: String, id: String) -> Peer? {
        if parts.count == 3, parts[0] == "chat", parts[1] == "group" {
            return Peer(type: "group", id: parts[2])
        }

        if parts.count == 6, parts[0] == "chat", parts[1] == "dm" {
            let left = Peer(type: parts[2], id: parts[3])
            let right = Peer(type: parts[4], id: parts[5])

            if left.type == type && left.id == id { return right }
            if right.type == type && right.id == id { return left }
        }

        return nil
    }
}
