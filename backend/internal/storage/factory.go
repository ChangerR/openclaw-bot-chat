package storage

import (
	"fmt"
	"strings"

	"github.com/openclaw-bot-chat/backend/internal/config"
)

func NewProvider(cfg config.StorageConfig) (ObjectStorageProvider, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "":
		return nil, nil
	case "cos":
		return NewCOSProvider(COSConfig{
			Bucket:       cfg.Bucket,
			Region:       cfg.Region,
			Endpoint:     cfg.Endpoint,
			SecretID:     cfg.COS.SecretID,
			SecretKey:    cfg.COS.SecretKey,
			SessionToken: cfg.COS.SessionToken,
		})
	case "oss":
		return NewOSSProvider(OSSConfig{
			Bucket:          cfg.Bucket,
			Endpoint:        cfg.Endpoint,
			Region:          cfg.Region,
			AccessKeyID:     cfg.OSS.AccessKeyID,
			AccessKeySecret: cfg.OSS.AccessKeySecret,
			SecurityToken:   cfg.OSS.SecurityToken,
		})
	default:
		return nil, fmt.Errorf("unsupported storage provider: %s", cfg.Provider)
	}
}
