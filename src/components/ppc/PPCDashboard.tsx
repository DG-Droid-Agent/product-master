'use client'
// components/ppc/PPCDashboard.tsx — v3
// [D1] No routing — internal view state only (fixes scroll + 401)
// [D2] toggle(key, recCampaigns) — auto-pre-selects recommended campaigns
// [D3] preMap key format: neg_phrase_{term}, neg_exact_{term}, harvest_{Cap}_{term}
// [D4] Campaign buttons: red = recommended (ROAS<1.0 + $10+ spend)
// [D5] Tooltip shows spend + ROAS per campaign
// [D6] Top 3 toxic combos in Negatives tab
// [D7] "← negate here" only when spend >= 10
// [D8] Home deduplication by upload_ids fingerprint
// [D9] "run N×" badge for repeated analyses
// [D10] Save stays on page — toast not redirect
// [D11] Suspense not needed — no useSearchParams (internal state)
// [D12] Brands from products table, org from orgs.limit(1)
// NEW: Option A sidebar, portfolio colour coding, PT negatives + PT harvest tabs

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

type View       = 'home' | 'upload' | 'portfolio_select' | 'analysis' | 'decisions'
type Tab        = 'kw_neg' | 'pt_neg' | 'harvest_kw' | 'harvest_pt' | 'ngrams'
type Health     = 'red' | 'amber' | 'green'

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  pending:       { label: 'Pending review',     icon: '⏳', color: '#b45309', bg: 'rgba(180,83,9,.08)',    border: 'rgba(180,83,9,.2)'    },
  actioned:      { label: 'Actioned in Amazon', icon: '✅', color: '#166534', bg: 'rgba(22,101,52,.08)',   border: 'rgba(22,101,52,.2)'   },
  not_actioning: { label: 'Not actioning',      icon: '⏸', color: '#6b7280', bg: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.2)' },
  reversed:      { label: 'Reversed',           icon: '↩️', color: '#dc2626', bg: 'rgba(220,38,38,.08)',   border: 'rgba(220,38,38,.2)'   },
}
const MT_LABELS: Record<string, string> = {
  negative_phrase: 'Neg · Phrase', negative_exact: 'Neg · Exact',
  negative_pt: 'Neg · PT', harvest_exact: 'Harvest · Exact',
  harvest_phrase: 'Harvest · Phrase', harvest_broad: 'Harvest · Broad', harvest_pt: 'Harvest · PT',
}
const MT_COLORS: Record<string, { color: string; bg: string }> = {
  negative_phrase: { color: '#dc2626', bg: 'rgba(220,38,38,.1)'  },
  negative_exact:  { color: '#b91c1c', bg: 'rgba(185,28,28,.08)' },
  negative_pt:     { color: '#7c3aed', bg: 'rgba(124,58,237,.08)'},
  harvest_exact:   { color: '#166534', bg: 'rgba(22,101,52,.1)'  },
  harvest_phrase:  { color: '#166534', bg: 'rgba(22,101,52,.08)' },
  harvest_broad:   { color: '#1d4ed8', bg: 'rgba(29,78,216,.08)' },
  harvest_pt:      { color: '#0f766e', bg: 'rgba(15,118,110,.08)'},
}
const HEALTH_COLORS: Record<Health, { dot: string; bg: string; text: string; border: string }> = {
  red:   { dot: '#dc2626', bg: 'rgba(220,38,38,.08)',   text: '#dc2626', border: 'rgba(220,38,38,.2)'   },
  amber: { dot: '#d97706', bg: 'rgba(217,119,6,.08)',   text: '#b45309', border: 'rgba(217,119,6,.2)'   },
  green: { dot: '#16a34a', bg: 'rgba(22,163,74,.08)',   text: '#166534', border: 'rgba(22,163,74,.2)'   },
}
const CAMPAIGN_TYPES = ['auto', 'broad', 'exact', 'phrase', 'other']
const DATE_RANGES = [
  { label: '7 days', value: 7 }, { label: '30 days', value: 30 },
  { label: '60 days', value: 60 }, { label: '65 days', value: 65 }, { label: 'Custom', value: 0 },
]

// ── SHARED MICRO COMPONENTS ───────────────────────────────────────────────────

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, color, background: bg, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>{children}</span>
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.pending
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10, color: s.color, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' as const, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</span>
}

function SectionTitle({ label, sub, color }: { label: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color ?? 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: color ?? 'var(--text)' }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</span>}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: accent ? 'var(--red)' : 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── CAMPAIGN BUTTONS (with recommendation highlighting) ───────────────────────
// [D4] red dashed = recommended, [D5] tooltip shows spend/ROAS, [D7] $10+ threshold

function CampButtons({ campaigns, selected, recommendedScope, autoSpend, autoRoas, broadSpend, broadRoas, onUpdate, updateKey }: any) {
  const recList = (recommendedScope ?? '').split(', ').map((s: string) => s.trim()).filter(Boolean)
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
      {(campaigns ?? []).map((c: string) => {
        const inList  = (selected ?? []).includes(c)
        const isRec   = recList.length > 0 ? recList.includes(c) : true
        const isAuto  = c.toLowerCase().includes('auto')
        const isBroad = c.toLowerCase().includes('broad')
        const spend   = isAuto ? autoSpend : isBroad ? broadSpend : null
        const roas    = isAuto ? autoRoas  : isBroad ? broadRoas  : null
        const spendStr = spend != null ? `$${spend.toFixed(2)}` : ''
        const roasStr  = roas  != null ? `ROAS ${roas.toFixed(2)}x` : ''
        const tooltip  = [c, [spendStr, roasStr].filter(Boolean).join(' · '), isRec ? 'ROAS < 1.0 — negate here' : 'converting — leave alone'].filter(Boolean).join(' — ')
        const bg     = inList ? (isRec ? '#dc2626' : 'var(--accent)') : 'var(--surface2)'
        const color  = inList ? '#fff' : isRec ? '#dc2626' : 'var(--text3)'
        const border = inList ? (isRec ? '1.5px solid #dc2626' : '1.5px solid var(--accent)') : isRec ? '1.5px dashed #dc2626' : '1px solid var(--border)'
        return (
          <button key={c} title={tooltip}
            onClick={() => onUpdate(updateKey, 'campaigns', inList ? (selected ?? []).filter((x: string) => x !== c) : [...(selected ?? []), c])}
            style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', border, background: bg, color, fontWeight: isRec ? 600 : 400, display: 'flex', alignItems: 'center', gap: 3 }}>
            {isRec && !inList && <span style={{ fontSize: 9 }}>⚠</span>}
            {c}
            {!isRec && inList && <span style={{ fontSize: 9, opacity: 0.7 }}>✓override</span>}
          </button>
        )
      })}
    </div>
  )
}

// ── NEG ROW (keyword) ─────────────────────────────────────────────────────────

function NegRow({ row, keyStr, selected, decision, onToggle, onUpdate, campaigns, isExact = false }: any) {
  const isOn = selected.has(keyStr)
  const d    = decision ?? { status: 'pending', campaigns: [], notes: '' }
  const wasted = row.wasted_spend ?? row.cost ?? 0
  return (
    <div style={{ border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: isOn ? 'var(--accent-light)' : 'var(--surface)', padding: '10px 14px', marginBottom: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={isOn} onChange={() => onToggle(keyStr)}
          style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>{isExact ? row.search_term : row.ngram}</span>
        {!isExact && row.ngram_type && <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>{row.ngram_type}</span>}
        {isExact && row.coverage !== 'Not covered' && <Badge color="#166534" bg="rgba(22,101,52,.1)">{row.coverage === 'Covered' ? '✓ Covered' : '⚡ Partial'}</Badge>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'var(--mono)' }}>${wasted.toFixed(2)} wasted</span>
        {(row.roas ?? 0) > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS {row.roas?.toFixed(2)}x</span>}
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>ACOS {row.acos?.toFixed(1)}%</span>
        {row.appearances > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.appearances} apps</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 10, paddingLeft: 25, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Status</div>
          <select value={d.status} onChange={e => onUpdate(keyStr, 'status', e.target.value)}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
            {Object.entries(STATUS).filter(([v]) => v !== 'reversed').map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>
            Apply to campaigns <span style={{ color: '#dc2626', fontWeight: 400, textTransform: 'none' as const }}>— red = recommended</span>
          </div>
          <CampButtons campaigns={campaigns} selected={d.campaigns} recommendedScope={row.recommended_scope}
            autoSpend={row.auto_spend} autoRoas={row.auto_roas} broadSpend={row.broad_spend} broadRoas={row.broad_roas}
            onUpdate={onUpdate} updateKey={keyStr} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Notes</div>
          <input type="text" value={d.notes ?? ''} placeholder="Optional…" onChange={e => onUpdate(keyStr, 'notes', e.target.value)}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} />
        </div>
      </div>
    </div>
  )
}

// ── PT NEGATIVE ROW ───────────────────────────────────────────────────────────

function PTNegRow({ row, keyStr, selected, decision, onToggle, onUpdate }: any) {
  const isOn = selected.has(keyStr)
  const d    = decision ?? { status: 'pending', campaigns: row.campaigns ?? [], notes: '' }
  return (
    <div style={{ border: `1px solid ${isOn ? 'var(--accent)' : 'rgba(124,58,237,.2)'}`, borderRadius: 8, background: isOn ? 'var(--accent-light)' : 'rgba(124,58,237,.03)', padding: '10px 14px', marginBottom: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={isOn} onChange={() => onToggle(keyStr)}
          style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{row.pt_expression}</span>
        <Badge color="#7c3aed" bg="rgba(124,58,237,.1)">{row.pt_expression?.startsWith('asin=') ? 'ASIN target' : 'Match type'}</Badge>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'var(--mono)' }}>${row.total_spend?.toFixed(2)} spend</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS {row.roas?.toFixed(2)}x</span>
      </div>
      <div style={{ paddingLeft: 25, marginTop: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{row.action}</div>
        {row.camp_breakdown?.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 8 }}>
            {row.camp_breakdown.map((c: any) => (
              <span key={c.name} style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px' }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span style={{ color: 'var(--text3)', marginLeft: 6 }}>${c.spend.toFixed(2)} · ROAS {c.roas.toFixed(2)}x</span>
                {c.roas < 1.0 && c.spend >= 10 && <span style={{ color: '#dc2626', marginLeft: 4, fontWeight: 600 }}>← exclude here</span>}
                {c.roas < 1.0 && c.spend < 10 && <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: 10 }}>low spend</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      {isOn && (
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, paddingLeft: 25, marginTop: 4 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Status</div>
            <select value={d.status} onChange={e => onUpdate(keyStr, 'status', e.target.value)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
              {Object.entries(STATUS).filter(([v]) => v !== 'reversed').map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Notes</div>
            <input type="text" value={d.notes ?? ''} placeholder="Optional…" onChange={e => onUpdate(keyStr, 'notes', e.target.value)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── HARVEST KW ROW ────────────────────────────────────────────────────────────

function HarvestRow({ row, selectedKeys, onToggle }: any) {
  const matchTypes = row.match_types?.split(', ') ?? ['Phrase']
  const anyOn = matchTypes.some((mt: string) => selectedKeys.has(`harvest_${mt}_${row.search_term}`))
  return (
    <div style={{ border: `1px solid ${row.generic_flag ? 'rgba(234,88,12,.3)' : anyOn ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: anyOn ? 'var(--accent-light)' : 'var(--surface)', padding: '10px 14px', marginBottom: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>{row.search_term}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.confidence}</span>
            {row.generic_flag && <Badge color="#ea580c" bg="rgba(234,88,12,.1)">{row.generic_flag}</Badge>}
            <Badge color={row.existing_targeting?.startsWith('🆕') ? '#166534' : '#b45309'} bg={row.existing_targeting?.startsWith('🆕') ? 'rgba(22,101,52,.08)' : 'rgba(180,83,9,.08)'}>{row.existing_targeting}</Badge>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.purchases} orders</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>ROAS {row.roas?.toFixed(2)}x</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>${row.cost?.toFixed(2)} spend</span>
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>Bid ${row.suggested_bid}</span>
            {row.campaign_breakdown && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.campaign_breakdown}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {matchTypes.map((mt: string) => {
            const key = `harvest_${mt}_${row.search_term}`
            const isOn = selectedKeys.has(key)
            return <button key={mt} onClick={() => onToggle(key)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, border: '1px solid', background: isOn ? 'var(--accent)' : 'var(--surface2)', color: isOn ? '#fff' : 'var(--text)', borderColor: isOn ? 'var(--accent)' : 'var(--border)' }}>{isOn ? '✓ ' : ''}{mt}</button>
          })}
        </div>
      </div>
    </div>
  )
}

// ── HARVEST PT ROW ────────────────────────────────────────────────────────────

function HarvestPTRow({ row, selectedKeys, onToggle }: any) {
  const key  = `harvest_pt_${row.pt_expression}`
  const isOn = selectedKeys.has(key)
  return (
    <div style={{ border: `1px solid ${isOn ? 'var(--accent)' : 'rgba(15,118,110,.2)'}`, borderRadius: 8, background: isOn ? 'var(--accent-light)' : 'rgba(15,118,110,.03)', padding: '10px 14px', marginBottom: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{row.pt_expression}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.confidence}</span>
            <Badge color="#0f766e" bg="rgba(15,118,110,.08)">{row.pt_expression?.startsWith('asin=') ? 'ASIN target' : 'Match type'}</Badge>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.orders} orders</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>ROAS {row.roas?.toFixed(2)}x</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>${row.total_spend?.toFixed(2)} spend</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>{row.action}</div>
        </div>
        <button onClick={() => onToggle(key)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, border: '1px solid', background: isOn ? 'var(--accent)' : 'var(--surface2)', color: isOn ? '#fff' : 'var(--text)', borderColor: isOn ? 'var(--accent)' : 'var(--border)', flexShrink: 0 }}>
          {isOn ? '✓ Selected' : 'Select'}
        </button>
      </div>
    </div>
  )
}

// ── NGRAM TABLE ───────────────────────────────────────────────────────────────

function NGramTable({ rows, label }: { rows: any[]; label: string }) {
  const [exp, setExp] = useState(false)
  const visible = exp ? rows : rows.slice(0, 8)
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--surface2)' }}>
            {['N-gram','Apps','Spend','Wasted','Sales','ROAS','ACOS','Waste%'].map(h => (
              <th key={h} style={{ textAlign: 'left' as const, padding: '7px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{visible.map((row: any, i: number) => {
            const hi = row.roas < 1.0 || row.acos > 100
            return <tr key={row.ngram} style={{ background: hi ? 'rgba(220,38,38,.04)' : !hi && row.roas < 1.5 ? 'rgba(234,88,12,.03)' : i % 2 ? 'var(--surface2)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{row.ngram}</td>
              <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>{row.appearances}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>${row.total_cost?.toFixed(2)}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: hi ? '#dc2626' : 'var(--text)', fontWeight: hi ? 600 : 400 }}>${row.wasted_spend?.toFixed(2)}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>${row.total_sales?.toFixed(2)}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 600, color: row.roas >= 3 ? 'var(--accent)' : row.roas < 1 ? '#dc2626' : 'var(--text)' }}>{row.roas?.toFixed(2)}x</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{row.acos?.toFixed(1)}%</td>
              <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)' }}>{(row.waste_pct * 100)?.toFixed(1)}%</td>
            </tr>
          })}</tbody>
        </table>
        {rows.length > 8 && <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <button onClick={() => setExp(e => !e)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{exp ? '▲ Show less' : `▼ Show all ${rows.length} rows`}</button>
        </div>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── UPLOAD VIEW ───────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// ── PORTFOLIO SELECTOR VIEW ───────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioSelectorView({ portfolioSummary, selected, onSelect, onConfirm, onBack, uploadIds, orgId }: {
  portfolioSummary: any[]
  selected: string[]
  onSelect: (v: string[]) => void
  onConfirm: () => void
  onBack: () => void
  uploadIds: string[]
  orgId: string
}) {
  const supabase = createClient()
  const [analysedPortfolios, setAnalysedPortfolios] = useState<string[]>([])

  useEffect(() => {
    // Fetch which portfolios have already been analysed for this upload
    const load = async () => {
      const { data } = await supabase
        .from('ppc_decisions_log')
        .select('portfolio')
        .eq('org_id', orgId)
        .not('portfolio', 'is', null)
      // Also check analysis runs
      const { data: runs } = await supabase
        .from('ppc_analysis_runs')
        .select('portfolio')
        .eq('org_id', orgId)
        .not('portfolio', 'is', null)
        .not('results_json', 'is', null)
      const done = new Set([
        ...(data ?? []).map((r: any) => r.portfolio),
        ...(runs ?? []).map((r: any) => r.portfolio),
      ].filter(Boolean))
      setAnalysedPortfolios([...done])
    }
    load()
  }, [])
  const toggle = (name: string) => onSelect(
    selected.includes(name) ? selected.filter(p => p !== name) : [...selected, name]
  )
  const selectAll  = () => onSelect(portfolioSummary.map(p => p.name))
  const selectTop  = (n: number) => onSelect(portfolioSummary.slice(0, n).map(p => p.name))
  const clearAll   = () => onSelect([])

  const totalSpend    = portfolioSummary.reduce((s, p) => s + p.spend, 0)
  const selectedSpend = portfolioSummary.filter(p => selected.includes(p.name)).reduce((s, p) => s + p.spend, 0)
  const selectedRows  = portfolioSummary.filter(p => selected.includes(p.name)).reduce((s, p) => s + p.rows, 0)

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <button onClick={onBack} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>← Back to upload</button>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Select portfolios to analyse</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
        Choose which portfolios to run the analysis on. Fewer portfolios = faster analysis. De-select inactive or test portfolios.
      </div>

      {/* Summary bar */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Selected</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{selected.length} of {portfolioSummary.length} portfolios</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Selected spend</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>${selectedSpend.toFixed(0)} <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>of ${totalSpend.toFixed(0)}</span></div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Rows to analyse</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{selectedRows.toLocaleString()}</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Quick select buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[5, 10, 15].map(n => (
            <button key={n} onClick={() => selectTop(n)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text)' }}>
              Top {n}
            </button>
          ))}
          <button onClick={selectAll} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text)' }}>All</button>
          <button onClick={clearAll} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text)' }}>None</button>
        </div>
      </div>

      {/* Portfolio list */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {portfolioSummary.map((p, i) => {
          const isSelected = selected.includes(p.name)
          const isDone     = analysedPortfolios.includes(p.name)
          const pct        = totalSpend > 0 ? (p.spend / totalSpend * 100) : 0
          return (
            <div key={p.name} onClick={() => toggle(p.name)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer',
              background: isSelected ? 'var(--accent-light)' : isDone ? 'rgba(22,101,52,.04)' : 'var(--surface)',
              borderBottom: i < portfolioSummary.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(p.name)}
                onClick={e => e.stopPropagation()}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400 }}>{p.name}</span>
                  {isDone && <span style={{ fontSize: 10, color: '#166534', background: 'rgba(22,101,52,.1)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>✓ Done</span>}
                </div>
                <div style={{ background: 'var(--surface2)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: isSelected ? 'var(--accent)' : 'var(--border)', borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>${p.spend.toFixed(0)}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{p.rows.toLocaleString()} rows · {p.campaigns} camps</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', minWidth: 36, textAlign: 'right' as const }}>{pct.toFixed(1)}%</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          {selected.length === 0 && <span style={{ color: 'var(--red)' }}>Select at least one portfolio</span>}
          {selected.length > 0 && `${selected.length} portfolios · ${selectedRows.toLocaleString()} rows · ~${Math.max(10, Math.round(selectedRows / 1000 * 1.5))}s estimated`}
        </div>
        <button className="btn-primary" onClick={onConfirm} disabled={selected.length === 0}
          style={{ opacity: selected.length === 0 ? 0.5 : 1 }}>
          Analyse {selected.length === 1 ? selected[0] : `${selected.length} portfolios`} →
        </button>
      </div>
    </div>
  )
}

function inferType(n: string) { return n.includes('auto') ? 'auto' : n.includes('broad') ? 'broad' : n.includes('exact') ? 'exact' : n.includes('phrase') ? 'phrase' : 'other' }
function cleanName(f: string) { return f.replace(/\.(csv|xlsx)$/i,'').replace(/sponsored_products_searchterm[_\w]*/i,'').replace(/apr_\d+_\d+/i,'').replace(/__+/g,'_').replace(/^_+|_+$/g,'').replace(/_/g,' ').trim() || f.replace(/\.(csv|xlsx)$/i,'') }

interface FileEntry { file: File; campaignName: string; campaignType: string; error: string | null }

function UploadView({ brands, orgId, onDone }: { brands: string[]; orgId: string; onDone: (ids: string[], days: number, brand: string, isBulk: boolean, portfolios: string[], portfolioSummary: any[], donePorts?: string[]) => void }) {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)
  const [brand, setBrand]         = useState('')
  const [asin, setAsin]           = useState('')
  const [entries, setEntries]     = useState<FileEntry[]>([])
  const [dateRange, setDateRange] = useState(65)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const [uploading, setUploading]           = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [bulkDetected, setBulkDetected]     = useState(false)
  const [duplicateUploadId, setDuplicateUploadId] = useState<string | null>(null)

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => /\.(csv|xlsx)$/i.test(f.name))
    // Detect bulk file by name pattern
    const hasBulk = valid.some(f => f.name.includes('bulk-') || f.name.toLowerCase().includes('bulk'))
    if (hasBulk) setBulkDetected(true)
    setEntries(prev => {
      const ex = new Set(prev.map(e => e.file.name))
      return [...prev, ...valid.filter(f => !ex.has(f.name)).map(f => ({ file: f, campaignName: cleanName(f.name), campaignType: inferType(f.name.toLowerCase()), error: null }))]
    })
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { addFiles(Array.from(e.target.files)); e.target.value = '' }
  }, [addFiles])

  const handleUpload = async () => {
    setError(null)
    if (!entries.length) { setError('Add at least one file'); return }
    setUploading(true)
    try {
      const form = new FormData()
      entries.forEach(e => form.append('files', e.file))
      form.append('org_id', orgId)
      form.append('brand', brand)
      form.append('asin', asin)
      form.append('campaign_names', JSON.stringify(entries.map(e => e.campaignName.trim())))
      form.append('campaign_types', JSON.stringify(entries.map(e => e.campaignType)))
      form.append('date_range_days', String(dateRange))
      if (startDate) form.append('report_start_date', startDate)
      if (endDate)   form.append('report_end_date', endDate)

      const res  = await fetch('/api/ppc/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) {
        if (json.duplicate && json.existing_upload_id) {
          // Duplicate bulk file — offer to run analysis on existing upload
          setDuplicateUploadId(json.existing_upload_id)
          setError(json.error ?? 'Duplicate upload')
        } else {
          setError(json.error ?? 'Upload failed')
        }
        return
      }

      const firstUpload     = json.uploads[0]
      const isBulk          = firstUpload.is_bulk ?? false
      const portfolios      = firstUpload.portfolios ?? []
      const portfolioSummary = firstUpload.portfolio_summary ?? []
      const ids             = json.uploads.map((u: any) => u.upload_id)
      onDone(ids, dateRange, brand, isBulk, portfolios, portfolioSummary)
    } catch (err: any) { setError(err.message) }
    finally { setUploading(false) }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Upload search term reports</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
        Upload individual campaign CSVs <em>or</em> the Amazon bulk download file (auto-detected — splits by portfolio automatically).
      </div>

      {bulkDetected && (
        <div style={{ background: 'rgba(22,101,52,.08)', border: '1px solid rgba(22,101,52,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#166534', fontWeight: 600 }}>
          ✅ Bulk file detected — will analyse all portfolios automatically
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 12 }}>1 · Brand &amp; product</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Brand (optional for bulk)</div>
            <select value={brand} onChange={e => setBrand(e.target.value)} style={inp}>
              <option value="">Select brand…</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>ASIN (optional)</div>
            <input type="text" placeholder="B0XXXXXXXXX" value={asin} onChange={e => setAsin(e.target.value.toUpperCase())} style={{ ...inp, fontFamily: 'var(--mono)' }} />
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 10 }}>2 · Date range</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 10 }}>
          {DATE_RANGES.map(opt => (
            <button key={opt.value} onClick={() => setDateRange(opt.value)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: dateRange === opt.value ? 'var(--accent)' : 'var(--surface2)', color: dateRange === opt.value ? '#fff' : 'var(--text)', border: `1px solid ${dateRange === opt.value ? 'var(--accent)' : 'var(--border)'}`, fontWeight: dateRange === opt.value ? 600 : 400 }}>
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Start date (optional)</div><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} /></div>
          <div><div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>End date (optional)</div><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inp} /></div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 10 }}>3 · Upload files</div>
        <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)) }} onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '24px 20px', textAlign: 'center' as const, cursor: 'pointer', background: dragOver ? 'var(--accent-light)' : 'var(--surface2)', marginBottom: entries.length ? 12 : 0 }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>📂</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Drop files here or <span style={{ color: 'var(--accent)', textDecoration: 'underline' }}>click to browse</span></div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Bulk Amazon file or individual campaign CSVs · Hold Ctrl/Cmd to select multiple</div>
        </div>
        <input ref={fileRef} type="file" multiple accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleChange} />
        {entries.map((e, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: `1px solid ${e.error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 7, padding: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>📄 {e.file.name}</span>
              <button onClick={() => { setEntries(p => p.filter((_, j) => j !== i)); setBulkDetected(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, flexShrink: 0 }}>✕</button>
            </div>
            {!bulkDetected && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Campaign name</div>
                  <input type="text" value={e.campaignName} onChange={ev => setEntries(p => p.map((x, j) => j === i ? { ...x, campaignName: ev.target.value, error: null } : x))} placeholder="e.g. coir_basic_auto"
                    style={{ width: '100%', background: 'var(--surface)', border: `1px solid ${e.error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Type</div>
                  <select value={e.campaignType} onChange={ev => setEntries(p => p.map((x, j) => j === i ? { ...x, campaignType: ev.target.value } : x))}
                    style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
                    {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>
          ⚠️ {error}
          {duplicateUploadId && (
            <div style={{ marginTop: 8 }}>
              <button className="btn-primary" style={{ fontSize: 12 }}
                onClick={async () => {
                  // Fetch portfolio summary for this existing upload so selector can show it
                  const sb = (await import('@/lib/supabase')).createClient()
                  const { data: upload } = await sb.from('ppc_uploads')
                    .select('portfolios, portfolio_summary')
                    .eq('id', duplicateUploadId)
                    .single()
                  const portfolios       = upload?.portfolios ?? []
                  const portfolioSummary = upload?.portfolio_summary ?? []
                  // Check if any portfolios already analysed
                  const sb2 = (await import('@/lib/supabase')).createClient()
                  const { data: doneRuns } = await sb2.from('ppc_analysis_runs')
                    .select('portfolio')
                    .eq('is_bulk_run', true)
                    .not('portfolio', 'is', null)
                    .not('results_json', 'is', null)
                  const donePorts = (doneRuns ?? []).map((r: any) => r.portfolio).filter(Boolean)
                  onDone([duplicateUploadId!], dateRange, brand, true, portfolios, portfolioSummary, donePorts)
                }}>
                Run analysis on existing upload →
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={handleUpload} disabled={uploading || !entries.length} style={{ opacity: uploading || !entries.length ? 0.5 : 1 }}>
          {uploading ? '⟳ Uploading…' : entries.length === 0 ? 'Add files to continue' : `Upload ${entries.length} file${entries.length > 1 ? 's' : ''} & run analysis`}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ANALYSIS VIEW (Option A: sidebar + main panel) ────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisView({ uploadIds, dateRangeDays, brand, orgId, isBulk, portfolios: selectedPortfoliosIn, onBack, onSelectMore, onGoDecisions }: {
  uploadIds: string[]; dateRangeDays: number; brand: string; orgId: string
  isBulk: boolean; portfolios: string[]
  onBack: () => void; onSelectMore: () => void; onGoDecisions: (runId: string) => void
}) {
  const supabase = createClient()
  const [loading, setLoading]         = useState(true)
  const [progress, setProgress]       = useState(0)
  const [progressMsg, setProgressMsg] = useState('Starting analysis…')
  const [fromCache, setFromCache]     = useState(false)
  const [analysedAt, setAnalysedAt]   = useState<string | null>(null)
  const [results, setResults]         = useState<any>(null)
  const [runId, setRunId]             = useState<string | null>(null)
  const [loadError, setLoadError]     = useState('')
  const initialPortfolio = selectedPortfoliosIn[0] ?? ''
  const [activePortfolio, setActivePortfolio] = useState<string>(initialPortfolio)
  const [allPortfolioRuns, setAllPortfolioRuns] = useState<any[]>([])
  const portfolioCache = useRef<Map<string, any>>(new Map())
  const [activeTab, setActiveTab]     = useState<Tab>('kw_neg')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [decisionMap, setDecisionMap] = useState<Map<string, any>>(new Map())
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState('')
  const [saveError, setSaveError]     = useState('')
  const [prevRun, setPrevRun]         = useState<any>(null)
  const [prevDecs, setPrevDecs]       = useState<any[]>([])
  const [histExp, setHistExp]         = useState(false)

  const applyDecisions = (decisions: any[]) => {
    if (!decisions?.length) return
    const preMap = new Map<string, any>()
    for (const d of decisions) {
      let key = ''
      if (d.match_type === 'negative_phrase')     key = 'neg_phrase_' + d.term
      else if (d.match_type === 'negative_exact') key = 'neg_exact_' + d.term
      else if (d.match_type === 'negative_pt')    key = 'neg_pt_' + d.term
      else if (d.match_type === 'harvest_pt')     key = 'harvest_pt_' + d.term
      else if (d.match_type.startsWith('harvest_')) {
        const mtPart = d.match_type.replace('harvest_', '')
        key = 'harvest_' + mtPart.charAt(0).toUpperCase() + mtPart.slice(1) + '_' + d.term
      }
      if (key) preMap.set(key, { status: d.status, campaigns: d.campaign_names ?? [], notes: d.notes ?? '', portfolio: d.portfolio })
    }
    setDecisionMap(preMap)
    setSelected(new Set(preMap.keys()))
  }

  const runAnalysis = useCallback(async (force = false) => {
    // For bulk: need a portfolio to analyse
    if (isBulk && !initialPortfolio) { onSelectMore(); return }
    setLoading(true); setLoadError(''); setProgress(0)

    const steps = [
      [10, 'Fetching data from database…'],
      [25, 'Loading search term rows…'],
      [45, 'Running n-gram analysis…'],
      [60, 'Analysing PT targets…'],
      [75, 'Scoring harvest candidates…'],
      [88, 'Building results…'],
      [95, 'Finalising…'],
    ]
    let stepIdx = 0
    const ticker = setInterval(() => {
      if (stepIdx < steps.length) {
        const [pct, msg] = steps[stepIdx++]
        setProgress(pct as number)
        setProgressMsg(msg as string)
      }
    }, 1200)

    try {
      const res = await fetch('/api/ppc/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_ids: uploadIds, date_range_days: dateRangeDays, org_id: orgId, brand, force, portfolio: initialPortfolio || undefined }),
      })
      clearInterval(ticker)
      setProgress(98); setProgressMsg('Processing results…')

      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) }
      catch { throw new Error('Server error (' + res.status + ') — timed out or unavailable.') }

      if (!res.ok) throw new Error(json.error ?? 'Analysis failed')
      setProgress(100); setProgressMsg('Done!')
      setResults(json.results)
      setRunId(json.analysis_run_id)
      setFromCache(json.from_cache ?? false)
      setAnalysedAt(json.analysed_at ?? null)

      const activePF = json.portfolio || initialPortfolio || ''
      setActivePortfolio(activePF)

      // Cache for instant switching
      if (activePF) {
        portfolioCache.current.set(activePF, { results: json.results, runId: json.analysis_run_id, analysedAt: json.analysed_at })
      }

      // Load all portfolio runs for sidebar (bulk only)
      if (isBulk && uploadIds[0]) {
        const runsRes = await fetch('/api/ppc/analyse?upload_id=' + uploadIds[0] + '&org_id=' + orgId)
        const runsJson = await runsRes.json()
        if (runsJson.portfolio_runs) setAllPortfolioRuns(runsJson.portfolio_runs)
      }

      applyDecisions(json.existing_decisions)

    } catch (err: any) { clearInterval(ticker); setLoadError(err.message) }
    finally { setLoading(false) }
  }, [uploadIds, dateRangeDays, orgId, brand, isBulk, initialPortfolio])

  useEffect(() => { runAnalysis(false) }, [runAnalysis])

  // [D2] toggle with auto-pre-select recommended campaigns
  const toggle = (key: string, recCampaigns?: string[]) => {
    setSelected(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
    setDecisionMap(p => {
      if (p.has(key)) return p
      const n = new Map(p)
      n.set(key, { status: 'pending', campaigns: recCampaigns ?? [], notes: '' })
      return n
    })
  }

  const update = (key: string, field: string, value: any) => setDecisionMap(p => {
    const n = new Map(p)
    n.set(key, { ...(n.get(key) ?? { status:'pending', campaigns:[], notes:'' }), [field]: value })
    return n
  })

  const buildDecisions = (portData: any, portfolio: string) => {
    const out: any[] = []
    for (const row of [...(portData.phrase_high ?? []), ...(portData.phrase_medium ?? [])]) {
      const key = `neg_phrase_${row.ngram}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
      out.push({ term: row.ngram, match_type: 'negative_phrase', priority: row.priority, portfolio, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: row.wasted_spend, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (portData.exact_negatives ?? [])) {
      const key = `neg_exact_${row.search_term}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
      out.push({ term: row.search_term, match_type: 'negative_exact', priority: 'HIGH', portfolio, campaign_names: d.campaigns, roas_at_decision: 0, wasted_at_decision: row.wasted_spend, purchases_at_decision: 0, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (portData.toxic_combos ?? []).slice(0, 3)) {
      const key = `toxic_${row.ngram}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns: row.recommended_scope?.split(', ')??[], notes:'' }
      out.push({ term: row.ngram, match_type: 'negative_phrase', priority: 'HIGH', portfolio, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: row.wasted_spend, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (portData.pt_negatives ?? [])) {
      const key = `neg_pt_${row.pt_expression}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns: row.campaigns??[], notes:'' }
      out.push({ term: row.pt_expression, match_type: 'negative_pt', priority: row.priority, portfolio, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: row.total_spend, purchases_at_decision: 0, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (portData.harvest_candidates ?? [])) {
      for (const mt of (row.match_types?.split(', ') ?? ['Phrase'])) {
        const key = `harvest_${mt}_${row.search_term}`; if (!selected.has(key)) continue
        const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
        out.push({ term: row.search_term, match_type: `harvest_${mt.toLowerCase()}`, priority: row.confidence?.includes('⭐⭐⭐') ? 'HIGH' : 'MEDIUM', portfolio, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: 0, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: !!row.generic_flag })
      }
    }
    for (const row of (portData.pt_harvest ?? [])) {
      const key = `harvest_pt_${row.pt_expression}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns: row.campaigns??[], notes:'' }
      out.push({ term: row.pt_expression, match_type: 'harvest_pt', priority: row.confidence?.includes('⭐⭐⭐') ? 'HIGH' : 'MEDIUM', portfolio, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: 0, purchases_at_decision: row.orders, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    return out
  }

  const handleSave = async () => {
    if (!runId || !selected.size) return
    setSaving(true); setSaveError('')
    try {
      const portData   = getActivePortfolioData()
      const portfolio  = activePortfolio === '__account__' ? '' : activePortfolio
      const decisions  = buildDecisions(portData, portfolio)
      if (!decisions.length) { setSaveError('No decisions to save'); setSaving(false); return }
      const res = await fetch('/api/ppc/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, brand, analysis_run_id: runId, decisions }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setToast(`✅ ${json.saved} decision${json.saved > 1 ? 's' : ''} logged`)  // [D10]
      setSelected(new Set())
      setTimeout(() => setToast(''), 4000)
    } catch (err: any) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  const getActivePortfolioData = () => {
    if (!results) return {}
    // New model: each portfolio run has flat results (not nested portfolio_results)
    // results IS the portfolio data directly
    return results ?? {}
  }

  const loadPortfolio = async (portfolioName: string, forceRefresh = false) => {
    if (activePortfolio === portfolioName && !forceRefresh) return

    // Check local cache first — instant switch
    if (!forceRefresh && portfolioCache.current.has(portfolioName)) {
      const cached = portfolioCache.current.get(portfolioName)
      setResults(cached.results); setRunId(cached.runId)
      setFromCache(true); setAnalysedAt(cached.analysedAt)
      setActivePortfolio(portfolioName); setActiveTab('kw_neg')
      setSelected(new Set()); setDecisionMap(new Map())
      return
    }

    setLoading(true); setLoadError('')
    try {
      const res  = await fetch('/api/ppc/analyse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_ids: uploadIds, date_range_days: dateRangeDays, org_id: orgId, brand, force: forceRefresh, portfolio: portfolioName }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      portfolioCache.current.set(portfolioName, { results: json.results, runId: json.analysis_run_id, analysedAt: json.analysed_at })
      setResults(json.results); setRunId(json.analysis_run_id)
      setFromCache(json.from_cache ?? true); setAnalysedAt(json.analysed_at ?? null)
      setActivePortfolio(portfolioName); setActiveTab('kw_neg')
      setSelected(new Set()); setDecisionMap(new Map())
      applyDecisions(json.existing_decisions)
    } catch (e: any) { setLoadError(e.message) }
    finally { setLoading(false) }
  }

  if (loading) return (
    <div style={{ padding: 48, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ textAlign: 'center' as const, marginBottom: 24 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Running analysis…</div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{progressMsg}</div>
      </div>
      <div style={{ background: 'var(--surface2)', borderRadius: 8, height: 8, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ height: '100%', borderRadius: 8, background: 'var(--accent)', width: `${progress}%`, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)' }}>
        <span>{progress}% complete</span>
        {isBulk && <span>All portfolios · bulk run</span>}
      </div>
      {isBulk && progress < 50 && (
        <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', fontSize: 12, color: 'var(--text3)' }}>
          ℹ️ First bulk run takes 30-60 seconds. Results are saved — future opens are instant.
        </div>
      )}
    </div>
  )

  if (loadError) return (
    <div style={{ padding: 24 }}>
      <div style={{ color: 'var(--red)', marginBottom: 12 }}>⚠️ {loadError}</div>
      <button className="btn-secondary" onClick={onBack}>← Back</button>
    </div>
  )

  if (!results) return null

  const portData   = getActivePortfolioData()
  const summary    = portData.summary ?? {}

  // Pre-compute campaign table rows — must be after summary/portData declarations
  const campMap: Record<string, { spend: number; wasted: number; high: number }> = {}
  for (const c of (summary.campaigns ?? [])) campMap[c] = { spend: 0, wasted: 0, high: 0 }
  for (const row of (portData.phrase_high ?? [])) {
    for (const c of (row.camp_breakdown ?? [])) {
      if (campMap[c.name]) { campMap[c.name].spend += c.spend ?? 0; campMap[c.name].wasted += (c.roas < 1.0 ? c.spend : 0) ?? 0; campMap[c.name].high++ }
    }
  }
  const campTableRows = Object.entries(campMap).sort((a, b) => b[1].wasted - a[1].wasted).filter(([, v]) => v.spend > 0)

  const tabCounts: Record<Tab, number> = {
    kw_neg:     (portData.phrase_high?.length ?? 0) + (portData.phrase_medium?.length ?? 0) + (portData.exact_negatives?.length ?? 0),
    pt_neg:     portData.pt_negatives?.length ?? 0,
    harvest_kw: portData.harvest_candidates?.length ?? 0,
    harvest_pt: portData.pt_harvest?.length ?? 0,
    ngrams:     0,
  }

  const exportCSV = () => {
    const rows: string[][] = [['Type', 'Term/Expression', 'Match Type', 'Priority', 'Wasted $', 'ROAS', 'Appearances', 'Recommended Campaigns']]
    for (const r of (portData.phrase_high ?? [])) {
      rows.push(['Negative', r.ngram, 'Phrase', 'HIGH', r.wasted_spend?.toFixed(2), r.roas?.toFixed(2), r.appearances, r.recommended_scope ?? ''])
    }
    for (const r of (portData.phrase_medium ?? [])) {
      rows.push(['Negative', r.ngram, 'Phrase', 'MEDIUM', r.wasted_spend?.toFixed(2), r.roas?.toFixed(2), r.appearances, r.recommended_scope ?? ''])
    }
    for (const r of (portData.exact_negatives ?? [])) {
      rows.push(['Negative', r.search_term, 'Exact', 'HIGH', r.wasted_spend?.toFixed(2), '0', '', r.campaigns ?? ''])
    }
    for (const r of (portData.pt_negatives ?? [])) {
      rows.push(['PT Negative', r.pt_expression, 'Product Target', r.priority, r.wasted_spend?.toFixed(2), r.roas?.toFixed(2), '', r.recommended_scope ?? ''])
    }
    for (const r of (portData.harvest_candidates ?? [])) {
      rows.push(['Harvest', r.search_term, r.match_types, r.confidence, '', r.roas?.toFixed(2), r.purchases, ''])
    }
    for (const r of (portData.pt_harvest ?? [])) {
      rows.push(['PT Harvest', r.pt_expression, 'Product Target', r.confidence, '', r.roas?.toFixed(2), r.orders, ''])
    }
    const csv = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = (activePortfolio || 'ppc-analysis') + '-' + new Date().toISOString().slice(0,10) + '.csv'
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>

      {/* ── LEFT SIDEBAR — all analysed portfolios ─────────────────────────── */}
      {isBulk && (
        <div style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '14px 8px', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', padding: '0 8px 8px' }}>
            Portfolios ({allPortfolioRuns.length} analysed)
          </div>

          {allPortfolioRuns.map((p: any) => {
            const hc       = HEALTH_COLORS[p.health as Health] ?? HEALTH_COLORS.green
            const isActive = activePortfolio === p.portfolio
            return (
              <div key={p.portfolio} onClick={() => loadPortfolio(p.portfolio)} style={{
                padding: '7px 10px', borderRadius: 6, marginBottom: 2, cursor: 'pointer',
                background: isActive ? 'var(--accent-light)' : 'transparent',
                border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 }}>
                    {p.portfolio}
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: hc.dot, flexShrink: 0, marginLeft: 6 }} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {p.high_negatives > 0 && <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 600 }}>{p.high_negatives} HIGH</span>}
                  <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>${(p.total_wasted ?? 0).toFixed(0)} wasted</span>
                </div>
              </div>
            )
          })}

          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
            <button onClick={onSelectMore} style={{ width: '100%', fontSize: 11, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', color: 'var(--text)', textAlign: 'left' as const, marginBottom: 8 }}>
              ＋ Analyse another portfolio
            </button>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              {(['red','amber','green'] as Health[]).map(c => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: HEALTH_COLORS[c].dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{{ red: '> 30% wasted', amber: '15–30% wasted', green: 'Clean' }[c]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN PANEL ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '20px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <button onClick={onBack} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>← PPC Manager</button>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {activePortfolio || 'PPC analysis results'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
              {summary.date_range_days}-day
              {brand && <> · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{brand}</span></>}
              {summary.campaigns?.length > 0 && <> · <span style={{ color: 'var(--text3)' }}>{summary.campaigns?.length} campaigns</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {fromCache && analysedAt && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Saved {new Date(analysedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {fromCache && (
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => loadPortfolio(activePortfolio, true)} title="Re-run the analysis engine with latest data">
                🔄 Refresh analysis
              </button>
            )}
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={exportCSV}>⬇ Export CSV</button>
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => runId && onGoDecisions(runId)}>View decisions log</button>
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onBack}>← Back to uploads</button>

          </div>
        </div>

        {/* History callout */}
        {prevRun && (
          <div style={{ background: 'rgba(29,78,216,.04)', border: '1px solid rgba(29,78,216,.18)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
            <div onClick={() => setHistExp(e => !e)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📋</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Last analysis: {Math.floor((Date.now() - new Date(prevRun.run_at).getTime()) / 86400000)} days ago</span>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>${prevRun.total_spend?.toFixed(2)} · {prevRun.high_negatives} HIGH</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {prevDecs.filter(d => d.status === 'actioned').length > 0 && <Badge color="#166534" bg="rgba(22,101,52,.1)">✅ {prevDecs.filter(d=>d.status==='actioned').length} actioned</Badge>}
                {prevDecs.filter(d => d.status === 'not_actioning').length > 0 && <Badge color="#6b7280" bg="rgba(107,114,128,.1)">⏸ {prevDecs.filter(d=>d.status==='not_actioning').length} skipped</Badge>}
                <span style={{ fontSize: 12, color: 'var(--text3)', transition: 'transform .15s', transform: histExp ? 'rotate(180deg)' : 'none' }}>▾</span>
              </div>
            </div>
            {histExp && prevDecs.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(29,78,216,.15)', padding: '10px 14px' }}>
                {prevDecs.map((d, i) => {
                  const mtc = MT_COLORS[d.match_type] ?? { color: '#6b7280', bg: 'rgba(107,114,128,.08)' }
                  const st  = STATUS[d.status]
                  return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < prevDecs.length-1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ flexShrink: 0 }}>{st?.icon ?? '⏳'}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, flex: 1 }}>{d.term}</span>
                    <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type] ?? d.match_type}</Badge>
                  </div>
                })}
              </div>
            )}
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          <StatCard label="Total spend"       value={`$${(summary.total_spend ?? 0).toFixed(2)}`} />
          <StatCard label="Overall ROAS"      value={`${(summary.overall_roas ?? 0).toFixed(2)}x`} sub={`ACOS ${(summary.overall_acos ?? 0).toFixed(1)}%`} />
          <StatCard label="Wasted spend"      value={`$${(summary.total_wasted ?? 0).toFixed(2)}`} sub={`${((summary.wasted_pct ?? 0) * 100).toFixed(1)}% of spend`} accent />
          <StatCard label="Addressable waste" value={`$${(summary.addressable_waste ?? 0).toFixed(2)}`} />
        </div>

        {/* Campaign summary table */}
        {campTableRows.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>📢 Campaign breakdown</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Wasted spend by campaign — highest priority first</span>
              </div>
              <div style={{ overflowX: 'auto' as const }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                  <thead><tr style={{ background: 'var(--surface2)' }}>
                    {['Campaign', 'Wasted spend', 'HIGH terms', 'Action'].map(h => (
                      <th key={h} style={{ textAlign: 'left' as const, padding: '6px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {camps.map(([name, v], i) => (
                      <tr key={name} style={{ borderBottom: i < camps.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '7px 12px', fontWeight: 500, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{name}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: v.wasted > 0 ? '#dc2626' : 'var(--text3)', fontWeight: v.wasted > 0 ? 700 : 400 }}>${v.wasted.toFixed(2)}</td>
                        <td style={{ padding: '7px 12px' }}>{v.high > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>{v.high} HIGH</span> : <span style={{ color: 'var(--text3)' }}>—</span>}</td>
                        <td style={{ padding: '7px 12px', fontSize: 11, color: v.wasted > 20 ? '#dc2626' : 'var(--text3)' }}>
                          {v.wasted > 20 ? '⚠️ Negate terms in this campaign' : v.wasted > 0 ? 'Review negatives' : '✅ Clean'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
        )}

        {/* Clickable insight cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          {([
            { icon:'🔴', label:`${(portData.phrase_high?.length??0)+(portData.exact_negatives?.length??0)} kw negatives`,  sub:'Keyword terms to negate',       tab:'kw_neg'     as Tab, bg:'rgba(220,38,38,.06)', border:'rgba(220,38,38,.2)'   },
            { icon:'🟣', label:`${portData.pt_negatives?.length??0} PT negatives`,       sub:'Product targets to exclude',   tab:'pt_neg'     as Tab, bg:'rgba(124,58,237,.06)', border:'rgba(124,58,237,.2)' },
            { icon:'🚀', label:`${portData.harvest_candidates?.length??0} harvest kw`,   sub:'Keywords to push',             tab:'harvest_kw' as Tab, bg:'rgba(22,101,52,.06)',  border:'rgba(22,101,52,.2)'  },
            { icon:'🎯', label:`${portData.pt_harvest?.length??0} harvest PT`,           sub:'ASIN targets to expand',       tab:'harvest_pt' as Tab, bg:'rgba(15,118,110,.06)', border:'rgba(15,118,110,.2)' },
          ] as any[]).map(item => (
            <div key={item.label} onClick={() => setActiveTab(item.tab)} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{item.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{item.sub}</div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>→</span>
            </div>
          ))}
        </div>

        {/* Toast / error */}
        {toast && <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{toast} {runId && <button onClick={() => onGoDecisions(runId!)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontSize: 13, padding: 0 }}>View decisions log →</button>}</div>}
        {saveError && <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>⚠️ {saveError}</div>}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 8, padding: 3, marginBottom: 14, width: 'fit-content' }}>
          {([
            { key:'kw_neg',     label:'Kw negatives'  },
            { key:'pt_neg',     label:'PT negatives'  },
            { key:'harvest_kw', label:'Harvest kw'    },
            { key:'harvest_pt', label:'Harvest PT'    },
            { key:'ngrams',     label:'N-gram tables' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 5, background: activeTab === t.key ? 'var(--surface)' : 'transparent', color: activeTab === t.key ? 'var(--text)' : 'var(--text3)', fontWeight: activeTab === t.key ? 600 : 400, boxShadow: activeTab === t.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
              {t.label}
              {tabCounts[t.key] > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: activeTab === t.key ? 'var(--accent)' : 'var(--surface3)', color: activeTab === t.key ? '#fff' : 'var(--text3)' }}>{tabCounts[t.key]}</span>}
            </button>
          ))}
        </div>

        {/* ── KW NEGATIVES TAB ─────────────────────────────────────────────── */}
        {activeTab === 'kw_neg' && (
          <div>
            {(portData.phrase_high?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <SectionTitle label="HIGH priority phrase negatives" sub="ROAS < 1.0 or ACOS > 100% · negate now" color="#dc2626" />
                  <button onClick={() => portData.phrase_high.forEach((r: any) => { if (!selected.has(`neg_phrase_${r.ngram}`)) toggle(`neg_phrase_${r.ngram}`, r.recommended_scope?.split(', ')) })}
                    style={{ fontSize: 11, background: 'rgba(220,38,38,.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,.2)', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', fontWeight: 600, marginLeft: 4 }}>
                    ☑ Select all HIGH
                  </button>
                </div>
                {portData.phrase_high.map((r: any) => <NegRow key={r.ngram} row={r} keyStr={`neg_phrase_${r.ngram}`} selected={selected} decision={decisionMap.get(`neg_phrase_${r.ngram}`)} onToggle={(k: string) => toggle(k, r.recommended_scope?.split(', '))} onUpdate={update} campaigns={summary.campaigns ?? []} />)}
              </div>
            )}
            {(portData.phrase_medium?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionTitle label="MEDIUM priority phrase negatives" sub="ROAS 1.0–1.49 · negate + monitor" color="#ea580c" />
                {portData.phrase_medium.map((r: any) => <NegRow key={r.ngram} row={r} keyStr={`neg_phrase_${r.ngram}`} selected={selected} decision={decisionMap.get(`neg_phrase_${r.ngram}`)} onToggle={(k: string) => toggle(k, r.recommended_scope?.split(', '))} onUpdate={update} campaigns={summary.campaigns ?? []} />)}
              </div>
            )}
            {(portData.exact_negatives?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionTitle label="Exact match negatives" sub="$15+ wasted · 0 purchases" color="#dc2626" />
                {portData.exact_negatives.map((r: any) => <NegRow key={r.search_term} row={r} keyStr={`neg_exact_${r.search_term}`} selected={selected} decision={decisionMap.get(`neg_exact_${r.search_term}`)} onToggle={(k: string) => toggle(k, r.campaigns?.split(', '))} onUpdate={update} campaigns={summary.campaigns ?? []} isExact />)}
              </div>
            )}
            {(portData.toxic_combos?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 18 }}>
                <SectionTitle label="⚡ Toxic combinations — phrase negatives" sub="Each word converts well alone but ROAS < 1.0 combined" color="#ea580c" />
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, paddingLeft: 16 }}>Negating the phrase won't block individual words from converting.{portData.toxic_combos.length > 3 && <span style={{ marginLeft: 6, color: 'var(--accent)' }}>Showing top 3 of {portData.toxic_combos.length} — see N-gram tables for full list.</span>}</div>
                {(portData.toxic_combos.slice(0, 3)).map((row: any) => (
                  <div key={row.ngram} style={{ border: `1px solid ${selected.has(`toxic_${row.ngram}`) ? 'var(--accent)' : 'rgba(234,88,12,.25)'}`, borderRadius: 8, background: selected.has(`toxic_${row.ngram}`) ? 'var(--accent-light)' : 'rgba(234,88,12,.03)', padding: '10px 14px', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={selected.has(`toxic_${row.ngram}`)} onChange={() => toggle(`toxic_${row.ngram}`, row.recommended_scope?.split(', '))} style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>{row.ngram}</span>
                      <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>{row.combo_type}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'var(--mono)' }}>${row.wasted_spend?.toFixed(2)} wasted</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS {row.roas?.toFixed(2)}x</span>
                    </div>
                    <div style={{ paddingLeft: 25, marginTop: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{row.reason}</div>
                      {row.camp_breakdown?.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: selected.has(`toxic_${row.ngram}`) ? 8 : 0 }}>
                          {row.camp_breakdown.map((c: any) => (
                            <span key={c.name} style={{ fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px' }}>
                              <span style={{ fontWeight: 600 }}>{c.name}</span>
                              <span style={{ color: 'var(--text3)', marginLeft: 6 }}>${c.spend.toFixed(2)} · ROAS {c.roas.toFixed(2)}x</span>
                              {c.roas < 1.0 && c.spend >= 10 && <span style={{ color: '#dc2626', marginLeft: 4, fontWeight: 600 }}>← negate here</span>}
                              {c.roas < 1.0 && c.spend < 10 && <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: 10 }}>low spend</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      {selected.has(`toxic_${row.ngram}`) && (() => {
                        const d = decisionMap.get(`toxic_${row.ngram}`) ?? { status:'pending', campaigns: row.recommended_scope?.split(', ')??[], notes:'' }
                        return <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 10, marginTop: 4 }}>
                          <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Status</div>
                          <select value={d.status} onChange={e => update(`toxic_${row.ngram}`, 'status', e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>{Object.entries(STATUS).filter(([v]) => v !== 'reversed').map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}</select></div>
                          <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Apply to campaigns <span style={{ color: '#dc2626', fontWeight: 400, textTransform: 'none' as const }}>— red = recommended</span></div>
                          <CampButtons campaigns={summary.campaigns??[]} selected={d.campaigns} recommendedScope={row.recommended_scope} onUpdate={update} updateKey={`toxic_${row.ngram}`} /></div>
                          <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Notes</div><input type="text" value={d.notes??''} placeholder="Optional…" onChange={e => update(`toxic_${row.ngram}`, 'notes', e.target.value)} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)', boxSizing: 'border-box' as const }} /></div>
                        </div>
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(portData.phrase_watch?.length ?? 0) > 0 && <div style={{ background: 'rgba(202,138,4,.06)', border: '1px solid rgba(202,138,4,.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 600, color: '#ca8a04', marginBottom: 3 }}>🟡 Watch list — {portData.phrase_watch.length} items</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>Below significance threshold. Re-review after 30 more days.</div></div>}
            {tabCounts.kw_neg === 0 && <div className="empty" style={{ height: 120 }}><div className="ei">✅</div><div>No actionable keyword negatives for this portfolio</div></div>}
            {selected.size > 0 && <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} decision{selected.size > 1 ? 's' : ''} ready to log</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, opacity: saving ? 0.6 : 1 }}>{saving ? '⟳ Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}</button>
              </div>
            </div>}
          </div>
        )}

        {/* ── PT NEGATIVES TAB ─────────────────────────────────────────────── */}
        {activeTab === 'pt_neg' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
              Product targeting expressions with ROAS &lt; 1.0 and $10+ spend. These are the ASINs or match types (close-match, loose-match, substitutes) you're targeting that aren't converting.
            </div>
            {(portData.pt_negatives?.length ?? 0) > 0
              ? portData.pt_negatives.map((r: any) => <PTNegRow key={r.pt_expression} row={r} keyStr={`neg_pt_${r.pt_expression}`} selected={selected} decision={decisionMap.get(`neg_pt_${r.pt_expression}`)} onToggle={(k: string) => toggle(k, r.campaigns)} onUpdate={update} />)
              : <div className="empty" style={{ height: 120 }}><div className="ei">✅</div><div>No negative PT targets found for this portfolio</div></div>
            }
            {selected.size > 0 && <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} decision{selected.size > 1 ? 's' : ''} ready to log</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, opacity: saving ? 0.6 : 1 }}>{saving ? '⟳ Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}</button>
              </div>
            </div>}
          </div>
        )}

        {/* ── HARVEST KW TAB ───────────────────────────────────────────────── */}
        {activeTab === 'harvest_kw' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>ROAS ≥ 3.0 · $20+ spend · 3+ purchases · ranked by conviction. Click match type buttons to select for logging.</div>
            {(portData.harvest_candidates?.length ?? 0) > 0
              ? portData.harvest_candidates.map((r: any) => <HarvestRow key={r.search_term} row={r} selectedKeys={selected} onToggle={toggle} decisionMap={decisionMap} onUpdate={update} />)
              : <div className="empty" style={{ height: 120 }}><div className="ei">🔍</div><div>No harvest keyword candidates for this portfolio</div></div>
            }
            {selected.size > 0 && <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, opacity: saving ? 0.6 : 1 }}>{saving ? '⟳ Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}</button>
              </div>
            </div>}
          </div>
        )}

        {/* ── HARVEST PT TAB ───────────────────────────────────────────────── */}
        {activeTab === 'harvest_pt' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
              Product targeting expressions with ROAS ≥ 3.0, $20+ spend, 3+ orders. These are ASIN or match type targets already converting — consider expanding them with explicit targeted campaigns.
            </div>
            {(portData.pt_harvest?.length ?? 0) > 0
              ? portData.pt_harvest.map((r: any) => <HarvestPTRow key={r.pt_expression} row={r} selectedKeys={selected} onToggle={toggle} />)
              : <div className="empty" style={{ height: 120 }}><div className="ei">🎯</div><div>No harvest PT candidates for this portfolio</div></div>
            }
            {selected.size > 0 && <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize: 12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 12, opacity: saving ? 0.6 : 1 }}>{saving ? '⟳ Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}</button>
              </div>
            </div>}
          </div>
        )}

        {/* ── NGRAMS TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'ngrams' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>Red = ROAS &lt; 1.0 · Orange = ROAS 1.0–1.49. Keyword rows only.</div>
            <NGramTable rows={portData.ngrams?.uni ?? []} label="Unigrams" />
            <NGramTable rows={portData.ngrams?.bi  ?? []} label="Bigrams" />
            <NGramTable rows={portData.ngrams?.tri ?? []} label="Trigrams" />
            {(portData.toxic_combos?.length ?? 0) > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>⚡ All toxic combinations ({portData.toxic_combos.length})</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Top 3 are actionable in the Kw negatives tab.</div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
                    <thead><tr style={{ background: 'var(--surface2)' }}>{['Phrase','Type','Wasted','ROAS','ACOS','Why toxic'].map(h => <th key={h} style={{ textAlign: 'left' as const, padding: '7px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                    <tbody>{portData.toxic_combos.map((r: any, i: number) => <tr key={r.ngram} style={{ background: i%2?'var(--surface2)':'var(--surface)', borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'7px 10px',fontFamily:'var(--mono)',fontWeight:600 }}>{r.ngram}</td>
                      <td style={{ padding:'7px 10px',color:'var(--text3)' }}>{r.combo_type}</td>
                      <td style={{ padding:'7px 10px',fontFamily:'var(--mono)',color:'#dc2626',fontWeight:600 }}>${r.wasted_spend?.toFixed(2)}</td>
                      <td style={{ padding:'7px 10px',fontFamily:'var(--mono)' }}>{r.roas?.toFixed(2)}x</td>
                      <td style={{ padding:'7px 10px',fontFamily:'var(--mono)' }}>{r.acos?.toFixed(1)}%</td>
                      <td style={{ padding:'7px 10px',fontSize:11,color:'var(--text3)' }}>{r.reason}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── DECISIONS VIEW ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function DecisionsView({ orgId, brands, initialRunId, onBack }: { orgId: string; brands: string[]; initialRunId?: string; onBack: () => void }) {
  const supabase = createClient()
  const [decisions, setDecisions] = useState<any[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [updating, setUpdating]   = useState(false)
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkNotes, setBulkNotes]   = useState('')
  const [updateMsg, setUpdateMsg]   = useState('')
  const [brandFilter,     setBrandFilter]     = useState('')
  const [statusFilter,    setStatusFilter]    = useState('')
  const [typeFilter,      setTypeFilter]      = useState('')
  const [portfolioFilter, setPortfolioFilter] = useState('')
  const [runFilter,       setRunFilter]       = useState(initialRunId ?? '')
  const [termSearch,      setTermSearch]      = useState('')

  const portfolios = [...new Set(decisions.map(d => d.portfolio).filter(Boolean))].sort()

  useEffect(() => { fetchDecisions() }, [brandFilter, statusFilter, typeFilter, runFilter, portfolioFilter])

  const fetchDecisions = async () => {
    setLoading(true)
    const p = new URLSearchParams({ org_id: orgId, limit: '200' })
    if (brandFilter)     p.set('brand', brandFilter)
    if (statusFilter)    p.set('status', statusFilter)
    if (typeFilter)      p.set('match_type', typeFilter)
    if (runFilter)       p.set('analysis_run_id', runFilter)
    if (portfolioFilter) p.set('portfolio', portfolioFilter)
    const res  = await fetch(`/api/ppc/decisions?${p}`)
    const json = await res.json()
    if (res.ok) { setDecisions(json.decisions ?? []); setTotal(json.total ?? 0) }
    setLoading(false)
  }

  const handleBulkUpdate = async () => {
    if (!bulkStatus || !selected.size) return
    setUpdating(true)
    try {
      const res = await fetch('/api/ppc/decisions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selected], status: bulkStatus, notes: bulkNotes || undefined }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUpdateMsg(`✅ Updated ${json.updated}`)
      setSelected(new Set()); setBulkStatus(''); setBulkNotes('')
      fetchDecisions(); setTimeout(() => setUpdateMsg(''), 3000)
    } catch (err: any) { setUpdateMsg(`⚠️ ${err.message}`) }
    finally { setUpdating(false) }
  }

  const filtered = decisions.filter(d =>
    (!termSearch || d.term.toLowerCase().includes(termSearch.toLowerCase()))
  )
  // Group by portfolio, then within each portfolio by type (Negatives / Harvest)
  const grouped: Record<string, { portfolio: string; brand: string; negatives: any[]; harvest: any[]; pts: any[] }> = {}
  for (const d of filtered) {
    const port = d.portfolio || 'Unassigned'
    if (!grouped[port]) grouped[port] = { portfolio: port, brand: d.brand ?? '', negatives: [], harvest: [], pts: [] }
    const isNeg     = d.match_type?.startsWith('negative')
    const isHarvest = d.match_type?.startsWith('harvest')
    const isPT      = d.match_type?.includes('pt')
    if (isHarvest && isPT)      grouped[port].pts.push(d)
    else if (isHarvest)         grouped[port].harvest.push(d)
    else if (isNeg && isPT)     grouped[port].pts.push(d)
    else                        grouped[port].negatives.push(d)
  }
  // Sort portfolios by number of decisions
  const sortedPortfolios = Object.entries(grouped).sort((a, b) => 
    (b[1].negatives.length + b[1].harvest.length + b[1].pts.length) - 
    (a[1].negatives.length + a[1].harvest.length + a[1].pts.length)
  )
  const statusCounts = Object.fromEntries(Object.keys(STATUS).map(s => [s, decisions.filter(d => d.status === s).length]))
  const inp: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px', fontSize: 12, color: 'var(--text)' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <button onClick={onBack} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>← PPC Manager</button>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Decisions log</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{total} total decisions</div>
        </div>
        <button className="btn-primary" onClick={onBack} style={{ fontSize: 12 }}>＋ New analysis</button>
      </div>

      {/* Status pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' as const }}>
        {Object.entries(STATUS).map(([k, s]) => {
          const count = statusCounts[k] ?? 0; if (!count) return null
          const active = statusFilter === k
          return <button key={k} onClick={() => setStatusFilter(active ? '' : k)} style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', color: s.color, background: active ? s.bg : 'var(--surface)', border: `1.5px solid ${active ? s.color : s.border}`, display: 'inline-flex', alignItems: 'center', gap: 5 }}>{s.icon} {s.label}: {count}</button>
        })}
        {(brandFilter||statusFilter||typeFilter||termSearch||runFilter||portfolioFilter) && <button onClick={() => { setBrandFilter(''); setStatusFilter(''); setTypeFilter(''); setTermSearch(''); setRunFilter(''); setPortfolioFilter('') }} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 12px', cursor: 'pointer' }}>✕ Clear filters</button>}
      </div>

      {/* Filters — now includes portfolio */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1.5fr', gap: 10, marginBottom: 14 }}>
        <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Brand</div><select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={{ ...inp, width: '100%' }}><option value="">All brands</option>{brands.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
        <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Portfolio</div><select value={portfolioFilter} onChange={e => setPortfolioFilter(e.target.value)} style={{ ...inp, width: '100%' }}><option value="">All portfolios</option>{portfolios.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
        <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Type</div><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, width: '100%' }}><option value="">All types</option>{Object.entries(MT_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Status</div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: '100%' }}><option value="">All statuses</option>{Object.entries(STATUS).map(([v,s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}</select></div>
        <div><div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Search term</div><input type="text" value={termSearch} onChange={e => setTermSearch(e.target.value)} placeholder="Filter by keyword…" style={{ ...inp, width: '100%', boxSizing: 'border-box' as const }} /></div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{selected.size} selected</span>
        <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={inp}><option value="">Change status to…</option>{Object.entries(STATUS).map(([v,s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}</select>
        <input type="text" value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} placeholder="Notes (optional)" style={{ ...inp, flex: 1, minWidth: 120 }} />
        <button className="btn-primary" onClick={handleBulkUpdate} disabled={!bulkStatus||updating} style={{ fontSize: 12, opacity: !bulkStatus||updating ? 0.5 : 1 }}>{updating?'⟳ Updating…':'Apply'}</button>
        <button onClick={() => setSelected(new Set())} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        {updateMsg && <span style={{ fontSize: 12, fontWeight: 600, color: updateMsg.startsWith('✅') ? 'var(--accent)' : 'var(--red)' }}>{updateMsg}</span>}
      </div>}

      {filtered.length > 0 && selected.size === 0 && <div style={{ marginBottom: 8 }}><button onClick={() => setSelected(new Set(filtered.map(d => d.id)))} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>☑ Select all {filtered.length} visible</button></div>}

      {loading ? <div className="loading">⟳ Loading…</div>
       : filtered.length === 0 ? <div className="empty" style={{ height: 160 }}><div className="ei">📋</div><div>No decisions found</div></div>
       : <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sortedPortfolios.map(([portKey, group]) => {
            const allItems = [...group.negatives, ...group.harvest, ...group.pts]
            const totalWasted = allItems.reduce((s, d) => s + (d.wasted_at_decision ?? 0), 0)
            return (
              <div key={portKey} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {/* Portfolio header */}
                <div style={{ padding: '10px 16px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{portKey}</span>
                  {group.brand && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{group.brand}</span>}
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{allItems.length} decisions</span>
                  {group.negatives.length > 0 && <Badge color="#dc2626" bg="rgba(220,38,38,.08)">{group.negatives.length} negatives</Badge>}
                  {group.harvest.length > 0 && <Badge color="#166534" bg="rgba(22,101,52,.08)">{group.harvest.length} harvest kw</Badge>}
                  {group.pts.length > 0 && <Badge color="#7c3aed" bg="rgba(124,58,237,.08)">{group.pts.length} PT</Badge>}
                  {totalWasted > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)', color: '#dc2626', fontWeight: 700 }}>${totalWasted.toFixed(2)} wasted logged</span>}
                </div>
                {/* Decision rows */}
                <div style={{ padding: '6px 0' }}>
                  {allItems.map((d: any, i: number) => {
                    const mtc  = MT_COLORS[d.match_type] ?? { color: '#6b7280', bg: 'rgba(107,114,128,.08)' }
                    const isSel = selected.has(d.id)
                    const isNeg = d.match_type?.startsWith('negative')
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', background: isSel ? 'var(--accent-light)' : 'transparent', borderBottom: i < allItems.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <input type="checkbox" checked={isSel} onChange={() => setSelected(p => { const n = new Set(p); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n })} style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, minWidth: 180 }}>{d.term}</span>
                        <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type] ?? d.match_type}</Badge>
                        {d.is_generic_flag && <Badge color="#ea580c" bg="rgba(234,88,12,.1)">⚠️ Generic</Badge>}
                        <span style={{ fontSize: 11, color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {d.campaign_names?.length > 0 ? d.campaign_names.join(' · ') : ''}
                        </span>
                        {d.notes && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>"{d.notes}"</span>}
                        {(d.roas_at_decision ?? 0) > 0 && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>ROAS {d.roas_at_decision?.toFixed(2)}x</span>}
                        {isNeg && (d.wasted_at_decision ?? 0) > 0 && <span style={{ fontSize: 11, color: '#dc2626', fontFamily: 'var(--mono)', fontWeight: 700, flexShrink: 0 }}>${d.wasted_at_decision?.toFixed(2)}</span>}
                        {!isNeg && (d.purchases_at_decision ?? 0) > 0 && <span style={{ fontSize: 11, color: '#166534', fontFamily: 'var(--mono)', flexShrink: 0 }}>{d.purchases_at_decision} orders</span>}
                        <StatusPill status={d.status} />
                        <span style={{ fontSize: 10, color: 'var(--text3)', minWidth: 44, textAlign: 'right' as const, flexShrink: 0 }}>{new Date(d.decided_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      }
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export default function PPCDashboard({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const [view, setView]         = useState<View>('home')
  const [orgId, setOrgId]       = useState<string | null>(null)
  const [brands, setBrands]     = useState<string[]>([])
  const [recentRuns, setRecentRuns]       = useState<any[]>([])
  const [recentUploads, setRecentUploads] = useState<any[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading]   = useState(true)
  const [uploadIds, setUploadIds]         = useState<string[]>([])
  const [uploadDays, setUploadDays]       = useState(65)
  const [uploadBrand, setUploadBrand]     = useState('')
  const [uploadIsBulk, setUploadIsBulk]   = useState(false)
  const [uploadPortfolios, setUploadPortfolios]   = useState<string[]>([])
  const [uploadPortfolioSummary, setUploadPortfolioSummary] = useState<any[]>([])
  const [selectedPortfolios, setSelectedPortfolios]         = useState<string[]>([])
  const [decisionsRunId, setDecisionsRunId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const load = async () => {
      const { data: org } = await supabase.from('orgs').select('id').limit(1).single()  // [D12]
      if (!org?.id) return
      setOrgId(org.id)
      const [{ data: bData }, { data: runs }, { count }, { data: uploads }] = await Promise.all([
        supabase.from('products').select('brand'),                                        // [D12]
        supabase.from('ppc_analysis_runs')
          .select('id,run_name,run_at,brand,asin,report_start_date,report_end_date,date_range_days,total_spend,total_wasted,high_negatives,harvest_candidates,upload_ids,is_bulk_run,portfolio')
          .eq('org_id', org.id).order('run_at', { ascending: false }).limit(50),
        supabase.from('ppc_decisions_log').select('*', { count: 'exact', head: true }).eq('org_id', org.id).eq('status', 'pending'),
        supabase.from('ppc_uploads')
          .select('id,filename,uploaded_at,row_count,is_bulk_file,brand,portfolios,portfolio_summary')
          .eq('org_id', org.id).order('uploaded_at', { ascending: false }).limit(20),
      ])
      if (bData) setBrands([...new Set(bData.map((r: any) => r.brand).filter(Boolean))].sort() as string[])
      setRecentRuns(runs ?? [])
      setRecentUploads(uploads ?? [])
      setPendingCount(count ?? 0)
      setLoading(false)
    }
    load()
  }, [])

  const handleUploadDone = (ids: string[], days: number, brand: string, isBulk: boolean, portfolios: string[], portfolioSummary: any[], donePorts: string[] = []) => {
    setUploadIds(ids); setUploadDays(days); setUploadBrand(brand)
    setUploadIsBulk(isBulk); setUploadPortfolios(portfolios)
    setUploadPortfolioSummary(portfolioSummary)
    if (isBulk) {
      if (donePorts.length > 0) {
        // Already have analyses — go straight to dashboard
        setSelectedPortfolios([donePorts[0]])
        setView('analysis')
      } else if (portfolioSummary.length > 0) {
        // No analyses yet — show selector
        const preSelected = portfolioSummary.filter(p => p.spend >= 50).map(p => p.name)
        setSelectedPortfolios(preSelected.length > 0 ? preSelected : portfolioSummary.slice(0, 5).map(p => p.name))
        setView('portfolio_select')
      } else {
        setSelectedPortfolios([])
        setView('analysis')
      }
    } else {
      setSelectedPortfolios([])
      setView('analysis')
    }
  }

  const handleGoDecisions = (runId: string) => { setDecisionsRunId(runId); setView('decisions') }

  const handleSelectMore = async () => {
    if (uploadPortfolioSummary.length === 0 && uploadIds.length > 0) {
      const sb = createClient()
      const { data } = await sb.from('ppc_uploads').select('portfolio_summary').eq('id', uploadIds[0]).single()
      if (data?.portfolio_summary?.length) setUploadPortfolioSummary(data.portfolio_summary)
    }
    setView('portfolio_select')
  }

  if (!orgId && !loading) return <div style={{ padding: 32, color: 'var(--text3)' }}>No organisation found.</div>

  if (view === 'upload')    return <UploadView brands={brands} orgId={orgId!} onDone={handleUploadDone} />
  if (view === 'portfolio_select') return (
    <PortfolioSelectorView
      portfolioSummary={uploadPortfolioSummary}
      selected={selectedPortfolios}
      onSelect={setSelectedPortfolios}
      onConfirm={() => setView('analysis')}
      onBack={() => setView('home')}
      uploadIds={uploadIds}
      orgId={orgId!}
    />
  )
  if (view === 'analysis')  return <AnalysisView
    uploadIds={uploadIds} dateRangeDays={uploadDays} brand={uploadBrand}
    orgId={orgId!} isBulk={uploadIsBulk}
    portfolios={selectedPortfolios.length > 0 ? selectedPortfolios : ['']}
    onBack={() => setView('home')}
    onSelectMore={handleSelectMore}
    onGoDecisions={handleGoDecisions}
  />
  if (view === 'decisions') return <DecisionsView orgId={orgId!} brands={brands} initialRunId={decisionsRunId} onBack={() => setView('home')} />

  // ── HOME — pre-compute upload groups before return ────────────────────────
  const bulkUploads  = recentUploads.filter((u: any) => u.is_bulk_file)
  const indivUploads = recentUploads.filter((u: any) => !u.is_bulk_file)
  const indivGroups: Record<string, any[]> = {}
  for (const u of indivUploads) {
    const day = new Date(u.uploaded_at).toLocaleDateString('en-GB')
    const key = (u.brand ?? 'Unknown') + '_' + day
    if (!indivGroups[key]) indivGroups[key] = []
    indivGroups[key].push(u)
  }
  const homeItems: { type: string; upload: any; group: any[] | null }[] = [
    ...bulkUploads.map((u: any) => ({ type: 'bulk', upload: u, group: null })),
    ...Object.entries(indivGroups).map(([, uploads]) => ({ type: 'group', upload: uploads[0], group: uploads })),
  ]

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>PPC — Negative targeting &amp; keyword harvesting</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Select an upload to view its dashboard · Upload a new file to add data</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setView('decisions')}>
            {pendingCount > 0 && <span style={{ marginRight: 6, background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 6px' }}>{pendingCount}</span>}
            📋 Decisions log
          </button>
          <button className="btn-primary" onClick={() => setView('upload')}>＋ Upload new file</button>
        </div>
      </div>

      {/* Uploads — top level navigation */}
      {loading
        ? <div className="loading">⟳ Loading…</div>
        : recentUploads.length === 0
          ? <div className="empty" style={{ height: 160 }}><div className="ei">📂</div><div>No uploads yet — upload a bulk file or individual campaign CSVs to get started</div></div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {homeItems.map(item => {
                const upload = item.upload
                const groupUploads = item.group ?? [upload]
                const allGroupIds = groupUploads.map(u => u.id)
                const uploadRuns = recentRuns.filter(r => (r.upload_ids ?? []).some((id: string) => allGroupIds.includes(id)))
                const donePorts  = uploadRuns.filter(r => r.portfolio).map(r => r.portfolio)
                const totalPorts = upload.portfolios?.length ?? 0
                const isBulk     = upload.is_bulk_file

                const firstRun    = uploadRuns[0]
                const fmtDate     = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                const dateLabel   = firstRun?.report_start_date && firstRun?.report_end_date
                  ? 'Data: ' + fmtDate(firstRun.report_start_date) + ' – ' + fmtDate(firstRun.report_end_date)
                  : 'Uploaded ' + fmtDate(upload.uploaded_at)
                const totalWasted  = uploadRuns.reduce((s: number, r: any) => s + (r.total_wasted ?? 0), 0)
                const totalSpend   = uploadRuns.reduce((s: number, r: any) => s + (r.total_spend ?? 0), 0)
                const totalHigh    = uploadRuns.reduce((s: number, r: any) => s + (r.high_negatives ?? 0), 0)
                const totalHarvest = uploadRuns.reduce((s: number, r: any) => s + (r.harvest_candidates ?? 0), 0)

                return (
                  <div key={upload.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

                    {/* Upload header */}
                    <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 20 }}>{isBulk ? '📦' : '📄'}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          {upload.brand && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{upload.brand}</span>}
                          {isBulk
                            ? <Badge color="#7c3aed" bg="rgba(124,58,237,.08)">Bulk · {totalPorts} portfolios</Badge>
                            : item.group && item.group.length > 1
                              ? <Badge color="#0f766e" bg="rgba(15,118,110,.08)">{item.group.length} campaigns</Badge>
                              : <span style={{ fontSize: 12, fontWeight: 600 }}>{upload.filename?.replace(/\.(csv|xlsx)$/i, '')}</span>
                          }
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
                          <span>{(item.group ? item.group.reduce((s: number, u: any) => s + (u.row_count ?? 0), 0) : (upload.row_count ?? 0)).toLocaleString()} rows</span>
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{dateLabel}</span>
                          {isBulk && donePorts.length > 0 && <span style={{ color: '#166534', fontWeight: 600 }}>✓ {donePorts.length}/{totalPorts} portfolios analysed</span>}
                          {isBulk && donePorts.length === 0 && <span>No portfolios analysed yet</span>}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        {isBulk && donePorts.length > 0 && (
                          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => {
                            setUploadIds([upload.id]); setUploadDays(65); setUploadBrand(upload.brand ?? '')
                            setUploadIsBulk(true); setUploadPortfolioSummary(upload.portfolio_summary ?? [])
                            setSelectedPortfolios([donePorts[0]]); setView('analysis')
                          }}>📊 Open dashboard</button>
                        )}
                        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => {
                          setUploadIds([upload.id]); setUploadDays(65); setUploadBrand(upload.brand ?? '')
                          setUploadIsBulk(isBulk); setUploadPortfolioSummary(upload.portfolio_summary ?? [])
                          if (isBulk) {
                            const remaining = (upload.portfolio_summary ?? []).filter((p: any) => !donePorts.includes(p.name)).map((p: any) => p.name)
                            setSelectedPortfolios(remaining.length > 0 ? remaining : [])
                            setView('portfolio_select')
                          } else {
                            // Individual upload group — no portfolio needed
                            setUploadIds(allGroupIds)
                            setUploadDays(uploadRuns[0]?.date_range_days ?? 65)
                            setSelectedPortfolios([])
                            setView('analysis')
                          }
                        }}>{isBulk ? '＋ Analyse portfolio' : uploadRuns.length > 0 ? '📊 View results' : '▶ Run analysis'}</button>
                      </div>
                    </div>

                    {/* Portfolio pills + account summary */}
                    {isBulk && donePorts.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
                          {/* Account summary bar */}
                          <div style={{ padding: '8px 18px', display: 'flex', gap: 20, borderBottom: '1px solid var(--border)' }}>
                            <div>
                              <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Total spend </span>
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)' }}>${totalSpend.toFixed(0)}</span>
                            </div>
                            <div>
                              <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Wasted </span>
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', color: '#dc2626' }}>${totalWasted.toFixed(0)}</span>
                              <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>{totalSpend > 0 ? ((totalWasted / totalSpend) * 100).toFixed(0) : 0}%</span>
                            </div>
                            <div>
                              <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>HIGH terms </span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{totalHigh}</span>
                            </div>
                            <div>
                              <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600 }}>Harvest kw </span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>{totalHarvest}</span>
                            </div>
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: 10, color: 'var(--text3)', alignSelf: 'center' }}>across {donePorts.length} analysed portfolios</span>
                          </div>
                          {/* Portfolio pills */}
                          <div style={{ padding: '8px 18px', display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                            {donePorts.map(port => {
                              const run    = uploadRuns.find((r: any) => r.portfolio === port)
                              const wPct   = (run?.total_spend ?? 0) > 0 ? (run?.total_wasted ?? 0) / run.total_spend : 0
                              const hi     = run?.high_negatives ?? 0
                              const health: Health = wPct > 0.30 || hi > 3 ? 'red' : wPct > 0.15 || hi > 0 ? 'amber' : 'green'
                              return (
                                <button key={port} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text)' }}
                                  onClick={() => {
                                    setUploadIds([upload.id]); setUploadDays(65); setUploadBrand(upload.brand ?? '')
                                    setUploadIsBulk(true); setUploadPortfolioSummary(upload.portfolio_summary ?? [])
                                    setSelectedPortfolios([port]); setView('analysis')
                                  }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: HEALTH_COLORS[health].dot, flexShrink: 0 }} />
                                  {port}
                                </button>
                              )
                            })}
                            {totalPorts > donePorts.length && (
                              <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>+{totalPorts - donePorts.length} not analysed</span>
                            )}
                          </div>
                        </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
      }
    </div>
  )
}
