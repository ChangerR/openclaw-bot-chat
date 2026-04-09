package handler

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/openclaw-bot-chat/backend/pkg/response"
)

// BotHandler handles bot endpoints
type BotHandler struct {
	botService *service.BotService
}

// NewBotHandler creates a new bot handler
func NewBotHandler(botService *service.BotService) *BotHandler {
	return &BotHandler{botService: botService}
}

// List returns all bots for the current user
func (h *BotHandler) List(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	bots, total, err := h.botService.ListByOwner(c.Request.Context(), userID, page, pageSize)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	response.Paginated(c, bots, page, pageSize, total)
}

// Create creates a new bot
func (h *BotHandler) Create(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	var req service.CreateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	bot, err := h.botService.Create(c.Request.Context(), req, userID, ip, userAgent)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	response.Created(c, bot)
}

// Get returns a bot by ID
func (h *BotHandler) Get(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	bot, err := h.botService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrBotNotFound) {
			response.NotFound(c, "bot not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	// Check ownership
	if bot.OwnerID != userID {
		response.Forbidden(c, "you don't have access to this bot")
		return
	}
	response.Success(c, bot)
}

// Update updates a bot
func (h *BotHandler) Update(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	var req service.UpdateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	bot, err := h.botService.Update(c.Request.Context(), id, userID, req, ip, userAgent)
	if err != nil {
		if errors.Is(err, service.ErrBotNotFound) {
			response.NotFound(c, "bot not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, bot)
}

// Delete deletes a bot
func (h *BotHandler) Delete(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	if err := h.botService.Delete(c.Request.Context(), id, userID, ip, userAgent); err != nil {
		if errors.Is(err, service.ErrBotNotFound) {
			response.NotFound(c, "bot not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, gin.H{"message": "bot deleted"})
}

// --- Bot Keys ---

// ListKeys returns all keys for a bot
func (h *BotHandler) ListKeys(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	botIDStr := c.Param("id")
	botID, err := uuid.Parse(botIDStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	keys, err := h.botService.ListKeys(c.Request.Context(), botID, userID)
	if err != nil {
		if errors.Is(err, service.ErrBotNotFound) {
			response.NotFound(c, "bot not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, keys)
}

// CreateKey creates a new bot key
func (h *BotHandler) CreateKey(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	botIDStr := c.Param("id")
	botID, err := uuid.Parse(botIDStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	var req service.CreateKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	keyResp, err := h.botService.CreateKey(c.Request.Context(), botID, userID, req, ip, userAgent)
	if err != nil {
		if errors.Is(err, service.ErrBotNotFound) {
			response.NotFound(c, "bot not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	c.JSON(201, gin.H{
		"code":    0,
		"message": "key created successfully. save it now, it won't be shown again.",
		"data":    keyResp,
	})
}

// RevokeKey revokes a bot key
func (h *BotHandler) RevokeKey(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	botIDStr := c.Param("id")
	botID, err := uuid.Parse(botIDStr)
	if err != nil {
		response.BadRequest(c, "invalid bot id")
		return
	}
	keyIDStr := c.Param("key_id")
	keyID, err := uuid.Parse(keyIDStr)
	if err != nil {
		response.BadRequest(c, "invalid key id")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	if err := h.botService.RevokeKey(c.Request.Context(), botID, keyID, userID, ip, userAgent); err != nil {
		if errors.Is(err, service.ErrBotNotFound) || errors.Is(err, service.ErrBotKeyNotFound) {
			response.NotFound(c, "bot or key not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, gin.H{"message": "key revoked"})
}
