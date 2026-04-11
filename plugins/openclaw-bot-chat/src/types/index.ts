export type BotChatContentType = "text" | "image" | "file";
export type BotChatSenderType = "user" | "bot" | "system";
export type BotChatRouteTargetType = BotChatSenderType | "group" | "channel";

export interface BotChatMessage {
  message_id: string;
  dialog_id: string;
  from_type: BotChatSenderType;
  from_id: string;
  to_type?: BotChatRouteTargetType;
  to_id?: string;
  content_type: BotChatContentType;
  body: string;
  meta?: Record<string, unknown>;
  timestamp: number;
  seq?: number;
}

export interface BotInfo {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  config?: Record<string, unknown>;
}

export interface GroupInfo {
  id: string;
  name?: string;
  topic?: string;
}

export interface DialogInfo {
  dialog_id: string;
  topic?: string;
  title?: string;
  last_seq?: number;
  last_message_id?: string;
  updated_at?: number;
}

export interface Subscription {
  topic: string;
  qos?: number;
}

export interface Checkpoint {
  dialog_id: string;
  last_seq?: number;
  last_message_id?: string;
  session_id?: string;
  updated_at?: number;
}

export interface TransportPolicy {
  heartbeat_interval?: number;
  heartbeat_interval_ms?: number;
  base_reconnect_delay_ms?: number;
  max_reconnect_delay_ms?: number;
  topics?: string[];
}

export interface BootstrapResponse {
  bot: BotInfo;
  groups: GroupInfo[];
  dialogs: DialogInfo[];
  subscriptions: Subscription[];
  checkpoints: Checkpoint[];
  transport_policy: TransportPolicy;
}

export interface OpenClawRequest {
  session_id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface OpenClawResponse {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface OpenClawAgent {
  respond(request: OpenClawRequest): Promise<OpenClawResponse>;
}

export interface BotChatOutgoingMessage {
  dialog_id: string;
  message_id: string;
  content_type: BotChatContentType;
  body: string;
  meta?: Record<string, unknown>;
  reply_to_message_id?: string;
  topic?: string;
}

export interface BotChatRuntimeHeartbeat {
  session_id: string;
  bot_id: string;
  subscriptions: string[];
  checkpoints: Checkpoint[];
  timestamp: number;
}

export interface BotChatHelloFrame {
  type: "hello";
  session_id: string;
  heartbeat_interval?: number;
  heartbeat_interval_ms?: number;
  bot?: BotInfo;
}

export interface BotChatAckFrame {
  type: "ack";
  id?: string;
  payload?: unknown;
}

export interface BotChatErrorFrame {
  type: "error";
  id?: string;
  error: string;
}

export interface BotChatWsMessageFrame {
  type: "message";
  id?: string;
  topic: string;
  payload: unknown;
}

export interface BotChatWsPingFrame {
  type: "ping" | "pong";
  id?: string;
}

export interface BotChatWsSubscribeFrame {
  type: "subscribe" | "unsubscribe";
  id?: string;
  topic: string;
}

export interface BotChatWsPublishFrame {
  type: "publish";
  id?: string;
  topic: string;
  payload: unknown;
}

export type BotChatWsFrame =
  | BotChatHelloFrame
  | BotChatAckFrame
  | BotChatErrorFrame
  | BotChatWsMessageFrame
  | BotChatWsPingFrame
  | BotChatWsSubscribeFrame
  | BotChatWsPublishFrame
  | Record<string, unknown>;

export type BotChatWsState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";
