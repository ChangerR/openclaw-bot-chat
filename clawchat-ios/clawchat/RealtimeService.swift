import Foundation
import Combine
import CocoaMQTT
import CocoaMQTTWebSocket

enum RealtimeConnectionState: Equatable {
    case idle, connecting, connected, disconnected
}

class RealtimeService: NSObject, ObservableObject {
    static let shared = RealtimeService()

    @Published var connectionState: RealtimeConnectionState = .idle
    @Published var lastMessagesByConversation: [String: Message] = [:]

    let messagePublisher = PassthroughSubject<Message, Never>()

    private var bootstrap: RealtimeBootstrapResponse?
    private var cancellables = Set<AnyCancellable>()
    private var mqttClient: CocoaMQTT?
    private var activeConversationID: String?
    private var requestedTopics = Set<String>()
    private var subscribedTopics = Set<String>()
    private var retryWorkItem: DispatchWorkItem?
    private let retryDelay: TimeInterval = 3

    var historyMaxCatchupBatch: Int {
        bootstrap?.history.maxCatchupBatch ?? 200
    }

    override init() {
        super.init()
    }

    func start() {
        guard AuthManager.shared.isAuthenticated else {
            log("start skipped: user is not authenticated")
            return
        }
        guard connectionState != .connected && connectionState != .connecting else {
            log("start skipped: current state=\(connectionState)")
            return
        }

        cancelRetry()
        log("bootstrap request started")

        fetchBootstrap()
            .sink { [weak self] completion in
                if case .failure(let error) = completion {
                    self?.log("bootstrap failed: \(error)")
                    DispatchQueue.main.async {
                        self?.connectionState = .disconnected
                    }
                    self?.scheduleRetry(reason: "bootstrap_failed")
                }
            } receiveValue: { [weak self] bootstrap in
                self?.log(
                    "bootstrap ok client_id=\(bootstrap.clientId) broker_ws=\(bootstrap.broker.wsPublicURL) qos=\(bootstrap.broker.qos ?? -1) subscriptions=\(bootstrap.subscriptions.count) topics=\(self?.topicListDescription(bootstrap.subscriptions.map(\.topic)) ?? "[]")"
                )
                self?.bootstrap = bootstrap
                self?.connect(using: bootstrap)
            }
            .store(in: &cancellables)
    }

    func stop() {
        log("stop requested")
        cancelRetry()
        mqttClient?.disconnect()
        mqttClient = nil
        activeConversationID = nil
        requestedTopics.removeAll()
        subscribedTopics.removeAll()
        connectionState = .idle
    }

    func setActiveConversation(_ conversationID: String?) {
        activeConversationID = conversationID
        log("active conversation set to \(conversationID ?? "<nil>")")
        if let conversationID {
            ensureSubscribed(to: conversationID)
            LocalMessageStore.shared.markConversationRead(conversationId: conversationID)
        }
    }

    func ensureSubscribed(to topic: String, qos: Int? = nil) {
        let normalizedTopic = normalizedTopic(topic)
        guard !normalizedTopic.isEmpty else { return }

        let wasRequested = requestedTopics.contains(normalizedTopic)
        requestedTopics.insert(normalizedTopic)

        guard connectionState == .connected,
              let mqttClient,
              !subscribedTopics.contains(normalizedTopic)
        else {
            log(
                "subscribe deferred topic=\(normalizedTopic) was_requested=\(wasRequested) state=\(connectionState) has_client=\(mqttClient != nil) already_subscribed=\(subscribedTopics.contains(normalizedTopic))"
            )
            return
        }

        subscribe(topic: normalizedTopic, qos: qos ?? bootstrap?.broker.qos ?? 1, using: mqttClient)
    }

    private func fetchBootstrap() -> AnyPublisher<RealtimeBootstrapResponse, Error> {
        APIClient.shared.request("/api/v1/realtime/bootstrap")
    }

    private func connect(using bootstrap: RealtimeBootstrapResponse) {
        cancelRetry()
        guard let url = resolvedBrokerWebSocketURL(from: bootstrap.broker.wsPublicURL), let host = url.host else {
            log("connect failed: invalid broker ws_url=\(bootstrap.broker.wsPublicURL)")
            connectionState = .disconnected
            return
        }

        connectionState = .connecting

        mqttClient?.disconnect()
        mqttClient = nil
        subscribedTopics.removeAll()

        let secureSchemes = Set(["wss", "https"])
        let isSecure = secureSchemes.contains((url.scheme ?? "").lowercased())
        let defaultPort = isSecure ? 443 : 80
        let port = url.port ?? defaultPort

        let websocket = CocoaMQTTWebSocket(uri: url.path.isEmpty ? "/mqtt" : url.path)
        websocket.enableSSL = isSecure

        let mqtt = CocoaMQTT(clientID: bootstrap.clientId, host: host, port: UInt16(port), socket: websocket)
        mqtt.username = bootstrap.broker.username
        mqtt.password = bootstrap.broker.password
        mqtt.keepAlive = 60
        mqtt.autoReconnect = true
        mqtt.cleanSession = true
        mqtt.didReceiveTrust = { _, _, completionHandler in
            completionHandler(true)
        }
        mqtt.delegate = self

        mqttClient = mqtt
        log(
            "connect start url=\(url.absoluteString) host=\(host) port=\(port) path=\(url.path.isEmpty ? "/mqtt" : url.path) ssl=\(isSecure) client_id=\(bootstrap.clientId) username_set=\(bootstrap.broker.username != nil)"
        )
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
        log("broker ws_url \(rawValue) is loopback-only; fallback to \(resolved.absoluteString)")
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
        guard let mqttClient, let user = AuthManager.shared.currentUser else {
            log("publish blocked: has_client=\(mqttClient != nil) has_user=\(AuthManager.shared.currentUser != nil)")
            return false
        }

        ensureSubscribed(to: topic)

        let route = MessageRoute(topic: topic)
        guard let target = route.targetForSender(type: "user", id: user.id.uuidString.lowercased()) else {
            log("publish blocked: cannot resolve message target topic=\(topic)")
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

        guard let jsonData = try? JSONEncoder().encode(payload) else {
            log("publish blocked: failed to encode payload id=\(payload.id) topic=\(topic)")
            return false
        }
        log(
            "publish topic=\(topic) conversation_id=\(conversationId) message_id=\(payload.id) to=\(target.type)/\(target.id) bytes=\(jsonData.count) subscribed=\(subscribedTopics.contains(topic))"
        )
        mqttClient.publish(topic, withString: String(decoding: jsonData, as: UTF8.self), qos: .qos1)
        return true
    }

    private func handleRealtimePayload(_ payload: RealtimeMessagePayload) {
        log(
            "message decoded id=\(payload.id) topic=\(payload.topic) conversation_id=\(payload.conversationId) from=\(payload.from.type)/\(payload.from.id) to=\(payload.to.type)/\(payload.to.id) seq=\(payload.seq.map(String.init) ?? "<nil>")"
        )
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

    private func log(_ message: String) {
        print("MQTT TRACE \(message)")
    }

    private func topicListDescription(_ topics: [String]) -> String {
        if topics.isEmpty {
            return "[]"
        }

        let preview = topics.prefix(8).joined(separator: ",")
        if topics.count <= 8 {
            return "[\(preview)]"
        }
        return "[\(preview),...+\(topics.count - 8)]"
    }

    private func normalizeConversationID(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    }

    private func normalizedTopic(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
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

        log("retry scheduled reason=\(reason) delay=\(retryDelay)")
        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.retryWorkItem = nil
            self.log("retry triggered reason=\(reason)")
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

extension RealtimeService: CocoaMQTTDelegate {
    func mqtt(_ mqtt: CocoaMQTT, didConnectAck ack: CocoaMQTTConnAck) {
        guard ack == .accept else {
            log("connect rejected reason=\(ack.rawValue) description=\(ack)")
            DispatchQueue.main.async {
                self.connectionState = .disconnected
            }
            scheduleRetry(reason: "connect_rejected")
            return
        }

        cancelRetry()
        log("connect accepted client_id=\(bootstrap?.clientId ?? "<unknown>")")
        DispatchQueue.main.async {
            self.connectionState = .connected
        }

        guard let bootstrap else { return }
        subscribedTopics.removeAll()
        log(
            "subscribing bootstrap_count=\(bootstrap.subscriptions.count) requested_count=\(requestedTopics.count) bootstrap_topics=\(topicListDescription(bootstrap.subscriptions.map(\.topic))) requested_topics=\(topicListDescription(Array(requestedTopics).sorted()))"
        )
        for sub in bootstrap.subscriptions {
            subscribe(topic: sub.topic, qos: sub.qos, using: mqtt)
        }
        for topic in requestedTopics {
            subscribe(topic: topic, qos: bootstrap.broker.qos ?? 1, using: mqtt)
        }
    }

    func mqtt(_ mqtt: CocoaMQTT, didStateChangeTo state: CocoaMQTTConnState) {
        log("state changed to \(state)")
        if state == .disconnected {
            DispatchQueue.main.async {
                self.connectionState = .disconnected
            }
            scheduleRetry(reason: "state_disconnected")
        }
    }

    func mqtt(_ mqtt: CocoaMQTT, didReceiveMessage message: CocoaMQTTMessage, id: UInt16) {
        log("receive raw topic=\(message.topic) packet_id=\(id) qos=\(message.qos.rawValue) bytes=\(message.payload.count)")
        guard let stringPayload = message.string else {
            log("receive dropped: payload is not utf8 topic=\(message.topic) bytes=\(message.payload.count)")
            return
        }

        guard let payloadData = stringPayload.data(using: .utf8) else {
            log("receive dropped: failed to convert payload string to data topic=\(message.topic)")
            return
        }

        do {
            let payload = try JSONDecoder().decode(RealtimeMessagePayload.self, from: payloadData)
            if normalizedTopic(payload.topic).isEmpty || normalizedTopic(payload.topic) != normalizedTopic(message.topic) {
                log("receive note: mqtt_topic=\(message.topic) payload_topic=\(payload.topic) conversation_id=\(payload.conversationId)")
            }

            handleRealtimePayload(payload)
        } catch {
            log("receive dropped: decode failed topic=\(message.topic) error=\(error)")
        }
    }

    private func subscribe(topic: String, qos: Int, using mqtt: CocoaMQTT) {
        let normalizedTopic = normalizedTopic(topic)
        guard !normalizedTopic.isEmpty, !subscribedTopics.contains(normalizedTopic) else {
            log("subscribe skipped topic=\(normalizedTopic) already_subscribed=\(subscribedTopics.contains(normalizedTopic))")
            return
        }

        log("subscribe request topic=\(normalizedTopic) qos=\(qos)")
        mqtt.subscribe(normalizedTopic, qos: CocoaMQTTQoS(rawValue: UInt8(qos)) ?? .qos1)
    }

    func mqtt(_ mqtt: CocoaMQTT, didSubscribeTopics success: NSDictionary, failed: [String]) {
        log("subscribe ack success=\(success.allKeys) failed=\(failed)")
        for key in success.allKeys {
            if let topic = key as? String {
                subscribedTopics.insert(topic)
            }
        }
        for topic in failed {
            subscribedTopics.remove(topic)
            log("subscribe failed topic=\(topic)")
        }
    }
    func mqtt(_ mqtt: CocoaMQTT, didUnsubscribeTopics topics: [String]) {
        log("unsubscribe ack topics=\(topics)")
    }
    func mqttDidPing(_ mqtt: CocoaMQTT) {
        log("ping sent")
    }
    func mqttDidReceivePong(_ mqtt: CocoaMQTT) {
        log("pong received")
    }
    func mqttDidDisconnect(_ mqtt: CocoaMQTT, withError err: Error?) {
        if let err {
            log("disconnected error=\(err.localizedDescription)")
        } else {
            log("disconnected without error")
        }
        DispatchQueue.main.async {
            self.connectionState = .disconnected
        }
        scheduleRetry(reason: "socket_disconnected")
    }
    func mqtt(_ mqtt: CocoaMQTT, didPublishMessage message: CocoaMQTTMessage, id: UInt16) {
        log("publish sent packet_id=\(id) topic=\(message.topic) qos=\(message.qos.rawValue) bytes=\(message.payload.count)")
    }
    func mqtt(_ mqtt: CocoaMQTT, didPublishAck id: UInt16) {
        log("publish ack packet_id=\(id)")
    }
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
