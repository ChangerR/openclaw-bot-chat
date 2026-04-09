package websocket

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	TypeSubscribe   = "subscribe"
	TypeUnsubscribe = "unsubscribe"
	TypePublish     = "publish"
	TypeMessage     = "message"
	TypePing        = "ping"
	TypePong        = "pong"
	TypeError       = "error"
	TypeAck         = "ack"
)

// WSConfig holds WebSocket runtime configuration.
type WSConfig struct {
	ReadBufferSize    int
	WriteBufferSize   int
	PingInterval      time.Duration
	PongTimeout       time.Duration
	WriteTimeout      time.Duration
	MaxMessageSize    int64
	SendQueueSize     int
	BroadcastQueueSize int
}

func (cfg WSConfig) withDefaults() WSConfig {
	if cfg.ReadBufferSize == 0 {
		cfg.ReadBufferSize = 1024
	}
	if cfg.WriteBufferSize == 0 {
		cfg.WriteBufferSize = 1024
	}
	if cfg.PingInterval == 0 {
		cfg.PingInterval = 30 * time.Second
	}
	if cfg.PongTimeout == 0 {
		cfg.PongTimeout = 60 * time.Second
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 10 * time.Second
	}
	if cfg.MaxMessageSize == 0 {
		cfg.MaxMessageSize = 65536
	}
	if cfg.SendQueueSize == 0 {
		cfg.SendQueueSize = 256
	}
	if cfg.BroadcastQueueSize == 0 {
		cfg.BroadcastQueueSize = 256
	}

	return cfg
}

func (cfg WSConfig) upgrader() websocket.Upgrader {
	cfg = cfg.withDefaults()

	return websocket.Upgrader{
		ReadBufferSize:  cfg.ReadBufferSize,
		WriteBufferSize: cfg.WriteBufferSize,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
}
