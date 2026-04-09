package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/openclaw-bot-chat/backend/pkg/response"
)

// AuthHandler handles authentication endpoints
type AuthHandler struct {
	authService *service.AuthService
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// Register handles user registration
func (h *AuthHandler) Register(c *gin.Context) {
	var req service.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	tokens, user, err := h.authService.Register(c.Request.Context(), req, ip, userAgent)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrUsernameTaken):
			response.Conflict(c, "username already taken")
		case errors.Is(err, service.ErrEmailTaken):
			response.Conflict(c, "email already taken")
		default:
			response.InternalError(c, "failed to register: "+err.Error())
		}
		return
	}
	c.JSON(201, gin.H{
		"code":    0,
		"message": "registered successfully",
		"data": gin.H{
			"tokens": tokens,
			"user": gin.H{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
			},
		},
	})
}

// Login handles user login
func (h *AuthHandler) Login(c *gin.Context) {
	var req service.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	tokens, user, err := h.authService.Login(c.Request.Context(), req, ip, userAgent)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			response.Unauthorized(c, "invalid username or password")
		} else {
			response.InternalError(c, "failed to login: "+err.Error())
		}
		return
	}
	c.JSON(200, gin.H{
		"code":    0,
		"message": "login successful",
		"data": gin.H{
			"tokens": tokens,
			"user": gin.H{
				"id":       user.ID,
				"username": user.Username,
				"email":    user.Email,
			},
		},
	})
}

// Refresh handles token refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req service.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	tokens, err := h.authService.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		response.Unauthorized(c, "invalid or expired refresh token")
		return
	}
	c.JSON(200, gin.H{
		"code":    0,
		"message": "token refreshed",
		"data":    tokens,
	})
}

// Logout handles user logout
func (h *AuthHandler) Logout(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	h.authService.Logout(c.Request.Context(), userID, ip, userAgent)
	response.Success(c, gin.H{"message": "logged out"})
}

// Me returns the current user's info
func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		response.Unauthorized(c, "unauthorized")
		return
	}
	username, _ := middleware.GetUsername(c)
	c.JSON(200, gin.H{
		"code":    0,
		"message": "success",
		"data": gin.H{
			"id":       userID,
			"username": username,
		},
	})
}
