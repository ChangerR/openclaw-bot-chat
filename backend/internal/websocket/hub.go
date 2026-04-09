package websocket

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/openclaw-bot-chat/backend/internal/mqtt"
	"github.com/openclaw-bot-chat/backend/pkg/jwt"
	"github.com/rs/zerolog"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // In production, validate origin
	},
}

// Message types for the WebSocket protocol
const (
	TypeSubscribe  = "subscribe"
	TypeUnsubscribe = "unsubscribe"
	TypePublish    = "publish"
	TypeMessage    = "message"
	TypePing       = "ping"
	TypePong       = "pong"
	TypeError      = "error"
)

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type    string          `json:"type"`
	Topic   string          `json:"topic,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
}

// IncomingMessage is the message format from client
type IncomingMessage struct {
	Type    string          `json:"type"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
}

// ServerMessage is the message format sent to client
type ServerMessage struct {
	Type    string          `json:"type"`
	Topic   string          `json:"topic,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// Client represents a WebSocket client connection
type Client struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Username  string
	conn      *websocket.Conn
	hub       *Hub
	send      chan []byte
	topics    map[string]bool
	mu        sync.RWMutex
	log       zerolog.Logger
}

// Hub maintains the set of active clients and broadcasts messages
type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
	mu         sync.RWMutex
	log        zerolog.Logger
	mqttClient *mqtt.Client
	cfg        WSConfig
	wg         sync.WaitGroup
}

// WSConfig holds WebSocket configuration
type WSConfig struct {
	PingInterval   time.Duration
	PongTimeout    time.Duration
	MaxMessageSize int64
	ReadBufferSize  int
	WriteBufferSize int
}

// NewHub creates a new Hub instance
func NewHub(mqttClient *mqtt.Client, cfg WSConfig, log zerolog.Logger) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
		log:        log,
		mqttClient: mqttClient,
		cfg:        cfg,
	}
}

// Run starts the hub's main loop
func (h *Hub) Run() {
	h.wg.Add(1)
	defer h.wg.Done()
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.log.Info().Str("user", client.Username).Int("clients", len(h.clients)).Msg("WS client connected")
			// Subscribe to user's personal topic
			topic := "chat/user/" + client.UserID.String() + "/#"
			h.mqttClient.Subscribe(topic, client.handleMQTTMessage)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			h.log.Info().Str("user", client.Username).Int("clients", len(h.clients)).Msg("WS client disconnected")

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Stop gracefully stops the hub
func (h *Hub) Stop() {
	h.mu.Lock()
	for client := range h.clients {
		close(client.send)
		delete(h.clients, client)
	}
	h.mu.Unlock()
	h.wg.Wait()
}

// BroadcastToTopic sends a message to all clients subscribed to a topic
func (h *Hub) BroadcastToTopic(topic string, payload []byte) {
	msg := ServerMessage{Type: TypeMessage, Topic: topic, Payload: payload}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		client.mu.RLock()
		interested := client.topics[topic] || client.topics["#"] || matchTopicPatterns(topic, client.topics)
		client.mu.RUnlock()
		if interested {
			select {
			case client.send <- data:
			default:
			}
		}
	}
}

// matchTopicPatterns checks if a topic matches any of the client's subscribed patterns
func matchTopicPatterns(topic string, topics map[string]bool) bool {
	for pattern := range topics {
		if pattern == "#" {
			return true
		}
		if matchWildcard(pattern, topic) {
			return true
		}
	}
	return false
}

func matchWildcard(pattern, topic string) bool {
	patternParts := splitTopic(pattern)
	topicParts := splitTopic(topic)
	if len(patternParts) != len(topicParts) {
		return false
	}
	for i := range patternParts {
		if patternParts[i] == "+" || patternParts[i] == "#" {
			continue
		}
		if patternParts[i] != topicParts[i] {
			return false
		}
	}
	return true
}

func splitTopic(t string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(t); i++ {
		if t[i] == '/' {
			parts = append(parts, t[start:i])
			start = i + 1
		}
	}
	parts = append(parts, t[start:])
	return parts
}

// NewClient creates a new WebSocket client
func NewClient(conn *websocket.Conn, userID uuid.UUID, username string, hub *Hub, log zerolog.Logger) *Client {
	return &Client{
		ID:       uuid.New(),
		UserID:   userID,
		Username: username,
		conn:     conn,
		hub:      hub,
		send:     make(chan []byte, 256),
		topics:   make(map[string]bool),
		log:      log,
	}
}

// ReadPump pumps messages from the WebSocket connection to the hub
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(65536)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, rawMsg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.log.Warn().Err(err).Msg("WebSocket read error")
			}
			break
		}

		var msg IncomingMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			c.sendError("invalid message format", msg.ID)
			continue
		}

		c.handleMessage(msg)
	}
}

// WritePump pumps messages from the hub to the WebSocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(msg IncomingMessage) {
	switch msg.Type {
	case TypeSubscribe:
		c.mu.Lock()
		c.topics[msg.Topic] = true
		c.mu.Unlock()
		c.log.Debug().Str("user", c.Username).Str("topic", msg.Topic).Msg("WS subscribed to topic")
		// Also subscribe to MQTT topic
		c.hub.mqttClient.Subscribe(msg.Topic, c.handleMQTTMessage)
		c.sendAck(msg.ID, "subscribed")

	case TypeUnsubscribe:
		c.mu.Lock()
		delete(c.topics, msg.Topic)
		c.mu.Unlock()
		c.hub.mqttClient.Unsubscribe(msg.Topic)
		c.sendAck(msg.ID, "unsubscribed")

	case TypePublish:
		// Forward to MQTT broker
		err := c.hub.mqttClient.Publish(msg.Topic, msg.Payload, 1)
		if err != nil {
			c.sendError(err.Error(), msg.ID)
		} else {
			c.sendAck(msg.ID, "published")
		}

	case TypePing:
		c.send <- mustMarshal(ServerMessage{Type: TypePong, ID: msg.ID})

	default:
		c.sendError("unknown message type: "+msg.Type, msg.ID)
	}
}

func (c *Client) handleMQTTMessage(topic string, payload []byte) {
	msg := ServerMessage{Type: TypeMessage, Topic: topic, Payload: json.RawMessage(payload)}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
	}
}

func (c *Client) sendError(errMsg, id string) {
	msg := ServerMessage{Type: TypeError, Error: errMsg, ID: id}
	c.send <- mustMarshal(msg)
}

func (c *Client) sendAck(id, status string) {
	msg := ServerMessage{Type: "ack", ID: id, Payload: json.RawMessage([]byte(`"` + status + `"`))}
	c.send <- mustMarshal(msg)
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

// HandleWebSocket upgrades HTTP to WebSocket with JWT auth
func HandleWebSocket(jwtManager *jwt.Manager, hub *Hub, log zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get token from query param or header
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
		hub.register <- client

		go client.WritePump()
		go client.ReadPump()
	}
}
