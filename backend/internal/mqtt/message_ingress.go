package mqtt

// MessageIngress handles MQTT messages received by the transport layer.
type MessageIngress interface {
	HandleIncomingMessage(topic string, payload []byte) error
}
