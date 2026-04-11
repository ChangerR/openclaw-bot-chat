'use client'

import React from 'react'
import { Avatar } from '@/components/Avatar'
import type { Bot, Group, Conversation } from '@/lib/types'

interface ConversationItemProps {
  name: string
  avatar?: string | null
  lastMessage?: string
  timestamp?: string
  isActive?: boolean
  onClick: () => void
  status?: 'online' | 'offline' | 'none'
  unreadCount?: number
}

export function ConversationItem({
  name,
  avatar,
  lastMessage,
  timestamp,
  isActive,
  onClick,
  status = 'none',
  unreadCount = 0,
}: ConversationItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full h-[72px] flex items-center gap-3 px-4 transition-all duration-200 group relative ${
        isActive
          ? 'bg-[#0EA5E9]/10'
          : 'hover:bg-white/50'
      }`}
    >
      {isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#0EA5E9]" />
      )}
      
      <div className="relative flex-shrink-0">
        <Avatar name={name} src={avatar} size="md" className="w-10 h-10" />
        {status !== 'none' && (
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
            status === 'online' ? 'bg-[#10B981]' : 'bg-[#94A3B8]'
          }`} />
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-0.5">
          <h4 className={`text-sm font-semibold truncate ${isActive ? 'text-[#0EA5E9]' : 'text-slate-900'}`}>
            {name}
          </h4>
          {timestamp && (
            <span className="text-[10px] text-slate-400 font-medium">
              {timestamp}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <p className="text-xs text-slate-500 truncate pr-4">
            {lastMessage || 'No messages yet'}
          </p>
          {unreadCount > 0 && (
            <span className="bg-[#0EA5E9] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
