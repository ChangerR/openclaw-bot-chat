package storage

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	cos "github.com/tencentyun/cos-go-sdk-v5"
)

type COSConfig struct {
	Bucket       string
	Region       string
	Endpoint     string
	SecretID     string
	SecretKey    string
	SessionToken string
}

type COSProvider struct {
	client       *cos.Client
	bucket       string
	secretID     string
	secretKey    string
	sessionToken string
}

func NewCOSProvider(cfg COSConfig) (*COSProvider, error) {
	if cfg.Bucket == "" || cfg.Region == "" {
		return nil, fmt.Errorf("cos bucket and region are required")
	}
	if cfg.SecretID == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("cos secret_id and secret_key are required")
	}

	var bucketURL *url.URL
	var err error
	if cfg.Endpoint != "" {
		bucketURL, err = url.Parse(strings.TrimRight(cfg.Endpoint, "/"))
		if err != nil {
			return nil, fmt.Errorf("parse cos endpoint: %w", err)
		}
	} else {
		bucketURL, err = cos.NewBucketURL(cfg.Bucket, cfg.Region, true)
		if err != nil {
			return nil, fmt.Errorf("build cos bucket url: %w", err)
		}
	}

	baseURL := &cos.BaseURL{BucketURL: bucketURL}
	client := cos.NewClient(baseURL, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:     cfg.SecretID,
			SecretKey:    cfg.SecretKey,
			SessionToken: cfg.SessionToken,
		},
	})

	return &COSProvider{
		client:       client,
		bucket:       cfg.Bucket,
		secretID:     cfg.SecretID,
		secretKey:    cfg.SecretKey,
		sessionToken: cfg.SessionToken,
	}, nil
}

func (p *COSProvider) Provider() string { return "cos" }

func (p *COSProvider) Bucket() string { return p.bucket }

func (p *COSProvider) CreatePresignedUpload(ctx context.Context, objectKey string, contentType string, expires time.Duration) (*PresignedUpload, error) {
	headers := make(http.Header)
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	if p.sessionToken != "" {
		headers.Set("x-cos-security-token", p.sessionToken)
	}

	signedURL, err := p.client.Object.GetPresignedURL(ctx, http.MethodPut, objectKey, p.secretID, p.secretKey, expires, &cos.PresignedURLOptions{
		Header: &headers,
	}, true)
	if err != nil {
		return nil, fmt.Errorf("create cos presigned upload url: %w", err)
	}

	return &PresignedUpload{
		Method: http.MethodPut,
		URL:    signedURL.String(),
		Headers: map[string]string{
			"Content-Type": contentType,
		},
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

func (p *COSProvider) CreatePresignedDownload(ctx context.Context, objectKey string, expires time.Duration) (string, time.Time, error) {
	headers := make(http.Header)
	if p.sessionToken != "" {
		headers.Set("x-cos-security-token", p.sessionToken)
	}

	signedURL, err := p.client.Object.GetPresignedURL(ctx, http.MethodGet, objectKey, p.secretID, p.secretKey, expires, &cos.PresignedURLOptions{
		Header: &headers,
	}, true)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create cos presigned download url: %w", err)
	}

	expiresAt := time.Now().Add(expires)
	return signedURL.String(), expiresAt, nil
}

func (p *COSProvider) StatObject(ctx context.Context, objectKey string) (*ObjectInfo, error) {
	resp, err := p.client.Object.Head(ctx, objectKey, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	lastModified, _ := http.ParseTime(resp.Header.Get("Last-Modified"))
	info := &ObjectInfo{
		ETag:          strings.Trim(resp.Header.Get("ETag"), `"`),
		ContentType:   resp.Header.Get("Content-Type"),
		ContentLength: resp.ContentLength,
	}
	if !lastModified.IsZero() {
		info.LastModified = &lastModified
	}
	return info, nil
}

func (p *COSProvider) PutObject(ctx context.Context, input PutObjectInput) (*ObjectInfo, error) {
	resp, err := p.client.Object.Put(ctx, input.ObjectKey, input.Reader, &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType:   input.ContentType,
			ContentLength: input.ContentLength,
		},
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	info := &ObjectInfo{
		ETag:          strings.Trim(resp.Header.Get("ETag"), `"`),
		ContentType:   input.ContentType,
		ContentLength: input.ContentLength,
	}
	return info, nil
}

func (p *COSProvider) DeleteObject(ctx context.Context, objectKey string) error {
	resp, err := p.client.Object.Delete(ctx, objectKey)
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()
	}
	return err
}
