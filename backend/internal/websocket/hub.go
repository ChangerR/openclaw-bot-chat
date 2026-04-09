package websocket

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/mqtt"
	"github.com/rs/zerolog"
)

type TopicAuthorizer interface {
	CanUserSubscribeTopic(ctx context.Context, userID uuid.UUID, topic string) error
	CanUserPublishTopic(ctx context.Context, userID uuid.UUID, topic string, payload json.RawMessage) error
	CanBotSubscribeTopic(ctx context.Context, botID uuid.UUID, topic string) error
	CanBotPublishTopic(ctx context.Context, botID uuid.UUID, topic string, payload json.RawMessage) error
}

type broadcastMessage struct {
	topic string
	data  []byte
}

// Hub maintains the set of active clients and broadcasts MQTT messages to them.
type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMessage
	done       chan struct{}
	stopOnce   sync.Once
	mu         sync.RWMutex
	log        zerolog.Logger
	mqttClient *mqtt.Client
	authorizer TopicAuthorizer
	cfg        WSConfig
	wg         sync.WaitGroup
}

// NewHub creates a new Hub instance.
func NewHub(mqttClient *mqtt.Client, cfg WSConfig, log zerolog.Logger, authorizer TopicAuthorizer) *Hub {
	cfg = cfg.withDefaults()

	return &Hub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan broadcastMessage, cfg.BroadcastQueueSize),
		done:       make(chan struct{}),
		log:        log,
		mqttClient: mqttClient,
		authorizer: authorizer,
		cfg:        cfg,
	}
}

// Run starts the hub's main loop.
func (h *Hub) Run() {
	h.wg.Add(1)
	defer h.wg.Done()

	for {
		select {
		case client := <-h.register:
			h.addClient(client)
		case client := <-h.unregister:
			h.removeClient(client)
		case message := <-h.broadcast:
			h.broadcastMessage(message)
		case <-h.done:
			return
		}
	}
}

// Stop gracefully stops the hub.
func (h *Hub) Stop() {
	h.stopOnce.Do(func() {
		close(h.done)
	})

	h.wg.Wait()

	h.mu.Lock()
	for client := range h.clients {
		_ = client.conn.Close()
		close(client.send)
		delete(h.clients, client)
	}
	h.mu.Unlock()
}

// BroadcastToTopic enqueues a topic-scoped message for all interested clients.
func (h *Hub) BroadcastToTopic(topic string, payload []byte) {
	msg := ServerMessage{
		Type:    TypeMessage,
		Topic:   topic,
		Payload: json.RawMessage(payload),
	}

	h.enqueueBroadcast(topic, mustMarshal(msg))
}

func (h *Hub) registerClient(client *Client) {
	select {
	case <-h.done:
		_ = client.conn.Close()
	case h.register <- client:
	}
}

func (h *Hub) unregisterClient(client *Client) {
	select {
	case <-h.done:
	case h.unregister <- client:
	}
}

func (h *Hub) enqueueBroadcast(topic string, data []byte) {
	message := broadcastMessage{topic: topic, data: data}

	select {
	case <-h.done:
	case h.broadcast <- message:
	default:
		h.log.Warn().Str("topic", topic).Msg("WebSocket broadcast queue full")
	}
}

func (h *Hub) addClient(client *Client) {
	h.mu.Lock()
	h.clients[client] = true
	count := len(h.clients)
	h.mu.Unlock()

	h.log.Info().
		Str("user", client.Username).
		Int("clients", count).
		Msg("WS client connected")
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	if _, ok := h.clients[client]; !ok {
		h.mu.Unlock()
		return
	}

	delete(h.clients, client)
	close(client.send)
	count := len(h.clients)
	h.mu.Unlock()

	h.log.Info().
		Str("user", client.Username).
		Int("clients", count).
		Msg("WS client disconnected")
}

func (h *Hub) broadcastMessage(message broadcastMessage) {
	staleClients := make([]*Client, 0)

	h.mu.RLock()
	for client := range h.clients {
		if !client.acceptsTopic(message.topic) {
			continue
		}
		if !client.enqueue(message.data) {
			staleClients = append(staleClients, client)
		}
	}
	h.mu.RUnlock()

	for _, client := range staleClients {
		h.removeClient(client)
	}
}
