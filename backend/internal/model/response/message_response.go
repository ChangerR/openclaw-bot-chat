package response

import (
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
)

type MessagePeerResponse struct {
	Type   string  `json:"type"`
	ID     string  `json:"id"`
	Name   *string `json:"name,omitempty"`
	Avatar *string `json:"avatar,omitempty"`
}

type MessageContentResponse struct {
	Type string                 `json:"type"`
	Body string                 `json:"body"`
	Meta map[string]interface{} `json:"meta,omitempty"`
}

type MessageResponse struct {
	ID             string                 `json:"id"`
	DBID           int64                  `json:"db_id"`
	ConversationID string                 `json:"conversation_id"`
	MessageID      uuid.UUID              `json:"message_id"`
	From           MessagePeerResponse    `json:"from"`
	To             MessagePeerResponse    `json:"to"`
	Content        MessageContentResponse `json:"content"`
	Timestamp      int64                  `json:"timestamp"`
	Seq            int64                  `json:"seq"`
	SenderType     model.SenderType       `json:"sender_type,omitempty"`
	SenderID       *uuid.UUID             `json:"sender_id,omitempty"`
	SenderName     *string                `json:"sender_name,omitempty"`
	BotID          *uuid.UUID             `json:"bot_id,omitempty"`
	GroupID        *uuid.UUID             `json:"group_id,omitempty"`
	MsgType        model.MsgType          `json:"msg_type,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	MQTTTopic      string                 `json:"mqtt_topic,omitempty"`
	QOS            int                    `json:"qos,omitempty"`
	IsRead         bool                   `json:"is_read,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
}

type ConversationInfoResponse struct {
	ID                string                   `json:"id"`
	Type              string                   `json:"type,omitempty"`
	Name              string                   `json:"name,omitempty"`
	Avatar            *string                  `json:"avatar,omitempty"`
	TargetID          string                   `json:"targetId,omitempty"`
	SourceID          string                   `json:"sourceId,omitempty"`
	LastMessage       *ConversationLastMessage `json:"lastMessage,omitempty"`
	UnreadCount       int64                    `json:"unreadCount"`
	ConversationID    string                   `json:"conversation_id"`
	LegacyLastMessage *MessageResponse         `json:"last_message,omitempty"`
	LegacyUnreadCount int64                    `json:"unread_count"`
}

type ConversationLastMessage struct {
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

func NewMessageResponse(message *model.Message) *MessageResponse {
	if message == nil {
		return nil
	}

	from, to := buildMessagePeers(message)
	metadata := copyJSONMap(message.Metadata)

	return &MessageResponse{
		ID:             message.MessageID.String(),
		DBID:           message.ID,
		ConversationID: message.ConversationID,
		MessageID:      message.MessageID,
		From:           from,
		To:             to,
		Content: MessageContentResponse{
			Type: string(message.MsgType),
			Body: message.Content,
			Meta: metadata,
		},
		Timestamp:  message.CreatedAt.Unix(),
		SenderType: message.SenderType,
		SenderID:   message.SenderID,
		SenderName: message.SenderName,
		BotID:      message.BotID,
		GroupID:    message.GroupID,
		MsgType:    message.MsgType,
		Metadata:   metadata,
		MQTTTopic:  message.MQTTTopic,
		QOS:        message.QOS,
		IsRead:     message.IsRead,
		Seq:        message.Seq,
		CreatedAt:  message.CreatedAt,
	}
}

func NewMessageResponses(messages []model.Message) []MessageResponse {
	if len(messages) == 0 {
		return []MessageResponse{}
	}

	responses := make([]MessageResponse, 0, len(messages))
	for i := range messages {
		responses = append(responses, *NewMessageResponse(&messages[i]))
	}
	return responses
}

func copyJSONMap(source model.JSONMap) map[string]interface{} {
	if source == nil {
		return nil
	}

	copied := make(map[string]interface{}, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

func NewConversationInfoResponse(conversationID string, lastMessage *model.Message, unreadCount int64) ConversationInfoResponse {
	response := ConversationInfoResponse{
		ID:                conversationID,
		SourceID:          conversationID,
		UnreadCount:       unreadCount,
		ConversationID:    conversationID,
		LegacyLastMessage: NewMessageResponse(lastMessage),
		LegacyUnreadCount: unreadCount,
	}

	if lastMessage != nil {
		response.LastMessage = &ConversationLastMessage{
			Content:   lastMessage.Content,
			Timestamp: lastMessage.CreatedAt.Unix(),
		}
	}

	parts := splitTopic(conversationID)
	if len(parts) == 3 && parts[0] == "chat" && parts[1] == "group" {
		response.Type = "group"
		response.TargetID = parts[2]
		response.Name = "Group " + parts[2]
		return response
	}

	if len(parts) == 6 && parts[0] == "chat" && parts[3] == "to" {
		response.Type = parts[4]
		response.TargetID = parts[5]
		switch response.Type {
		case "bot":
			response.Name = "Bot " + parts[5]
		case "user":
			response.Name = "User " + parts[5]
		default:
			response.Name = response.Type + " " + parts[5]
		}
	}

	return response
}

func buildMessagePeers(message *model.Message) (MessagePeerResponse, MessagePeerResponse) {
	from := MessagePeerResponse{
		Type: string(message.SenderType),
		Name: message.SenderName,
	}
	if message.SenderID != nil {
		from.ID = message.SenderID.String()
	} else if message.BotID != nil && message.SenderType == model.SenderTypeBot {
		from.ID = message.BotID.String()
	}

	topicParts := splitTopic(message.ConversationID)
	if len(topicParts) >= 3 && topicParts[0] == "chat" {
		switch {
		case len(topicParts) == 6 && topicParts[3] == "to":
			return ensurePeer(from), MessagePeerResponse{
				Type: topicParts[4],
				ID:   topicParts[5],
			}
		case len(topicParts) == 3 && topicParts[1] == "group":
			return ensurePeer(from), MessagePeerResponse{
				Type: "group",
				ID:   topicParts[2],
			}
		}
	}

	if message.GroupID != nil {
		return ensurePeer(from), MessagePeerResponse{
			Type: "group",
			ID:   message.GroupID.String(),
		}
	}

	if message.BotID != nil && from.ID != message.BotID.String() {
		return ensurePeer(from), MessagePeerResponse{
			Type: "bot",
			ID:   message.BotID.String(),
		}
	}

	return ensurePeer(from), MessagePeerResponse{}
}

func ensurePeer(peer MessagePeerResponse) MessagePeerResponse {
	if peer.Type == "" {
		peer.Type = "system"
	}
	return peer
}

func splitTopic(topic string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(topic); i++ {
		if topic[i] == '/' {
			parts = append(parts, topic[start:i])
			start = i + 1
		}
	}
	parts = append(parts, topic[start:])
	return parts
}
