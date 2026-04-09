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

// GroupHandler handles group endpoints
type GroupHandler struct {
	groupService *service.GroupService
}

// NewGroupHandler creates a new group handler
func NewGroupHandler(groupService *service.GroupService) *GroupHandler {
	return &GroupHandler{groupService: groupService}
}

// List returns all groups for the current user
func (h *GroupHandler) List(c *gin.Context) {
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
	groups, total, err := h.groupService.ListByUser(c.Request.Context(), userID, page, pageSize)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	response.Paginated(c, groups, page, pageSize, total)
}

// Create creates a new group
func (h *GroupHandler) Create(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	var req service.CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	group, err := h.groupService.Create(c.Request.Context(), req, userID, ip, userAgent)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	response.Created(c, group)
}

// Get returns a group by ID
func (h *GroupHandler) Get(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	group, err := h.groupService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrGroupNotFound) {
			response.NotFound(c, "group not found")
		} else {
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, group)
}

// Update updates a group
func (h *GroupHandler) Update(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	var req service.UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	group, err := h.groupService.Update(c.Request.Context(), id, userID, req, ip, userAgent)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrGroupNotFound):
			response.NotFound(c, "group not found")
		case errors.Is(err, service.ErrNotGroupOwner):
			response.Forbidden(c, "you are not the owner of this group")
		default:
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, group)
}

// Delete deletes a group
func (h *GroupHandler) Delete(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	if err := h.groupService.Delete(c.Request.Context(), id, userID, ip, userAgent); err != nil {
		switch {
		case errors.Is(err, service.ErrGroupNotFound):
			response.NotFound(c, "group not found")
		case errors.Is(err, service.ErrNotGroupOwner):
			response.Forbidden(c, "you are not the owner of this group")
		default:
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, gin.H{"message": "group deleted"})
}

// --- Members ---

// AddMember adds a user or bot to a group
func (h *GroupHandler) AddMember(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	var req service.AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	if req.UserID == nil && req.BotID == nil {
		response.BadRequest(c, "either user_id or bot_id is required")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	if err := h.groupService.AddMember(c.Request.Context(), groupID, userID, req, ip, userAgent); err != nil {
		switch {
		case errors.Is(err, service.ErrGroupNotFound):
			response.NotFound(c, "group not found")
		case errors.Is(err, service.ErrAlreadyMember):
			response.Conflict(c, "user is already a member")
		case errors.Is(err, service.ErrGroupFull):
			response.BadRequest(c, "group is full")
		default:
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, gin.H{"message": "member added"})
}

// RemoveMember removes a user from a group
func (h *GroupHandler) RemoveMember(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	targetIDStr := c.Param("uid")
	targetID, err := uuid.Parse(targetIDStr)
	if err != nil {
		response.BadRequest(c, "invalid user id")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	if err := h.groupService.RemoveMember(c.Request.Context(), groupID, targetID, userID, ip, userAgent); err != nil {
		switch {
		case errors.Is(err, service.ErrGroupNotFound):
			response.NotFound(c, "group not found")
		case errors.Is(err, service.ErrNotGroupMember):
			response.NotFound(c, "member not found")
		default:
			response.InternalError(c, err.Error())
		}
		return
	}
	response.Success(c, gin.H{"message": "member removed"})
}

// GetMembers returns all members of a group
func (h *GroupHandler) GetMembers(c *gin.Context) {
	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		response.BadRequest(c, "invalid group id")
		return
	}
	users, bots, err := h.groupService.ListMembers(c.Request.Context(), groupID)
	if err != nil {
		response.InternalError(c, err.Error())
		return
	}
	response.Success(c, gin.H{
		"users": users,
		"bots":  bots,
	})
}
