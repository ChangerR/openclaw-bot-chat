package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/service"
	"github.com/rs/zerolog"
)

// Client wraps the MQTT client with message routing
type Client struct {
	client      mqtt.Client
	log         zerolog.Logger
	cfg         MQTTConfig
	msgService  *service.MessageService
	topicPrefix string
	subscribers map[string][]MessageHandler
	subMu       sync.RWMutex
	wg          sync.WaitGroup
	ctx         context.Context
	cancel      context.CancelFunc
}

// MQTTConfig holds MQTT client configuration
type MQTTConfig struct {
	Broker         string
	ClientID       string
	Username       string
	Password       string
	TopicPrefix    string
	QOS            byte
	AutoReconnect  bool
	ReconnectDelay int
}

// MessageHandler is a callback for incoming messages
type MessageHandler func(topic string, payload []byte)

// MessageCallback is the global message callback
type MessageCallback func(topic string, payload []byte)

// NewClient creates a new MQTT client
func NewClient(cfg MQTTConfig, log zerolog.Logger, msgService *service.MessageService) *Client {
	if cfg.ClientID == "" {
		cfg.ClientID = fmt.Sprintf("openclaw-backend-%s", uuid.New().String()[:8])
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{
		cfg:         cfg,
		log:         log,
		msgService:  msgService,
		topicPrefix: cfg.TopicPrefix,
		subscribers: make(map[string][]MessageHandler),
		ctx:         ctx,
		cancel:      cancel,
	}
}

// Connect establishes connection to the MQTT broker
func (c *Client) Connect() error {
	opts := mqtt.NewClientOptions().
		AddBroker(c.cfg.Broker).
		SetClientID(c.cfg.ClientID).
		SetAutoReconnect(c.cfg.AutoReconnect).
		SetConnectRetry(true).
		SetConnectRetryInterval(time.Duration(c.cfg.ReconnectDelay) * time.Second).
		SetKeepAlive(30 * time.Second).
		SetCleanSession(false).
		SetDefaultPublishHandler(c.defaultHandler).
		SetOnConnectHandler(c.onConnect).
		SetConnectionLostHandler(c.onConnectionLost).
		SetReconnectingHandler(c.onReconnecting)

	if c.cfg.Username != "" {
		opts.SetUsername(c.cfg.Username)
		opts.SetPassword(c.cfg.Password)
	}

	c.client = mqtt.NewClient(opts)

	token := c.client.Connect()
	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to connect to MQTT broker: %w", token.Error())
	}

	c.log.Info().Str("broker", c.cfg.Broker).Msg("connected to MQTT broker")
	return nil
}

func (c *Client) defaultHandler(client mqtt.Client, msg mqtt.Message) {
	c.log.Debug().Str("topic", msg.Topic()).Int("qos", int(msg.Qos())).Msg("unhandled message received")
}

func (c *Client) onConnect(client mqtt.Client) {
	c.log.Info().Msg("MQTT connected, subscribing to topics...")
	// Subscribe to all chat topics
	topic := fmt.Sprintf("%s/#", c.cfg.TopicPrefix)
	if token := client.Subscribe(topic, c.cfg.QOS, c.handleMessage); token.Wait() && token.Error() != nil {
		c.log.Error().Err(token.Error()).Str("topic", topic).Msg("failed to subscribe")
	} else {
		c.log.Info().Str("topic", topic).Msg("subscribed to MQTT topic")
	}
}

func (c *Client) onConnectionLost(client mqtt.Client, err error) {
	c.log.Warn().Err(err).Msg("MQTT connection lost")
}

func (c *Client) onReconnecting(client mqtt.Client, opts *mqtt.ClientOptions) {
	c.log.Warn().Msg("MQTT reconnecting...")
}

// handleMessage processes incoming MQTT messages
func (c *Client) handleMessage(client mqtt.Client, msg mqtt.Message) {
	c.wg.Add(1)
	defer c.wg.Done()

	topic := msg.Topic()
	payload := msg.Payload()

	c.log.Debug().Str("topic", topic).Int("len", len(payload)).Msg("MQTT message received")

	// Parse message payload
	var msgPayload service.MessagePayload
	if err := json.Unmarshal(payload, &msgPayload); err != nil {
		c.log.Warn().Err(err).Str("topic", topic).Msg("failed to unmarshal MQTT payload")
		return
	}

	// Create message model
	mqttMsg, err := service.NewMQTTMessage(topic, string(payload), msgPayload)
	if err != nil {
		c.log.Warn().Err(err).Str("topic", topic).Msg("failed to create message model")
		return
	}

	// Save to database
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.msgService.SaveMessage(ctx, mqttMsg); err != nil {
		c.log.Error().Err(err).Str("topic", topic).Msg("failed to save message")
	}

	// Route to local subscribers
	c.deliverToSubscribers(topic, payload)

	// Route based on topic pattern
	c.routeMessage(topic, payload, msgPayload)
}

func (c *Client) routeMessage(topic string, payload []byte, msgPayload service.MessagePayload) {
	// Parse topic: chat/user/{uid}/bot/{bid} or chat/group/{gid}
	// This method handles routing for bot-to-bot private chats and group broadcasts
	parts := splitTopic(topic)
	if len(parts) < 3 {
		return
	}
	c.log.Debug().Interface("parts", parts).Msg("routing message")
}

func splitTopic(topic string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(topic); i++ {
		if topic[i] == '/' {
			parts = append(parts, topic[start:i])
			start = i + 1
		}
	}
	parts = append(parts, topic[start:])
	return parts
}

// Subscribe adds a local subscriber for a topic pattern
func (c *Client) Subscribe(topicPattern string, handler MessageHandler) {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	c.subscribers[topicPattern] = append(c.subscribers[topicPattern], handler)
	c.log.Debug().Str("topic", topicPattern).Msg("added local subscriber")
}

// Unsubscribe removes a local subscriber
func (c *Client) Unsubscribe(topicPattern string) {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	delete(c.subscribers, topicPattern)
}

// deliverToSubscribers sends a message to all matching local subscribers
func (c *Client) deliverToSubscribers(topic string, payload []byte) {
	c.subMu.RLock()
	defer c.subMu.RUnlock()
	for pattern, handlers := range c.subscribers {
		if matchTopic(pattern, topic) {
			for _, handler := range handlers {
				go handler(topic, payload)
			}
		}
	}
}

// matchTopic checks if a topic matches a topic pattern (simple wildcard)
func matchTopic(pattern, topic string) bool {
	if pattern == "#" {
		return true
	}
	if pattern == topic {
		return true
	}
	// Simple single-level wildcard
	patternParts := splitTopic(pattern)
	topicParts := splitTopic(topic)
	if len(patternParts) != len(topicParts) {
		return false
	}
	for i := range patternParts {
		if patternParts[i] == "+" || patternParts[i] == topicParts[i] {
			continue
		}
		return false
	}
	return true
}

// Publish publishes a message to an MQTT topic
func (c *Client) Publish(topic string, payload interface{}, qos byte) error {
	if c.client == nil || !c.client.IsConnected() {
		return fmt.Errorf("MQTT client is not connected")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	token := c.client.Publish(topic, qos, false, data)
	if token.Wait() && token.Error() != nil {
		return token.Error()
	}
	c.log.Debug().Str("topic", topic).Int("len", len(data)).Msg("MQTT message published")
	return nil
}

// PublishRaw publishes raw bytes to an MQTT topic
func (c *Client) PublishRaw(topic string, payload []byte, qos byte) error {
	if c.client == nil || !c.client.IsConnected() {
		return fmt.Errorf("MQTT client is not connected")
	}
	token := c.client.Publish(topic, qos, false, payload)
	if token.Wait() && token.Error() != nil {
		return token.Error()
	}
	return nil
}

// Disconnect gracefully disconnects from the MQTT broker
func (c *Client) Disconnect() {
	c.cancel()
	if c.client != nil {
		c.client.Disconnect(3000)
	}
	c.wg.Wait()
	c.log.Info().Msg("MQTT client disconnected")
}

// IsConnected returns whether the client is connected
func (c *Client) IsConnected() bool {
	return c.client != nil && c.client.IsConnected()
}

// BuildTopic is a helper to build a full MQTT topic path
func BuildTopic(prefix string, topicParts ...string) string {
	all := append([]string{prefix}, topicParts...)
	result := all[0]
	for _, p := range all[1:] {
		result += "/" + p
	}
	return result
}
