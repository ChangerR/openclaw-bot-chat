package handler

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	responsedto "github.com/openclaw-bot-chat/backend/internal/model/response"
	"github.com/openclaw-bot-chat/backend/internal/service"
	apiresponse "github.com/openclaw-bot-chat/backend/pkg/response"
)

const (
	defaultBotRuntimeHeartbeatIntervalMs = 15000
	defaultBotRuntimeReconnectBaseMs     = 1000
	defaultBotRuntimeReconnectMaxMs      = 30000
)

type BotRuntimeHandler struct {
	msgService *service.MessageService
}

type botRuntimeBootstrapResponse struct {
	Bot             botRuntimeBotInfo         `json:"bot"`
	Groups          []botRuntimeGroupInfo     `json:"groups"`
	Dialogs         []botRuntimeDialogInfo    `json:"dialogs"`
	Subscriptions   []botRuntimeSubscription  `json:"subscriptions"`
	Checkpoints     []botRuntimeCheckpoint    `json:"checkpoints"`
	TransportPolicy botRuntimeTransportPolicy `json:"transport_policy"`
}

type botRuntimeBotInfo struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name,omitempty"`
	Description *string                `json:"description,omitempty"`
	Status      string                 `json:"status,omitempty"`
	Config      map[string]interface{} `json:"config,omitempty"`
}

type botRuntimeGroupInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name,omitempty"`
	Topic string `json:"topic,omitempty"`
}

type botRuntimeDialogInfo struct {
	DialogID string `json:"dialog_id"`
	Topic    string `json:"topic,omitempty"`
}

type botRuntimeSubscription struct {
	Topic string `json:"topic"`
	QOS   int    `json:"qos,omitempty"`
}

type botRuntimeCheckpoint struct {
	DialogID      string `json:"dialog_id"`
	LastSeq       int64  `json:"last_seq,omitempty"`
	LastMessageID string `json:"last_message_id,omitempty"`
}

type botRuntimeTransportPolicy struct {
	HeartbeatIntervalMs int      `json:"heartbeat_interval_ms"`
	BaseReconnectDelay  int      `json:"base_reconnect_delay_ms"`
	MaxReconnectDelay   int      `json:"max_reconnect_delay_ms"`
	Topics              []string `json:"topics"`
}

type botRuntimeSendMessageRequest struct {
	DialogID         string                 `json:"dialog_id"`
	MessageID        string                 `json:"message_id"`
	ContentType      string                 `json:"content_type"`
	Body             string                 `json:"body"`
	Meta             map[string]interface{} `json:"meta,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
	ReplyToMessageID string                 `json:"reply_to_message_id,omitempty"`
	Topic            string                 `json:"topic,omitempty"`
}

func NewBotRuntimeHandler(msgService *service.MessageService) *BotRuntimeHandler {
	return &BotRuntimeHandler{msgService: msgService}
}

func (h *BotRuntimeHandler) Bootstrap(c *gin.Context) {
	bot, ok := middleware.GetBot(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}

	groups, err := h.msgService.ListGroupsForBot(c.Request.Context(), bot.ID)
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}

	conversations, err := h.msgService.GetConversationsForBot(c.Request.Context(), bot.ID, 200)
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}

	dialogs := make([]botRuntimeDialogInfo, 0, len(conversations))
	for _, conversationID := range conversations {
		dialogs = append(dialogs, botRuntimeDialogInfo{
			DialogID: conversationID,
			Topic:    conversationID,
		})
	}

	subscriptions := []botRuntimeSubscription{
		{Topic: "chat/dm/user/+/bot/" + bot.ID.String(), QOS: 1},
		{Topic: "chat/dm/bot/" + bot.ID.String() + "/bot/+", QOS: 1},
		{Topic: "chat/dm/bot/+/bot/" + bot.ID.String(), QOS: 1},
	}
	groupInfos := make([]botRuntimeGroupInfo, 0, len(groups))
	for _, group := range groups {
		topic := "chat/group/" + group.ID.String()
		groupInfos = append(groupInfos, botRuntimeGroupInfo{
			ID:    group.ID.String(),
			Name:  group.Name,
			Topic: topic,
		})
		subscriptions = append(subscriptions, botRuntimeSubscription{
			Topic: topic,
			QOS:   1,
		})
	}

	status := ""
	if response := responsedto.NewBotResponse(bot); response != nil {
		status = response.Status
	}

	apiresponse.Success(c, botRuntimeBootstrapResponse{
		Bot: botRuntimeBotInfo{
			ID:          bot.ID.String(),
			Name:        bot.Name,
			Description: bot.Description,
			Status:      status,
			Config:      copyBotRuntimeMap(map[string]interface{}(bot.Config)),
		},
		Groups:        groupInfos,
		Dialogs:       dialogs,
		Subscriptions: subscriptions,
		Checkpoints:   []botRuntimeCheckpoint{},
		TransportPolicy: botRuntimeTransportPolicy{
			HeartbeatIntervalMs: defaultBotRuntimeHeartbeatIntervalMs,
			BaseReconnectDelay:  defaultBotRuntimeReconnectBaseMs,
			MaxReconnectDelay:   defaultBotRuntimeReconnectMaxMs,
			Topics:              []string{},
		},
	})
}

func (h *BotRuntimeHandler) SendMessage(c *gin.Context) {
	bot, ok := middleware.GetBot(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}

	var req botRuntimeSendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apiresponse.BadRequest(c, "invalid request: "+err.Error())
		return
	}

	message, err := h.msgService.SendBotMessage(c.Request.Context(), bot.ID, service.SendMessageRequest{
		ID:             req.MessageID,
		ConversationID: req.DialogID,
		Topic:          req.Topic,
		ContentType:    req.ContentType,
		Body:           req.Body,
		Meta:           mergeBotRuntimeMeta(req.Meta, req.Metadata, req.ReplyToMessageID),
		FromType:       "bot",
		FromID:         bot.ID.String(),
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrMessageSenderForbidden),
			errors.Is(err, service.ErrMessageTargetForbidden),
			errors.Is(err, service.ErrConversationAccessDenied):
			apiresponse.Forbidden(c, err.Error())
		default:
			apiresponse.BadRequest(c, err.Error())
		}
		return
	}

	apiresponse.Success(c, responsedto.NewMessageResponse(message))
}

func (h *BotRuntimeHandler) Heartbeat(c *gin.Context) {
	if _, ok := middleware.GetBot(c); !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	apiresponse.Success(c, gin.H{"ok": true})
}

func (h *BotRuntimeHandler) GetDialogMessages(c *gin.Context) {
	bot, ok := middleware.GetBot(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}

	dialogID := service.NormalizeConversationReference(c.Param("dialog_id"))
	if dialogID == "" {
		apiresponse.BadRequest(c, "dialog_id is required")
		return
	}

	if err := h.msgService.CanBotAccessConversation(c.Request.Context(), bot.ID, dialogID); err != nil {
		switch {
		case errors.Is(err, service.ErrConversationAccessDenied):
			apiresponse.Forbidden(c, err.Error())
		case errors.Is(err, service.ErrInvalidMessageRoute):
			apiresponse.BadRequest(c, err.Error())
		default:
			apiresponse.InternalError(c, err.Error())
		}
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	afterSeq, _ := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)

	var (
		messages interface{}
		err      error
	)
	if afterSeq > 0 {
		rawMessages, queryErr := h.msgService.GetMessagesAfterSeq(c.Request.Context(), dialogID, limit, afterSeq)
		err = queryErr
		messages = responsedto.NewMessageResponses(rawMessages)
	} else {
		rawMessages, queryErr := h.msgService.GetMessages(c.Request.Context(), dialogID, limit, 0)
		err = queryErr
		messages = responsedto.NewMessageResponses(rawMessages)
	}
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}

	apiresponse.Success(c, gin.H{"messages": messages})
}

func mergeBotRuntimeMeta(primary map[string]interface{}, secondary map[string]interface{}, replyToMessageID string) map[string]interface{} {
	if len(primary) == 0 && len(secondary) == 0 && replyToMessageID == "" {
		return nil
	}

	merged := make(map[string]interface{}, len(primary)+len(secondary)+1)
	for key, value := range secondary {
		merged[key] = value
	}
	for key, value := range primary {
		merged[key] = value
	}
	if replyToMessageID != "" {
		merged["reply_to_message_id"] = replyToMessageID
	}
	return merged
}

func copyBotRuntimeMap(source map[string]interface{}) map[string]interface{} {
	if source == nil {
		return nil
	}

	copied := make(map[string]interface{}, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}
