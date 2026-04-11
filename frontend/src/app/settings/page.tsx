'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/AppLayout'
import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Avatar } from '@/components/Avatar'
import { LoadingPage } from '@/components/Loading'
import { useAppearanceStore, BackgroundType, FontType } from '@/lib/store'

export default function SettingsPage() {
  const { isAuthenticated, isLoading: authLoading, user, updateUser, changePassword, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'notifications' | 'security'>('profile')
  const { background, font, setBackground, setFont } = useAppearanceStore()
  
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = '/login'
    }
  }, [authLoading, isAuthenticated])

  useEffect(() => {
    if (user) {
      setUsername(user.username)
      setEmail(user.email)
    }
  }, [user])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setProfileMessage('Username is required')
      return
    }

    setIsSavingProfile(true)
    setProfileMessage('')

    try {
      await updateUser({ username, email })
      setProfileMessage('Profile updated successfully!')
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : 'Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')

    if (!oldPassword) {
      setPasswordError('Current password is required')
      return
    }
    if (!newPassword) {
      setPasswordError('New password is required')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setIsSavingPassword(true)
    setPasswordMessage('')

    try {
      await changePassword(oldPassword, newPassword)
      setPasswordMessage('Password changed successfully!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Failed to change password')
    } finally {
      setIsSavingPassword(false)
    }
  }

  const handleLogout = async () => {
    if (confirm('Are you sure you want to logout?')) {
      await logout()
      window.location.href = '/login'
    }
  }

  if (authLoading) return <LoadingPage />
  if (!isAuthenticated || !user) return null

  return (
    <AppLayout>
      {/* Column 2: Settings Nav */}
      <aside className="w-[300px] h-screen bg-white/65 backdrop-blur-xl border-r border-white/20 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-white/20">
          <h2 className="text-xl font-bold text-slate-800 tracking-tight">Settings</h2>
        </div>
        <div className="p-2 space-y-1">
          <button 
            onClick={() => setActiveTab('profile')}
            className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'profile' ? 'bg-sky-500/10 text-sky-600' : 'text-slate-500 hover:bg-white/50'}`}
          >
            Account & Profile
          </button>
          <button 
            onClick={() => setActiveTab('appearance')}
            className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'appearance' ? 'bg-sky-500/10 text-sky-600' : 'text-slate-500 hover:bg-white/50'}`}
          >
            Appearance
          </button>
          <button 
            onClick={() => setActiveTab('notifications')}
            className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'notifications' ? 'bg-sky-500/10 text-sky-600' : 'text-slate-500 hover:bg-white/50'}`}
          >
            Notifications
          </button>
          <button 
            onClick={() => setActiveTab('security')}
            className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'security' ? 'bg-sky-500/10 text-sky-600' : 'text-slate-500 hover:bg-white/50'}`}
          >
            Security
          </button>
        </div>
      </aside>

      {/* Column 3: Main Settings Area */}
      <section className="flex-1 h-screen overflow-y-auto bg-white/95 p-12">
        <div className="max-w-2xl mx-auto space-y-12 pb-20">
          {activeTab === 'profile' && (
            <>
              <header>
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Account Settings</h1>
                <p className="text-slate-500 mt-1">Manage your profile and security preferences.</p>
              </header>

              {/* Profile Section */}
              <section className="space-y-6">
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">Profile Information</h2>
                <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-8">
                  <div className="flex items-center gap-6">
                    <Avatar name={user.username} size="xl" className="w-20 h-20 shadow-lg shadow-slate-100 ring-4 ring-slate-50" />
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">{user.username}</h3>
                      <p className="text-sm text-slate-400">{user.email}</p>
                      <Button size="sm" variant="ghost" className="mt-2 text-sky-500 font-bold px-0 hover:bg-transparent">Change Avatar</Button>
                    </div>
                  </div>

                  <form onSubmit={handleSaveProfile} className="space-y-6">
                    <Input
                      label="Username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="rounded-2xl"
                    />

                    <Input
                      type="email"
                      label="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-2xl"
                    />

                    {profileMessage && (
                      <div className={`p-4 rounded-2xl text-sm ${profileMessage.includes('success') ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                        {profileMessage}
                      </div>
                    )}

                    <Button type="submit" isLoading={isSavingProfile} className="rounded-2xl px-8 shadow-lg shadow-sky-50">
                      Save Profile Changes
                    </Button>
                  </form>
                </div>
              </section>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <header>
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Appearance</h1>
                <p className="text-slate-500 mt-1">Customize how the application looks and feels.</p>
              </header>

              <section className="space-y-8">
                <div>
                  <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1 mb-4">Background Theme</h2>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { id: 'default', name: 'Default', colors: 'bg-slate-100' },
                      { id: 'dark', name: 'Dark Night', colors: 'bg-slate-900' },
                      { id: 'nature', name: 'Nature', colors: 'bg-emerald-100' },
                      { id: 'sunset', name: 'Sunset', colors: 'bg-orange-100' },
                      { id: 'ocean', name: 'Ocean', colors: 'bg-sky-100' },
                      { id: 'minimal', name: 'Minimal', colors: 'bg-white border' },
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setBackground(theme.id as BackgroundType)}
                        className={`p-4 rounded-2xl border-2 transition-all text-left space-y-2 ${background === theme.id ? 'border-sky-500 bg-sky-50/50' : 'border-transparent bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <div className={`w-full h-12 rounded-lg ${theme.colors}`} />
                        <span className="text-sm font-bold text-slate-700 block text-center">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1 mb-4">Typography</h2>
                  <div className="space-y-2">
                    {[
                      { id: 'sans', name: 'Inter (Default)', class: 'font-sans' },
                      { id: 'roboto', name: 'Roboto', class: 'font-sans' },
                      { id: 'open-sans', name: 'Open Sans', class: 'font-sans' },
                      { id: 'serif', name: 'Playfair Display (Serif)', class: 'font-serif' },
                      { id: 'mono', name: 'Fira Code (Monospace)', class: 'font-mono' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFont(f.id as FontType)}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${font === f.id ? 'border-sky-500 bg-sky-50/50' : 'border-transparent bg-slate-50 hover:bg-slate-100'}`}
                      >
                        <span className={`text-lg ${f.class} text-slate-700`}>{f.name}</span>
                        {font === f.id && <div className="w-2 h-2 rounded-full bg-sky-500" />}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === 'security' && (
            <>
              <header>
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Security Settings</h1>
                <p className="text-slate-500 mt-1">Manage your password and account security.</p>
              </header>

              {/* Password Section */}
              <section className="space-y-6">
                <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest ml-1">Change Password</h2>
                <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-6">
                  <form onSubmit={handleChangePassword} className="space-y-6">
                    <Input
                      type="password"
                      label="Current Password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      autoComplete="current-password"
                      className="rounded-2xl"
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="password"
                        label="New Password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        className="rounded-2xl"
                      />
                      <Input
                        type="password"
                        label="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        className="rounded-2xl"
                      />
                    </div>

                    {passwordError && (
                      <div className="p-4 bg-red-50 text-red-700 text-sm rounded-2xl border border-red-100">
                        {passwordError}
                      </div>
                    )}

                    {passwordMessage && (
                      <div className="p-4 bg-green-50 text-green-700 text-sm rounded-2xl border border-green-100">
                        {passwordMessage}
                      </div>
                    )}

                    <Button type="submit" isLoading={isSavingPassword} className="rounded-2xl px-8 shadow-lg shadow-sky-50">
                      Update Password
                    </Button>
                  </form>
                </div>
              </section>

              {/* Danger Zone */}
              <section className="space-y-6 pt-6">
                <h2 className="text-sm font-black text-red-400 uppercase tracking-widest ml-1">Danger Zone</h2>
                <div className="bg-red-50 rounded-3xl p-8 border border-red-100 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-red-900">Sign Out</h4>
                    <p className="text-sm text-red-600/70">Sign out of your account on this device.</p>
                  </div>
                  <Button variant="danger" onClick={handleLogout} className="rounded-2xl px-8 shadow-lg shadow-red-100">
                    Logout
                  </Button>
                </div>
              </section>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <header>
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Notifications</h1>
                <p className="text-slate-500 mt-1">Configure how you receive updates and messages.</p>
              </header>
              <div className="bg-white rounded-3xl p-12 border border-slate-100 text-center space-y-4">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-2xl">🔔</div>
                <h3 className="text-xl font-bold text-slate-800">Notification settings coming soon</h3>
                <p className="text-slate-400 max-w-sm mx-auto">We are working on bringing desktop and email notifications to the platform.</p>
              </div>
            </>
          )}
        </div>
      </section>
    </AppLayout>
  )
}
