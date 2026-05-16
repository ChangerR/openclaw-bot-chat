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
	case "s3":
		return NewS3Provider(S3Config{
			Bucket:         firstNonEmpty(cfg.S3.Bucket, cfg.Bucket),
			Region:         firstNonEmpty(cfg.S3.Region, cfg.Region),
			Endpoint:       firstNonEmpty(cfg.S3.Endpoint, cfg.Endpoint),
			PublicEndpoint: cfg.S3.PublicEndpoint,
			AccessKey:      cfg.S3.AccessKey,
			SecretKey:      cfg.S3.SecretKey,
			SSL:            cfg.S3.SSL,
		})
	default:
		return nil, fmt.Errorf("unsupported storage provider: %s", cfg.Provider)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
