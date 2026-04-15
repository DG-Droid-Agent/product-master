'use client'
// components/ppc/PPCDashboard.tsx
// Wrapper that renders the PPC module inside the existing AppShell tab system.
// Mirrors the pattern used by InventoryDashboard.

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'

type PPCView = 'home' | 'upload' | 'analysis' | 'decisions'

interface AnalysisRun {
  id: string
  run_name: string
  brand: string
  date_range_days: number
  total_spend: number
  total_wasted: number
  high_negatives: number
  harvest_candidates: number
  run_at: string
}

export default function PPCDashboard({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const [view, setView]             = useState<PPCView>('home')
  const [recentRuns, setRecentRuns] = useState<AnalysisRun[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [orgId, setOrgId]           = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
      if (!org) return
      setOrgId(org.id)

      const [{ data: runs }, { count }] = await Promise.all([
        supabase.from('ppc_analysis_runs')
          .select('*').eq('org_id', org.id)
          .order('run_at', { ascending: false }).limit(5),
        supabase.from('ppc_decisions_log')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', org.id).eq('status', 'pending'),
      ])
      setRecentRuns(runs ?? [])
      setPendingCount(count ?? 0)
      setLoading(false)
    }
    load()
  }, [])

  // ── HOME VIEW ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>PPC — Negative targeting & keyword harvesting</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            Upload search term reports · Find wasted spend to negate · Discover keywords to push
          </div>
        </div>
        <button className="btn-primary" onClick={() => setView('upload')}>
          ＋ New analysis
        </button>
      </div>

      {/* Quick action cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { icon: '📂', title: 'Upload & analyse', desc: 'Upload search term reports and run n-gram analysis', action: () => setView('upload') },
          { icon: '📋', title: 'Decisions log', desc: `Track what was actioned, when, and in which campaigns${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`, action: () => setView('decisions'), highlight: pendingCount > 0 },
          { icon: '⏳', title: 'Pending decisions', desc: pendingCount > 0 ? `${pendingCount} decisions awaiting action in Amazon` : 'All decisions actioned', action: () => setView('decisions'), highlight: pendingCount > 0 },
        ].map(card => (
          <div key={card.title}
            onClick={card.action}
            style={{
              background: card.highlight ? 'rgba(234,164,44,.08)' : 'var(--surface)',
              border: `1px solid ${card.highlight ? 'rgba(234,164,44,.35)' : 'var(--border)'}`,
              borderRadius: 8, padding: 16, cursor: 'pointer', transition: 'all .15s'
            }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{card.title}</div>
            <div style={{ fontSize: 11, color: card.highlight ? 'var(--amber,#b45309)' : 'var(--text3)' }}>{card.desc}</div>
          </div>
        ))}
      </div>

      {/* Recent runs */}
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 10 }}>
        Recent analysis runs
      </div>

      {loading ? (
        <div className="loading">⟳ Loading…</div>
      ) : recentRuns.length === 0 ? (
        <div className="empty" style={{ height: 120 }}>
          <div className="ei">🎯</div>
          <div>No analysis runs yet — upload your first search term report</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recentRuns.map(run => (
            <div key={run.id}
              onClick={() => setView('decisions')}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{run.run_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, display: 'flex', gap: 14 }}>
                  {run.brand && <span>{run.brand}</span>}
                  <span>{run.date_range_days}-day report</span>
                  <span>${run.total_spend?.toFixed(2)} spend</span>
                  <span style={{ color: 'var(--red)' }}>${run.total_wasted?.toFixed(2)} wasted</span>
                  <span>{run.high_negatives} HIGH negatives</span>
                  <span>{run.harvest_candidates} harvest candidates</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {new Date(run.run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>View decisions →</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ── OTHER VIEWS — iframe into the Next.js app pages ────────────────────────
  // The full Upload / Analysis / Decisions pages are proper Next.js pages at /ppc/*
  // We open them in the same window via router push from here.
  // Simpler: use window.location since these are full pages, not components.

  const VIEW_URLS: Record<string, string> = {
  upload:    '/ppc/upload',
  analysis:  '/ppc/analysis',
  decisions: '/ppc/decisions',
}

if (typeof window !== 'undefined') {
  window.location.href = VIEW_URLS[view] ?? '/ppc'
}
return <div className="loading">⟳ Loading…</div>
}
