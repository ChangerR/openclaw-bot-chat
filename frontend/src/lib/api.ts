import type {
  User,
  Bot,
  BotKey,
  ConversationApiResponse,
  MessageApiResponse,
  Group,
  GroupMembersResponse,
  AuthTokens,
  AuthPayload,
  ApiResponse,
  Asset,
  PreparedUpload,
} from './types'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '')

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('access_token')
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 204) {
    return undefined as T
  }

  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return text ? { message: text } : {}
  })

  if (!response.ok) {
    const error = payload as ApiResponse<unknown>
    throw new Error(error.message || error.error || `HTTP ${response.status}`)
  }

  if (payload && typeof payload === 'object' && 'code' in payload) {
    return (payload as ApiResponse<T>).data as T
  }

  return payload as T
}

// Auth API
export const authApi = {
  register: (data: { username: string; email: string; password: string }) =>
    request<AuthPayload>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((payload) => payload.tokens),

  login: (data: { identifier: string; password: string }) =>
    request<AuthPayload>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(
        data.identifier.includes('@')
          ? { email: data.identifier, password: data.password }
          : { username: data.identifier, password: data.password }
      ),
    }).then((payload) => payload.tokens),

  refresh: (data: { refresh_token: string }) =>
    request<AuthTokens>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    request<void>('/api/v1/auth/logout', { method: 'POST' }),

  getMe: () => request<User>('/api/v1/auth/me'),

  updateMe: (data: Partial<User>) =>
    request<User>('/api/v1/auth/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  changePassword: (data: { old_password: string; new_password: string }) =>
    request<void>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Bots API
export const botsApi = {
  list: () => request<Bot[]>('/api/v1/bots'),

  get: (id: string) => request<Bot>(`/api/v1/bots/${id}`),

  create: (data: { name: string; description?: string; avatar?: string }) =>
    request<Bot>('/api/v1/bots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Bot>) =>
    request<Bot>(`/api/v1/bots/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/v1/bots/${id}`, { method: 'DELETE' }),

  // Bot Keys
  listKeys: (botId: string) => request<BotKey[]>(`/api/v1/bots/${botId}/keys`),

  createKey: (botId: string, data: { name?: string; expires_at?: string }) =>
    request<BotKey>(`/api/v1/bots/${botId}/keys`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteKey: (botId: string, keyId: string) =>
    request<void>(`/api/v1/bots/${botId}/keys/${keyId}`, { method: 'DELETE' }),
}

// Conversations API
export const conversationsApi = {
  list: () => request<ConversationApiResponse[]>('/api/v1/conversations'),

  getMessages: (conversationId: string, limit = 50, before?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (before) params.set('before', before)
    return request<MessageApiResponse[]>(`/api/v1/messages/${conversationId}?${params}`)
  },

  sendMessage: (
    data: {
      id?: string
      conversation_id?: string
      to: { type: 'bot' | 'group' | 'user'; id: string }
      content: { type: string; body?: string; url?: string; name?: string; size?: number; meta?: Record<string, unknown> }
    },
  ) =>
    request<MessageApiResponse>(`/api/v1/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

export const assetsApi = {
  prepareImageUpload: (data: { file_name: string; content_type: string; size: number; conversation_id?: string }) =>
    request<PreparedUpload>('/api/v1/assets/image/upload-prepare', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  completeImageUpload: (data: { asset_id: string; object_key: string }) =>
    request<Asset>('/api/v1/assets/image/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Groups API
export const groupsApi = {
  list: () => request<Group[]>('/api/v1/groups'),

  get: (id: string) => request<Group>(`/api/v1/groups/${id}`),

  create: (data: { name: string; description?: string }) =>
    request<Group>('/api/v1/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Group>) =>
    request<Group>(`/api/v1/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/v1/groups/${id}`, { method: 'DELETE' }),

  getMembers: (id: string) =>
    request<GroupMembersResponse>(`/api/v1/groups/${id}/members`),

  addMember: (id: string, data: { user_id?: string; bot_id?: string; nickname?: string }) =>
    request<void>(`/api/v1/groups/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeMember: (id: string, userId: string) =>
    request<void>(`/api/v1/groups/${id}/members/${userId}`, {
      method: 'DELETE',
    }),
}

// Health check
export const healthApi = {
  check: () => request<{ status: string }>('/health'),
}

export { getToken }
