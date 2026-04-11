'use client'

import React, { useEffect } from 'react'
import { useAppearanceStore } from '@/lib/store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { background, font } = useAppearanceStore()

  useEffect(() => {
    // Apply background theme to body
    const body = document.body
    
    // Remove all existing theme classes
    const themeClasses = Array.from(body.classList).filter(c => c.startsWith('bg-theme-'))
    body.classList.remove(...themeClasses)
    
    // Add current theme class
    body.classList.add(`bg-theme-${background}`)
    
    // Apply font theme
    const fontClasses = Array.from(body.classList).filter(c => c.startsWith('font-theme-'))
    body.classList.remove(...fontClasses)
    body.classList.add(`font-theme-${font}`)
  }, [background, font])

  return <>{children}</>
}
