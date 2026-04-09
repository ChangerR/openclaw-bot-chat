package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/openclaw-bot-chat/backend/pkg/response"
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
	conversationID := c.Query("conversation_id")
	if conversationID == "" {
		response.BadRequest(c, "conversation_id is required")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	beforeSeq, _ := strconv.ParseInt(c.DefaultQuery("before_seq", "0"), 10, 64)

	if limit < 1 || limit > 200 {
		limit = 50
	}

	messages, err := h.msgService.GetMessages(c.Request.Context(), conversationID, limit, beforeSeq)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}

	c.JSON(200, gin.H{
		"code":    0,
		"message": "success",
		"data":    messages,
	})
}

// GetConversations returns the list of conversations for the current user
func (h *MessageHandler) GetConversations(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit < 1 || limit > 100 {
		limit = 50
	}
	conversations, err := h.msgService.GetConversationList(c.Request.Context(), userID, limit)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	c.JSON(200, gin.H{
		"code":    0,
		"message": "success",
		"data":    conversations,
	})
}

// MessageQuery represents query params for messages
type MessageQuery struct {
	ConversationID string `form:"conversation_id" binding:"required"`
	Limit          int    `form:"limit"`
	BeforeSeq      int64  `form:"before_seq"`
}
