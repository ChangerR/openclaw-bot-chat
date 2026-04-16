import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { ChatProvider } from '@/contexts/ChatContext'
import { ThemeProvider } from '@/components/ThemeProvider'

export const metadata: Metadata = {
  title: 'BotChat - AI Chat Platform',
  description: 'Chat with AI bots and manage your conversations',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-theme-sans antialiased">
        <AuthProvider>
          <ChatProvider>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </ChatProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
