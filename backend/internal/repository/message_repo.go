package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
	"gorm.io/gorm"
)

// MessageRepository handles message database operations
type MessageRepository struct {
	db *gorm.DB
}

func NewMessageRepository(db *gorm.DB) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) Create(ctx context.Context, msg *model.Message) error {
	return r.db.WithContext(ctx).Create(msg).Error
}

func (r *MessageRepository) GetByID(ctx context.Context, id int64) (*model.Message, error) {
	var msg model.Message
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&msg).Error
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

func (r *MessageRepository) GetByConversationID(ctx context.Context, conversationID string, limit int, beforeSeq int64) ([]model.Message, error) {
	var msgs []model.Message
	query := r.db.WithContext(ctx).Where("conversation_id = ? AND is_deleted = false", conversationID)
	if beforeSeq > 0 {
		query = query.Where("seq < ?", beforeSeq)
	}
	err := query.Order("seq DESC").Limit(limit).Find(&msgs).Error
	// Reverse to get chronological order
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, err
}

func (r *MessageRepository) CountByConversationID(ctx context.Context, conversationID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Message{}).Where("conversation_id = ? AND is_deleted = false", conversationID).Count(&count).Error
	return count, err
}

func (r *MessageRepository) GetNextSeq(ctx context.Context, conversationID string) (int64, error) {
	var maxSeq int64
	err := r.db.WithContext(ctx).Model(&model.Message{}).Where("conversation_id = ?", conversationID).Select("COALESCE(MAX(seq), 0)").Scan(&maxSeq).Error
	return maxSeq + 1, err
}

func (r *MessageRepository) GetConversations(ctx context.Context, userID uuid.UUID, botID *uuid.UUID, limit int) ([]string, error) {
	var conversationIDs []string
	query := r.db.WithContext(ctx).Model(&model.Message{}).
		Distinct("conversation_id").
		Where("is_deleted = false").
		Order("MAX(created_at) DESC")

	if botID != nil {
		query = query.Where("(sender_id = ? OR bot_id = ?)", userID, *botID)
	} else {
		query = query.Where("sender_id = ? OR bot_id IN (SELECT id FROM bots WHERE owner_id = ?)", userID, userID)
	}

	err := query.Limit(limit).Pluck("conversation_id", &conversationIDs).Error
	return conversationIDs, err
}

func (r *MessageRepository) MarkAsRead(ctx context.Context, conversationID string) error {
	return r.db.WithContext(ctx).Model(&model.Message{}).
		Where("conversation_id = ? AND is_read = false", conversationID).
		Update("is_read", true).Error
}
