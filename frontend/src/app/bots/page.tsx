'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useChat } from '@/contexts/ChatContext'
import { botsApi } from '@/lib/api'
import { AppLayout } from '@/components/AppLayout'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Avatar } from '@/components/Avatar'
import { Modal } from '@/components/Modal'
import { LoadingPage, LoadingSpinner } from '@/components/Loading'
import { ConversationItem } from '@/components/Chat/ConversationItem'
import { MessageBubble } from '@/components/Chat/MessageBubble'
import { ChatInput } from '@/components/Chat/ChatInput'
import type { Bot, BotKey } from '@/lib/types'

export default function BotsPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  const {
    bots,
    currentConversation,
    messages,
    openBotConversation,
    sendMessage,
    refreshBots,
    refreshMessages,
    connectionState,
  } = useChat()
  
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState<'chat' | 'create' | 'edit' | 'keys'>('chat')
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null)
  const [showKeyModalBot, setShowKeyModalBot] = useState<Bot | null>(null)
  const [runtimeActivity, setRuntimeActivity] = useState<Record<string, string | null>>({})
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = '/login'
    }
  }, [authLoading, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated) {
      void refreshBots()
    }
  }, [isAuthenticated, refreshBots])

  useEffect(() => {
    if (currentConversation && currentConversation.type === 'bot') {
      void refreshMessages(currentConversation.id)
      const bot = bots.find(b => b.id === currentConversation.target.id)
      if (bot) setSelectedBot(bot)
      setView('chat')
    }
  }, [currentConversation, refreshMessages, bots])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentConversation])

  const filteredBots = bots.filter(bot => 
    bot.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleBotClick = (bot: Bot) => {
    openBotConversation(bot)
    setSelectedBot(bot)
    setView('chat')
  }

  const currentMessages = currentConversation ? messages.get(currentConversation.id) || [] : []

  if (authLoading) return <LoadingPage />
  if (!isAuthenticated) return null

  return (
    <AppLayout>
      {/* Column 2: Bot List */}
      <aside className="w-[300px] h-screen bg-white/65 backdrop-blur-xl border-r border-white/20 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/20 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Bots</h2>
            <button
              onClick={() => setView('create')}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-sky-500 text-white shadow-sm hover:bg-sky-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="Search bots..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/50 border border-white/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all"
            />
            <svg className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {filteredBots.length === 0 ? (
            <div className="p-8 text-center text-slate-400 space-y-2">
              <p className="text-sm font-medium">No bots found</p>
              <Button size="sm" variant="ghost" onClick={() => setView('create')}>Create one</Button>
            </div>
          ) : (
            filteredBots.map(bot => (
              <ConversationItem
                key={bot.id}
                name={bot.name}
                avatar={bot.avatar}
                isActive={selectedBot?.id === bot.id && view === 'chat'}
                onClick={() => handleBotClick(bot)}
                status="none" // TODO: Implement real-time status if available
                lastMessage={bot.description || ''}
              />
            ))
          )}
        </div>
      </aside>

      {/* Column 3: Main Area */}
      <section className="flex-1 h-screen flex flex-col bg-white/95 relative overflow-hidden">
        {view === 'chat' && currentConversation ? (
          <>
            {/* Chat Header */}
            <header className="h-[72px] px-6 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-md z-10">
              <div className="flex items-center gap-3">
                <Avatar name={currentConversation.name} src={currentConversation.avatar} size="md" />
                <div>
                  <h3 className="font-bold text-slate-800">{currentConversation.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-[#10B981]' : 'bg-amber-400'}`} />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {connectionState === 'connected' ? 'Bot Online' : 'Connecting...'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView('edit')}
                  className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 transition-all rounded-xl"
                  title="Bot Settings"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
              {currentMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-4 opacity-60">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium italic">Start your conversation with {selectedBot?.name}</p>
                </div>
              ) : (
                <>
                  {currentMessages.map((msg, index) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={msg.sender_id === user?.id}
                      showSenderName={false}
                      mentions={bots.map(b => b.name)}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <ChatInput onSendMessage={sendMessage} placeholder={`Message ${selectedBot?.name}...`} />
          </>
        ) : view === 'create' || view === 'edit' ? (
          <div className="flex-1 overflow-y-auto p-12 max-w-2xl mx-auto w-full">
            <header className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
                {view === 'create' ? 'Create New Bot' : `Configure ${selectedBot?.name}`}
              </h2>
              <p className="text-slate-500 mt-1">
                {view === 'create' ? 'Give your AI bot a name and personality.' : 'Update your bot details and manage API keys.'}
              </p>
            </header>
            
            <CreateEditBotForm
              bot={view === 'edit' ? selectedBot : null}
              onCancel={() => setView('chat')}
              onSuccess={(bot) => {
                void refreshBots()
                setSelectedBot(bot)
                setView('chat')
              }}
              onShowKeys={(bot) => setShowKeyModalBot(bot)}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-6">
            <div className="w-32 h-32 bg-slate-50 rounded-3xl flex items-center justify-center shadow-inner">
               <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-400">Select a bot to start chatting</h3>
              <p className="text-sm">Or create a new one using the button in the side list.</p>
            </div>
          </div>
        )}
      </section>

      {/* Keys Modal */}
      {showKeyModalBot && (
        <BotKeysModal
          isOpen={true}
          onClose={() => setShowKeyModalBot(null)}
          bot={showKeyModalBot}
        />
      )}
    </AppLayout>
  )
}

function CreateEditBotForm({
  bot,
  onCancel,
  onSuccess,
  onShowKeys
}: {
  bot: Bot | null
  onCancel: () => void
  onSuccess: (bot: Bot) => void
  onShowKeys: (bot: Bot) => void
}) {
  const [name, setName] = useState(bot?.name || '')
  const [description, setDescription] = useState(bot?.description || '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    
    setIsLoading(true)
    setError('')
    try {
      if (bot) {
        const updated = await botsApi.update(bot.id, { name, description })
        onSuccess(updated)
      } else {
        const created = await botsApi.create({ name, description })
        onSuccess(created)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bot')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 animate-pulse">
          {error}
        </div>
      )}
      
      <div className="space-y-4">
        <Input
          label="Display Name"
          placeholder="e.g. JARVIS"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-2xl border-slate-200"
        />
        
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-slate-700 ml-1">Bot Personality / Description</label>
          <textarea
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 min-h-[120px] transition-all"
            placeholder="Tell us about this bot's role..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <div className="flex gap-3">
          <Button type="submit" isLoading={isLoading} className="rounded-2xl px-8 shadow-lg shadow-sky-100">
            {bot ? 'Save Changes' : 'Create Bot'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="rounded-2xl">
            Cancel
          </Button>
        </div>
        
        {bot && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => onShowKeys(bot)}
            className="rounded-2xl bg-white border-slate-200"
          >
            Manage API Keys
          </Button>
        )}
      </div>
    </form>
  )
}

function BotKeysModal({
  isOpen,
  onClose,
  bot,
}: {
  isOpen: boolean
  onClose: () => void
  bot: Bot
}) {
  const [keys, setKeys] = useState<BotKey[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      void loadKeys()
    }
  }, [isOpen])

  const loadKeys = async () => {
    try {
      const data = await botsApi.listKeys(bot.id)
      setKeys(data)
    } catch (error) {
      console.error('Failed to load keys')
    }
  }

  const handleCreateKey = async () => {
    setIsLoading(true)
    try {
      const key = await botsApi.createKey(bot.id, { name: newKeyName || undefined })
      setKeys(prev => [...prev, key])
      setCreatedKey(key.key || null)
      setNewKeyName('')
    } catch (error) {
      alert('Failed to create key')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm('Revoke this key immediately?')) return
    try {
      await botsApi.deleteKey(bot.id, keyId)
      setKeys(prev => prev.filter(k => k.id !== keyId))
    } catch (error) {
      alert('Failed to delete key')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`API Keys: ${bot.name}`} size="lg">
      <div className="space-y-6 py-2">
        <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-sky-600 uppercase tracking-widest bg-white px-2 py-0.5 rounded-full shadow-sm">
              Runtime ID
            </span>
            <code className="text-sm font-mono text-sky-800 break-all">{bot.id}</code>
          </div>
          <p className="text-xs text-sky-700/70 leading-relaxed font-medium">
            Provide this ID to your bot plugin if bootstrap discovery is not configured.
          </p>
        </div>

        {createdKey && (
          <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-4 animate-in fade-in slide-in-from-top-4">
             <p className="text-sm font-bold text-emerald-800">New Key Created!</p>
             <code className="block bg-white p-3 rounded-xl border border-emerald-100 font-mono text-xs break-all shadow-sm">
              {createdKey}
            </code>
            <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-tight">
              Copy this now. You won&apos;t be able to see it again.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-slate-800 ml-1">Generate Key</h4>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Production Server"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 rounded-2xl border-slate-200"
            />
            <Button onClick={handleCreateKey} isLoading={isLoading} className="rounded-2xl px-6">
              Create
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-slate-800 ml-1">Active Keys</h4>
          <div className="space-y-2">
            {keys.length === 0 ? (
              <p className="text-center py-8 text-slate-400 text-sm italic bg-slate-50 rounded-2xl">No active keys found.</p>
            ) : (
              keys.map(key => (
                <div key={key.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group">
                  <div>
                    <p className="text-sm font-bold text-slate-700">{key.name || 'Unnamed Key'}</p>
                    <p className="text-[10px] font-mono text-slate-400 mt-1 uppercase">
                      {key.key_prefix}************************
                    </p>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => handleDeleteKey(key.id)} className="rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                    Revoke
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
