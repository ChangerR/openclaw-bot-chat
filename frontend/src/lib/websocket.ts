import type {
  WsAckFrame,
  WsConnectionState,
  WsErrorFrame,
  WsIncomingMessage,
  WsPingFrame,
  WsPublishFrame,
  WsPublishPayload,
  WsServerFrame,
  WsSubscribeFrame,
} from './types'
import { createClientId } from './id'

type MessageHandler = (message: WsIncomingMessage) => void
type ConnectionHandler = (state: WsConnectionState) => void

interface PendingRequest {
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface WebSocketClient {
  connect: (token?: string) => Promise<void>
  disconnect: () => void
  publish: (topic: string, payload: WsPublishPayload, timeoutMs?: number) => Promise<void>
  subscribe: (topic: string, handler: MessageHandler) => () => void
  onStateChange: (handler: ConnectionHandler) => () => void
  getState: () => WsConnectionState
  isConnected: () => boolean
  reconnectNow: () => Promise<void>
}

const DEFAULT_ACK_TIMEOUT_MS = 5000

export function createWebSocketClient(): WebSocketClient {
  let ws: WebSocket | null = null
  let token: string | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let manualDisconnect = false
  let state: WsConnectionState = 'idle'
  let connectPromise: Promise<void> | null = null

  const maxReconnectAttempts = 8
  const reconnectBaseDelay = 1000
  const serverTopics = new Set<string>()
  const topicHandlers = new Map<string, Set<MessageHandler>>()
  const stateHandlers = new Set<ConnectionHandler>()
  const pendingRequests = new Map<string, PendingRequest>()

  function emitState(nextState: WsConnectionState) {
    state = nextState
    stateHandlers.forEach((handler) => handler(nextState))
  }

  function getWsUrl(currentToken: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = process.env.NEXT_PUBLIC_API_WS_HOST || window.location.host
    return `${protocol}//${host}/api/v1/ws?token=${encodeURIComponent(currentToken)}`
  }

  function createRequestId(): string {
    return createClientId()
  }

  function clearPendingRequests(reason: string) {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
      pendingRequests.delete(id)
    }
  }

  function scheduleReconnect() {
    if (manualDisconnect || !token || reconnectAttempts >= maxReconnectAttempts) {
      emitState('disconnected')
      return
    }

    emitState('reconnecting')
    const delay = Math.min(reconnectBaseDelay * 2 ** reconnectAttempts, 10000)
    reconnectTimer = setTimeout(() => {
      reconnectAttempts += 1
      void connect(token ?? undefined)
    }, delay)
  }

  function sendFrame(frame: WsPublishFrame | WsSubscribeFrame | WsPingFrame, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not connected'))
    }
    const socket = ws

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(frame.id)
        reject(new Error(`${frame.type} request timed out`))
      }, timeoutMs)

      pendingRequests.set(frame.id, { resolve, reject, timeout })
      socket.send(JSON.stringify(frame))
    })
  }

  function resolvePending(id?: string) {
    if (!id) return
    const pending = pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pending.resolve()
    pendingRequests.delete(id)
  }

  function rejectPending(id: string | undefined, error: string) {
    if (!id) return
    const pending = pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pending.reject(new Error(error || 'WebSocket request failed'))
    pendingRequests.delete(id)
  }

  function handleAck(frame: WsAckFrame) {
    resolvePending(frame.id)
  }

  function handleError(frame: WsErrorFrame) {
    rejectPending(frame.id, frame.error)
  }

  function dispatchMessage(frame: WsIncomingMessage) {
    topicHandlers.get(frame.topic)?.forEach((handler) => handler(frame))
    topicHandlers.get('*')?.forEach((handler) => handler(frame))
  }

  function resubscribeAll() {
    const topics = [...serverTopics]
    if (topics.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) {
      return
    }

    topics.forEach((topic) => {
      const frame: WsSubscribeFrame = {
        type: 'subscribe',
        id: createRequestId(),
        topic,
      }
      void sendFrame(frame).catch(() => undefined)
    })
  }

  async function connect(nextToken?: string): Promise<void> {
    if (nextToken) {
      token = nextToken
    }
    if (!token) {
      return
    }
    if (ws?.readyState === WebSocket.OPEN) {
      return
    }
    if (connectPromise) {
      return connectPromise
    }

    manualDisconnect = false
    emitState(reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    connectPromise = new Promise<void>((resolve, reject) => {
      let nextSocket: WebSocket
      try {
        nextSocket = new WebSocket(getWsUrl(token!))
        ws = nextSocket
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        connectPromise = null
        scheduleReconnect()
        return
      }

      nextSocket.onopen = () => {
        reconnectAttempts = 0
        emitState('connected')
        resubscribeAll()
        resolve()
      }

      nextSocket.onmessage = (event: MessageEvent) => {
        try {
          const frame = JSON.parse(event.data) as WsServerFrame
          switch (frame.type) {
            case 'ack':
              handleAck(frame)
              break
            case 'error':
              handleError(frame)
              break
            case 'message':
              dispatchMessage(frame)
              break
            case 'pong':
              resolvePending(frame.id)
              break
            default:
              break
          }
        } catch (error) {
          console.error('Failed to parse WebSocket frame:', error)
        }
      }

      nextSocket.onclose = () => {
        ws = null
        connectPromise = null
        clearPendingRequests('WebSocket disconnected')
        scheduleReconnect()
      }

      nextSocket.onerror = (error: Event) => {
        console.error('WebSocket error:', error)
      }
    }).finally(() => {
      connectPromise = null
    })

    return connectPromise
  }

  function disconnect() {
    manualDisconnect = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearPendingRequests('WebSocket disconnected')
    if (ws) {
      ws.close()
      ws = null
    }
    emitState('disconnected')
  }

  async function reconnectNow() {
    if (!token) {
      throw new Error('No WebSocket token available')
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    reconnectAttempts = 0
    await connect(token)
  }

  async function publish(topic: string, payload: WsPublishPayload, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await connect(token ?? undefined)
    }

    const frame: WsPublishFrame = {
      type: 'publish',
      id: createRequestId(),
      topic,
      payload,
    }

    return sendFrame(frame, timeoutMs)
  }

  function subscribe(topic: string, handler: MessageHandler): () => void {
    if (!topicHandlers.has(topic)) {
      topicHandlers.set(topic, new Set())
    }
    topicHandlers.get(topic)!.add(handler)

    if (topic !== '*') {
      const isNewServerTopic = !serverTopics.has(topic)
      serverTopics.add(topic)
      if (isNewServerTopic && ws?.readyState === WebSocket.OPEN) {
        const frame: WsSubscribeFrame = {
          type: 'subscribe',
          id: createRequestId(),
          topic,
        }
        void sendFrame(frame).catch(() => undefined)
      }
    }

    return () => {
      topicHandlers.get(topic)?.delete(handler)
      if (topicHandlers.get(topic)?.size === 0) {
        topicHandlers.delete(topic)
      }

      if (topic !== '*') {
        const hasHandlers = topicHandlers.has(topic)
        if (!hasHandlers) {
          serverTopics.delete(topic)
          if (ws?.readyState === WebSocket.OPEN) {
            const frame: WsSubscribeFrame = {
              type: 'unsubscribe',
              id: createRequestId(),
              topic,
            }
            void sendFrame(frame).catch(() => undefined)
          }
        }
      }
    }
  }

  function onStateChange(handler: ConnectionHandler) {
    stateHandlers.add(handler)
    handler(state)
    return () => {
      stateHandlers.delete(handler)
    }
  }

  function getState() {
    return state
  }

  function isConnected(): boolean {
    return state === 'connected'
  }

  return {
    connect,
    disconnect,
    publish,
    subscribe,
    onStateChange,
    getState,
    isConnected,
    reconnectNow,
  }
}

let wsClient: ReturnType<typeof createWebSocketClient> | null = null

export function getWebSocketClient(): ReturnType<typeof createWebSocketClient> {
  if (!wsClient) {
    wsClient = createWebSocketClient()
  }
  return wsClient
}
