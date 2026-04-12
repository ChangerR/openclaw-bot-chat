package service

import (
	"testing"

	"github.com/google/uuid"
)

func TestIsBotWildcardSubscriptionTopic(t *testing.T) {
	botID := uuid.New()
	bot := botID.String()

	tests := []struct {
		name  string
		topic string
		want  bool
	}{
		{
			name:  "user to bot wildcard",
			topic: "chat/dm/user/+/bot/" + bot,
			want:  true,
		},
		{
			name:  "bot to any bot wildcard from self",
			topic: "chat/dm/bot/" + bot + "/bot/+",
			want:  true,
		},
		{
			name:  "any bot to self wildcard",
			topic: "chat/dm/bot/+/bot/" + bot,
			want:  true,
		},
		{
			name:  "group topic is not wildcard direct route",
			topic: "chat/group/" + uuid.NewString(),
			want:  false,
		},
		{
			name:  "bot wildcard on wrong side is rejected",
			topic: "chat/dm/user/" + bot + "/bot/+",
			want:  false,
		},
		{
			name:  "other bot wildcard is rejected",
			topic: "chat/dm/user/+/bot/" + uuid.NewString(),
			want:  false,
		},
		{
			name:  "double wildcard is rejected",
			topic: "chat/dm/bot/+/bot/+",
			want:  false,
		},
		{
			name:  "hash wildcard is rejected",
			topic: "chat/dm/user/#/bot/" + bot,
			want:  false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isBotWildcardSubscriptionTopic(botID, tc.topic); got != tc.want {
				t.Fatalf("isBotWildcardSubscriptionTopic(%q) = %v, want %v", tc.topic, got, tc.want)
			}
		})
	}
}
