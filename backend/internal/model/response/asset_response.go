package response

import (
	"time"

	"github.com/openclaw-bot-chat/backend/internal/model"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/openclaw-bot-chat/backend/internal/storage"
)

type AssetResponse struct {
	ID                   string                 `json:"id,omitempty"`
	Kind                 string                 `json:"kind,omitempty"`
	Status               string                 `json:"status,omitempty"`
	StorageProvider      string                 `json:"storage_provider,omitempty"`
	Bucket               string                 `json:"bucket,omitempty"`
	ObjectKey            string                 `json:"object_key,omitempty"`
	MIMEType             string                 `json:"mime_type,omitempty"`
	Size                 int64                  `json:"size,omitempty"`
	FileName             string                 `json:"file_name,omitempty"`
	Width                *int                   `json:"width,omitempty"`
	Height               *int                   `json:"height,omitempty"`
	SHA256               string                 `json:"sha256,omitempty"`
	DownloadURL          string                 `json:"download_url,omitempty"`
	DownloadURLExpiresAt *time.Time             `json:"download_url_expires_at,omitempty"`
	ExternalURL          string                 `json:"external_url,omitempty"`
	SourceURL            string                 `json:"source_url,omitempty"`
	Metadata             map[string]interface{} `json:"metadata,omitempty"`
}

type PreparedUploadResponse struct {
	Asset  AssetResponse           `json:"asset"`
	Upload PresignedUploadResponse `json:"upload"`
}

type PresignedUploadResponse struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	ExpiresAt time.Time         `json:"expires_at"`
}

func NewAssetResponse(payload *model.AssetPayload) *AssetResponse {
	if payload == nil {
		return nil
	}

	return &AssetResponse{
		ID:                   payload.ID,
		Kind:                 payload.Kind,
		Status:               payload.Status,
		StorageProvider:      payload.StorageProvider,
		Bucket:               payload.Bucket,
		ObjectKey:            payload.ObjectKey,
		MIMEType:             payload.MIMEType,
		Size:                 payload.Size,
		FileName:             payload.FileName,
		Width:                payload.Width,
		Height:               payload.Height,
		SHA256:               payload.SHA256,
		DownloadURL:          payload.DownloadURL,
		DownloadURLExpiresAt: payload.DownloadURLExpiresAt,
		ExternalURL:          payload.ExternalURL,
		SourceURL:            payload.SourceURL,
		Metadata:             payload.Metadata,
	}
}

func NewPreparedUploadResponse(prepared *service.PreparedUpload) *PreparedUploadResponse {
	if prepared == nil || prepared.Asset == nil || prepared.Upload == nil {
		return nil
	}

	return &PreparedUploadResponse{
		Asset:  *NewAssetResponse(prepared.Asset),
		Upload: *NewPresignedUploadResponse(prepared.Upload),
	}
}

func NewPresignedUploadResponse(upload *storage.PresignedUpload) *PresignedUploadResponse {
	if upload == nil {
		return nil
	}

	return &PresignedUploadResponse{
		Method:    upload.Method,
		URL:       upload.URL,
		Headers:   upload.Headers,
		ExpiresAt: upload.ExpiresAt,
	}
}
