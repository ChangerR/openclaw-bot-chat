package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
	"github.com/openclaw-bot-chat/backend/internal/repository"
)

// MessageService handles message operations
type MessageService struct {
	msgRepo  *repository.MessageRepository
	auditRepo *repository.AuditLogRepository
}

// NewMessageService creates a new message service
func NewMessageService(msgRepo *repository.MessageRepository, auditRepo *repository.AuditLogRepository) *MessageService {
	return &MessageService{msgRepo: msgRepo, auditRepo: auditRepo}
}

// SaveMessage saves an incoming MQTT message to the database
func (s *MessageService) SaveMessage(ctx context.Context, msg *model.Message) error {
	seq, err := s.msgRepo.GetNextSeq(ctx, msg.ConversationID)
	if err != nil {
		return err
	}
	msg.Seq = seq
	return s.msgRepo.Create(ctx, msg)
}

// GetMessages returns messages for a conversation
func (s *MessageService) GetMessages(ctx context.Context, conversationID string, limit int, beforeSeq int64) ([]model.Message, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.msgRepo.GetByConversationID(ctx, conversationID, limit, beforeSeq)
}

// GetConversations returns a list of conversation IDs for a user
func (s *MessageService) GetConversations(ctx context.Context, userID uuid.UUID, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 50
	}
	return s.msgRepo.GetConversations(ctx, userID, nil, limit)
}

// ConversationInfo holds summary info for a conversation
type ConversationInfo struct {
	ConversationID string     `json:"conversation_id"`
	LastMessage    *model.Message `json:"last_message,omitempty"`
	UnreadCount    int64      `json:"unread_count"`
}

// GetConversationList returns conversation summaries for a user
func (s *MessageService) GetConversationList(ctx context.Context, userID uuid.UUID, limit int) ([]ConversationInfo, error) {
	ids, err := s.msgRepo.GetConversations(ctx, userID, nil, limit)
	if err != nil {
		return nil, err
	}
	result := make([]ConversationInfo, 0, len(ids))
	for _, id := range ids {
		msgs, err := s.msgRepo.GetByConversationID(ctx, id, 1, 0)
		if err != nil || len(msgs) == 0 {
			continue
		}
		result = append(result, ConversationInfo{
			ConversationID: id,
			LastMessage:     &msgs[0],
			UnreadCount:     0,
		})
	}
	return result, nil
}

// MessagePayload represents an MQTT message payload
type MessagePayload struct {
	MessageID   string                 `json:"message_id"`
	SenderType  string                 `json:"sender_type"`
	SenderID    string                 `json:"sender_id,omitempty"`
	SenderName  string                 `json:"sender_name,omitempty"`
	BotID       string                 `json:"bot_id,omitempty"`
	GroupID     string                 `json:"group_id,omitempty"`
	MsgType     string                 `json:"msg_type"`
	Content     string                 `json:"content"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Timestamp   int64                  `json:"timestamp"`
}

// BuildConversationID builds a conversation ID from components
func BuildConversationID(senderType, senderID, recipientType, recipientID string) string {
	if senderType == "user" && recipientType == "bot" {
		return "user/" + senderID + "/bot/" + recipientID
	}
	if senderType == "bot" && recipientType == "user" {
		return "user/" + recipientID + "/bot/" + senderID
	}
	if senderType == "bot" && recipientType == "bot" {
		return "bot/" + senderID + "/bot/" + recipientID
	}
	return "unknown"
}

// BuildGroupConversationID builds a group conversation ID
func BuildGroupConversationID(groupID string) string {
	return "group/" + groupID
}

// ParseConversationID parses a conversation ID into its components
func ParseConversationID(convID string) (senderType, senderID, recipientType, recipientID string) {
	// Format: user/{uid}/bot/{bid} or group/{gid}
	if len(convID) > 5 && convID[:5] == "user/" {
		// user/{uid}/bot/{bid}
		parts := splitConversationID(convID)
		if len(parts) >= 4 {
			return parts[0], parts[1], parts[2], parts[3]
		}
	}
	return "", "", "", ""
}

func splitConversationID(convID string) []string {
	var parts []string
	start := 0
	for i, c := range convID {
		if c == '/' {
			parts = append(parts, convID[start:i])
			start = i + 1
		}
	}
	parts = append(parts, convID[start:])
	return parts
}

// NewMQTTMessage creates a Message model from an MQTT payload
func NewMQTTMessage(topic, payloadStr string, payload MessagePayload) (*model.Message, error) {
	msgID, err := uuid.Parse(payload.MessageID)
	if err != nil {
		msgID = uuid.New()
	}
	var senderID *uuid.UUID
	if payload.SenderID != "" {
		if parsed, err := uuid.Parse(payload.SenderID); err == nil {
			senderID = &parsed
		}
	}
	var botID *uuid.UUID
	if payload.BotID != "" {
		if parsed, err := uuid.Parse(payload.BotID); err == nil {
			botID = &parsed
		}
	}
	var groupID *uuid.UUID
	if payload.GroupID != "" {
		if parsed, err := uuid.Parse(payload.GroupID); err == nil {
			groupID = &parsed
		}
	}
	var senderName *string
	if payload.SenderName != "" {
		senderName = &payload.SenderName
	}
	metadata := model.JSONMap(payload.Metadata)
	if metadata == nil {
		metadata = make(model.JSONMap)
	}
	var ts time.Time
	if payload.Timestamp > 0 {
		ts = time.Unix(payload.Timestamp, 0)
	} else {
		ts = time.Now()
	}
	return &model.Message{
		ConversationID: topic,
		MessageID:      msgID,
		SenderType:     model.SenderType(payload.SenderType),
		SenderID:       senderID,
		SenderName:     senderName,
		BotID:          botID,
		GroupID:        groupID,
		MsgType:        model.MsgType(payload.MsgType),
		Content:        payload.Content,
		Metadata:       metadata,
		MQTTTopic:      topic,
		QOS:            1,
		Seq:            0,
		CreatedAt:      ts,
	}, nil
}
