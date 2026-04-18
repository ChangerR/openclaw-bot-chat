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

    override init() {
        super.init()
    }

    func start() {
        guard AuthManager.shared.isAuthenticated else { return }
        guard connectionState != .connected && connectionState != .connecting else { return }

        fetchBootstrap()
            .sink { completion in
                if case .failure(let error) = completion {
                    print("Realtime bootstrap failed: \(error)")
                }
            } receiveValue: { [weak self] bootstrap in
                self?.bootstrap = bootstrap
                self?.connect(using: bootstrap)
            }
            .store(in: &cancellables)
    }

    func stop() {
        mqttClient?.disconnect()
        mqttClient = nil
        connectionState = .idle
    }

    private func fetchBootstrap() -> AnyPublisher<RealtimeBootstrapResponse, Error> {
        APIClient.shared.request("/api/v1/realtime/bootstrap")
    }

    private func connect(using bootstrap: RealtimeBootstrapResponse) {
        guard let url = URL(string: bootstrap.broker.wsPublicURL), let host = url.host else {
            connectionState = .disconnected
            return
        }

        connectionState = .connecting

        let isSecure = (url.scheme == "wss" || url.scheme == "https")
        let defaultPort = isSecure ? 443 : 80
        let port = url.port ?? defaultPort

        let websocket = CocoaMQTTWebSocket(uri: url.path.isEmpty ? "/mqtt" : url.path)
        websocket.enableSSL = isSecure

        let mqtt = CocoaMQTT5(clientID: bootstrap.clientId, host: host, port: UInt16(port), socket: websocket)
        mqtt.username = bootstrap.broker.username
        mqtt.password = bootstrap.broker.password
        mqtt.keepAlive = 60
        mqtt.autoReconnect = true
        mqtt.allowUntrustCACertificate = true
        mqtt.delegate = self

        mqttClient = mqtt
        _ = mqtt.connect()
    }

    func sendMessage(conversationId: String, text: String, topic: String) {
        guard let mqttClient, let user = AuthManager.shared.currentUser else { return }

        let route = MessageRoute(topic: topic)
        guard let target = route.targetForSender(type: "user", id: user.id.uuidString.lowercased()) else {
            print("Cannot resolve message target for topic: \(topic)")
            return
        }

        let payload = RealtimeMessagePayload(
            id: UUID().uuidString.lowercased(),
            topic: topic,
            conversationId: conversationId,
            timestamp: Int64(Date().timeIntervalSince1970),
            from: MessagePeerPayload(type: "user", id: user.id.uuidString.lowercased(), name: user.username),
            to: MessagePeerPayload(type: target.type, id: target.id, name: nil),
            content: RealtimeContentPayload(type: "text", body: text),
            seq: nil
        )

        guard let jsonData = try? JSONEncoder().encode(payload) else { return }
        mqttClient.publish(topic, withString: String(decoding: jsonData, as: UTF8.self), qos: .qos1, properties: MqttPublishProperties())
    }

    private func handleRealtimePayload(_ payload: RealtimeMessagePayload) {
        let message = Message(from: payload)
        DispatchQueue.main.async {
            self.messagePublisher.send(message)
            self.lastMessagesByConversation[message.conversationId] = message
        }
    }
}

extension RealtimeService: CocoaMQTT5Delegate {
    func mqtt5(_ mqtt5: CocoaMQTT5, didConnectAck ack: CocoaMQTTCONNACKReasonCode, connAckData: MqttDecodeConnAck?) {
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
        DispatchQueue.main.async {
            self.connectionState = .disconnected
        }
    }
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishMessage message: CocoaMQTT5Message, id: UInt16) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishAck id: UInt16, pubAckData: MqttDecodePubAck?) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didPublishRec id: UInt16, pubRecData: MqttDecodePubRec?) {}
    func mqtt5(_ mqtt5: CocoaMQTT5, didReceiveDisconnectReasonCode reasonCode: CocoaMQTTDISCONNECTReasonCode) {}
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
