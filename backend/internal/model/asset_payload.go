package model

import (
	"encoding/json"
	"time"
)

type AssetPayload struct {
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

func AssetPayloadFromMap(meta map[string]interface{}) *AssetPayload {
	if len(meta) == 0 {
		return nil
	}

	raw, ok := meta["asset"]
	if !ok || raw == nil {
		return nil
	}

	switch typed := raw.(type) {
	case map[string]interface{}:
		payload := &AssetPayload{}
		if decoded, err := json.Marshal(typed); err == nil {
			if err := json.Unmarshal(decoded, payload); err == nil {
				return payload
			}
		}
	case AssetPayload:
		copy := typed
		return &copy
	case *AssetPayload:
		if typed == nil {
			return nil
		}
		copy := *typed
		return &copy
	}

	return nil
}

func UpsertAssetPayload(meta map[string]interface{}, payload *AssetPayload) map[string]interface{} {
	if payload == nil {
		return meta
	}

	next := CloneStringMap(meta)
	if next == nil {
		next = make(map[string]interface{}, 1)
	}
	next["asset"] = payload.ToMap()
	return next
}

func RemoveEphemeralAssetFields(meta map[string]interface{}) map[string]interface{} {
	if len(meta) == 0 {
		return meta
	}

	payload := AssetPayloadFromMap(meta)
	if payload == nil {
		return meta
	}

	payload.DownloadURL = ""
	payload.DownloadURLExpiresAt = nil

	return UpsertAssetPayload(meta, payload)
}

func (p *AssetPayload) ToMap() map[string]interface{} {
	if p == nil {
		return nil
	}

	encoded, err := json.Marshal(p)
	if err != nil {
		return nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil
	}

	return result
}

func CloneStringMap(source map[string]interface{}) map[string]interface{} {
	if source == nil {
		return nil
	}

	copied := make(map[string]interface{}, len(source))
	for key, value := range source {
		copied[key] = value
	}
	return copied
}
