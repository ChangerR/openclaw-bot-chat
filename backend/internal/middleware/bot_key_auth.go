package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/openclaw-bot-chat/backend/internal/model"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/openclaw-bot-chat/backend/pkg/response"
)

const (
	botContextKey      = "bot"
	botIDContextKey    = "botID"
	botOwnerContextKey = "botOwnerID"
)

func BotKeyAuth(botService *service.BotService) gin.HandlerFunc {
	return botKeyAuth(botService, true)
}

func OptionalBotKeyAuth(botService *service.BotService) gin.HandlerFunc {
	return botKeyAuth(botService, false)
}

func botKeyAuth(botService *service.BotService, required bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		rawKey := strings.TrimSpace(c.GetHeader("X-Bot-Key"))
		if rawKey == "" {
			if required {
				response.Unauthorized(c, "missing X-Bot-Key header")
				c.Abort()
				return
			}
			c.Next()
			return
		}

		bot, err := botService.ValidateKey(c.Request.Context(), rawKey)
		if err != nil {
			response.Unauthorized(c, "invalid bot key")
			c.Abort()
			return
		}

		c.Set(botContextKey, bot)
		c.Set(botIDContextKey, bot.ID)
		c.Set(botOwnerContextKey, bot.OwnerID)
		c.Next()
	}
}

func GetBot(c *gin.Context) (*model.Bot, bool) {
	value, exists := c.Get(botContextKey)
	if !exists {
		return nil, false
	}
	bot, ok := value.(*model.Bot)
	return bot, ok
}
