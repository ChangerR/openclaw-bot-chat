package handler

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	"github.com/openclaw-bot-chat/backend/internal/model"
	responsedto "github.com/openclaw-bot-chat/backend/internal/model/response"
	"github.com/openclaw-bot-chat/backend/internal/service"
	apiresponse "github.com/openclaw-bot-chat/backend/pkg/response"
)

// MessageHandler handles message endpoints
type MessageHandler struct {
	msgService *service.MessageService
}

// NewMessageHandler creates a new message handler
func NewMessageHandler(msgService *service.MessageService) *MessageHandler {
	return &MessageHandler{msgService: msgService}
}

// GetMessages returns messages for a conversation
func (h *MessageHandler) GetMessages(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	conversationID := service.NormalizeConversationReference(c.Query("conversation_id"))
	if conversationID == "" {
		apiresponse.BadRequest(c, "conversation_id is required")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	if beforeSeq == 0 {
		beforeSeq, _ = strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	}
	afterSeq, _ := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)

	if limit < 1 || limit > 200 {
		limit = 50
	}
	if err := h.msgService.CanUserAccessConversation(c.Request.Context(), userID, conversationID); err != nil {
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

	messages, err := h.loadMessages(c, conversationID, limit, beforeSeq, afterSeq)
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}
	apiresponse.Success(c, responsedto.NewMessageResponses(messages))
}

// GetMessagesByConversation returns messages using a REST-style conversation path
func (h *MessageHandler) GetMessagesByConversation(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	conversationID := service.NormalizeConversationReference(c.Param("conversation_id"))
	if conversationID == "" {
		apiresponse.BadRequest(c, "conversation_id is required")
		return
	}

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)
	if beforeSeq == 0 {
		beforeSeq, _ = strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	}
	afterSeq, _ := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if err := h.msgService.CanUserAccessConversation(c.Request.Context(), userID, conversationID); err != nil {
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

	messages, err := h.loadMessages(c, conversationID, limit, beforeSeq, afterSeq)
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}
	apiresponse.Success(c, responsedto.NewMessageResponses(messages))
}

func (h *MessageHandler) loadMessages(c *gin.Context, conversationID string, limit int, beforeSeq int64, afterSeq int64) ([]model.Message, error) {
	if afterSeq > 0 {
		return h.msgService.GetMessagesAfterSeq(c.Request.Context(), conversationID, limit, afterSeq)
	}
	return h.msgService.GetMessages(c.Request.Context(), conversationID, limit, beforeSeq)
}

// GetConversations returns the list of conversations for the current user
func (h *MessageHandler) GetConversations(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 100 {
		limit = 50
	}
	conversations, err := h.msgService.GetConversationList(c.Request.Context(), userID, limit)
	if err != nil {
		apiresponse.InternalError(c, err.Error())
		return
	}
	items := make([]responsedto.ConversationInfoResponse, 0, len(conversations))
	for _, conversation := range conversations {
		items = append(items, responsedto.NewConversationInfoResponse(
			conversation.ConversationID,
			conversation.LastMessage,
			conversation.UnreadCount,
		))
	}
	apiresponse.Success(c, items)
}

// MessageQuery represents query params for messages
type MessageQuery struct {
	ConversationID string `form:"conversation_id" binding:"required"`
	Limit          int    `form:"limit"`
	BeforeSeq      int64  `form:"before_seq"`
	AfterSeq       int64  `form:"after_seq"`
}
