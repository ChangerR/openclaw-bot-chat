'use client'

import React from 'react'
import { Avatar } from '@/components/Avatar'
import { Markdown } from '@/components/Markdown'
import type { Message, User } from '@/lib/types'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
  showSenderName?: boolean
}

export function MessageBubble({ message, isOwn, showSenderName }: MessageBubbleProps) {
  const isBot = message.sender_type === 'bot'
  const isSystem = message.sender_type === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="px-4 py-1 bg-slate-100 rounded-full text-xs text-slate-500 font-medium">
          {message.content.body}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex w-full mb-6 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[80%] ${isOwn ? 'flex-row-reverse' : 'flex-row'} items-end gap-3`}>
        {!isOwn && (
          <Avatar
            name={message.from.name || 'Bot'}
            src={message.from.avatar}
            size="sm"
            className="flex-shrink-0 mb-1"
          />
        )}
        
        <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
          {showSenderName && !isOwn && (
            <span className="text-xs text-slate-500 mb-1 ml-1 font-medium">
              {message.from.name}
            </span>
          )}
          
          <div
            className={`px-4 py-3 shadow-sm transition-all ${
              isOwn
                ? 'bg-[#0EA5E9] text-white rounded-[16px_16px_4px_16px]'
                : isBot
                ? 'bg-sky-50 text-slate-800 rounded-[16px_16px_16px_4px] border border-sky-100'
                : 'bg-slate-100 text-slate-800 rounded-[16px_16px_16px_4px] border border-slate-200'
            }`}
          >
            {message.content.type === 'text' && (
              <div className={`prose prose-sm max-w-none ${isOwn ? 'prose-invert' : 'prose-slate'}`}>
                <Markdown content={message.content.body || ''} />
              </div>
            )}
            
            {message.content.type === 'image' && (
              <div className="rounded-lg overflow-hidden max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={message.content.url} alt="Sent image" className="w-full h-auto object-cover" />
              </div>
            )}
          </div>
          
          <span className="text-[10px] text-slate-400 mt-1 mx-1 uppercase tracking-tighter font-medium">
            {message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            {message.pending && ' • Sending...'}
            {message.failed && ' • Failed'}
          </span>
        </div>
      </div>
    </div>
  )
}
