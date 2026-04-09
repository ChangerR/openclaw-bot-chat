package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
	"gorm.io/gorm"
)

// BotKeyRepository handles bot key database operations
type BotKeyRepository struct {
	db *gorm.DB
}

func NewBotKeyRepository(db *gorm.DB) *BotKeyRepository {
	return &BotKeyRepository{db: db}
}

func (r *BotKeyRepository) Create(ctx context.Context, key *model.BotKey) error {
	return r.db.WithContext(ctx).Create(key).Error
}

func (r *BotKeyRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.BotKey, error) {
	var key model.BotKey
	err := r.db.WithContext(ctx).Preload("Bot").Where("id = ?", id).First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *BotKeyRepository) GetByPrefix(ctx context.Context, prefix string) (*model.BotKey, error) {
	var key model.BotKey
	err := r.db.WithContext(ctx).Where("key_prefix = ? AND is_active = true", prefix).First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *BotKeyRepository) ListByBotID(ctx context.Context, botID uuid.UUID) ([]model.BotKey, error) {
	var keys []model.BotKey
	err := r.db.WithContext(ctx).Where("bot_id = ?", botID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

func (r *BotKeyRepository) Revoke(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&model.BotKey{}).Where("id = ?", id).Update("is_active", false).Error
}

func (r *BotKeyRepository) UpdateLastUsed(ctx context.Context, id uuid.UUID, ip string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&model.BotKey{}).Where("id = ?", id).Updates(map[string]interface{}{
		"last_used_at": now,
		"last_used_ip": ip,
	}).Error
}

func (r *BotKeyRepository) CountActiveByBotID(ctx context.Context, botID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.BotKey{}).Where("bot_id = ? AND is_active = true", botID).Count(&count).Error
	return count, err
}
