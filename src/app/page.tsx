'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import AppShell from '@/components/AppShell'

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    // Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn() {
    if (!email || !password) return
    setSigningIn(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Incorrect email or password.')
    setSigningIn(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  if (loading) {
    return <div className="loading">Loading…</div>
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">Product Master</div>
          <div className="auth-sub">Sign in to continue</div>
          <label className="auth-label">Email</label>
          <input
            className="auth-input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="you@company.com"
            autoComplete="username"
          />
          <label className="auth-label">Password</label>
          <input
            className="auth-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && signIn()}
            placeholder="Password"
            autoComplete="current-password"
          />
          <button className="auth-btn" onClick={signIn} disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign In'}
          </button>
          {error && <div className="auth-error">{error}</div>}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
            Access limited to authorised team members. Contact admin to request access.
          </div>
        </div>
      </div>
    )
  }

  return <AppShell user={user} onSignOut={signOut} />
}
