package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all configuration for the application
type Config struct {
	App       AppConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	MQTT      MQTTConfig
	JWT       JWTConfig
	WebSocket WebSocketConfig
	Storage   StorageConfig
	Asset     AssetConfig
	Log       LogConfig
}

// AppConfig holds application-level settings
type AppConfig struct {
	Host string
	Port int
	Mode string // debug, release, test
}

// DatabaseConfig holds PostgreSQL connection settings
type DatabaseConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	DBName          string
	SSLMode         string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime int // seconds
}

// RedisConfig holds Redis connection settings
type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
	PoolSize int
}

// MQTTConfig holds MQTT broker settings
type MQTTConfig struct {
	Broker         string
	ClientID       string
	Username       string
	Password       string
	TopicPrefix    string
	QOS            byte
	AutoReconnect  bool
	ReconnectDelay int // seconds
}

// JWTConfig holds JWT settings
type JWTConfig struct {
	Secret          string
	AccessTokenTTL  int // seconds
	RefreshTokenTTL int // seconds
	Issuer          string
}

// WebSocketConfig holds WebSocket settings
type WebSocketConfig struct {
	ReadBufferSize     int
	WriteBufferSize    int
	PingInterval       int   // seconds
	PongTimeout        int   // seconds
	WriteTimeout       int   // seconds
	MaxMessageSize     int64 // bytes
	SendQueueSize      int
	BroadcastQueueSize int
}

type StorageConfig struct {
	Provider       string           `mapstructure:"provider"`
	Bucket         string           `mapstructure:"bucket"`
	Region         string           `mapstructure:"region"`
	Endpoint       string           `mapstructure:"endpoint"`
	PublicBaseURL  string           `mapstructure:"public_base_url"`
	PrivateRead    bool             `mapstructure:"private_read"`
	UploadURLTTL   int              `mapstructure:"upload_url_ttl"`
	DownloadURLTTL int              `mapstructure:"download_url_ttl"`
	KeyPrefix      string           `mapstructure:"key_prefix"`
	COS            COSStorageConfig `mapstructure:"cos"`
	OSS            OSSStorageConfig `mapstructure:"oss"`
}

type COSStorageConfig struct {
	SecretID     string `mapstructure:"secret_id"`
	SecretKey    string `mapstructure:"secret_key"`
	SessionToken string `mapstructure:"session_token"`
}

type OSSStorageConfig struct {
	AccessKeyID     string `mapstructure:"access_key_id"`
	AccessKeySecret string `mapstructure:"access_key_secret"`
	SecurityToken   string `mapstructure:"security_token"`
}

type AssetConfig struct {
	MaxImageSizeMB int `mapstructure:"max_image_size_mb"`
}

// LogConfig holds logging settings
type LogConfig struct {
	Level  string // debug, info, warn, error
	Format string // json, console
}

// DSN returns the PostgreSQL connection string
func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

// Addr returns the Redis address
func (r *RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

// Load reads configuration from config.yaml and environment variables
func Load(configPath string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(configPath)
	v.SetConfigType("yaml")

	// Allow environment variable overrides
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	bindEnvKeys(v,
		"app.host",
		"app.port",
		"app.mode",
		"database.host",
		"database.port",
		"database.user",
		"database.password",
		"database.dbname",
		"database.sslmode",
		"database.max_open_conns",
		"database.max_idle_conns",
		"database.conn_max_lifetime",
		"redis.host",
		"redis.port",
		"redis.password",
		"redis.db",
		"redis.pool_size",
		"mqtt.broker",
		"mqtt.client_id",
		"mqtt.username",
		"mqtt.password",
		"mqtt.topic_prefix",
		"mqtt.qos",
		"mqtt.auto_reconnect",
		"mqtt.reconnect_delay",
		"jwt.secret",
		"jwt.access_token_ttl",
		"jwt.refresh_token_ttl",
		"jwt.issuer",
		"websocket.read_buffer_size",
		"websocket.write_buffer_size",
		"websocket.ping_interval",
		"websocket.pong_timeout",
		"websocket.write_timeout",
		"websocket.max_message_size",
		"websocket.send_queue_size",
		"websocket.broadcast_queue_size",
		"storage.provider",
		"storage.bucket",
		"storage.region",
		"storage.endpoint",
		"storage.public_base_url",
		"storage.private_read",
		"storage.upload_url_ttl",
		"storage.download_url_ttl",
		"storage.key_prefix",
		"storage.cos.secret_id",
		"storage.cos.secret_key",
		"storage.cos.session_token",
		"storage.oss.access_key_id",
		"storage.oss.access_key_secret",
		"storage.oss.security_token",
		"asset.max_image_size_mb",
		"log.level",
		"log.format",
	)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Set defaults
	if cfg.App.Port == 0 {
		cfg.App.Port = 8080
	}
	if cfg.App.Mode == "" {
		cfg.App.Mode = "debug"
	}
	if cfg.Database.MaxOpenConns == 0 {
		cfg.Database.MaxOpenConns = 25
	}
	if cfg.Database.MaxIdleConns == 0 {
		cfg.Database.MaxIdleConns = 5
	}
	if cfg.Database.ConnMaxLifetime == 0 {
		cfg.Database.ConnMaxLifetime = 300
	}
	if cfg.Redis.PoolSize == 0 {
		cfg.Redis.PoolSize = 10
	}
	if cfg.MQTT.TopicPrefix == "" {
		cfg.MQTT.TopicPrefix = "chat"
	}
	if cfg.JWT.AccessTokenTTL == 0 {
		cfg.JWT.AccessTokenTTL = 7200
	}
	if cfg.JWT.RefreshTokenTTL == 0 {
		cfg.JWT.RefreshTokenTTL = 604800
	}
	if cfg.WebSocket.PingInterval == 0 {
		cfg.WebSocket.PingInterval = 30
	}
	if cfg.WebSocket.PongTimeout == 0 {
		cfg.WebSocket.PongTimeout = 60
	}
	if cfg.WebSocket.WriteTimeout == 0 {
		cfg.WebSocket.WriteTimeout = 10
	}
	if cfg.WebSocket.MaxMessageSize == 0 {
		cfg.WebSocket.MaxMessageSize = 65536
	}
	if cfg.WebSocket.ReadBufferSize == 0 {
		cfg.WebSocket.ReadBufferSize = 1024
	}
	if cfg.WebSocket.WriteBufferSize == 0 {
		cfg.WebSocket.WriteBufferSize = 1024
	}
	if cfg.WebSocket.SendQueueSize == 0 {
		cfg.WebSocket.SendQueueSize = 256
	}
	if cfg.WebSocket.BroadcastQueueSize == 0 {
		cfg.WebSocket.BroadcastQueueSize = 256
	}
	if cfg.Storage.UploadURLTTL == 0 {
		cfg.Storage.UploadURLTTL = 900
	}
	if cfg.Storage.DownloadURLTTL == 0 {
		cfg.Storage.DownloadURLTTL = 900
	}
	if cfg.Storage.KeyPrefix == "" {
		cfg.Storage.KeyPrefix = "chat-assets"
	}
	if cfg.Asset.MaxImageSizeMB == 0 {
		cfg.Asset.MaxImageSizeMB = 10
	}
	if !cfg.Storage.PrivateRead {
		cfg.Storage.PrivateRead = true
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = "debug"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "console"
	}

	return &cfg, nil
}

// ConnMaxLifetimeDuration returns the connection max lifetime as time.Duration
func (d *DatabaseConfig) ConnMaxLifetimeDuration() time.Duration {
	return time.Duration(d.ConnMaxLifetime) * time.Second
}

func bindEnvKeys(v *viper.Viper, keys ...string) {
	for _, key := range keys {
		_ = v.BindEnv(key)
	}
}
