package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
	"github.com/openclaw-bot-chat/backend/internal/mqtt"
	"github.com/openclaw-bot-chat/backend/internal/repository"
)

// MessageService handles message operations
type MessageService struct {
	msgRepo    *repository.MessageRepository
	auditRepo  *repository.AuditLogRepository
	mqttClient *mqtt.Client
}

// NewMessageService creates a new message service
func NewMessageService(msgRepo *repository.MessageRepository, auditRepo *repository.AuditLogRepository) *MessageService {
	return &MessageService{msgRepo: msgRepo, auditRepo: auditRepo}
}

func (s *MessageService) SetMQTTClient(client *mqtt.Client) {
	s.mqttClient = client
}

// HandleIncomingMessage persists a raw MQTT payload received by the transport layer.
func (s *MessageService) HandleIncomingMessage(topic string, payload []byte) error {
	var msgPayload MessagePayload
	if err := json.Unmarshal(payload, &msgPayload); err != nil {
		return fmt.Errorf("unmarshal MQTT payload: %w", err)
	}

	mqttMsg, err := NewMQTTMessage(topic, msgPayload)
	if err != nil {
		return fmt.Errorf("build MQTT message model: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.SaveMessage(ctx, mqttMsg); err != nil {
		return fmt.Errorf("save MQTT message: %w", err)
	}

	return nil
}

// SaveMessage saves an incoming MQTT message to the database
func (s *MessageService) SaveMessage(ctx context.Context, msg *model.Message) error {
	exists, err := s.msgRepo.ExistsByConversationAndMessageID(ctx, msg.ConversationID, msg.MessageID)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

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
	ConversationID string         `json:"conversation_id"`
	LastMessage    *model.Message `json:"last_message,omitempty"`
	UnreadCount    int64          `json:"unread_count"`
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
			LastMessage:    &msgs[0],
			UnreadCount:    0,
		})
	}
	return result, nil
}

// MessagePayload represents an MQTT message payload
type MessagePayload struct {
	ID         string                 `json:"id"`
	MessageID  string                 `json:"message_id"`
	From       *MessagePeerPayload    `json:"from,omitempty"`
	To         *MessagePeerPayload    `json:"to,omitempty"`
	ContentRaw json.RawMessage        `json:"content,omitempty"`
	Timestamp  int64                  `json:"timestamp"`
	Seq        int64                  `json:"seq,omitempty"`
	SenderType string                 `json:"sender_type"`
	SenderID   string                 `json:"sender_id,omitempty"`
	SenderName string                 `json:"sender_name,omitempty"`
	BotID      string                 `json:"bot_id,omitempty"`
	GroupID    string                 `json:"group_id,omitempty"`
	MsgType    string                 `json:"msg_type"`
	Body       string                 `json:"body,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	Meta       map[string]interface{} `json:"meta,omitempty"`
}

type MessagePeerPayload struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Name   string `json:"name,omitempty"`
	Avatar string `json:"avatar,omitempty"`
}

type MessageContentPayload struct {
	Type string                 `json:"type"`
	Body string                 `json:"body"`
	Meta map[string]interface{} `json:"meta,omitempty"`
}

type SendMessageRequest struct {
	ID                  string                 `json:"id"`
	ConversationID      string                 `json:"conversationId"`
	ConversationIDSnake string                 `json:"conversation_id"`
	From                *MessagePeerPayload    `json:"from,omitempty"`
	To                  *MessagePeerPayload    `json:"to,omitempty"`
	ContentRaw          json.RawMessage        `json:"content,omitempty"`
	FromType            string                 `json:"fromType"`
	FromTypeSnake       string                 `json:"from_type"`
	FromID              string                 `json:"fromId"`
	FromIDSnake         string                 `json:"from_id"`
	BotID               string                 `json:"botId"`
	BotIDSnake          string                 `json:"bot_id"`
	ToType              string                 `json:"toType"`
	ToTypeSnake         string                 `json:"to_type"`
	ToID                string                 `json:"toId"`
	ToIDSnake           string                 `json:"to_id"`
	ContentType         string                 `json:"contentType"`
	ContentTypeSnake    string                 `json:"content_type"`
	Body                string                 `json:"body"`
	Meta                map[string]interface{} `json:"meta,omitempty"`
	Metadata            map[string]interface{} `json:"metadata,omitempty"`
	Timestamp           int64                  `json:"timestamp"`
}

type normalizedMessage struct {
	messageID      string
	conversationID string
	senderType     string
	senderID       string
	senderName     string
	receiverType   string
	receiverID     string
	contentType    string
	body           string
	meta           map[string]interface{}
	timestamp      int64
	botID          string
	groupID        string
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

// NewMQTTMessage creates a Message model from an MQTT payload.
func NewMQTTMessage(topic string, payload MessagePayload) (*model.Message, error) {
	normalized := normalizeIncomingMessage(topic, payload)
	msgID, err := uuid.Parse(normalized.messageID)
	if err != nil {
		msgID = uuid.New()
	}
	senderID := parseOptionalUUID(normalized.senderID)
	botID := parseOptionalUUID(normalized.botID)
	groupID := parseOptionalUUID(normalized.groupID)
	senderName := strPtrOrNil(normalized.senderName)
	metadata := model.JSONMap(normalized.meta)
	if metadata == nil {
		metadata = make(model.JSONMap)
	}
	var ts time.Time
	if normalized.timestamp > 0 {
		ts = time.Unix(normalized.timestamp, 0)
	} else {
		ts = time.Now()
	}
	return &model.Message{
		ConversationID: topic,
		MessageID:      msgID,
		SenderType:     model.SenderType(normalized.senderType),
		SenderID:       senderID,
		SenderName:     senderName,
		BotID:          botID,
		GroupID:        groupID,
		MsgType:        model.MsgType(normalized.contentType),
		Content:        normalized.body,
		Metadata:       metadata,
		MQTTTopic:      topic,
		QOS:            1,
		Seq:            0,
		CreatedAt:      ts,
	}, nil
}

func (s *MessageService) SendMessage(ctx context.Context, userID uuid.UUID, req SendMessageRequest) (*model.Message, error) {
	normalized, err := req.normalize(userID)
	if err != nil {
		return nil, err
	}

	msgID, err := uuid.Parse(normalized.messageID)
	if err != nil {
		msgID = uuid.New()
	}

	ts := time.Now()
	if normalized.timestamp > 0 {
		ts = time.Unix(normalized.timestamp, 0)
	}

	message := &model.Message{
		ConversationID: normalized.conversationID,
		MessageID:      msgID,
		SenderType:     model.SenderType(normalized.senderType),
		SenderID:       parseOptionalUUID(normalized.senderID),
		SenderName:     strPtrOrNil(normalized.senderName),
		BotID:          parseOptionalUUID(normalized.botID),
		GroupID:        parseOptionalUUID(normalized.groupID),
		MsgType:        model.MsgType(normalized.contentType),
		Content:        normalized.body,
		Metadata:       model.JSONMap(normalized.meta),
		MQTTTopic:      normalized.conversationID,
		QOS:            1,
		CreatedAt:      ts,
	}
	if message.Metadata == nil {
		message.Metadata = make(model.JSONMap)
	}

	if err := s.SaveMessage(ctx, message); err != nil {
		return nil, err
	}

	s.auditRepo.CreateAsync(&model.AuditLog{
		UserID:       &userID,
		BotID:        message.BotID,
		GroupID:      message.GroupID,
		Action:       string(model.AuditActionSendMessage),
		ResponseCode: intPtr(200),
	})

	if s.mqttClient != nil && s.mqttClient.IsConnected() {
		_ = s.mqttClient.Publish(normalized.conversationID, buildRealtimePayload(message), 1)
	}

	return message, nil
}

func NormalizeConversationReference(raw string) string {
	trimmed := strings.TrimSpace(strings.TrimPrefix(raw, "/"))
	if trimmed == "" {
		return ""
	}

	if decoded, err := url.PathUnescape(trimmed); err == nil && decoded != "" {
		trimmed = decoded
	}

	if strings.HasPrefix(trimmed, "chat/") {
		return trimmed
	}

	parts := strings.Split(trimmed, ":")
	if len(parts) == 3 {
		switch parts[0] {
		case "bot":
			return fmt.Sprintf("chat/bot/%s/to/bot/%s", parts[1], parts[2])
		case "group":
			return fmt.Sprintf("chat/group/%s", parts[2])
		case "user":
			return fmt.Sprintf("chat/user/%s/to/user/%s", parts[1], parts[2])
		}
	}

	return trimmed
}

func normalizeIncomingMessage(topic string, payload MessagePayload) normalizedMessage {
	route := parseMessageRoute(topic)
	normalized := normalizedMessage{
		messageID:      firstNonEmpty(payload.ID, payload.MessageID),
		conversationID: topic,
		senderType:     firstNonEmpty(payload.SenderType, route.fromType),
		senderID:       firstNonEmpty(payload.SenderID, route.fromID),
		senderName:     payload.SenderName,
		receiverType:   route.toType,
		receiverID:     route.toID,
		contentType:    firstNonEmpty(payload.MsgType, "text"),
		body:           payload.Body,
		meta:           firstNonEmptyMap(payload.Meta, payload.Metadata),
		timestamp:      payload.Timestamp,
		botID:          payload.BotID,
		groupID:        firstNonEmpty(payload.GroupID, route.groupID),
	}

	if payload.From != nil {
		normalized.senderType = firstNonEmpty(payload.From.Type, normalized.senderType)
		normalized.senderID = firstNonEmpty(payload.From.ID, normalized.senderID)
		normalized.senderName = firstNonEmpty(payload.From.Name, normalized.senderName)
	}
	if payload.To != nil {
		normalized.receiverType = firstNonEmpty(payload.To.Type, normalized.receiverType)
		normalized.receiverID = firstNonEmpty(payload.To.ID, normalized.receiverID)
	}
	contentPayload, legacyText := decodeContentPayload(payload.ContentRaw)
	if contentPayload != nil {
		normalized.contentType = firstNonEmpty(contentPayload.Type, normalized.contentType)
		normalized.body = firstNonEmpty(contentPayload.Body, normalized.body)
		normalized.meta = firstNonEmptyMap(contentPayload.Meta, normalized.meta)
	}
	if normalized.body == "" {
		normalized.body = legacyText
	}

	if normalized.messageID == "" {
		normalized.messageID = uuid.New().String()
	}
	if normalized.senderType == "" {
		normalized.senderType = string(model.SenderTypeSystem)
	}
	if normalized.contentType == "" {
		normalized.contentType = string(model.MsgTypeText)
	}
	if normalized.botID == "" {
		switch {
		case normalized.senderType == string(model.SenderTypeBot):
			normalized.botID = normalized.senderID
		case normalized.receiverType == "bot":
			normalized.botID = normalized.receiverID
		}
	}
	if normalized.groupID == "" && normalized.receiverType == "group" {
		normalized.groupID = normalized.receiverID
	}

	return normalized
}

func (r SendMessageRequest) normalize(userID uuid.UUID) (normalizedMessage, error) {
	conversationID := NormalizeConversationReference(firstNonEmpty(r.ConversationID, r.ConversationIDSnake))
	route := parseMessageRoute(conversationID)

	senderType := firstNonEmpty(r.FromType, r.FromTypeSnake, route.fromType)
	senderID := firstNonEmpty(r.FromID, r.FromIDSnake, r.BotID, r.BotIDSnake, route.fromID)
	senderName := ""
	if r.From != nil {
		senderType = firstNonEmpty(r.From.Type, senderType)
		senderID = firstNonEmpty(r.From.ID, senderID)
		senderName = firstNonEmpty(r.From.Name, senderName)
	}
	if senderType == "" {
		senderType = string(model.SenderTypeUser)
	}
	if senderID == "" {
		senderID = userID.String()
	}

	receiverType := firstNonEmpty(r.ToType, r.ToTypeSnake, route.toType)
	receiverID := firstNonEmpty(r.ToID, r.ToIDSnake, route.toID)
	if r.To != nil {
		receiverType = firstNonEmpty(r.To.Type, receiverType)
		receiverID = firstNonEmpty(r.To.ID, receiverID)
	}
	if receiverType == "" || receiverID == "" {
		return normalizedMessage{}, fmt.Errorf("missing message target")
	}

	contentType := firstNonEmpty(r.ContentType, r.ContentTypeSnake)
	body := r.Body
	meta := firstNonEmptyMap(r.Meta, r.Metadata)
	contentPayload, legacyText := decodeContentPayload(r.ContentRaw)
	if contentPayload != nil {
		contentType = firstNonEmpty(contentPayload.Type, contentType)
		body = firstNonEmpty(contentPayload.Body, body)
		meta = firstNonEmptyMap(contentPayload.Meta, meta)
	}
	if body == "" {
		body = legacyText
	}
	if contentType == "" {
		contentType = string(model.MsgTypeText)
	}
	if body == "" {
		return normalizedMessage{}, fmt.Errorf("message body is required")
	}

	if conversationID == "" {
		conversationID = buildRealtimeConversationID(senderType, senderID, receiverType, receiverID)
	}

	normalized := normalizedMessage{
		messageID:      firstNonEmpty(r.ID, uuid.New().String()),
		conversationID: conversationID,
		senderType:     senderType,
		senderID:       senderID,
		senderName:     senderName,
		receiverType:   receiverType,
		receiverID:     receiverID,
		contentType:    contentType,
		body:           body,
		meta:           meta,
		timestamp:      r.Timestamp,
	}
	if normalized.senderType == string(model.SenderTypeBot) {
		normalized.botID = normalized.senderID
	} else if normalized.receiverType == "bot" {
		normalized.botID = normalized.receiverID
	}
	if normalized.receiverType == "group" {
		normalized.groupID = normalized.receiverID
	}

	return normalized, nil
}

func buildRealtimePayload(message *model.Message) map[string]interface{} {
	route := parseMessageRoute(message.ConversationID)
	senderID := ""
	if message.SenderID != nil {
		senderID = message.SenderID.String()
	}
	if senderID == "" && message.BotID != nil && message.SenderType == model.SenderTypeBot {
		senderID = message.BotID.String()
	}

	from := map[string]interface{}{
		"type": string(message.SenderType),
		"id":   senderID,
	}
	if message.SenderName != nil {
		from["name"] = *message.SenderName
	}

	return map[string]interface{}{
		"id":        message.MessageID.String(),
		"from":      from,
		"to":        map[string]interface{}{"type": route.toType, "id": route.toID},
		"content":   map[string]interface{}{"type": string(message.MsgType), "body": message.Content, "meta": copyMapFromJSON(message.Metadata)},
		"timestamp": message.CreatedAt.Unix(),
		"seq":       message.Seq,
	}
}

type messageRoute struct {
	fromType string
	fromID   string
	toType   string
	toID     string
	groupID  string
}

func parseMessageRoute(topic string) messageRoute {
	parts := splitMessageTopic(NormalizeConversationReference(topic))
	if len(parts) == 6 && parts[0] == "chat" && parts[3] == "to" {
		return messageRoute{
			fromType: parts[1],
			fromID:   parts[2],
			toType:   parts[4],
			toID:     parts[5],
		}
	}
	if len(parts) == 3 && parts[0] == "chat" && parts[1] == "group" {
		return messageRoute{
			toType:  "group",
			toID:    parts[2],
			groupID: parts[2],
		}
	}
	return messageRoute{}
}

func buildRealtimeConversationID(senderType, senderID, receiverType, receiverID string) string {
	if receiverType == "group" {
		return fmt.Sprintf("chat/group/%s", receiverID)
	}
	return fmt.Sprintf("chat/%s/%s/to/%s/%s", senderType, senderID, receiverType, receiverID)
}

func parseOptionalUUID(raw string) *uuid.UUID {
	if raw == "" {
		return nil
	}
	parsed, err := uuid.Parse(raw)
	if err != nil {
		return nil
	}
	return &parsed
}

func strPtrOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonEmptyMap(values ...map[string]interface{}) map[string]interface{} {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func copyMapFromJSON(source model.JSONMap) map[string]interface{} {
	if source == nil {
		return nil
	}

	copied := make(map[string]interface{}, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}

func splitMessageTopic(topic string) []string {
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

func decodeContentPayload(raw json.RawMessage) (*MessageContentPayload, string) {
	if len(raw) == 0 {
		return nil, ""
	}

	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, ""
	}

	if trimmed[0] == '{' {
		var payload MessageContentPayload
		if err := json.Unmarshal(raw, &payload); err == nil {
			return &payload, ""
		}
		return nil, ""
	}

	var legacyText string
	if err := json.Unmarshal(raw, &legacyText); err == nil {
		return nil, legacyText
	}

	return nil, ""
}
