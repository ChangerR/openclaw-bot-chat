package websocket

import (
	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/mqtt"
)

// TopicRoute represents a parsed topic structure.
type TopicRoute struct {
	Prefix string
	Scope  string
	UserID string
	BotID  string
	GroupID string
}

// ParseTopic extracts the known chat route shape from a topic string.
func ParseTopic(topic string) (TopicRoute, bool) {
	parts := splitTopic(topic)
	if len(parts) < 2 {
		return TopicRoute{}, false
	}

	route := TopicRoute{
		Prefix: parts[0],
		Scope:  parts[1],
	}

	switch route.Scope {
	case "user":
		if len(parts) < 3 {
			return TopicRoute{}, false
		}
		route.UserID = parts[2]
		if len(parts) >= 5 && parts[3] == "bot" {
			route.BotID = parts[4]
		}
	case "group":
		if len(parts) < 3 {
			return TopicRoute{}, false
		}
		route.GroupID = parts[2]
	default:
		return TopicRoute{}, false
	}

	return route, true
}

// PersonalTopic builds the default topic subscription for a user.
func PersonalTopic(prefix string, userID uuid.UUID) string {
	return mqtt.BuildTopic(prefix, "user", userID.String(), "#")
}

// MatchTopic checks whether a concrete topic matches an MQTT-style subscription pattern.
func MatchTopic(pattern, topic string) bool {
	if pattern == "" || topic == "" {
		return false
	}
	if pattern == "#" || pattern == topic {
		return true
	}

	patternParts := splitTopic(pattern)
	topicParts := splitTopic(topic)
	topicIndex := 0

	for patternIndex, part := range patternParts {
		switch part {
		case "#":
			return patternIndex == len(patternParts)-1
		case "+":
			if topicIndex >= len(topicParts) {
				return false
			}
			topicIndex++
		default:
			if topicIndex >= len(topicParts) || part != topicParts[topicIndex] {
				return false
			}
			topicIndex++
		}
	}

	return topicIndex == len(topicParts)
}

func splitTopic(topic string) []string {
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
