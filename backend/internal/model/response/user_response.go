package response

import (
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
)

type UserResponse struct {
	ID          uuid.UUID        `json:"id"`
	Username    string           `json:"username"`
	Email       string           `json:"email"`
	Nickname    *string          `json:"nickname,omitempty"`
	AvatarURL   *string          `json:"avatar_url,omitempty"`
	Status      model.UserStatus `json:"status"`
	LastLoginAt *time.Time       `json:"last_login_at,omitempty"`
	LastLoginIP *string          `json:"last_login_ip,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type AuthUserResponse struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

type AuthPayloadResponse struct {
	Tokens TokenResponse     `json:"tokens"`
	User   *AuthUserResponse `json:"user,omitempty"`
}

type MeResponse struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
}

func NewUserResponse(user *model.User) *UserResponse {
	if user == nil {
		return nil
	}

	return &UserResponse{
		ID:          user.ID,
		Username:    user.Username,
		Email:       user.Email,
		Nickname:    user.Nickname,
		AvatarURL:   user.AvatarURL,
		Status:      user.Status,
		LastLoginAt: user.LastLoginAt,
		LastLoginIP: user.LastLoginIP,
		CreatedAt:   user.CreatedAt,
		UpdatedAt:   user.UpdatedAt,
	}
}

func NewUserResponses(users []model.User) []UserResponse {
	if len(users) == 0 {
		return []UserResponse{}
	}

	responses := make([]UserResponse, 0, len(users))
	for i := range users {
		responses = append(responses, *NewUserResponse(&users[i]))
	}
	return responses
}

func NewAuthUserResponse(user *model.User) *AuthUserResponse {
	if user == nil {
		return nil
	}

	return &AuthUserResponse{
		ID:       user.ID,
		Username: user.Username,
		Email:    user.Email,
	}
}
