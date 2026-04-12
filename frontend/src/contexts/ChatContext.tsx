'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { botsApi, conversationsApi, groupsApi, getToken } from '@/lib/api'
import {
  buildConversationFromTopic,
  compareConversationsByLatest,
  compareMessagesByTime,
  conversationIdFromTopic,
  createBotDraftConversation,
  createGroupDraftConversation,
  normalizeApiMessage,
  normalizeConversations,
  normalizeWsMessage,
} from '@/lib/chat'
import { getWebSocketClient } from '@/lib/websocket'
import { createClientId } from '@/lib/id'
import type {
  Asset,
  Bot,
  ComposerMessageInput,
  Conversation,
  ConversationApiResponse,
  Group,
  Message,
  WsIncomingMessage,
  WsConnectionState,
} from '@/lib/types'
import { useAuth } from './AuthContext'

interface ChatContextType {
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Map<string, Message[]>
  bots: Bot[]
  groups: Group[]
  isLoading: boolean
  connectionState: WsConnectionState
  setCurrentConversation: (conv: Conversation | null) => void
  openBotConversation: (bot: Bot) => void
  openGroupConversation: (group: Group) => void
  sendMessage: (input: ComposerMessageInput) => Promise<void>
  refreshConversations: () => Promise<void>
  refreshMessages: (conversationId: string) => Promise<void>
  refreshBots: () => Promise<void>
  refreshGroups: () => Promise<void>
  reconnectRealtime: () => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth()
  const [rawConversations, setRawConversations] = useState<ConversationApiResponse[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Map<string, Message[]>>(new Map())
  const [bots, setBots] = useState<Bot[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [connectionState, setConnectionState] = useState<WsConnectionState>('idle')
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map())

  const mergeConversationMessages = useCallback((existing: Message[], incoming: Message[]) => {
    const merged = new Map<string, Message>()

    existing.forEach((message) => {
      merged.set(message.id, message)
    })

    incoming.forEach((message) => {
      const previous = merged.get(message.id)
      merged.set(message.id, {
        ...previous,
        ...message,
        pending: false,
        failed: false,
      })
    })

    return [...merged.values()].sort(compareMessagesByTime)
  }, [])

  const upsertConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) => {
      const existing = prev.find((item) => item.id === conversation.id)
      const next = existing
        ? prev.map((item) =>
            item.id === conversation.id
              ? {
                  ...item,
                  ...conversation,
                  topics: [...new Set([...(item.topics || []), ...(conversation.topics || [])])],
                  last_message: conversation.last_message || item.last_message,
                }
              : item,
          )
        : [conversation, ...prev]

      return next.sort(compareConversationsByLatest)
    })
  }, [])

  const upsertMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      const current = prev.get(message.conversation_id) || []
      const existingIndex = current.findIndex((item) => item.id === message.id)
      const nextMessages = [...current]

      if (existingIndex >= 0) {
        nextMessages[existingIndex] = {
          ...nextMessages[existingIndex],
          ...message,
          pending: false,
          failed: false,
        }
      } else {
        nextMessages.push(message)
      }

      nextMessages.sort(compareMessagesByTime)

      return new Map(prev).set(message.conversation_id, nextMessages)
    })

    setConversations((prev) =>
      prev
        .map((conversation) =>
          conversation.id === message.conversation_id
            ? {
                ...conversation,
                last_message: {
                  ...message,
                  pending: false,
                  failed: false,
                },
              }
            : conversation,
        )
        .sort(compareConversationsByLatest),
    )
  }, [])

  const ensureTopicSubscription = useCallback((topic: string) => {
    if (!topic || subscriptionsRef.current.has(topic) || !user) {
      return
    }

    const ws = getWebSocketClient()
    const unsubscribe = ws.subscribe(topic, (frame) => {
      const conversationId = conversationIdFromTopic(frame.topic, user.id)
      if (!conversationId) {
        return
      }

      const existingConversation = conversations.find((item) => item.id === conversationId)
      const conversation =
        existingConversation || buildConversationFromTopic(frame.topic, user.id, bots, groups)

      if (!conversation) {
        return
      }

      if (!existingConversation) {
        upsertConversation(conversation)
      }

      upsertMessage(normalizeWsMessage(frame.topic, frame.payload, conversation.id))
    })

    subscriptionsRef.current.set(topic, unsubscribe)
  }, [bots, conversations, groups, upsertConversation, upsertMessage, user])

  const refreshBots = useCallback(async () => {
    if (!isAuthenticated) return
    const data = await botsApi.list()
    setBots(data)
  }, [isAuthenticated])

  const refreshGroups = useCallback(async () => {
    if (!isAuthenticated) return
    const data = await groupsApi.list()
    setGroups(data)
  }, [isAuthenticated])

  const refreshConversations = useCallback(async () => {
    if (!isAuthenticated) return
    const data = await conversationsApi.list()
    setRawConversations(data)
  }, [isAuthenticated])

  const refreshMessages = useCallback(
    async (conversationId: string) => {
      const conversation = conversations.find((item) => item.id === conversationId)
      if (!conversation) return

      const loadedMessages = await Promise.all(
        conversation.topics.map(async (topic) => {
          const items = await conversationsApi.getMessages(topic)
          return items.map((item) => normalizeApiMessage(item, conversation.id))
        }),
      )

      const merged = loadedMessages
        .flat()
        .reduce<Map<string, Message>>((acc, message) => {
          acc.set(message.id, message)
          return acc
        }, new Map())

      const sortedMessages = [...merged.values()].sort(compareMessagesByTime)

      setMessages((prev) => {
        const currentMessages = prev.get(conversationId) || []
        return new Map(prev).set(
          conversationId,
          mergeConversationMessages(currentMessages, sortedMessages),
        )
      })
    },
    [conversations, mergeConversationMessages],
  )

  const reconnectRealtime = useCallback(async () => {
    const ws = getWebSocketClient()
    await ws.reconnectNow()
  }, [])

  const openBotConversation = useCallback(
    (bot: Bot) => {
      if (!user) return
      const draftConversation = createBotDraftConversation(user.id, bot)
      upsertConversation(draftConversation)
      draftConversation.topics.forEach(ensureTopicSubscription)
      setCurrentConversation(draftConversation)
    },
    [ensureTopicSubscription, upsertConversation, user],
  )

  const openGroupConversation = useCallback(
    (group: Group) => {
      const draftConversation = createGroupDraftConversation(group)
      upsertConversation(draftConversation)
      draftConversation.topics.forEach(ensureTopicSubscription)
      setCurrentConversation(draftConversation)
    },
    [ensureTopicSubscription, upsertConversation],
  )

  const sendMessage = useCallback(
    async (input: ComposerMessageInput) => {
      if (!currentConversation || !user) return

      const ws = getWebSocketClient()
      const messageId = createClientId()
      currentConversation.topics.forEach(ensureTopicSubscription)
      const content = buildOutgoingContent(input)
      const optimisticMessage: Message = {
        id: messageId,
        conversation_id: currentConversation.id,
        topic: currentConversation.send_topic,
        sender_id: user.id,
        sender_type: 'user',
        from: { type: 'user', id: user.id, name: user.username },
        to: { type: currentConversation.target.type, id: currentConversation.target.id, name: currentConversation.name },
        content,
        timestamp: Math.floor(Date.now() / 1000),
        created_at: new Date().toISOString(),
        pending: true,
      }

      upsertMessage(optimisticMessage)

      try {
        await ws.publish(currentConversation.send_topic, {
          id: messageId,
          from: { type: 'user', id: user.id },
          to: { type: currentConversation.target.type, id: currentConversation.target.id },
          content,
        })
      } catch (error) {
        try {
          const fallbackMessage = await conversationsApi.sendMessage({
            id: messageId,
            conversation_id: currentConversation.send_topic,
            to: { type: currentConversation.target.type, id: currentConversation.target.id },
            content,
          })
          upsertMessage(normalizeApiMessage(fallbackMessage, currentConversation.id))
        } catch (fallbackError) {
          setMessages((prev) => {
            const next = new Map(prev)
            const currentMessages = next.get(currentConversation.id) || []
            next.set(
              currentConversation.id,
              currentMessages.map((item) =>
                item.id === messageId
                  ? {
                      ...item,
                      pending: false,
                      failed: true,
                    }
                  : item,
              ),
            )
            return next
          })
          throw fallbackError instanceof Error ? fallbackError : error
        }
      }
    },
    [currentConversation, ensureTopicSubscription, upsertMessage, user],
  )

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setRawConversations([])
      setConversations([])
      setCurrentConversation(null)
      setMessages(new Map())
      setBots([])
      setGroups([])
      setConnectionState('idle')
      return
    }

    let cancelled = false
    setIsLoading(true)

    Promise.all([refreshBots(), refreshGroups(), refreshConversations()])
      .catch((error) => {
        console.error('Failed to load chat data:', error)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, refreshBots, refreshConversations, refreshGroups, user])

  useEffect(() => {
    if (!user) return

    const normalized = normalizeConversations(rawConversations, user.id, bots, groups)
    setConversations((prev) => {
      const drafts = prev.filter((item) => item.last_message == null)
      const merged = new Map<string, Conversation>()

      normalized.forEach((item) => merged.set(item.id, item))
      drafts.forEach((item) => {
        if (!merged.has(item.id)) {
          merged.set(item.id, item)
        }
      })

      return [...merged.values()].sort(compareConversationsByLatest)
    })
  }, [bots, groups, rawConversations, user])

  useEffect(() => {
    if (!currentConversation) return
    setCurrentConversation((prev) => {
      if (!prev) return prev
      return conversations.find((item) => item.id === prev.id) || prev
    })
  }, [conversations])

  useEffect(() => {
    if (!isAuthenticated) return

    const ws = getWebSocketClient()
    const unsubscribe = ws.onStateChange(setConnectionState)
    const currentToken = getToken()
    if (currentToken) {
      void ws.connect(currentToken)
    }

    return unsubscribe
  }, [isAuthenticated])

  useEffect(() => {
    if (!user) return

    const nextTopics = new Set<string>(conversations.flatMap((conversation) => conversation.topics))

    for (const [topic, unsubscribe] of subscriptionsRef.current.entries()) {
      if (!nextTopics.has(topic)) {
        unsubscribe()
        subscriptionsRef.current.delete(topic)
      }
    }

    nextTopics.forEach((topic) => {
      ensureTopicSubscription(topic)
    })
  }, [conversations, ensureTopicSubscription, user])

  return (
    <ChatContext.Provider
      value={{
        conversations,
        currentConversation,
        messages,
        bots,
        groups,
        isLoading,
        connectionState,
        setCurrentConversation,
        openBotConversation,
        openGroupConversation,
        sendMessage,
        refreshConversations,
        refreshMessages,
        refreshBots,
        refreshGroups,
        reconnectRealtime,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

function buildOutgoingContent(input: ComposerMessageInput): Message['content'] {
  if (input.type === 'image') {
    const asset = input.asset
    const url = asset?.download_url || asset?.external_url || asset?.source_url
    const body = input.body?.trim() || asset?.file_name || 'Image'
    return {
      type: 'image',
      body,
      url,
      name: asset?.file_name,
      size: asset?.size,
      meta: {
        ...(asset ? { asset } : {}),
        ...(input.meta || {}),
      },
    }
  }

  return {
    type: 'text',
    body: input.body?.trim() || '',
    meta: input.meta || {},
  }
}

export function useChat() {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
