import Foundation
import Combine

enum RealtimeConnectionState {
    case idle, connecting, connected, disconnected
}

class RealtimeService: NSObject, ObservableObject {
    static let shared = RealtimeService()
    
    @Published var connectionState: RealtimeConnectionState = .idle
    @Published var lastMessagesByConversation: [String: Message] = [:]
    
    private var webSocket: URLSessionWebSocketTask?
    private var bootstrap: RealtimeBootstrapResponse?
    private var cancellables = Set<AnyCancellable>()
    
    private let messageSubject = PassthroughSubject<RealtimeMessagePayload, Never>()
    
    override init() {
        super.init()
    }

    func start() {
        guard AuthManager.shared.isAuthenticated else { return }
        
        fetchBootstrap()
            .sink { completion in
                if case .failure(let error) = completion {
                    print("Realtime bootstrap failed: \(error)")
                }
            } receiveValue: { [weak self] bootstrap in
                self?.bootstrap = bootstrap
                self?.connect()
            }
            .store(in: &cancellables)
    }

    func stop() {
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        connectionState = .idle
    }

    private func fetchBootstrap() -> AnyPublisher<RealtimeBootstrapResponse, Error> {
        return APIClient.shared.request("/api/v1/realtime/bootstrap")
    }

    private func connect() {
        guard let bootstrap = bootstrap else { return }
        
        let urlString = bootstrap.broker.wsPublicURL
        guard let url = URL(string: urlString) else { return }
        
        connectionState = .connecting
        
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue())
        webSocket = session.webSocketTask(with: url, protocols: ["mqtt"])
        webSocket?.resume()
        
        listen()
        sendConnectFrame()
    }

    private func listen() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .data(let data):
                    self?.handleMqttData(data)
                case .string(let string):
                    print("Received string frame, but MQTT expects binary: \(string)")
                @unknown default:
                    break
                }
                self?.listen()
            case .failure(let error):
                print("WebSocket error: \(error)")
                self?.connectionState = .disconnected
            }
        }
    }

    // MARK: - MQTT Minimal Implementation
    
    private func sendConnectFrame() {
        guard let bootstrap = bootstrap else { return }
        
        // MQTT 3.1.1 CONNECT packet (Simplified)
        var packet = Data()
        packet.append(0x10) // Fixed Header (CONNECT)
        
        var variableHeader = Data()
        variableHeader.append(contentsOf: [0x00, 0x04]) // Protocol Name Length (4)
        variableHeader.append(contentsOf: "MQTT".data(using: .utf8)!)
        variableHeader.append(0x04) // Protocol Level (4 = 3.1.1)
        
        var connectFlags: UInt8 = 0x02 // Clean Session
        if bootstrap.broker.username != nil { connectFlags |= 0x80 }
        if bootstrap.broker.password != nil { connectFlags |= 0x40 }
        variableHeader.append(connectFlags)
        
        variableHeader.append(contentsOf: [0x00, 0x3C]) // Keep Alive (60s)
        
        var payload = Data()
        let clientIdData = bootstrap.clientId.data(using: .utf8)!
        payload.append(contentsOf: UInt16(clientIdData.count).bigEndianBytes)
        payload.append(clientIdData)
        
        if let username = bootstrap.broker.username, let usernameData = username.data(using: .utf8) {
            payload.append(contentsOf: UInt16(usernameData.count).bigEndianBytes)
            payload.append(usernameData)
        }
        
        if let password = bootstrap.broker.password, let passwordData = password.data(using: .utf8) {
            payload.append(contentsOf: UInt16(passwordData.count).bigEndianBytes)
            payload.append(passwordData)
        }
        
        let remainingLength = variableHeader.count + payload.count
        packet.append(contentsOf: encodeRemainingLength(remainingLength))
        packet.append(variableHeader)
        packet.append(payload)
        
        webSocket?.send(.data(packet)) { error in
            if let error = error {
                print("Failed to send CONNECT: \(error)")
            }
        }
    }

    private func subscribeToTopics() {
        guard let bootstrap = bootstrap else { return }
        
        for sub in bootstrap.subscriptions {
            sendSubscribeFrame(topic: sub.topic, qos: sub.qos)
        }
    }

    private func sendSubscribeFrame(topic: String, qos: Int) {
        var packet = Data()
        packet.append(0x82) // Fixed Header (SUBSCRIBE, QoS 1)
        
        var payload = Data()
        payload.append(contentsOf: [0x00, 0x01]) // Packet Identifier (1)
        
        let topicData = topic.data(using: .utf8)!
        payload.append(contentsOf: UInt16(topicData.count).bigEndianBytes)
        payload.append(topicData)
        payload.append(UInt8(qos))
        
        packet.append(contentsOf: encodeRemainingLength(payload.count))
        packet.append(payload)
        
        webSocket?.send(.data(packet)) { error in
            if let error = error {
                print("Failed to subscribe to \(topic): \(error)")
            }
        }
    }

    func sendMessage(conversationId: String, text: String, topic: String) {
        guard let user = AuthManager.shared.currentUser, let bootstrap = bootstrap else { return }
        
        let messageId = UUID().uuidString
        let timestamp = Int64(Date().timeIntervalSince1970)
        
        let payload = RealtimeMessagePayload(
            id: messageId,
            topic: topic,
            conversationId: conversationId,
            timestamp: timestamp,
            from: MessagePeerPayload(type: "user", id: user.id.uuidString, name: user.username),
            to: MessagePeerPayload(type: "bot", id: "bot_id_placeholder"), // Needs proper mapping
            content: RealtimeContentPayload(type: "text", body: text),
            seq: nil
        )
        
        publish(topic: topic, payload: payload)
    }

    private func publish(topic: String, payload: RealtimeMessagePayload) {
        guard let jsonData = try? JSONEncoder().encode(payload) else { return }
        
        var packet = Data()
        packet.append(0x30) // Fixed Header (PUBLISH, QoS 0)
        
        var variableHeader = Data()
        let topicData = topic.data(using: .utf8)!
        variableHeader.append(contentsOf: UInt16(topicData.count).bigEndianBytes)
        variableHeader.append(topicData)
        
        let remainingLength = variableHeader.count + jsonData.count
        packet.append(contentsOf: encodeRemainingLength(remainingLength))
        packet.append(variableHeader)
        packet.append(jsonData)
        
        webSocket?.send(.data(packet)) { error in
            if let error = error {
                print("Failed to publish to \(topic): \(error)")
            }
        }
    }

    private func handleMqttData(_ data: Data) {
        guard data.count > 0 else { return }
        let firstByte = data[0]
        let packetType = (firstByte & 0xF0) >> 4
        
        switch packetType {
        case 2: // CONNACK
            print("MQTT Connected (CONNACK)")
            DispatchQueue.main.async {
                self.connectionState = .connected
                self.subscribeToTopics()
            }
        case 3: // PUBLISH
            handleIncomingPublish(data)
        default:
            break
        }
    }

    private func handleIncomingPublish(_ data: Data) {
        // Very basic PUBLISH parsing
        var offset = 1
        let (remainingLength, lengthSize) = decodeRemainingLength(data, offset: offset)
        offset += lengthSize
        
        let topicLength = Int(UInt16(bigEndianData: data.subdata(in: offset..<(offset+2))))
        offset += 2
        // let topic = String(data: data.subdata(in: offset..<(offset+topicLength)), encoding: .utf8)
        offset += topicLength
        
        let payloadData = data.subdata(in: offset..<(offset + Int(remainingLength) - 2 - topicLength))
        
        if let payload = try? JSONDecoder().decode(RealtimeMessagePayload.self, from: payloadData) {
            print("Received MQTT message: \(payload.id)")
            let message = Message(from: payload)
            DispatchQueue.main.async {
                self.messagePublisher.send(message)
                self.lastMessagesByConversation[message.conversationId] = message
            }
        }
    }

    private func encodeRemainingLength(_ length: Int) -> [UInt8] {
        var bytes = [UInt8]()
        var val = length
        repeat {
            var digit = UInt8(val % 128)
            val /= 128
            if val > 0 {
                digit |= 0x80
            }
            bytes.append(digit)
        } while val > 0
        return bytes
    }

    private func decodeRemainingLength(_ data: Data, offset: Int) -> (UInt32, Int) {
        var multiplier: UInt32 = 1
        var value: UInt32 = 0
        var currentOffset = offset
        var digit: UInt8 = 0
        repeat {
            digit = data[currentOffset]
            value += UInt32(digit & 127) * multiplier
            multiplier *= 128
            currentOffset += 1
        } while (digit & 128) != 0
        return (value, currentOffset - offset)
    }
}

extension RealtimeService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("WebSocket connected")
    }
    
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWithCode closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("WebSocket closed")
        DispatchQueue.main.async {
            self.connectionState = .disconnected
        }
    }
}

// Helper extensions
extension UInt16 {
    var bigEndianBytes: [UInt8] {
        return [UInt8((self & 0xFF00) >> 8), UInt8(self & 0x00FF)]
    }
    
    init(bigEndianData data: Data) {
        self = data.withUnsafeBytes { $0.load(as: UInt16.self).bigEndian }
    }
}
}
    }
}
