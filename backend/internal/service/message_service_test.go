package service

import (
	"reflect"
	"testing"
)

func TestNormalizeIncomingMessageUsesMQTTTopicAsCanonicalConversation(t *testing.T) {
	actualTopic := "chat/group/11111111-1111-1111-1111-111111111111"
	normalized := normalizeIncomingMessage(actualTopic, MessagePayload{
		ConversationID: "chat/group/22222222-2222-2222-2222-222222222222",
		Topic:          "chat/group/33333333-3333-3333-3333-333333333333",
		From: &MessagePeerPayload{
			Type: "user",
			ID:   "44444444-4444-4444-4444-444444444444",
		},
		To: &MessagePeerPayload{
			Type: "group",
			ID:   "11111111-1111-1111-1111-111111111111",
		},
		ContentRaw: []byte(`{"type":"text","body":"hello"}`),
	})

	if normalized.conversationID != actualTopic {
		t.Fatalf("normalizeIncomingMessage() conversationID = %q, want %q", normalized.conversationID, actualTopic)
	}
}

func TestUniqueSortedTopicsNormalizesAndDeduplicates(t *testing.T) {
	topics := uniqueSortedTopics([]string{
		"chat/group/22222222-2222-2222-2222-222222222222",
		"/chat/group/11111111-1111-1111-1111-111111111111",
		"chat/group/22222222-2222-2222-2222-222222222222",
		"chat/group/11111111-1111-1111-1111-111111111111",
	})

	if len(topics) != 2 {
		t.Fatalf("uniqueSortedTopics() len = %d, want 2", len(topics))
	}
	if topics[0] != "chat/group/11111111-1111-1111-1111-111111111111" {
		t.Fatalf("uniqueSortedTopics()[0] = %q", topics[0])
	}
	if topics[1] != "chat/group/22222222-2222-2222-2222-222222222222" {
		t.Fatalf("uniqueSortedTopics()[1] = %q", topics[1])
	}
}

func TestReadMentionedBotIDsMetaSupportsInterfaceSlice(t *testing.T) {
	meta := map[string]interface{}{
		mentionedBotIDsMetaKey: []interface{}{
			"bot-1",
			" bot-2 ",
			123,
			"",
		},
	}

	mentioned := readMentionedBotIDsMeta(meta)
	expected := []string{"bot-1", "bot-2"}
	if !reflect.DeepEqual(mentioned, expected) {
		t.Fatalf("readMentionedBotIDsMeta() = %#v, want %#v", mentioned, expected)
	}
}

func TestMergeMentionedBotIDsPreservesFrontendAndBackendMentions(t *testing.T) {
	merged := mergeMentionedBotIDs(
		[]string{"bot-frontend", "bot-shared"},
		[]string{"bot-shared", "bot-backend"},
	)
	expected := []string{"bot-frontend", "bot-shared", "bot-backend"}
	if !reflect.DeepEqual(merged, expected) {
		t.Fatalf("mergeMentionedBotIDs() = %#v, want %#v", merged, expected)
	}
}
