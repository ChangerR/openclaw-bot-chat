package websocket

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/openclaw-bot-chat/backend/pkg/jwt"
	"github.com/rs/zerolog"
)

// IncomingMessage is the message format from the client.
type IncomingMessage struct {
	Type    string          `json:"type"`
	Topic   string          `json:"topic,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
}

// ServerMessage is the message format sent to the client.
type ServerMessage struct {
	Type    string          `json:"type"`
	Topic   string          `json:"topic,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// Client represents a WebSocket client connection.
type Client struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Username string
	conn     *websocket.Conn
	hub      *Hub
	send     chan []byte
	topics   map[string]bool
	mu       sync.RWMutex
	log      zerolog.Logger
}

// NewClient creates a new WebSocket client.
func NewClient(conn *websocket.Conn, userID uuid.UUID, username string, hub *Hub, log zerolog.Logger) *Client {
	topics := map[string]bool{
		PersonalTopic(hub.topicPrefix(), userID): true,
	}

	return &Client{
		ID:       uuid.New(),
		UserID:   userID,
		Username: username,
		conn:     conn,
		hub:      hub,
		send:     make(chan []byte, hub.cfg.SendQueueSize),
		topics:   topics,
		log:      log,
	}
}

// AttachMQTTBridge routes MQTT traffic into the hub's topic broadcast pipeline.
func (h *Hub) AttachMQTTBridge() {
	if h.mqttClient == nil {
		return
	}

	h.mqttClient.Subscribe("#", h.handleMQTTMessage)
}

func (h *Hub) handleMQTTMessage(topic string, payload []byte) {
	h.BroadcastToTopic(topic, payload)
}

func (h *Hub) topicPrefix() string {
	if h.mqttClient != nil && h.mqttClient.TopicPrefix() != "" {
		return h.mqttClient.TopicPrefix()
	}
	return "chat"
}

// ReadPump pumps messages from the WebSocket connection into the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregisterClient(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(c.hub.cfg.MaxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(c.hub.cfg.PongTimeout))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(c.hub.cfg.PongTimeout))
	})

	for {
		_, rawMessage, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.log.Warn().Err(err).Msg("WebSocket read error")
			}
			return
		}

		var message IncomingMessage
		if err := json.Unmarshal(rawMessage, &message); err != nil {
			c.sendError("invalid message format", "")
			continue
		}

		c.handleMessage(message)
	}
}

// WritePump pumps outbound messages to the WebSocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(c.hub.cfg.PingInterval)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(c.hub.cfg.WriteTimeout))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(c.hub.cfg.WriteTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(message IncomingMessage) {
	switch message.Type {
	case TypeSubscribe:
		if message.Topic == "" {
			c.sendError("topic is required", message.ID)
			return
		}
		c.subscribe(message.Topic)
		c.sendAck(message.ID, "subscribed")
	case TypeUnsubscribe:
		if message.Topic == "" {
			c.sendError("topic is required", message.ID)
			return
		}
		c.unsubscribe(message.Topic)
		c.sendAck(message.ID, "unsubscribed")
	case TypePublish:
		if message.Topic == "" {
			c.sendError("topic is required", message.ID)
			return
		}
		if c.hub.mqttClient == nil || !c.hub.mqttClient.IsConnected() {
			c.sendError("MQTT client is not connected", message.ID)
			return
		}
		if err := c.hub.mqttClient.Publish(message.Topic, message.Payload, 1); err != nil {
			c.sendError(err.Error(), message.ID)
			return
		}
		c.sendAck(message.ID, "published")
	case TypePing:
		c.enqueue(mustMarshal(ServerMessage{Type: TypePong, ID: message.ID}))
	default:
		c.sendError("unknown message type: "+message.Type, message.ID)
	}
}

func (c *Client) subscribe(topic string) {
	c.mu.Lock()
	c.topics[topic] = true
	c.mu.Unlock()

	c.log.Debug().Str("user", c.Username).Str("topic", topic).Msg("WS subscribed to topic")
}

func (c *Client) unsubscribe(topic string) {
	c.mu.Lock()
	delete(c.topics, topic)
	c.mu.Unlock()

	c.log.Debug().Str("user", c.Username).Str("topic", topic).Msg("WS unsubscribed from topic")
}

func (c *Client) acceptsTopic(topic string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	for pattern := range c.topics {
		if MatchTopic(pattern, topic) {
			return true
		}
	}
	return false
}

func (c *Client) enqueue(message []byte) bool {
	defer func() {
		if recover() != nil {
			c.log.Debug().Str("user", c.Username).Msg("WS outbound queue already closed")
		}
	}()

	select {
	case c.send <- message:
		return true
	default:
		c.log.Warn().Str("user", c.Username).Msg("WS outbound queue full")
		return false
	}
}

func (c *Client) sendError(errMessage, id string) {
	c.enqueue(mustMarshal(ServerMessage{
		Type:  TypeError,
		Error: errMessage,
		ID:    id,
	}))
}

func (c *Client) sendAck(id, status string) {
	c.enqueue(mustMarshal(ServerMessage{
		Type:    TypeAck,
		ID:      id,
		Payload: json.RawMessage([]byte(`"` + status + `"`)),
	}))
}

func mustMarshal(value interface{}) []byte {
	data, _ := json.Marshal(value)
	return data
}

// HandleWebSocket upgrades HTTP to WebSocket with JWT auth.
func HandleWebSocket(jwtManager *jwt.Manager, hub *Hub, log zerolog.Logger) gin.HandlerFunc {
	upgrader := hub.cfg.upgrader()

	return func(c *gin.Context) {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			auth := c.GetHeader("Authorization")
			if len(auth) > 7 && auth[:7] == "Bearer " {
				tokenStr = auth[7:]
			}
		}

		if tokenStr == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		claims, err := jwtManager.ValidateAccessToken(tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Warn().Err(err).Msg("WebSocket upgrade failed")
			return
		}

		client := NewClient(conn, claims.UserID, claims.Username, hub, log)
		hub.registerClient(client)

		go client.WritePump()
		go client.ReadPump()
	}
}
