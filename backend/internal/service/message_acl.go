package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrConversationAccessDenied = errors.New("you do not have access to this conversation")
	ErrMessageSenderForbidden   = errors.New("you do not control the requested sender")
	ErrMessageTargetForbidden   = errors.New("message target is outside allowed scope")
	ErrTopicAccessDenied        = errors.New("you do not have access to this topic")
	ErrInvalidMessageRoute      = errors.New("invalid message route")
	ErrGroupAdminRequired       = errors.New("only group owner or admin can add members")
)

func (s *MessageService) CanUserAccessConversation(ctx context.Context, userID uuid.UUID, conversationID string) error {
	route := parseMessageRoute(conversationID)

	switch {
	case route.groupID != "":
		groupID, ok := parseUUIDValue(route.groupID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.isUserGroupMember(ctx, userID, groupID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrConversationAccessDenied
		}
		return nil
	case route.fromType == "" || route.toType == "":
		return ErrInvalidMessageRoute
	default:
		allowed, err := s.userMatchesDirectRoute(ctx, userID, route)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrConversationAccessDenied
		}
		return nil
	}
}

func (s *MessageService) CanUserSubscribeTopic(ctx context.Context, userID uuid.UUID, topic string) error {
	if err := s.CanUserAccessConversation(ctx, userID, topic); err != nil {
		if errors.Is(err, ErrConversationAccessDenied) {
			return ErrTopicAccessDenied
		}
		return err
	}
	return nil
}

func (s *MessageService) CanUserPublishTopic(ctx context.Context, userID uuid.UUID, topic string, payload json.RawMessage) error {
	normalized, err := decodePublishMessage(topic, payload)
	if err != nil {
		return err
	}
	return s.authorizeUserSendNormalized(ctx, userID, normalized)
}

func (s *MessageService) CanBotSubscribeTopic(ctx context.Context, botID uuid.UUID, topic string) error {
	route := parseMessageRoute(topic)

	switch {
	case route.groupID != "":
		groupID, ok := parseUUIDValue(route.groupID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.isBotGroupMember(ctx, groupID, botID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrTopicAccessDenied
		}
		return nil
	case route.fromType == "" || route.toType == "":
		return ErrInvalidMessageRoute
	case route.fromType == "bot" && route.fromID == botID.String():
		return nil
	case route.toType == "bot" && route.toID == botID.String():
		return nil
	default:
		return ErrTopicAccessDenied
	}
}

func (s *MessageService) CanBotPublishTopic(ctx context.Context, botID uuid.UUID, topic string, payload json.RawMessage) error {
	normalized, err := decodePublishMessage(topic, payload)
	if err != nil {
		return err
	}
	return s.authorizeBotSendNormalized(ctx, botID, normalized)
}

func (s *MessageService) authorizeUserSendNormalized(ctx context.Context, userID uuid.UUID, normalized normalizedMessage) error {
	if err := validateNormalizedMessage(normalized); err != nil {
		return err
	}

	switch normalized.senderType {
	case "user":
		if normalized.senderID != userID.String() {
			return ErrMessageSenderForbidden
		}
	case "bot":
		senderBotID, ok := parseUUIDValue(normalized.senderID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		ownsBot, err := s.userOwnsBot(ctx, userID, senderBotID)
		if err != nil {
			return err
		}
		if !ownsBot {
			return ErrMessageSenderForbidden
		}
	default:
		return ErrInvalidMessageRoute
	}

	switch normalized.receiverType {
	case "bot":
		receiverBotID, ok := parseUUIDValue(normalized.receiverID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.canUserTargetBot(ctx, userID, receiverBotID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrMessageTargetForbidden
		}
	case "group":
		groupID, ok := parseUUIDValue(normalized.receiverID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.isUserGroupMember(ctx, userID, groupID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrMessageTargetForbidden
		}
		if normalized.senderType == "bot" {
			senderBotID, ok := parseUUIDValue(normalized.senderID)
			if !ok {
				return ErrInvalidMessageRoute
			}
			botAllowed, err := s.isBotGroupMember(ctx, groupID, senderBotID)
			if err != nil {
				return err
			}
			if !botAllowed {
				return ErrMessageTargetForbidden
			}
		}
	case "user":
		if normalized.receiverID != userID.String() {
			return ErrMessageTargetForbidden
		}
	default:
		return ErrInvalidMessageRoute
	}

	return nil
}

func (s *MessageService) authorizeBotSendNormalized(ctx context.Context, botID uuid.UUID, normalized normalizedMessage) error {
	if err := validateNormalizedMessage(normalized); err != nil {
		return err
	}
	if normalized.senderType != "bot" || normalized.senderID != botID.String() {
		return ErrMessageSenderForbidden
	}

	senderBot, err := s.botRepo.GetByID(ctx, botID)
	if err != nil {
		return ErrMessageSenderForbidden
	}

	switch normalized.receiverType {
	case "bot":
		receiverBotID, ok := parseUUIDValue(normalized.receiverID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.canBotTargetBot(ctx, senderBot.OwnerID, receiverBotID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrMessageTargetForbidden
		}
	case "group":
		groupID, ok := parseUUIDValue(normalized.receiverID)
		if !ok {
			return ErrInvalidMessageRoute
		}
		allowed, err := s.isBotGroupMember(ctx, groupID, botID)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrMessageTargetForbidden
		}
	case "user":
		if normalized.receiverID != senderBot.OwnerID.String() {
			return ErrMessageTargetForbidden
		}
	default:
		return ErrInvalidMessageRoute
	}

	return nil
}

func (s *MessageService) userMatchesDirectRoute(ctx context.Context, userID uuid.UUID, route messageRoute) (bool, error) {
	if route.fromType == "user" && route.fromID == userID.String() {
		return true, nil
	}
	if route.toType == "user" && route.toID == userID.String() {
		return true, nil
	}

	for _, candidate := range []struct {
		kind string
		id   string
	}{
		{kind: route.fromType, id: route.fromID},
		{kind: route.toType, id: route.toID},
	} {
		if candidate.kind != "bot" {
			continue
		}
		botID, ok := parseUUIDValue(candidate.id)
		if !ok {
			continue
		}
		ownsBot, err := s.userOwnsBot(ctx, userID, botID)
		if err != nil {
			return false, err
		}
		if ownsBot {
			return true, nil
		}
	}

	return false, nil
}

func (s *MessageService) userOwnsBot(ctx context.Context, userID, botID uuid.UUID) (bool, error) {
	bot, err := s.botRepo.GetByID(ctx, botID)
	if err != nil {
		return false, nil
	}
	return bot.OwnerID == userID, nil
}

func (s *MessageService) canUserTargetBot(ctx context.Context, userID, botID uuid.UUID) (bool, error) {
	bot, err := s.botRepo.GetByID(ctx, botID)
	if err != nil {
		return false, nil
	}
	return bot.OwnerID == userID || bot.IsPublic, nil
}

func (s *MessageService) canBotTargetBot(ctx context.Context, ownerID, botID uuid.UUID) (bool, error) {
	bot, err := s.botRepo.GetByID(ctx, botID)
	if err != nil {
		return false, nil
	}
	return bot.OwnerID == ownerID || bot.IsPublic, nil
}

func (s *MessageService) isUserGroupMember(ctx context.Context, userID, groupID uuid.UUID) (bool, error) {
	group, err := s.groupRepo.GetByID(ctx, groupID)
	if err != nil {
		return false, nil
	}
	if !group.IsActive || group.OwnerID == userID {
		return group.IsActive, nil
	}
	return s.groupRepo.IsMember(ctx, groupID, userID)
}

func (s *MessageService) isBotGroupMember(ctx context.Context, groupID, botID uuid.UUID) (bool, error) {
	group, err := s.groupRepo.GetByID(ctx, groupID)
	if err != nil {
		return false, nil
	}
	if !group.IsActive {
		return false, nil
	}
	return s.groupRepo.IsBotMember(ctx, groupID, botID)
}

func decodePublishMessage(topic string, payload json.RawMessage) (normalizedMessage, error) {
	if len(payload) == 0 {
		return normalizedMessage{}, errors.New("message payload is required")
	}

	var msgPayload MessagePayload
	if err := json.Unmarshal(payload, &msgPayload); err != nil {
		return normalizedMessage{}, errors.New("invalid publish payload")
	}

	return normalizeIncomingMessage(topic, msgPayload), nil
}

func validateNormalizedMessage(normalized normalizedMessage) error {
	if normalized.body == "" {
		return errors.New("message body is required")
	}

	route := parseMessageRoute(normalized.conversationID)
	switch {
	case route.groupID != "":
		if normalized.receiverType != "group" || normalized.receiverID != route.groupID {
			return ErrInvalidMessageRoute
		}
	case route.fromType == "" || route.toType == "":
		return ErrInvalidMessageRoute
	case route.fromType != normalized.senderType ||
		route.fromID != normalized.senderID ||
		route.toType != normalized.receiverType ||
		route.toID != normalized.receiverID:
		return ErrInvalidMessageRoute
	}

	return nil
}

func parseUUIDValue(raw string) (uuid.UUID, bool) {
	parsed, err := uuid.Parse(raw)
	if err != nil {
		return uuid.UUID{}, false
	}
	return parsed, true
}
