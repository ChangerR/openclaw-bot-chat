import Foundation

// MARK: - Core Entities

struct User: Codable, Identifiable {
    let id: UUID
    var username: String
    var email: String
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, username, email
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct Bot: Codable, Identifiable {
    let id: UUID
    var ownerId: UUID?
    var name: String
    var description: String?
    var avatar: String?
    var avatarUrl: String?
    var botType: String?
    var status: String?
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, description, avatar, status
        case ownerId = "owner_id"
        case avatarUrl = "avatar_url"
        case botType = "bot_type"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct ChatGroup: Codable, Identifiable {
    let id: UUID
    var name: String
    var description: String?
    var avatar: String?
    var avatarUrl: String?
    var ownerId: UUID
    var memberCount: Int?
    var isActive: Bool?
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, description, avatar
        case ownerId = "owner_id"
        case memberCount = "member_count"
        case isActive = "is_active"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Chat & Messages

enum ChatPeerType: String, Codable {
    case user, bot, group, system
}

struct ChatPeer: Codable {
    let type: ChatPeerType
    let id: String
    var name: String?
    var avatar: String?
}

struct MessageContent: Codable {
    enum ContentType: String, Codable {
        case text, image, file, audio, video
    }
    var type: ContentType
    var body: String?
    var url: String?
    var name: String?
    var size: Int?
}

struct Message: Codable, Identifiable {
    let id: String
    var conversationId: String
    var topic: String
    var senderId: String
    var senderType: ChatPeerType
    var from: ChatPeer
    var to: ChatPeer
    var content: MessageContent
    var seq: Int?
    var timestamp: Int64?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, topic, from, to, content, seq, timestamp
        case conversationId = "conversation_id"
        case senderId = "sender_id"
        case senderType = "sender_type"
        case createdAt = "created_at"
    }
}

struct Conversation: Codable, Identifiable {
    let id: String
    var type: String
    var name: String
    var avatar: String?
    var targetId: String?
    var lastMessage: MessageSnippet?
    var unreadCount: Int?

    struct MessageSnippet: Codable {
        var content: String?
        var timestamp: Int64?
    }

    enum CodingKeys: String, CodingKey {
        case id, type, name, avatar
        case targetId = "targetId"
        case lastMessage = "lastMessage"
        case unreadCount = "unreadCount"
    }
}

// MARK: - Realtime Models

struct BrokerInfo: Codable {
    let wsPublicURL: String
    let username: String?
    let password: String?
    let qos: Int?

    enum CodingKeys: String, CodingKey {
        case wsPublicURL = "ws_url"
        case username, password, qos
    }
}

struct RealtimeSubscription: Codable {
    let topic: String
    let qos: Int
}

struct RealtimeHistoryInfo: Codable {
    let maxCatchupBatch: Int

    enum CodingKeys: String, CodingKey {
        case maxCatchupBatch = "max_catchup_batch"
    }
}

struct RealtimeBootstrapResponse: Codable {
    let broker: BrokerInfo
    let clientId: String
    let principalType: String
    let principalId: String
    let subscriptions: [RealtimeSubscription]
    let publishTopics: [String]
    let history: RealtimeHistoryInfo

    enum CodingKeys: String, CodingKey {
        case broker, subscriptions, history
        case clientId = "client_id"
        case principalType = "principal_type"
        case principalId = "principal_id"
        case publishTopics = "publish_topics"
    }
}

struct MessagePeerPayload: Codable {
    let type: String
    let id: String
    var name: String?
    var avatar: String?
}

struct RealtimeContentPayload: Codable {
    let type: String
    let body: String?
    var url: String?
    var name: String?
    var size: Int?
    var meta: [String: AnyCodable]?
}

struct RealtimeMessagePayload: Codable {
    let id: String
    let topic: String
    let conversationId: String
    let timestamp: Int64
    let from: MessagePeerPayload
    let to: MessagePeerPayload
    let content: RealtimeContentPayload
    var seq: Int64?

    enum CodingKeys: String, CodingKey {
        case id, topic, timestamp, from, to, content, seq
        case conversationId = "conversation_id"
    }
}

// Simple AnyCodable to handle dynamic metadata
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let str = try? container.decode(String.self) { value = str }
        else if let int = try? container.decode(Int.self) { value = int }
        else if let double = try? container.decode(Double.self) { value = double }
        else if let bool = try? container.decode(Bool.self) { value = bool }
        else if let dict = try? container.decode([String: AnyCodable].self) { value = dict }
        else if let array = try? container.decode([AnyCodable].self) { value = array }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable value cannot be decoded") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let str = value as? String { try container.encode(str) }
        else if let int = value as? Int { try container.encode(int) }
        else if let double = value as? Double { try container.encode(double) }
        else if let bool = value as? Bool { try container.encode(bool) }
        else if let dict = value as? [String: AnyCodable] { try container.encode(dict) }
        else if let array = value as? [AnyCodable] { try container.encode(array) }
    }
}

extension Message {
    init(from payload: RealtimeMessagePayload) {
        self.id = payload.id
        self.conversationId = payload.conversationId
        self.topic = payload.topic
        self.senderId = payload.from.id
        self.senderType = ChatPeerType(rawValue: payload.from.type) ?? .user
        self.from = ChatPeer(type: self.senderType, id: payload.from.id, name: payload.from.name, avatar: payload.from.avatar)
        self.to = ChatPeer(type: ChatPeerType(rawValue: payload.to.type) ?? .bot, id: payload.to.id, name: payload.to.name, avatar: payload.to.avatar)
        self.content = MessageContent(type: MessageContent.ContentType(rawValue: payload.content.type) ?? .text, body: payload.content.body, url: payload.content.url, name: payload.content.name, size: payload.content.size)
        self.seq = Int(payload.seq ?? 0)
        self.timestamp = payload.timestamp
        self.createdAt = Date(timeIntervalSince1970: Double(payload.timestamp))
    }
}

// MARK: - API Payloads

struct ApiResponse<T: Codable>: Codable {
    let code: Int
    let message: String
    let data: T?
}

struct AuthTokens: Codable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

struct AuthPayload: Codable {
    let user: User
    let tokens: AuthTokens
}
