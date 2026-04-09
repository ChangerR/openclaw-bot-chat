package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/middleware"
	responsedto "github.com/openclaw-bot-chat/backend/internal/model/response"
	"github.com/openclaw-bot-chat/backend/internal/service"
	apiresponse "github.com/openclaw-bot-chat/backend/pkg/response"
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
		apiresponse.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	tokens, user, err := h.authService.Register(c.Request.Context(), req, ip, userAgent)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrUsernameTaken):
			apiresponse.Conflict(c, "username already taken")
		case errors.Is(err, service.ErrEmailTaken):
			apiresponse.Conflict(c, "email already taken")
		default:
			apiresponse.InternalError(c, "failed to register: "+err.Error())
		}
		return
	}
	c.JSON(201, apiresponse.Response{
		Code:    int(apiresponse.CodeSuccess),
		Message: "registered successfully",
		Data: responsedto.AuthPayloadResponse{
			Tokens: responsedto.TokenResponse{
				AccessToken:  tokens.AccessToken,
				RefreshToken: tokens.RefreshToken,
				ExpiresIn:    tokens.ExpiresIn,
				TokenType:    tokens.TokenType,
			},
			User: responsedto.NewAuthUserResponse(user),
		},
	})
}

// Login handles user login
func (h *AuthHandler) Login(c *gin.Context) {
	var req service.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apiresponse.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	tokens, user, err := h.authService.Login(c.Request.Context(), req, ip, userAgent)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			apiresponse.Unauthorized(c, "invalid username or password")
		} else {
			apiresponse.InternalError(c, "failed to login: "+err.Error())
		}
		return
	}
	c.JSON(200, apiresponse.Response{
		Code:    int(apiresponse.CodeSuccess),
		Message: "login successful",
		Data: responsedto.AuthPayloadResponse{
			Tokens: responsedto.TokenResponse{
				AccessToken:  tokens.AccessToken,
				RefreshToken: tokens.RefreshToken,
				ExpiresIn:    tokens.ExpiresIn,
				TokenType:    tokens.TokenType,
			},
			User: responsedto.NewAuthUserResponse(user),
		},
	})
}

// Refresh handles token refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req service.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apiresponse.BadRequest(c, "invalid request: "+err.Error())
		return
	}
	tokens, err := h.authService.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		apiresponse.Unauthorized(c, "invalid or expired refresh token")
		return
	}
	c.JSON(200, apiresponse.Response{
		Code:    int(apiresponse.CodeSuccess),
		Message: "token refreshed",
		Data: responsedto.TokenResponse{
			AccessToken:  tokens.AccessToken,
			RefreshToken: tokens.RefreshToken,
			ExpiresIn:    tokens.ExpiresIn,
			TokenType:    tokens.TokenType,
		},
	})
}

// Logout handles user logout
func (h *AuthHandler) Logout(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	ip := c.ClientIP()
	userAgent := c.GetHeader("User-Agent")
	h.authService.Logout(c.Request.Context(), userID, ip, userAgent)
	apiresponse.Success(c, gin.H{"message": "logged out"})
}

// Me returns the current user's info
func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		apiresponse.Unauthorized(c, "unauthorized")
		return
	}
	username, _ := middleware.GetUsername(c)
	c.JSON(200, apiresponse.Response{
		Code:    int(apiresponse.CodeSuccess),
		Message: "success",
		Data: responsedto.MeResponse{
			ID:       userID,
			Username: username,
		},
	})
}
