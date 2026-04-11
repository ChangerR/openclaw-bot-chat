package storage

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

type OSSConfig struct {
	Bucket          string
	Endpoint        string
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	SecurityToken   string
}

type OSSProvider struct {
	client *oss.Client
	bucket *oss.Bucket
	name   string
}

func NewOSSProvider(cfg OSSConfig) (*OSSProvider, error) {
	if cfg.Bucket == "" || cfg.Endpoint == "" {
		return nil, fmt.Errorf("oss bucket and endpoint are required")
	}
	if cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("oss access_key_id and access_key_secret are required")
	}

	options := make([]oss.ClientOption, 0, 2)
	if cfg.SecurityToken != "" {
		options = append(options, oss.SecurityToken(cfg.SecurityToken))
	}
	client, err := oss.New(strings.TrimRight(cfg.Endpoint, "/"), cfg.AccessKeyID, cfg.AccessKeySecret, options...)
	if err != nil {
		return nil, fmt.Errorf("create oss client: %w", err)
	}
	if cfg.Region != "" {
		client.SetRegion(cfg.Region)
	}

	bucket, err := client.Bucket(cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("create oss bucket client: %w", err)
	}

	return &OSSProvider{
		client: client,
		bucket: bucket,
		name:   cfg.Bucket,
	}, nil
}

func (p *OSSProvider) Provider() string { return "oss" }

func (p *OSSProvider) Bucket() string { return p.name }

func (p *OSSProvider) CreatePresignedUpload(ctx context.Context, objectKey string, contentType string, expires time.Duration) (*PresignedUpload, error) {
	_ = ctx

	options := []oss.Option{}
	headers := map[string]string{}
	if contentType != "" {
		options = append(options, oss.ContentType(contentType))
		headers["Content-Type"] = contentType
	}

	signedURL, err := p.bucket.SignURL(objectKey, oss.HTTPPut, int64(expires.Seconds()), options...)
	if err != nil {
		return nil, fmt.Errorf("create oss presigned upload url: %w", err)
	}

	return &PresignedUpload{
		Method:    http.MethodPut,
		URL:       signedURL,
		Headers:   headers,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

func (p *OSSProvider) CreatePresignedDownload(ctx context.Context, objectKey string, expires time.Duration) (string, time.Time, error) {
	_ = ctx

	signedURL, err := p.bucket.SignURL(objectKey, oss.HTTPGet, int64(expires.Seconds()))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create oss presigned download url: %w", err)
	}

	expiresAt := time.Now().Add(expires)
	return signedURL, expiresAt, nil
}

func (p *OSSProvider) StatObject(ctx context.Context, objectKey string) (*ObjectInfo, error) {
	_ = ctx

	headers, err := p.bucket.GetObjectDetailedMeta(objectKey)
	if err != nil {
		return nil, err
	}

	lastModified, _ := http.ParseTime(headers.Get("Last-Modified"))
	info := &ObjectInfo{
		ETag:          strings.Trim(headers.Get("ETag"), `"`),
		ContentType:   headers.Get("Content-Type"),
		ContentLength: parseHeaderInt64(headers.Get("Content-Length")),
	}
	if !lastModified.IsZero() {
		info.LastModified = &lastModified
	}
	return info, nil
}

func (p *OSSProvider) PutObject(ctx context.Context, input PutObjectInput) (*ObjectInfo, error) {
	_ = ctx

	options := []oss.Option{}
	if input.ContentType != "" {
		options = append(options, oss.ContentType(input.ContentType))
	}
	if input.ContentLength > 0 {
		options = append(options, oss.ContentLength(input.ContentLength))
	}

	if err := p.bucket.PutObject(input.ObjectKey, input.Reader, options...); err != nil {
		return nil, err
	}

	info := &ObjectInfo{
		ContentType:   input.ContentType,
		ContentLength: input.ContentLength,
	}
	return info, nil
}

func (p *OSSProvider) DeleteObject(ctx context.Context, objectKey string) error {
	_ = ctx
	return p.bucket.DeleteObject(objectKey)
}

func parseHeaderInt64(raw string) int64 {
	if raw == "" {
		return 0
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}
