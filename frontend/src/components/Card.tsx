'use client'

import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export function Card({ children, className = '', onClick, hoverable = false }: CardProps) {
  const baseStyles = 'bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden'
  const hoverStyles = hoverable || onClick
    ? 'hover:shadow-lg hover:shadow-slate-200/50 hover:border-sky-200 cursor-pointer transition-all duration-300'
    : ''

  return (
    <div
      className={`${baseStyles} ${hoverStyles} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-5 border-b border-slate-50 ${className}`}>
      {children}
    </div>
  )
}

export function CardContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-8 py-6 ${className}`}>{children}</div>
}

export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-8 py-5 border-t border-slate-50 bg-slate-50/50 rounded-b-3xl ${className}`}>
      {children}
    </div>
  )
}
