import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BackgroundType = 'default' | 'dark' | 'nature' | 'sunset' | 'ocean' | 'minimal'
export type FontType = 'sans' | 'serif' | 'mono' | 'roboto' | 'open-sans'

interface AppearanceState {
  background: BackgroundType
  font: FontType
  setBackground: (background: BackgroundType) => void
  setFont: (font: FontType) => void
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      background: 'default',
      font: 'sans',
      setBackground: (background) => set({ background }),
      setFont: (font) => set({ font }),
    }),
    {
      name: 'appearance-settings',
    }
  )
)
