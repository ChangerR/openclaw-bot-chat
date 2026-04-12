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

export interface ConversationInfo {
  conversation_id: string;
  topic?: string;
  title?: string;
  last_seq?: number;
  last_message_id?: string;
  updated_at?: number;
}

export interface Subscription {
  topic: string;
  qos: number;
}

export interface Checkpoint {
  dialog_id: string;
  last_seq?: number;
  last_message_id?: string;
  session_id?: string;
  updated_at?: number;
}

export interface BrokerInfo {
  tcp_url: string;
  ws_url?: string;
  username?: string;
  password?: string;
  qos?: number;
}

export interface HistoryBootstrap {
  max_catchup_batch?: number;
}

export interface BootstrapResponse {
  bot: BotInfo;
  broker: BrokerInfo;
  client_id: string;
  groups: GroupInfo[];
  conversations: ConversationInfo[];
  subscriptions: Subscription[];
  publish_topics: string[];
  history?: HistoryBootstrap;
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
  message_id: string;
  topic: string;
  conversation_id: string;
  from_type: BotChatSenderType;
  from_id: string;
  to_type?: BotChatRouteTargetType;
  to_id?: string;
  content_type: BotChatContentType;
  body: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}
