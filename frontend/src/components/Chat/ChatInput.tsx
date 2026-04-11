'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Avatar } from '@/components/Avatar'
import { useChat } from '@/contexts/ChatContext'
import { assetsApi } from '@/lib/api'
import { Bot, ComposerMessageInput } from '@/lib/types'

interface ChatInputProps {
  onSendMessage: (input: ComposerMessageInput) => Promise<void>
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSendMessage, disabled, placeholder = 'Type a message...' }: ChatInputProps) {
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { bots, currentConversation } = useChat()
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filteredBots = bots.filter((bot) =>
    bot.name.toLowerCase().includes(mentionQuery.toLowerCase())
  )

  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [content])

  const handleScroll = () => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  // Reset selected index if filtered results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [mentionQuery])

  const handleSend = async () => {
    if (!content.trim() || isSending || isUploading || disabled) return
    
    setIsSending(true)
    try {
      await onSendMessage({ type: 'text', body: content.trim() })
      setContent('')
      setMentionActive(false)
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsSending(false)
    }
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentConversation || disabled || isSending || isUploading) {
      e.target.value = ''
      return
    }

    setIsUploading(true)
    try {
      const prepared = await assetsApi.prepareImageUpload({
        file_name: file.name,
        content_type: file.type,
        size: file.size,
        conversation_id: currentConversation.send_topic,
      })

      const uploadResponse = await fetch(prepared.upload.url, {
        method: prepared.upload.method || 'PUT',
        headers: prepared.upload.headers,
        body: file,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`)
      }

      const asset = await assetsApi.completeImageUpload({
        asset_id: prepared.asset.id || '',
        object_key: prepared.asset.object_key || '',
      })

      await onSendMessage({
        type: 'image',
        body: content.trim() || file.name,
        asset,
      })
      setContent('')
      setMentionActive(false)
    } catch (error) {
      console.error('Failed to upload image:', error)
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }

  const insertMention = (bot: Bot) => {
    const beforeMention = content.slice(0, mentionStartIndex)
    const mentionText = `@${bot.name} `
    const cursorPosition = textareaRef.current?.selectionStart || content.length
    const afterMention = content.slice(cursorPosition)
    
    const newContent = beforeMention + mentionText + afterMention
    setContent(newContent)
    setMentionActive(false)
    setMentionQuery('')
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newCursorPos = beforeMention.length + mentionText.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const checkMentionState = (target: HTMLTextAreaElement) => {
    const value = target.value
    const cursorPosition = target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPosition)
    const wordsBeforeCursor = textBeforeCursor.split(/[\s\n]+/)
    const currentWord = wordsBeforeCursor[wordsBeforeCursor.length - 1]
    
    if (currentWord.startsWith('@')) {
      setMentionActive(true)
      setMentionQuery(currentWord.slice(1))
      const wordStartIndex = textBeforeCursor.length - currentWord.length
      setMentionStartIndex(wordStartIndex)
    } else {
      setMentionActive(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    checkMentionState(e.target)
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    // Also check mention state when cursor moves via click or arrow keys
    checkMentionState(e.target as HTMLTextAreaElement)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && filteredBots.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredBots.length - 1))
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredBots.length - 1 ? prev + 1 : 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredBots[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionActive(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const renderHighlights = (text: string) => {
    if (!text) {
      return <span className="text-slate-400">{placeholder}</span>;
    }
    
    const escapedMentions = bots
      .map(m => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|');
      
    // Basic match for mentioning known bots
    const regex = escapedMentions ? new RegExp(`(@(?:${escapedMentions}))`, 'g') : /(@[a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g;
    
    const parts = text.split(regex);
    return parts.map((part, i) => {
      // Re-evaluate regex on the part to check if it's a match
      const isMatch = escapedMentions ? new RegExp(`^(@(?:${escapedMentions}))$`).test(part) : /^(@[a-zA-Z0-9_\-\u4e00-\u9fa5]+)$/.test(part);
      if (isMatch) {
        return (
          <span key={i} className="bg-indigo-100 text-indigo-700 rounded px-0.5 font-bold">
            {part}
          </span>
        );
      }
      return <span key={i} className="text-slate-700">{part}</span>;
    });
  }

  return (
    <div className="px-6 py-4 bg-white/50 border-t border-slate-200/50 backdrop-blur-sm relative">
      {/* Auto-complete Popup */}
      {mentionActive && filteredBots.length > 0 && (
        <div className="absolute bottom-full left-6 mb-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50 animate-in slide-in-from-bottom-2">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Mention Bot
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {filteredBots.map((bot, index) => (
              <button
                key={bot.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(bot);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  index === selectedIndex ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
              >
                <Avatar name={bot.name} src={bot.avatar || undefined} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold truncate ${index === selectedIndex ? 'text-sky-600' : 'text-slate-700'}`}>
                    {bot.name}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-3 bg-white p-2 pr-2.5 rounded-2xl shadow-sm border border-slate-200/50 focus-within:ring-2 focus-within:ring-[#0EA5E9]/20 transition-all">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            void handleImageSelect(e)
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending || isUploading || !currentConversation}
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
            !disabled && !isSending && !isUploading && currentConversation
              ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              : 'bg-slate-100 text-slate-300'
          }`}
          title="Upload image"
        >
          {isUploading ? (
            <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-10h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        <div className="relative flex-1">
          {/* Highlights Overlay */}
          <div 
            ref={overlayRef}
            className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words overflow-hidden py-2 px-3 m-0 border-none font-inherit"
            style={{ 
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit'
            }}
            aria-hidden="true"
          >
            {renderHighlights(content)}
            {/* Add a trailing space if content ends with newline to keep scrolling in sync */}
            {content.endsWith('\n') ? <br /> : null}
          </div>
          
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onSelect={handleSelect}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onBlur={() => setMentionActive(false)}
            disabled={disabled || isSending || isUploading}
            rows={1}
            className="w-full bg-transparent border-none focus:ring-0 resize-none py-2 px-3 placeholder:text-transparent max-h-[200px] relative z-10 m-0"
            style={{ color: 'transparent', caretColor: '#334155' }}
          />
        </div>
        <button
          onClick={() => void handleSend()}
          disabled={!content.trim() || isSending || isUploading || disabled}
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${
            content.trim() && !isSending && !isUploading && !disabled
              ? 'bg-[#0EA5E9] text-white shadow-lg shadow-sky-200 hover:scale-105 active:scale-95'
              : 'bg-slate-100 text-slate-400'
          }`}
        >
          {isSending ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
