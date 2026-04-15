'use client'
// app/ppc/decisions/page.tsx

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const STATUS: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  pending:       { label: 'Pending review',       icon: '⏳', color: '#b45309', bg: 'rgba(180,83,9,.08)',    border: 'rgba(180,83,9,.2)'    },
  actioned:      { label: 'Actioned in Amazon',    icon: '✅', color: '#166534', bg: 'rgba(22,101,52,.08)',   border: 'rgba(22,101,52,.2)'   },
  not_actioning: { label: 'Not actioning',         icon: '⏸', color: '#6b7280', bg: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.2)' },
  reversed:      { label: 'Reversed',             icon: '↩️', color: '#dc2626', bg: 'rgba(220,38,38,.08)',   border: 'rgba(220,38,38,.2)'   },
}

const MT_LABELS: Record<string, string> = {
  negative_phrase: 'Neg · Phrase', negative_exact: 'Neg · Exact',
  harvest_exact: 'Harvest · Exact', harvest_phrase: 'Harvest · Phrase', harvest_broad: 'Harvest · Broad',
}
const MT_COLORS: Record<string, { color: string; bg: string }> = {
  negative_phrase: { color: '#dc2626', bg: 'rgba(220,38,38,.1)'   },
  negative_exact:  { color: '#b91c1c', bg: 'rgba(185,28,28,.08)'  },
  harvest_exact:   { color: '#166534', bg: 'rgba(22,101,52,.1)'   },
  harvest_phrase:  { color: '#166534', bg: 'rgba(22,101,52,.08)'  },
  harvest_broad:   { color: '#1d4ed8', bg: 'rgba(29,78,216,.08)'  },
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, color, background: bg, letterSpacing: '.04em', whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
      {children}
    </span>
  )
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10, color: s.color, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' as const, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {s.icon} {s.label}
    </span>
  )
}

function PPCDecisionsPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  const [orgId, setOrgId]         = useState<string | null>(null)
  const [brands, setBrands]       = useState<string[]>([])
  const [decisions, setDecisions] = useState<any[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [updating, setUpdating]   = useState(false)
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkNotes, setBulkNotes]   = useState('')
  const [updateMsg, setUpdateMsg]   = useState('')

  const [brandFilter,  setBrandFilter]  = useState(searchParams.get('brand')         ?? '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status')        ?? '')
  const [typeFilter,   setTypeFilter]   = useState(searchParams.get('match_type')    ?? '')
  const [runFilter,    setRunFilter]    = useState(searchParams.get('run_id')        ?? '')
  const [termSearch,   setTermSearch]   = useState('')

  useEffect(() => {
    supabase.from('orgs').select('id').limit(1).single().then(({ data }) => {
      if (data?.id) {
        setOrgId(data.id)
        supabase.from('products').select('brand').then(({ data: b }) => {
          if (b) setBrands([...new Set(b.map((r: any) => r.brand).filter(Boolean))].sort() as string[])
        })
      }
    })
  }, [])

  useEffect(() => { if (orgId) fetchDecisions() }, [orgId, brandFilter, statusFilter, typeFilter, runFilter])

  const fetchDecisions = async () => {
    setLoading(true)
    const p = new URLSearchParams({ org_id: orgId!, limit: '200' })
    if (brandFilter)  p.set('brand', brandFilter)
    if (statusFilter) p.set('status', statusFilter)
    if (typeFilter)   p.set('match_type', typeFilter)
    if (runFilter)    p.set('analysis_run_id', runFilter)
    const res  = await fetch(`/api/ppc/decisions?${p}`)
    const json = await res.json()
    if (res.ok) { setDecisions(json.decisions ?? []); setTotal(json.total ?? 0) }
    setLoading(false)
  }

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const handleBulkUpdate = async () => {
    if (!bulkStatus || !selected.size) return
    setUpdating(true); setUpdateMsg('')
    try {
      const res  = await fetch('/api/ppc/decisions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], status: bulkStatus, notes: bulkNotes || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUpdateMsg(`✅ Updated ${json.updated} decision${json.updated > 1 ? 's' : ''}`)
      setSelected(new Set()); setBulkStatus(''); setBulkNotes('')
      fetchDecisions()
      setTimeout(() => setUpdateMsg(''), 3000)
    } catch (err: any) { setUpdateMsg(`⚠️ ${err.message}`) }
    finally { setUpdating(false) }
  }

  const clearFilters = () => { setBrandFilter(''); setStatusFilter(''); setTypeFilter(''); setTermSearch(''); setRunFilter('') }

  const filtered = decisions.filter(d => !termSearch || d.term.toLowerCase().includes(termSearch.toLowerCase()))

  // Group by run
  const grouped: Record<string, { run_name: string; run_at: string; brand: string; items: any[] }> = {}
  for (const d of filtered) {
    const key = d.analysis_run_id ?? 'unlinked'
    if (!grouped[key]) grouped[key] = { run_name: d.analysis_run?.run_name ?? 'Unlinked', run_at: d.analysis_run?.run_at ?? d.decided_at, brand: d.brand ?? '', items: [] }
    grouped[key].items.push(d)
  }

  // Status summary counts
  const statusCounts = Object.fromEntries(Object.keys(STATUS).map(s => [s, decisions.filter(d => d.status === s).length]))

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          {/* Fix #5: home / back button */}
          <button onClick={() => router.push('/ppc')} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>
            ← PPC Manager
          </button>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Decisions log</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{total} total decisions</div>
        </div>
        <button className="btn-primary" onClick={() => router.push('/ppc/upload')} style={{ fontSize: 12 }}>
          ＋ New analysis
        </button>
      </div>

      {/* ── STATUS SUMMARY PILLS ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
        {Object.entries(STATUS).map(([key, cfg]) => {
          const count = statusCounts[key] ?? 0
          if (!count) return null
          const active = statusFilter === key
          return (
            <button key={key} onClick={() => setStatusFilter(active ? '' : key)} style={{
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              color: cfg.color, background: active ? cfg.bg : 'var(--surface)',
              border: `1.5px solid ${active ? cfg.color : cfg.border}`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              {cfg.icon} {cfg.label}: {count}
            </button>
          )
        })}
        {(brandFilter || statusFilter || typeFilter || termSearch || runFilter) && (
          <button onClick={clearFilters} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* ── FILTER ROW ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Brand', value: brandFilter, set: setBrandFilter, opts: [['', 'All brands'], ...brands.map(b => [b, b])] as [string, string][] },
          { label: 'Type',  value: typeFilter,  set: setTypeFilter,  opts: [['', 'All types'],  ...Object.entries(MT_LABELS).map(([v, l]) => [v, l])] as [string, string][] },
        ].map(f => (
          <div key={f.label}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>{f.label}</div>
            <select value={f.value} onChange={e => f.set(e.target.value)}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontSize: 12, color: 'var(--text)' }}>
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Status</div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontSize: 12, color: 'var(--text)' }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Search term</div>
          <input type="text" value={termSearch} onChange={e => setTermSearch(e.target.value)} placeholder="Filter by keyword…"
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} />
        </div>
      </div>

      {/* ── BULK ACTION BAR ────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{selected.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
            <option value="">Change status to…</option>
            {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
          </select>
          <input type="text" value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} placeholder="Notes (optional)"
            style={{ flex: 1, minWidth: 120, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }} />
          <button className="btn-primary" onClick={handleBulkUpdate} disabled={!bulkStatus || updating} style={{ fontSize: 12, opacity: !bulkStatus || updating ? 0.5 : 1 }}>
            {updating ? '⟳ Updating…' : 'Apply'}
          </button>
          <button onClick={() => setSelected(new Set())} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
          {updateMsg && <span style={{ fontSize: 12, color: updateMsg.startsWith('✅') ? 'var(--accent)' : 'var(--red)', fontWeight: 600 }}>{updateMsg}</span>}
        </div>
      )}

      {/* ── SELECT ALL ─────────────────────────────────────────────────────── */}
      {filtered.length > 0 && selected.size === 0 && (
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setSelected(new Set(filtered.map(d => d.id)))}
            style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ☑ Select all {filtered.length} visible
          </button>
        </div>
      )}

      {/* ── DECISIONS LIST ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="loading">⟳ Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ height: 160 }}>
          <div className="ei">📋</div>
          <div>No decisions found</div>
          <button className="btn-secondary" style={{ marginTop: 12, fontSize: 12 }} onClick={() => router.push('/ppc/upload')}>Run an analysis to get started →</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {Object.entries(grouped).map(([runKey, group]) => (
            <div key={runKey}>
              {/* Run header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{group.run_name}</span>
                {group.brand && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{group.brand}</span>}
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {new Date(group.run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>· {group.items.length} decisions</span>
              </div>

              {/* Decision rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {group.items.map(d => {
                  const mtc = MT_COLORS[d.match_type] ?? { color: '#6b7280', bg: 'rgba(107,114,128,.08)' }
                  const isSelected = selected.has(d.id)
                  return (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 7,
                      background: isSelected ? 'var(--accent-light)' : 'var(--surface)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      transition: 'border-color .1s, background .1s',
                    }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(d.id)}
                        style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />

                      {/* Term */}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 160 }}>{d.term}</span>

                      {/* Match type */}
                      <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type] ?? d.match_type}</Badge>

                      {/* Generic flag */}
                      {d.is_generic_flag && <Badge color="#ea580c" bg="rgba(234,88,12,.1)">⚠️ Generic</Badge>}

                      {/* Campaigns */}
                      {d.campaign_names?.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>{d.campaign_names.join(', ')}</span>
                      )}

                      {/* Notes */}
                      {d.notes && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>"{d.notes}"</span>}

                      <div style={{ flex: 1 }} />

                      {/* ROAS / wasted */}
                      {(d.roas_at_decision ?? 0) > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>ROAS {d.roas_at_decision?.toFixed(2)}x</span>
                      )}
                      {(d.wasted_at_decision ?? 0) > 0 && (
                        <span style={{ fontSize: 11, color: '#dc2626', fontFamily: 'var(--mono)' }}>${d.wasted_at_decision?.toFixed(2)}</span>
                      )}

                      {/* Status */}
                      <StatusPill status={d.status} />

                      {/* Date */}
                      <span style={{ fontSize: 10, color: 'var(--text3)', minWidth: 50, textAlign: 'right' as const }}>
                        {new Date(d.decided_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PPCDecisionsPageWrapper() {
  return <Suspense fallback={<div className="loading">⟳ Loading…</div>}><PPCDecisionsPage /></Suspense>
}
