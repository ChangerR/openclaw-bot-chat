package response

import (
	"time"

	"github.com/google/uuid"
	"github.com/openclaw-bot-chat/backend/internal/model"
)

type GroupResponse struct {
	ID          uuid.UUID     `json:"id"`
	Name        string        `json:"name"`
	Description *string       `json:"description,omitempty"`
	AvatarURL   *string       `json:"avatar_url,omitempty"`
	OwnerID     uuid.UUID     `json:"owner_id"`
	MQTTTopic   *string       `json:"mqtt_topic,omitempty"`
	IsActive    bool          `json:"is_active"`
	MaxMembers  int           `json:"max_members"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	Owner       *UserResponse `json:"owner,omitempty"`
}

type GroupMemberResponse struct {
	ID       uuid.UUID             `json:"id"`
	GroupID  uuid.UUID             `json:"group_id"`
	UserID   uuid.UUID             `json:"user_id"`
	Role     model.GroupMemberRole `json:"role"`
	Nickname *string               `json:"nickname,omitempty"`
	IsActive bool                  `json:"is_active"`
	JoinedAt time.Time             `json:"joined_at"`
	Group    *GroupResponse        `json:"group,omitempty"`
	User     *UserResponse         `json:"user,omitempty"`
}

type BotGroupMemberResponse struct {
	ID       uuid.UUID             `json:"id"`
	GroupID  uuid.UUID             `json:"group_id"`
	BotID    uuid.UUID             `json:"bot_id"`
	Role     model.GroupMemberRole `json:"role"`
	Nickname *string               `json:"nickname,omitempty"`
	IsActive bool                  `json:"is_active"`
	AddedAt  time.Time             `json:"added_at"`
	Group    *GroupResponse        `json:"group,omitempty"`
	Bot      *BotResponse          `json:"bot,omitempty"`
}

type GroupMembersResponse struct {
	Users []GroupMemberResponse    `json:"users"`
	Bots  []BotGroupMemberResponse `json:"bots"`
}

func NewGroupResponse(group *model.Group) *GroupResponse {
	if group == nil {
		return nil
	}

	return &GroupResponse{
		ID:          group.ID,
		Name:        group.Name,
		Description: group.Description,
		AvatarURL:   group.AvatarURL,
		OwnerID:     group.OwnerID,
		MQTTTopic:   group.MQTTTopic,
		IsActive:    group.IsActive,
		MaxMembers:  group.MaxMembers,
		CreatedAt:   group.CreatedAt,
		UpdatedAt:   group.UpdatedAt,
		Owner:       NewUserResponse(group.Owner),
	}
}

func NewGroupResponses(groups []model.Group) []GroupResponse {
	if len(groups) == 0 {
		return []GroupResponse{}
	}

	responses := make([]GroupResponse, 0, len(groups))
	for i := range groups {
		responses = append(responses, *NewGroupResponse(&groups[i]))
	}
	return responses
}

func NewGroupMemberResponse(member *model.GroupMember) *GroupMemberResponse {
	if member == nil {
		return nil
	}

	return &GroupMemberResponse{
		ID:       member.ID,
		GroupID:  member.GroupID,
		UserID:   member.UserID,
		Role:     member.Role,
		Nickname: member.Nickname,
		IsActive: member.IsActive,
		JoinedAt: member.JoinedAt,
		Group:    NewGroupResponse(member.Group),
		User:     NewUserResponse(member.User),
	}
}

func NewGroupMemberResponses(members []model.GroupMember) []GroupMemberResponse {
	if len(members) == 0 {
		return []GroupMemberResponse{}
	}

	responses := make([]GroupMemberResponse, 0, len(members))
	for i := range members {
		responses = append(responses, *NewGroupMemberResponse(&members[i]))
	}
	return responses
}

func NewBotGroupMemberResponse(member *model.BotGroupMember) *BotGroupMemberResponse {
	if member == nil {
		return nil
	}

	return &BotGroupMemberResponse{
		ID:       member.ID,
		GroupID:  member.GroupID,
		BotID:    member.BotID,
		Role:     member.Role,
		Nickname: member.Nickname,
		IsActive: member.IsActive,
		AddedAt:  member.AddedAt,
		Group:    NewGroupResponse(member.Group),
		Bot:      NewBotResponse(member.Bot),
	}
}

func NewBotGroupMemberResponses(members []model.BotGroupMember) []BotGroupMemberResponse {
	if len(members) == 0 {
		return []BotGroupMemberResponse{}
	}

	responses := make([]BotGroupMemberResponse, 0, len(members))
	for i := range members {
		responses = append(responses, *NewBotGroupMemberResponse(&members[i]))
	}
	return responses
}
