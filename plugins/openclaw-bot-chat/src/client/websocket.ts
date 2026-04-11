import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";

import type {
  BotChatHelloFrame,
  BotChatWsFrame,
  BotChatWsMessageFrame,
  BotChatWsState,
} from "../types";

interface BotChatWebSocketHandlers {
  onError?: (error: Error) => void;
  onFrame?: (frame: BotChatWsFrame) => void;
  onHello?: (frame: BotChatHelloFrame) => void;
  onMessage?: (frame: BotChatWsMessageFrame) => Promise<void> | void;
  onReconnect?: () => Promise<void> | void;
  onStateChange?: (state: BotChatWsState) => void;
}

interface BotChatWebSocketClientOptions extends BotChatWebSocketHandlers {
  baseUrl: string;
  accessKey: string;
  heartbeatIntervalMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  helloTimeoutMs?: number;
}

export interface MultiBotWebSocketClientOptions
  extends Omit<BotChatWebSocketClientOptions, "baseUrl"> {}

type JsonRecord = Record<string, unknown>;

export class BotChatWebSocketClient {
  private readonly handlers: BotChatWebSocketHandlers = {};
  private readonly helloTimeoutMs: number;
  private heartbeatIntervalMs: number;

  private socket: WebSocket | undefined;
  private connectPromise: Promise<void> | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private helloTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;

  private state: BotChatWsState = "idle";
  private sessionId: string = randomUUID();
  private reconnectAttempt = 0;
  private lastActivityAt = 0;
  private lastPongAt = 0;
  private closedByUser = false;
  private subscribedTopics = new Set<string>();

  constructor(private readonly options: BotChatWebSocketClientOptions) {
    if (options.onError) {
      this.handlers.onError = options.onError;
    }
    if (options.onFrame) {
      this.handlers.onFrame = options.onFrame;
    }
    if (options.onHello) {
      this.handlers.onHello = options.onHello;
    }
    if (options.onMessage) {
      this.handlers.onMessage = options.onMessage;
    }
    if (options.onReconnect) {
      this.handlers.onReconnect = options.onReconnect;
    }
    if (options.onStateChange) {
      this.handlers.onStateChange = options.onStateChange;
    }
    this.helloTimeoutMs = options.helloTimeoutMs ?? 1_500;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs;
  }

  getHeartbeatIntervalMs(): number {
    return this.heartbeatIntervalMs;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getState(): BotChatWsState {
    return this.state;
  }

  getSubscribedTopics(): string[] {
    return [...this.subscribedTopics];
  }

  async connect(): Promise<void> {
    if (this.state === "open") {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.closedByUser = false;
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(toWebSocketUrl(this.options.baseUrl), {
        headers: {
          "X-Bot-Key": this.options.accessKey,
        },
      });

      const settleResolve = () => {
        if (this.connectPromise) {
          resolve();
        }
      };

      const settleReject = (error: Error) => {
        if (this.connectPromise) {
          reject(error);
        }
      };

      this.socket = socket;

      socket.on("open", () => {
        this.lastActivityAt = Date.now();
        this.lastPongAt = this.lastActivityAt;
        this.setState("open");

        this.startHelloFallbackTimer(settleResolve);
        this.resubscribeAll();
      });

      socket.on("message", (data) => {
        this.lastActivityAt = Date.now();
        void this.handleSocketMessage(data, settleResolve);
      });

      socket.on("pong", () => {
        this.lastPongAt = Date.now();
      });

      socket.on("error", (error) => {
        this.handlers.onError?.(error);
      });

      socket.on("close", () => {
        this.cleanupSocketResources();
        this.connectPromise = undefined;

        if (this.closedByUser) {
          this.setState("closed");
          return;
        }

        if (this.state !== "reconnecting") {
          this.setState("reconnecting");
        }
        this.scheduleReconnect();
      });

      socket.once("error", (error) => {
        settleReject(error);
      });
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise;
  }

  async close(): Promise<void> {
    this.closedByUser = true;
    this.cleanupSocketResources();
    if (this.socket) {
      const socket = this.socket;
      this.socket = undefined;
      socket.close();
    }
    this.setState("closed");
  }

  subscribe(topic: string): void {
    if (!topic) {
      return;
    }
    this.subscribedTopics.add(topic);
    this.sendFrame({
      type: "subscribe",
      id: randomUUID(),
      topic,
    });
  }

  unsubscribe(topic: string): void {
    if (!topic) {
      return;
    }
    this.subscribedTopics.delete(topic);
    this.sendFrame({
      type: "unsubscribe",
      id: randomUUID(),
      topic,
    });
  }

  publish(topic: string, payload: unknown, id: string = randomUUID()): void {
    this.sendFrame({
      type: "publish",
      id,
      topic,
      payload,
    });
  }

  private async handleSocketMessage(
    data: RawData,
    resolveConnection: () => void,
  ): Promise<void> {
    const text = toUtf8(data);
    const parsed = parseJson(text);
    if (!isRecord(parsed) || typeof parsed["type"] !== "string") {
      return;
    }

    const frame = parsed as BotChatWsFrame;
    this.handlers.onFrame?.(frame);

    switch (parsed["type"]) {
      case "hello": {
        const hello = this.normalizeHelloFrame(parsed);
        this.sessionId = hello.session_id;
        this.heartbeatIntervalMs =
          hello.heartbeat_interval_ms ??
          hello.heartbeat_interval ??
          this.heartbeatIntervalMs;
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        this.clearHelloTimer();
        this.handlers.onHello?.(hello);
        resolveConnection();
        this.resubscribeAll();
        return;
      }
      case "message":
        if (typeof parsed["topic"] === "string") {
          await this.handlers.onMessage?.({
            type: "message",
            topic: parsed["topic"],
            payload: parsed["payload"],
            ...(typeof parsed["id"] === "string" ? { id: parsed["id"] } : {}),
          });
        }
        return;
      case "ping":
        this.sendFrame({
          type: "pong",
          ...(typeof parsed["id"] === "string" ? { id: parsed["id"] } : {}),
        });
        return;
      case "pong":
        this.lastPongAt = Date.now();
        return;
      case "error":
        this.handlers.onError?.(
          new Error(
            typeof parsed["error"] === "string" ? parsed["error"] : "unknown websocket error",
          ),
        );
        return;
      default:
        return;
    }
  }

  private normalizeHelloFrame(frame: JsonRecord): BotChatHelloFrame {
    const payload = isRecord(frame["payload"]) ? frame["payload"] : undefined;

    const sessionId =
      readString(frame["session_id"]) ??
      readString(payload?.["session_id"]) ??
      this.sessionId;

    const heartbeatInterval =
      readNumber(frame["heartbeat_interval"]) ??
      readNumber(payload?.["heartbeat_interval"]);

    const heartbeatIntervalMs =
      readNumber(frame["heartbeat_interval_ms"]) ??
      readNumber(payload?.["heartbeat_interval_ms"]);

    const bot = readBotInfo(
      isRecord(frame["bot"])
        ? frame["bot"]
        : isRecord(payload?.["bot"])
          ? payload["bot"]
          : undefined,
    );

    return {
      type: "hello",
      session_id: sessionId,
      ...(heartbeatInterval !== undefined ? { heartbeat_interval: heartbeatInterval } : {}),
      ...(heartbeatIntervalMs !== undefined
        ? { heartbeat_interval_ms: heartbeatIntervalMs }
        : {}),
      ...(bot ? { bot } : {}),
    };
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const now = Date.now();
      const staleFor = now - Math.max(this.lastActivityAt, this.lastPongAt);
      if (staleFor > this.heartbeatIntervalMs * 2) {
        socket.terminate();
        return;
      }

      this.sendFrame({
        type: "ping",
        id: randomUUID(),
      });

      try {
        socket.ping();
      } catch (error) {
        this.handlers.onError?.(toError(error));
      }
    }, this.heartbeatIntervalMs);
  }

  private startHelloFallbackTimer(resolveConnection: () => void): void {
    this.clearHelloTimer();
    this.helloTimer = setTimeout(() => {
      const hello: BotChatHelloFrame = {
        type: "hello",
        session_id: this.sessionId,
        heartbeat_interval_ms: this.heartbeatIntervalMs,
      };
      this.startHeartbeat();
      this.handlers.onHello?.(hello);
      resolveConnection();
    }, this.helloTimeoutMs);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(
      this.options.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
      this.options.reconnectMaxDelayMs,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      void this.connect()
        .then(async () => {
          await this.handlers.onReconnect?.();
        })
        .catch((error) => {
          this.handlers.onError?.(toError(error));
        });
    }, withJitter(delay));
  }

  private resubscribeAll(): void {
    for (const topic of this.subscribedTopics) {
      this.sendFrame({
        type: "subscribe",
        id: randomUUID(),
        topic,
      });
    }
  }

  private sendFrame(frame: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(frame));
  }

  private cleanupSocketResources(): void {
    this.clearHeartbeat();
    this.clearHelloTimer();
    this.clearReconnectTimer();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearHelloTimer(): void {
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(state: BotChatWsState): void {
    this.state = state;
    this.handlers.onStateChange?.(state);
  }
}

export class MultiBotWebSocketClient {
  private readonly clients = new Map<string, BotChatWebSocketClient>();

  constructor(private readonly baseUrl: string) {}

  register(
    botKey: string,
    options: MultiBotWebSocketClientOptions,
  ): BotChatWebSocketClient {
    const existing = this.clients.get(botKey);
    if (existing) {
      return existing;
    }

    const client = new BotChatWebSocketClient({
      ...options,
      baseUrl: this.baseUrl,
    });
    this.clients.set(botKey, client);
    return client;
  }

  get(botKey: string): BotChatWebSocketClient | undefined {
    return this.clients.get(botKey);
  }

  entries(): Array<[string, BotChatWebSocketClient]> {
    return [...this.clients.entries()];
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.clients.values()].map((client) => client.close()),
    );
  }
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL("/api/v1/ws", `${baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function toUtf8(value: RawData): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }
  if (Array.isArray(value)) {
    return Buffer.concat(value).toString("utf8");
  }
  return value.toString("utf8");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function withJitter(value: number): number {
  return Math.round(value * (0.85 + Math.random() * 0.3));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBotInfo(value: unknown): BotChatHelloFrame["bot"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = readString(value["id"]);
  if (!id) {
    return undefined;
  }
  const name = readString(value["name"]);
  const description = readString(value["description"]);
  const status = readString(value["status"]);

  return {
    id,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(status ? { status } : {}),
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
