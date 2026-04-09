package model

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// --- User ---

type UserStatus int

const (
	UserStatusInactive UserStatus = 0
	UserStatusActive   UserStatus = 1
	UserStatusBanned   UserStatus = 2
)

type User struct {
	ID           uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Username     string         `gorm:"type:varchar(64);uniqueIndex;not null" json:"username"`
	Email        string         `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
	PasswordHash string         `gorm:"type:varchar(255);not null" json:"-"`
	Nickname     *string        `gorm:"type:varchar(128)" json:"nickname,omitempty"`
	AvatarURL    *string        `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	Status       UserStatus     `gorm:"type:smallint;not null;default:1" json:"status"`
	IsDeleted    bool           `gorm:"not null;default:false" json:"-"`
	LastLoginAt  *time.Time     `json:"last_login_at,omitempty"`
	LastLoginIP  *string        `gorm:"type:varchar(45)" json:"last_login_ip,omitempty"`
	CreatedAt    time.Time      `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt    time.Time      `gorm:"not null;default:now()" json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

func (User) TableName() string { return "users" }

// --- Bot ---

type BotType string

const (
	BotTypeGeneral   BotType = "general"
	BotTypeAssistant BotType = "assistant"
	BotTypeService   BotType = "service"
)

type BotStatus int

const (
	BotStatusDisabled BotStatus = 0
	BotStatusEnabled  BotStatus = 1
)

type Bot struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OwnerID     uuid.UUID      `gorm:"type:uuid;not null" json:"owner_id"`
	Name        string         `gorm:"type:varchar(128);not null" json:"name"`
	Description *string       `gorm:"type:text" json:"description,omitempty"`
	AvatarURL   *string       `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	BotType     BotType        `gorm:"type:varchar(32);not null;default:'general'" json:"bot_type"`
	Status      BotStatus      `gorm:"type:smallint;not null;default:1" json:"status"`
	IsPublic    bool           `gorm:"not null;default:false" json:"is_public"`
	Config      JSONMap        `gorm:"type:jsonb" json:"config,omitempty"`
	MQTTTopic   *string       `gorm:"type:varchar(256)" json:"mqtt_topic,omitempty"`
	CreatedAt   time.Time     `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt   time.Time     `gorm:"not null;default:now()" json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	Owner       *User          `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
}

func (Bot) TableName() string { return "bots" }

// --- BotKey ---

type BotKey struct {
	ID         uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	BotID      uuid.UUID  `gorm:"type:uuid;not null" json:"bot_id"`
	KeyPrefix  string     `gorm:"type:varchar(32);not null" json:"key_prefix"`
	KeyHash    string     `gorm:"type:varchar(255);not null" json:"-"`
	Name       *string    `gorm:"type:varchar(128)" json:"name,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	LastUsedIP *string    `gorm:"type:varchar(45)" json:"last_used_ip,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	IsActive   bool       `gorm:"not null;default:true" json:"is_active"`
	CreatedAt  time.Time  `gorm:"not null;default:now()" json:"created_at"`
	Bot        *Bot       `gorm:"foreignKey:BotID" json:"bot,omitempty"`
}

func (BotKey) TableName() string { return "bot_keys" }

// --- Message ---

type SenderType string

const (
	SenderTypeUser   SenderType = "user"
	SenderTypeBot    SenderType = "bot"
	SenderTypeSystem SenderType = "system"
)

type MsgType string

const (
	MsgTypeText   MsgType = "text"
	MsgTypeImage  MsgType = "image"
	MsgTypeFile   MsgType = "file"
	MsgTypeAudio  MsgType = "audio"
	MsgTypeVideo  MsgType = "video"
)

type Message struct {
	ID             int64        `gorm:"primaryKey;autoIncrement" json:"id"`
	ConversationID string       `gorm:"type:varchar(256);not null;index:idx_messages_conversation_id" json:"conversation_id"`
	MessageID      uuid.UUID    `gorm:"type:uuid;not null;default:uuid_generate_v4()" json:"message_id"`
	SenderType     SenderType   `gorm:"type:varchar(16);not null" json:"sender_type"`
	SenderID       *uuid.UUID   `gorm:"type:uuid" json:"sender_id,omitempty"`
	SenderName     *string      `gorm:"type:varchar(128)" json:"sender_name,omitempty"`
	BotID          *uuid.UUID   `gorm:"type:uuid;index:idx_messages_bot_id" json:"bot_id,omitempty"`
	GroupID        *uuid.UUID   `gorm:"type:uuid;index:idx_messages_group_id" json:"group_id,omitempty"`
	MsgType        MsgType      `gorm:"type:varchar(32);not null;default:'text'" json:"msg_type"`
	Content        string       `gorm:"type:text" json:"content"`
	Metadata       JSONMap      `gorm:"type:jsonb" json:"metadata,omitempty"`
	MQTTTopic      string       `gorm:"type:varchar(256);not null" json:"mqtt_topic"`
	QOS            int          `gorm:"type:smallint;not null;default:1" json:"qos"`
	IsRead         bool         `gorm:"not null;default:false" json:"is_read"`
	IsDeleted      bool         `gorm:"not null;default:false" json:"is_deleted"`
	Seq            int64        `gorm:"not null;default:0;index:idx_messages_seq" json:"seq"`
	CreatedAt      time.Time    `gorm:"not null;default:now();index:idx_messages_created_at" json:"created_at"`
}

func (Message) TableName() string { return "messages" }

// --- Group ---

type Group struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name        string         `gorm:"type:varchar(128);not null" json:"name"`
	Description *string        `gorm:"type:text" json:"description,omitempty"`
	AvatarURL   *string        `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	OwnerID     uuid.UUID      `gorm:"type:uuid;not null" json:"owner_id"`
	MQTTTopic   *string        `gorm:"type:varchar(256)" json:"mqtt_topic,omitempty"`
	IsActive    bool           `gorm:"not null;default:true" json:"is_active"`
	MaxMembers  int            `gorm:"not null;default:500" json:"max_members"`
	CreatedAt   time.Time      `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt   time.Time      `gorm:"not null;default:now()" json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	Owner       *User          `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
}

func (Group) TableName() string { return "groups" }

// --- GroupMember ---

type GroupMemberRole string

const (
	GroupRoleOwner  GroupMemberRole = "owner"
	GroupRoleAdmin GroupMemberRole = "admin"
	GroupRoleMember GroupMemberRole = "member"
)

type GroupMember struct {
	ID       uuid.UUID       `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	GroupID  uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex:idx_gm_group_user" json:"group_id"`
	UserID   uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex:idx_gm_group_user" json:"user_id"`
	Role     GroupMemberRole `gorm:"type:varchar(16);not null;default:'member'" json:"role"`
	Nickname *string         `gorm:"type:varchar(128)" json:"nickname,omitempty"`
	IsActive bool            `gorm:"not null;default:true" json:"is_active"`
	JoinedAt time.Time       `gorm:"not null;default:now()" json:"joined_at"`
	Group    *Group          `gorm:"foreignKey:GroupID" json:"group,omitempty"`
	User     *User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

func (GroupMember) TableName() string { return "group_members" }

// --- BotGroupMember ---

type BotGroupMember struct {
	ID       uuid.UUID       `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	GroupID  uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex:idx_bgm_group_bot" json:"group_id"`
	BotID    uuid.UUID       `gorm:"type:uuid;not null;uniqueIndex:idx_bgm_group_bot" json:"bot_id"`
	Role     GroupMemberRole `gorm:"type:varchar(16);not null;default:'member'" json:"role"`
	Nickname *string         `gorm:"type:varchar(128)" json:"nickname,omitempty"`
	IsActive bool            `gorm:"not null;default:true" json:"is_active"`
	AddedAt  time.Time       `gorm:"not null;default:now()" json:"added_at"`
	Group    *Group          `gorm:"foreignKey:GroupID" json:"group,omitempty"`
	Bot      *Bot            `gorm:"foreignKey:BotID" json:"bot,omitempty"`
}

func (BotGroupMember) TableName() string { return "bot_group_members" }

// --- AuditLog ---

type AuditAction string

const (
	AuditActionLogin        AuditAction = "login"
	AuditActionLogout       AuditAction = "logout"
	AuditActionRegister     AuditAction = "register"
	AuditActionCreateBot    AuditAction = "create_bot"
	AuditActionUpdateBot    AuditAction = "update_bot"
	AuditActionDeleteBot    AuditAction = "delete_bot"
	AuditActionCreateKey    AuditAction = "create_key"
	AuditActionRevokeKey    AuditAction = "revoke_key"
	AuditActionCreateGroup  AuditAction = "create_group"
	AuditActionUpdateGroup  AuditAction = "update_group"
	AuditActionDeleteGroup  AuditAction = "delete_group"
	AuditActionAddMember    AuditAction = "add_member"
	AuditActionRemoveMember AuditAction = "remove_member"
	AuditActionSendMessage  AuditAction = "send_message"
)

type AuditLog struct {
	ID            int64        `gorm:"primaryKey;autoIncrement" json:"id"`
	EventID       uuid.UUID    `gorm:"type:uuid;not null;default:uuid_generate_v4()" json:"event_id"`
	UserID        *uuid.UUID   `gorm:"type:uuid;index" json:"user_id,omitempty"`
	BotID         *uuid.UUID   `gorm:"type:uuid" json:"bot_id,omitempty"`
	GroupID       *uuid.UUID   `gorm:"type:uuid" json:"group_id,omitempty"`
	Action        string       `gorm:"type:varchar(64);not null;index" json:"action"`
	ResourceType  *string      `gorm:"type:varchar(64)" json:"resource_type,omitempty"`
	ResourceID    *uuid.UUID   `gorm:"type:uuid" json:"resource_id,omitempty"`
	IPAddress     *string      `gorm:"type:varchar(45)" json:"ip_address,omitempty"`
	UserAgent     *string      `gorm:"type:varchar(512)" json:"user_agent,omitempty"`
	RequestMethod *string      `gorm:"type:varchar(10)" json:"request_method,omitempty"`
	RequestPath   *string      `gorm:"type:varchar(256)" json:"request_path,omitempty"`
	RequestBody   *string      `gorm:"type:text" json:"request_body,omitempty"`
	ResponseCode  *int         `json:"response_code,omitempty"`
	ErrorMessage  *string      `gorm:"type:text" json:"error_message,omitempty"`
	Metadata      JSONMap      `gorm:"type:jsonb" json:"metadata,omitempty"`
	CreatedAt     time.Time    `gorm:"not null;default:now();index" json:"created_at"`
}

func (AuditLog) TableName() string { return "audit_logs" }

// --- JSONMap helper ---

type JSONMap map[string]interface{}

func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, j)
}

func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}
