package response

import (
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
)

type MessageResponse struct {
	ID             int64                  `json:"id"`
	ConversationID string                 `json:"conversation_id"`
	MessageID      uuid.UUID              `json:"message_id"`
	SenderType     model.SenderType       `json:"sender_type"`
	SenderID       *uuid.UUID             `json:"sender_id,omitempty"`
	SenderName     *string                `json:"sender_name,omitempty"`
	BotID          *uuid.UUID             `json:"bot_id,omitempty"`
	GroupID        *uuid.UUID             `json:"group_id,omitempty"`
	MsgType        model.MsgType          `json:"msg_type"`
	Content        string                 `json:"content"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	MQTTTopic      string                 `json:"mqtt_topic"`
	QOS            int                    `json:"qos"`
	IsRead         bool                   `json:"is_read"`
	Seq            int64                  `json:"seq"`
	CreatedAt      time.Time              `json:"created_at"`
}

type ConversationInfoResponse struct {
	ConversationID string           `json:"conversation_id"`
	LastMessage    *MessageResponse `json:"last_message,omitempty"`
	UnreadCount    int64            `json:"unread_count"`
}

func NewMessageResponse(message *model.Message) *MessageResponse {
	if message == nil {
		return nil
	}

	return &MessageResponse{
		ID:             message.ID,
		ConversationID: message.ConversationID,
		MessageID:      message.MessageID,
		SenderType:     message.SenderType,
		SenderID:       message.SenderID,
		SenderName:     message.SenderName,
		BotID:          message.BotID,
		GroupID:        message.GroupID,
		MsgType:        message.MsgType,
		Content:        message.Content,
		Metadata:       copyJSONMap(message.Metadata),
		MQTTTopic:      message.MQTTTopic,
		QOS:            message.QOS,
		IsRead:         message.IsRead,
		Seq:            message.Seq,
		CreatedAt:      message.CreatedAt,
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
