'use client'
// app/ppc/analysis/page.tsx

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

type Tab = 'negatives' | 'harvest' | 'ngrams'

const STATUS_OPTIONS = [
  { value: 'pending',       label: 'Pending review',     icon: '⏳', color: '#b45309',  bg: 'rgba(180,83,9,.08)'   },
  { value: 'actioned',      label: 'Actioned in Amazon', icon: '✅', color: '#166534',  bg: 'rgba(22,101,52,.08)'  },
  { value: 'not_actioning', label: 'Not actioning',      icon: '⏸', color: '#6b7280',  bg: 'rgba(107,114,128,.08)'},
]

const MT_LABELS: Record<string, string> = {
  negative_phrase: 'Neg · Phrase', negative_exact: 'Neg · Exact',
  harvest_exact: 'Harvest · Exact', harvest_phrase: 'Harvest · Phrase', harvest_broad: 'Harvest · Broad',
}

const MT_COLORS: Record<string, { color: string; bg: string }> = {
  negative_phrase: { color: '#dc2626', bg: 'rgba(220,38,38,.1)' },
  negative_exact:  { color: '#b91c1c', bg: 'rgba(185,28,28,.08)' },
  harvest_exact:   { color: '#166534', bg: 'rgba(22,101,52,.1)' },
  harvest_phrase:  { color: '#166534', bg: 'rgba(22,101,52,.08)' },
  harvest_broad:   { color: '#1d4ed8', bg: 'rgba(29,78,216,.08)' },
}

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, color, background: bg, letterSpacing: '.04em', whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
      {children}
    </span>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? 'var(--red)' : 'var(--text)', fontFamily: 'var(--mono)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

// ── HISTORY CALLOUT ───────────────────────────────────────────────────────────

function HistoryCallout({ prevRun, prevDecisions, expanded, onToggle }: { prevRun: any; prevDecisions: any[]; expanded: boolean; onToggle: () => void }) {
  if (!prevRun) return null
  const daysAgo = Math.floor((Date.now() - new Date(prevRun.run_at).getTime()) / 86400000)
  const daysLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
  const actioned     = prevDecisions.filter(d => d.status === 'actioned')
  const notActioning = prevDecisions.filter(d => d.status === 'not_actioning')
  const reversed     = prevDecisions.filter(d => d.status === 'reversed')

  return (
    <div style={{ background: 'rgba(29,78,216,.04)', border: '1px solid rgba(29,78,216,.18)', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Last analysis: {daysLabel}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>
              {new Date(prevRun.run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}{prevRun.date_range_days}-day · ${prevRun.total_spend?.toFixed(2)} spend · {prevRun.high_negatives} HIGH negatives
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {prevDecisions.length > 0 ? (
            <div style={{ display: 'flex', gap: 5 }}>
              {actioned.length     > 0 && <Badge color="#166534" bg="rgba(22,101,52,.1)">✅ {actioned.length} actioned</Badge>}
              {notActioning.length > 0 && <Badge color="#6b7280" bg="rgba(107,114,128,.1)">⏸ {notActioning.length} skipped</Badge>}
              {reversed.length     > 0 && <Badge color="#b45309" bg="rgba(180,83,9,.1)">↩️ {reversed.length} reversed</Badge>}
            </div>
          ) : <Badge color="#6b7280" bg="rgba(107,114,128,.08)">No decisions logged</Badge>}
          <span style={{ fontSize: 12, color: 'var(--text3)', transition: 'transform .15s', transform: expanded ? 'rotate(180deg)' : 'none' }}>▾</span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(29,78,216,.15)', padding: '10px 14px' }}>
          {prevDecisions.length === 0
            ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>No decisions were logged from that run.</span>
            : prevDecisions.map((d, i) => {
                const mtc = MT_COLORS[d.match_type] ?? { color: '#6b7280', bg: 'rgba(107,114,128,.08)' }
                const st  = STATUS_OPTIONS.find(s => s.value === d.status)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < prevDecisions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{st?.icon ?? '⏳'}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, flex: 1, color: 'var(--text)' }}>{d.term}</span>
                    <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type] ?? d.match_type}</Badge>
                    {d.campaign_names?.length > 0 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{d.campaign_names.join(', ')}</span>}
                    {(d.roas_at_decision ?? 0) > 0 && <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>ROAS {d.roas_at_decision?.toFixed(2)}x</span>}
                    {(d.wasted_at_decision ?? 0) > 0 && <span style={{ fontSize: 10, color: '#dc2626', fontFamily: 'var(--mono)' }}>${d.wasted_at_decision?.toFixed(2)} wasted</span>}
                  </div>
                )
              })
          }
        </div>
      )}
    </div>
  )
}

// ── INLINE DECISION ROW — flat single row with inline controls ────────────────
// Fix #2: All controls visible inline, no click-to-expand needed

function NegRow({ row, keyStr, selected, decision, onToggle, onUpdate, campaigns, isExact = false }: any) {
  const isSelected = selected.has(keyStr)
  const d = decision ?? { status: 'pending', campaigns: [], notes: '' }

  const wasted = row.wasted_spend ?? row.cost ?? 0
  const roas   = row.roas ?? 0
  const acos   = row.acos ?? 0

  return (
    <div style={{
      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 8, background: isSelected ? 'var(--accent-light)' : 'var(--surface)',
      padding: '10px 14px', marginBottom: 6, transition: 'border-color .15s',
    }}>
      {/* Row 1: checkbox + term + badges + wasted */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(keyStr)}
          style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {isExact ? row.search_term : row.ngram}
        </span>
        {!isExact && row.ngram_type && (
          <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>
            {row.ngram_type}
          </span>
        )}
        {isExact && row.coverage !== 'Not covered' && (
          <Badge color="#166534" bg="rgba(22,101,52,.1)">{row.coverage === 'Covered' ? '✓ Phrase covers this' : '⚡ Partial'}</Badge>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'var(--mono)' }}>${wasted.toFixed(2)} wasted</span>
        {roas > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS {roas.toFixed(2)}x</span>}
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>ACOS {acos.toFixed(1)}%</span>
        {row.appearances > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.appearances} apps</span>}
      </div>

      {/* Row 2: inline controls — ALWAYS VISIBLE, not gated on selection */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 10, paddingLeft: 25, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Status</div>
            <select value={d.status} onChange={e => onUpdate(keyStr, 'status', e.target.value)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Apply to campaigns</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
              {(campaigns ?? []).map((c: string) => (
                <button key={c} onClick={() => {
                  const cur = d.campaigns ?? []
                  onUpdate(keyStr, 'campaigns', cur.includes(c) ? cur.filter((x: string) => x !== c) : [...cur, c])
                }} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: '1px solid',
                  background: (d.campaigns ?? []).includes(c) ? 'var(--accent)' : 'var(--surface2)',
                  color:      (d.campaigns ?? []).includes(c) ? '#fff' : 'var(--text)',
                  borderColor:(d.campaigns ?? []).includes(c) ? 'var(--accent)' : 'var(--border)',
                }}>{c}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Notes</div>
            <input type="text" value={d.notes ?? ''} placeholder="Optional…"
              onChange={e => onUpdate(keyStr, 'notes', e.target.value)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} />
          </div>
        </div>
    </div>
  )
}

// ── HARVEST ROW ───────────────────────────────────────────────────────────────

function HarvestRow({ row, selectedKeys, onToggle, decisionMap, onUpdate }: any) {
  const matchTypes = row.match_types?.split(', ') ?? ['Phrase']
  const anySelected = matchTypes.some((mt: string) => selectedKeys.has(`harvest_${mt}_${row.search_term}`))

  return (
    <div style={{
      border: `1px solid ${row.generic_flag ? 'rgba(234,88,12,.3)' : anySelected ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 8, background: anySelected ? 'var(--accent-light)' : 'var(--surface)',
      padding: '10px 14px', marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{row.search_term}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.confidence}</span>
            {row.generic_flag && <Badge color="#ea580c" bg="rgba(234,88,12,.1)">{row.generic_flag}</Badge>}
            <Badge
              color={row.existing_targeting.startsWith('🆕') ? '#166534' : row.existing_targeting.startsWith('⚠️') ? '#b45309' : '#1d4ed8'}
              bg={row.existing_targeting.startsWith('🆕') ? 'rgba(22,101,52,.08)' : row.existing_targeting.startsWith('⚠️') ? 'rgba(180,83,9,.08)' : 'rgba(29,78,216,.08)'}
            >{row.existing_targeting}</Badge>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.purchases} orders</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>ROAS {row.roas?.toFixed(2)}x</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>${row.cost?.toFixed(2)} spend</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Conviction {row.conviction?.toFixed(0)}</span>
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>Bid ${row.suggested_bid}</span>
            {row.campaign_breakdown && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.campaign_breakdown}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {matchTypes.map((mt: string) => {
            const key = `harvest_${mt}_${row.search_term}`
            const isOn = selectedKeys.has(key)
            return (
              <button key={mt} onClick={() => onToggle(key)} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, border: '1px solid',
                background: isOn ? 'var(--accent)' : 'var(--surface2)',
                color:      isOn ? '#fff' : 'var(--text)',
                borderColor:isOn ? 'var(--accent)' : 'var(--border)',
              }}>{isOn ? '✓ ' : ''}{mt}</button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── NGRAM TABLE ───────────────────────────────────────────────────────────────

function NGramTable({ rows, label }: { rows: any[]; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, 8)
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>{label}</div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['N-gram', 'Apps', 'Spend', 'Wasted', 'Sales', 'ROAS', 'ACOS', 'Waste%'].map(h => (
                <th key={h} style={{ textAlign: 'left' as const, padding: '7px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row: any, i: number) => {
              const hi = row.roas < 1.0 || row.acos > 100
              const md = !hi && row.roas < 1.5
              return (
                <tr key={row.ngram} style={{ background: hi ? 'rgba(220,38,38,.04)' : md ? 'rgba(234,88,12,.03)' : i % 2 ? 'var(--surface2)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{row.ngram}</td>
                  <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>{row.appearances}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>${row.total_cost?.toFixed(2)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: hi ? '#dc2626' : 'var(--text)', fontWeight: hi ? 600 : 400 }}>${row.wasted_spend?.toFixed(2)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>${row.total_sales?.toFixed(2)}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 600, color: row.roas >= 3 ? 'var(--accent)' : row.roas < 1 ? '#dc2626' : 'var(--text)' }}>{row.roas?.toFixed(2)}x</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{row.acos?.toFixed(1)}%</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{(row.waste_pct * 100)?.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > 8 && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
            <button onClick={() => setExpanded(e => !e)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {expanded ? '▲ Show less' : `▼ Show all ${rows.length} rows`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

function PPCAnalysisPage() {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const supabase      = createClient()

  const uploadIds     = searchParams.get('upload_ids')?.split(',') ?? []
  const dateRangeDays = parseInt(searchParams.get('date_range_days') ?? '65')
  const brand         = searchParams.get('brand') ?? ''

  const [loading, setLoading]         = useState(true)
  const [results, setResults]         = useState<any>(null)
  const [runId, setRunId]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Tab>('negatives')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [decisionMap, setDecisionMap] = useState<Map<string, any>>(new Map())
  const [saving, setSaving]           = useState(false)
  // Fix #3: stay on page after save, show toast instead of redirect
  const [saveToast, setSaveToast]     = useState('')
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [prevRun, setPrevRun]         = useState<any>(null)
  const [prevDecisions, setPrevDecisions] = useState<any[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)

  useEffect(() => {
    if (!uploadIds.length) return
    const run = async () => {
      try {
        const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
        const [res, prevRunRes] = await Promise.all([
          fetch('/api/ppc/analyse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_ids: uploadIds, date_range_days: dateRangeDays, org_id: org?.id, brand }),
          }),
          brand
            ? supabase.from('ppc_analysis_runs')
                .select('id, run_name, run_at, total_spend, total_wasted, high_negatives, harvest_candidates, date_range_days')
                .eq('org_id', org?.id).eq('brand', brand)
                .order('run_at', { ascending: false }).limit(3)
            : Promise.resolve({ data: [] }),
        ])
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setResults(json.results)
        setRunId(json.analysis_run_id)
        const prevRuns = ((prevRunRes as any).data ?? []) as any[]
        const prior = prevRuns.find((r: any) => r.id !== json.analysis_run_id) ?? null
        if (prior) {
          setPrevRun(prior)
          const { data: decs } = await supabase
            .from('ppc_decisions_log')
            .select('term, match_type, status, campaign_names, roas_at_decision, wasted_at_decision, decided_at')
            .eq('analysis_run_id', prior.id)
            .in('status', ['actioned', 'not_actioning', 'reversed'])
            .order('decided_at', { ascending: false }).limit(20)
          setPrevDecisions(decs ?? [])
        }
      } catch (err: any) {
        setLoadError(err.message)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  const toggleSelect = (key: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
    setDecisionMap(prev => {
      if (prev.has(key)) return prev
      const n = new Map(prev); n.set(key, { status: 'pending', campaigns: [], notes: '' }); return n
    })
  }

  const updateDecision = (key: string, field: string, value: any) => {
    setDecisionMap(prev => {
      const n = new Map(prev)
      n.set(key, { ...(n.get(key) ?? { status: 'pending', campaigns: [], notes: '' }), [field]: value })
      return n
    })
  }

  const buildDecisions = () => {
    if (!results) return []
    const out: any[] = []
    for (const row of [...(results.phrase_high ?? []), ...(results.phrase_medium ?? [])]) {
      const key = `neg_phrase_${row.ngram}`
      if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status: 'pending', campaigns: [], notes: '' }
      out.push({ term: row.ngram, match_type: 'negative_phrase', priority: row.priority, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: row.wasted_spend, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (results.exact_negatives ?? [])) {
      const key = `neg_exact_${row.search_term}`
      if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status: 'pending', campaigns: [], notes: '' }
      out.push({ term: row.search_term, match_type: 'negative_exact', priority: 'HIGH', campaign_names: d.campaigns, roas_at_decision: 0, wasted_at_decision: row.wasted_spend, purchases_at_decision: 0, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (results.harvest_candidates ?? [])) {
      for (const mt of (row.match_types?.split(', ') ?? ['Phrase'])) {
        const key = `harvest_${mt}_${row.search_term}`
        if (!selected.has(key)) continue
        const d = decisionMap.get(key) ?? { status: 'pending', campaigns: [], notes: '' }
        out.push({ term: row.search_term, match_type: `harvest_${mt.toLowerCase()}`, priority: row.confidence?.includes('⭐⭐⭐') ? 'HIGH' : 'MEDIUM', campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: 0, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: !!row.generic_flag })
      }
    }
    return out
  }

  // Fix #3: save decisions but STAY ON PAGE — show toast, don't redirect
  const handleSave = async () => {
    if (!runId || !selected.size) return
    setSaving(true); setSaveError(null)
    try {
      const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
      const decisions = buildDecisions()
      if (!decisions.length) { setSaveError('No decisions to save'); setSaving(false); return }
      const res = await fetch('/api/ppc/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org?.id, brand, analysis_run_id: runId, decisions }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSaveToast(`✅ ${json.saved} decision${json.saved > 1 ? 's' : ''} logged successfully`)
      setSelected(new Set())
      setTimeout(() => setSaveToast(''), 4000)
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── LOADING / ERROR ────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center' as const }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Running analysis…</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>N-gram extraction · Significance testing · Generating recommendations</div>
    </div>
  )
  if (loadError) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: 'var(--red)', marginBottom: 12 }}>⚠️ {loadError}</div>
      <button className="btn-secondary" onClick={() => router.back()}>← Go back</button>
    </div>
  )
  if (!results) return null

  const { summary, phrase_high, phrase_medium, phrase_watch, exact_negatives, harvest_candidates, toxic_combos, ngrams } = results
  const actionableNeg = (phrase_high?.length ?? 0) + (phrase_medium?.length ?? 0)

  return (
    // Fix #1: use full width, no artificial max-width constraint cutting off right side
    <div style={{ padding: '20px 24px' }}>

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <button onClick={() => router.push('/ppc')} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>← PPC Manager</button>
          <div style={{ fontSize: 20, fontWeight: 700 }}>PPC analysis results</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
            {summary.date_range_days}-day report
            {brand && <> · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{brand}</span></>}
            {' · '}{summary.campaigns?.join(', ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => router.push('/ppc/decisions')}>View decisions log</button>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => router.push('/ppc/upload')}>＋ New upload</button>
        </div>
      </div>

      {/* HISTORY CALLOUT */}
      <HistoryCallout prevRun={prevRun} prevDecisions={prevDecisions} expanded={historyExpanded} onToggle={() => setHistoryExpanded(e => !e)} />

      {/* STAT CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        <StatCard label="Total spend"       value={`$${summary.total_spend?.toFixed(2)}`} />
        <StatCard label="Overall ROAS"      value={`${summary.overall_roas?.toFixed(2)}x`} sub={`ACOS ${summary.overall_acos?.toFixed(1)}%`} />
        <StatCard label="Wasted spend"      value={`$${summary.total_wasted?.toFixed(2)}`} sub={`${(summary.wasted_pct * 100)?.toFixed(1)}% of spend`} accent />
        <StatCard label="Addressable waste" value={`$${summary.addressable_waste?.toFixed(2)}`} sub={`${((summary.addressable_waste / summary.total_wasted) * 100)?.toFixed(0)}% of wasted`} />
      </div>

      {/* INSIGHT ROW — clickable to filter tab */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { icon: '🔴', label: `${phrase_high?.length ?? 0} HIGH negatives`, sub: 'Click to view · negate now', bg: 'rgba(220,38,38,.06)', border: 'rgba(220,38,38,.2)', tab: 'negatives' as Tab },
          { icon: '⚡', label: `${toxic_combos?.length ?? 0} toxic combos`, sub: 'Click to view in N-gram tables', bg: 'rgba(234,88,12,.06)', border: 'rgba(234,88,12,.2)', tab: 'ngrams' as Tab },
          { icon: '🚀', label: `${harvest_candidates?.length ?? 0} harvest candidates`, sub: 'Click to view · keywords to push', bg: 'rgba(22,101,52,.06)', border: 'rgba(22,101,52,.2)', tab: 'harvest' as Tab },
        ].map(item => (
          <div key={item.label} onClick={() => setActiveTab(item.tab)} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'opacity .15s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.sub}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text3)' }}>→</span>
          </div>
        ))}
      </div>

      {/* TOAST */}
      {saveToast && (
        <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
          {saveToast} — <button onClick={() => router.push('/ppc/decisions')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontSize: 13, padding: 0 }}>View decisions log →</button>
        </div>
      )}
      {saveError && (
        <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
          ⚠️ {saveError}
        </div>
      )}

      {/* TABS */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 8, padding: 3, marginBottom: 16, width: 'fit-content' }}>
        {([
          { key: 'negatives', label: 'Negatives',    count: actionableNeg + (exact_negatives?.length ?? 0) },
          { key: 'harvest',   label: 'Harvest',      count: harvest_candidates?.length ?? 0 },
          { key: 'ngrams',    label: 'N-gram tables' },
        ] as { key: Tab; label: string; count?: number }[]).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '7px 16px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 6,
            background: activeTab === t.key ? 'var(--surface)' : 'transparent',
            color: activeTab === t.key ? 'var(--text)' : 'var(--text3)',
            fontWeight: activeTab === t.key ? 600 : 400,
            boxShadow: activeTab === t.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
          }}>
            {t.label}
            {t.count !== undefined && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center' as const, background: activeTab === t.key ? 'var(--accent)' : 'var(--surface3)', color: activeTab === t.key ? '#fff' : 'var(--text3)' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── NEGATIVES TAB ──────────────────────────────────────────────────── */}
      {activeTab === 'negatives' && (
        <div>
          {(phrase_high?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <button onClick={() => results.phrase_high.forEach((r: any) => { if (!selected.has(`neg_phrase_${r.ngram}`)) toggleSelect(`neg_phrase_${r.ngram}`) })}
                style={{ fontSize: 11, background: 'rgba(220,38,38,.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,.2)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                ☑ Select all HIGH ({phrase_high.length})
              </button>
              {selected.size > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{selected.size} selected</span>}
            </div>
          )}

          {(phrase_high?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>HIGH priority phrase negatives</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS &lt; 1.0 or ACOS &gt; 100% · negate now</span>
              </div>
              {phrase_high.map((row: any) => (
                <NegRow key={row.ngram} row={row} keyStr={`neg_phrase_${row.ngram}`}
                  selected={selected} decision={decisionMap.get(`neg_phrase_${row.ngram}`)}
                  onToggle={toggleSelect} onUpdate={updateDecision} campaigns={summary.campaigns ?? []} />
              ))}
            </div>
          )}

          {(phrase_medium?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ea580c', display: 'inline-block' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ea580c' }}>MEDIUM priority phrase negatives</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS 1.0–1.49 · negate + monitor</span>
              </div>
              {phrase_medium.map((row: any) => (
                <NegRow key={row.ngram} row={row} keyStr={`neg_phrase_${row.ngram}`}
                  selected={selected} decision={decisionMap.get(`neg_phrase_${row.ngram}`)}
                  onToggle={toggleSelect} onUpdate={updateDecision} campaigns={summary.campaigns ?? []} />
              ))}
            </div>
          )}

          {(exact_negatives?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Exact match negatives</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>$15+ wasted · 0 purchases</span>
              </div>
              {exact_negatives.map((row: any) => (
                <NegRow key={row.search_term} row={row} keyStr={`neg_exact_${row.search_term}`}
                  selected={selected} decision={decisionMap.get(`neg_exact_${row.search_term}`)}
                  onToggle={toggleSelect} onUpdate={updateDecision} campaigns={summary.campaigns ?? []} isExact />
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(phrase_watch?.length ?? 0) > 0 && (
              <div style={{ background: 'rgba(202,138,4,.06)', border: '1px solid rgba(202,138,4,.2)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ca8a04', marginBottom: 3 }}>🟡 Watch list — {phrase_watch.length} items</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Below significance threshold. Re-review after 30 more days of data.</div>
              </div>
            )}
            {(toxic_combos?.length ?? 0) > 0 && (
              <div style={{ background: 'rgba(234,88,12,.06)', border: '1px solid rgba(234,88,12,.2)', borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ea580c', marginBottom: 3 }}>⚡ {toxic_combos.length} toxic combinations</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Component words fine individually but combined ROAS &lt; 1.0. See N-gram tables.</div>
              </div>
            )}
          </div>

          {actionableNeg === 0 && (exact_negatives?.length ?? 0) === 0 && (
            <div className="empty" style={{ height: 120 }}><div className="ei">✅</div><div>No actionable negatives — all terms converting well or below significance threshold</div></div>
          )}
        </div>
      )}

      {/* ── HARVEST TAB ────────────────────────────────────────────────────── */}
      {activeTab === 'harvest' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
            ROAS ≥ 3.0 · $20+ spend · 3+ purchases · ranked by conviction (ROAS × spend). Click match type buttons to select for logging.
          </div>
          {harvest_candidates?.length > 0
            ? harvest_candidates.map((row: any) => (
                <HarvestRow key={row.search_term} row={row} selectedKeys={selected} onToggle={toggleSelect} decisionMap={decisionMap} onUpdate={updateDecision} />
              ))
            : <div className="empty" style={{ height: 120 }}><div className="ei">🔍</div><div>No harvest candidates found</div></div>
          }
        </div>
      )}

      {/* ── NGRAMS TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'ngrams' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>Red = ROAS &lt; 1.0 · Orange = ROAS 1.0–1.49</div>
          <NGramTable rows={ngrams?.uni ?? []} label="Unigrams (single words)" />
          <NGramTable rows={ngrams?.bi  ?? []} label="Bigrams (2-word phrases)" />
          <NGramTable rows={ngrams?.tri ?? []} label="Trigrams (3-word phrases)" />
          {(toxic_combos?.length ?? 0) > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>⚡ Toxic combinations</div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {['Phrase', 'Type', 'Wasted', 'ROAS', 'ACOS', 'Why toxic'].map(h => (
                        <th key={h} style={{ textAlign: 'left' as const, padding: '7px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {toxic_combos.map((row: any, i: number) => (
                      <tr key={row.ngram} style={{ background: i % 2 ? 'var(--surface2)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{row.ngram}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>{row.combo_type}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: '#dc2626', fontWeight: 600 }}>${row.wasted_spend?.toFixed(2)}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{row.roas?.toFixed(2)}x</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{row.acos?.toFixed(1)}%</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text3)' }}>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log bar — inline at bottom of content, no fixed positioning that breaks scroll */}
      {selected.size > 0 && (
        <div style={{
          marginTop: 24,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 10, padding: '14px 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 2px 12px rgba(0,0,0,.08)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} decision{selected.size > 1 ? 's' : ''} ready to log</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, opacity: saving ? 0.6 : 1 }}>
              {saving ? '⟳ Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PPCAnalysisPageWrapper() {
  return <Suspense fallback={<div className="loading">⟳ Loading…</div>}><PPCAnalysisPage /></Suspense>
}
