package storage

import (
	"context"
	"io"
	"time"
)

type PresignedUpload struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	ExpiresAt time.Time         `json:"expires_at"`
}

type ObjectInfo struct {
	ETag          string
	ContentType   string
	ContentLength int64
	LastModified  *time.Time
}

type PutObjectInput struct {
	ObjectKey     string
	Reader        io.Reader
	ContentType   string
	ContentLength int64
}

type ObjectStorageProvider interface {
	Provider() string
	Bucket() string
	CreatePresignedUpload(ctx context.Context, objectKey string, contentType string, expires time.Duration) (*PresignedUpload, error)
	CreatePresignedDownload(ctx context.Context, objectKey string, expires time.Duration) (string, time.Time, error)
	StatObject(ctx context.Context, objectKey string) (*ObjectInfo, error)
	PutObject(ctx context.Context, input PutObjectInput) (*ObjectInfo, error)
	DeleteObject(ctx context.Context, objectKey string) error
}
