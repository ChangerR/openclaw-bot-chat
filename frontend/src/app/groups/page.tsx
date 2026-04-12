'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useChat } from '@/contexts/ChatContext'
import { groupsApi } from '@/lib/api'
import { AppLayout } from '@/components/AppLayout'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Avatar } from '@/components/Avatar'
import { LoadingPage } from '@/components/Loading'
import { ConversationItem } from '@/components/Chat/ConversationItem'
import { MessageBubble } from '@/components/Chat/MessageBubble'
import { ChatInput } from '@/components/Chat/ChatInput'
import type { Group, GroupMember } from '@/lib/types'

export default function GroupsPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, user } = useAuth()
  const {
    groups,
    bots,
    currentConversation,
    messages,
    openGroupConversation,
    sendMessage,
    refreshGroups,
    refreshMessages,
    connectionState,
  } = useChat()
  
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState<'chat' | 'create'>('chat')
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [showDrawer, setShowDrawer] = useState(false)
  const [showMobileList, setShowMobileList] = useState(true)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = '/login'
    }
  }, [authLoading, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated) {
      void refreshGroups()
    }
  }, [isAuthenticated, refreshGroups])

  useEffect(() => {
    if (currentConversation && currentConversation.type === 'group') {
      void refreshMessages(currentConversation.id)
      const group = groups.find(g => g.id === currentConversation.target.id)
      if (group) setSelectedGroup(group)
      setView('chat')
    }
  }, [currentConversation, refreshMessages, groups])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentConversation])

  const filteredGroups = groups.filter(group => 
    group.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleGroupClick = (group: Group) => {
    openGroupConversation(group)
    setSelectedGroup(group)
    setView('chat')
    setShowDrawer(false)
    setShowMobileList(false)
  }

  const currentMessages = currentConversation ? messages.get(currentConversation.id) || [] : []

  if (authLoading) return <LoadingPage />
  if (!isAuthenticated) return null

  return (
    <AppLayout>
      {/* Column 2: Group List */}
      <aside className={`w-full md:w-[300px] h-full bg-white/65 backdrop-blur-xl border-r border-white/20 flex flex-col overflow-hidden flex-shrink-0 ${showMobileList ? 'flex' : 'hidden md:flex'}`}>
        <div className="p-4 border-b border-white/20 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Groups</h2>
            <button
              onClick={() => { setView('create'); setShowMobileList(false); }}
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
              placeholder="Search groups..."
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
          {filteredGroups.length === 0 ? (
            <div className="p-8 text-center text-slate-400 space-y-2">
              <p className="text-sm font-medium">No groups found</p>
              <Button size="sm" variant="ghost" onClick={() => { setView('create'); setShowMobileList(false); }}>Create one</Button>
            </div>
          ) : (
            filteredGroups.map(group => (
              <ConversationItem
                key={group.id}
                name={group.name}
                avatar={group.avatar}
                isActive={selectedGroup?.id === group.id && view === 'chat'}
                onClick={() => handleGroupClick(group)}
                lastMessage={group.description || ''}
              />
            ))
          )}
        </div>
      </aside>

      {/* Column 3: Main Area */}
      <section className={`flex-1 h-full flex flex-col bg-white/95 relative overflow-hidden ${!showMobileList ? 'flex' : 'hidden md:flex'}`}>
        {view === 'chat' && currentConversation ? (
          <>
            {/* Chat Header */}
            <header className="h-[60px] md:h-[72px] px-4 md:px-6 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-md z-10">
              <div className="flex items-center gap-2 md:gap-3">
                <button
                  onClick={() => setShowMobileList(true)}
                  className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-sky-500 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <Avatar name={currentConversation.name} src={currentConversation.avatar} size="md" />
                <div>
                  <h3 className="font-bold text-slate-800">{currentConversation.name}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {selectedGroup?.member_count || 0} Members
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDrawer(!showDrawer)}
                  className={`p-2 transition-all rounded-xl ${showDrawer ? 'text-sky-500 bg-sky-50' : 'text-slate-400 hover:text-sky-500 hover:bg-sky-50'}`}
                  title="Group Info"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium italic">Start the conversation in {selectedGroup?.name}</p>
                </div>
              ) : (
                <>
                  {currentMessages.map((msg, index) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={msg.sender_id === user?.id}
                      showSenderName={true}
                      mentions={bots.map(b => b.name)}
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <ChatInput onSendMessage={sendMessage} placeholder={`Message ${selectedGroup?.name}...`} />
          </>
        ) : view === 'create' ? (
          <div className="flex-1 overflow-y-auto p-12 max-w-2xl mx-auto w-full">
            <header className="mb-6 md:mb-8 flex items-start gap-3">
              <button onClick={() => { setView('chat'); setShowMobileList(true); }} className="md:hidden mt-1 p-1 -ml-2 text-slate-400 hover:text-sky-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">Create New Group</h2>
              <p className="text-slate-500 mt-1">Bring your bots together in one conversation.</p>
            </div>
            </header>
            
            <CreateGroupForm
              onCancel={() => { setView('chat'); setShowMobileList(true); }}
              onSuccess={() => {
                void refreshGroups()
                setView('chat')
                setShowMobileList(false)
              }}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-6">
            <div className="w-32 h-32 bg-slate-50 rounded-3xl flex items-center justify-center shadow-inner">
               <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-400">Select a group to start chatting</h3>
              <p className="text-sm">Or create a new one using the button in the side list.</p>
            </div>
          </div>
        )}

        {/* Column 4: Right Drawer */}
        {selectedGroup && (
          <div 
            className={`absolute right-0 top-0 h-full w-full md:w-[320px] bg-white shadow-2xl md:border-l border-slate-100 transition-transform duration-300 z-20 ${showDrawer ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <GroupDrawer
              group={selectedGroup}
              onClose={() => setShowDrawer(false)}
              onUpdate={() => {
                void refreshGroups()
              }}
              currentUserId={user?.id || ''}
            />
          </div>
        )}
      </section>
    </AppLayout>
  )
}

function CreateGroupForm({
  onCancel,
  onSuccess
}: {
  onCancel: () => void
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    
    setIsLoading(true)
    setError('')
    try {
      await groupsApi.create({ name, description })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
          {error}
        </div>
      )}
      
      <div className="space-y-4">
        <Input
          label="Group Name"
          placeholder="e.g. AI Council"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-2xl border-slate-200"
        />
        
        <div className="space-y-1.5">
          <label className="text-sm font-bold text-slate-700 ml-1">Description</label>
          <textarea
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 min-h-[100px] transition-all"
            placeholder="What's this group for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-4 border-t border-slate-100">
        <Button type="submit" isLoading={isLoading} className="rounded-2xl px-8 shadow-lg shadow-sky-100">
          Create Group
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="rounded-2xl">
          Cancel
        </Button>
      </div>
    </form>
  )
}

function GroupDrawer({
  group,
  onClose,
  onUpdate,
  currentUserId
}: {
  group: Group
  onClose: () => void
  onUpdate: () => void
  currentUserId: string
}) {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newMemberId, setNewMemberId] = useState('')
  const [memberType, setMemberType] = useState<'user' | 'bot'>('user')
  const [isAdding, setIsAdding] = useState(false)

  useEffect(() => {
    void loadMembers()
  }, [group.id])

  const loadMembers = async () => {
    setIsLoading(true)
    try {
      const data = await groupsApi.getMembers(group.id)
      setMembers([
        ...(data.users || []).map(m => ({ ...m, type: 'user' as const })),
        ...(data.bots || []).map(m => ({ ...m, type: 'bot' as const }))
      ])
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddMember = async () => {
    if (!newMemberId.trim()) return
    setIsAdding(true)
    try {
      await groupsApi.addMember(group.id, memberType === 'user' ? { user_id: newMemberId } : { bot_id: newMemberId })
      setNewMemberId('')
      setShowAdd(false)
      void loadMembers()
      onUpdate()
    } catch (e) {
      alert('Failed to add member')
    } finally {
      setIsAdding(false)
    }
  }

  const isOwner = group.owner_id === currentUserId

  return (
    <div className="flex flex-col h-full">
      <header className="h-[72px] px-6 flex items-center justify-between border-b border-slate-100">
        <h3 className="font-bold text-slate-800">Group Details</h3>
        <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
             <Avatar name={group.name} src={group.avatar} size="lg" className="w-20 h-20 shadow-xl shadow-slate-200" />
             <div className="text-center">
                <h4 className="text-lg font-bold text-slate-800">{group.name}</h4>
                <p className="text-xs text-slate-400 font-medium">{group.description || 'No description'}</p>
             </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Members</h4>
            {isOwner && (
              <button 
                onClick={() => setShowAdd(!showAdd)}
                className="text-xs font-bold text-sky-500 hover:text-sky-600"
              >
                {showAdd ? 'Cancel' : '+ Add'}
              </button>
            )}
          </div>

          {showAdd && (
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
               <div className="flex gap-2">
                 <button 
                  onClick={() => setMemberType('user')}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tighter rounded-lg transition-all ${memberType === 'user' ? 'bg-sky-500 text-white shadow-md shadow-sky-100' : 'bg-white text-slate-400 border border-slate-200'}`}
                 >
                   User
                 </button>
                 <button 
                  onClick={() => setMemberType('bot')}
                  className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tighter rounded-lg transition-all ${memberType === 'bot' ? 'bg-sky-500 text-white shadow-md shadow-sky-100' : 'bg-white text-slate-400 border border-slate-200'}`}
                 >
                   Bot
                 </button>
               </div>
               <div className="flex gap-2">
                 <input 
                  type="text"
                  placeholder={`Enter ${memberType} ID`}
                  value={newMemberId}
                  onChange={e => setNewMemberId(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                 />
                 <button 
                  onClick={handleAddMember}
                  disabled={!newMemberId || isAdding}
                  className="px-3 py-2 bg-sky-500 text-white rounded-xl disabled:bg-slate-200 shadow-sm"
                 >
                   {isAdding ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Add'}
                 </button>
               </div>
            </div>
          )}

          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-4 text-slate-300 italic text-sm">Loading members...</div>
            ) : members.map(m => (
              <div key={m.id} className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <Avatar name={m.user?.username || m.bot?.name || 'User'} size="sm" />
                  <div>
                    <p className="text-sm font-bold text-slate-700">{m.user?.username || m.bot?.name || 'Unknown'}</p>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{m.role}{m.type === 'bot' && ' • BOT'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
