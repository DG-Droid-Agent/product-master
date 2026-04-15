'use client'
// components/ppc/PPCDashboard.tsx
// Self-contained PPC module — renders entirely inside AppShell's .content div.
// Uses internal sub-view state. No window.location, no Next.js routing.
// Pattern matches InventoryDashboard exactly.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

// ── TYPES ─────────────────────────────────────────────────────────────────────
type View = 'home' | 'upload' | 'analysis' | 'decisions'
type Tab  = 'negatives' | 'harvest' | 'ngrams'

const STATUS: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  pending:       { label: 'Pending review',     icon: '⏳', color: '#b45309', bg: 'rgba(180,83,9,.08)',    border: 'rgba(180,83,9,.2)'    },
  actioned:      { label: 'Actioned in Amazon', icon: '✅', color: '#166534', bg: 'rgba(22,101,52,.08)',   border: 'rgba(22,101,52,.2)'   },
  not_actioning: { label: 'Not actioning',      icon: '⏸', color: '#6b7280', bg: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.2)' },
  reversed:      { label: 'Reversed',           icon: '↩️', color: '#dc2626', bg: 'rgba(220,38,38,.08)',   border: 'rgba(220,38,38,.2)'   },
}
const MT_LABELS: Record<string, string> = {
  negative_phrase: 'Neg · Phrase', negative_exact: 'Neg · Exact',
  harvest_exact: 'Harvest · Exact', harvest_phrase: 'Harvest · Phrase', harvest_broad: 'Harvest · Broad',
}
const MT_COLORS: Record<string, { color: string; bg: string }> = {
  negative_phrase: { color: '#dc2626', bg: 'rgba(220,38,38,.1)'  },
  negative_exact:  { color: '#b91c1c', bg: 'rgba(185,28,28,.08)' },
  harvest_exact:   { color: '#166534', bg: 'rgba(22,101,52,.1)'  },
  harvest_phrase:  { color: '#166534', bg: 'rgba(22,101,52,.08)' },
  harvest_broad:   { color: '#1d4ed8', bg: 'rgba(29,78,216,.08)' },
}
const CAMPAIGN_TYPES = ['auto', 'broad', 'exact', 'phrase', 'other']
const DATE_RANGES = [
  { label: '7 days', value: 7 }, { label: '30 days', value: 30 },
  { label: '60 days', value: 60 }, { label: '65 days', value: 65 }, { label: 'Custom', value: 0 },
]

// ── MINI SHARED COMPONENTS ────────────────────────────────────────────────────

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

// ── NEG ROW ───────────────────────────────────────────────────────────────────

function NegRow({ row, keyStr, selected, decision, onToggle, onUpdate, campaigns, isExact = false }: any) {
  const isOn = selected.has(keyStr)
  const d    = decision ?? { status: 'pending', campaigns: [], notes: '' }
  const wasted = row.wasted_spend ?? row.cost ?? 0

  return (
    <div style={{ border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: isOn ? 'var(--accent-light)' : 'var(--surface)', padding: '10px 14px', marginBottom: 5 }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={isOn} onChange={() => onToggle(keyStr)}
          style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700 }}>{isExact ? row.search_term : row.ngram}</span>
        {!isExact && row.ngram_type && <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px' }}>{row.ngram_type}</span>}
        {isExact && row.coverage !== 'Not covered' && <Badge color="#166534" bg="rgba(22,101,52,.1)">{row.coverage === 'Covered' ? '✓ Covered by phrase' : '⚡ Partial'}</Badge>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', fontFamily: 'var(--mono)' }}>${wasted.toFixed(2)} wasted</span>
        {(row.roas ?? 0) > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>ROAS {row.roas?.toFixed(2)}x</span>}
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>ACOS {row.acos?.toFixed(1)}%</span>
        {row.appearances > 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.appearances} apps</span>}
      </div>
      {/* Inline controls — always visible */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 10, paddingLeft: 25, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Status</div>
          <select value={d.status} onChange={e => onUpdate(keyStr, 'status', e.target.value)}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }}>
            {Object.entries(STATUS).filter(([v]) => v !== 'reversed').map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Apply to campaigns</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
            {(campaigns ?? []).map((c: string) => {
              const inList = (d.campaigns ?? []).includes(c)
              return (
                <button key={c} onClick={() => onUpdate(keyStr, 'campaigns', inList ? d.campaigns.filter((x: string) => x !== c) : [...(d.campaigns ?? []), c])}
                  style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', border: '1px solid', background: inList ? 'var(--accent)' : 'var(--surface2)', color: inList ? '#fff' : 'var(--text)', borderColor: inList ? 'var(--accent)' : 'var(--border)' }}>
                  {c}
                </button>
              )
            })}
          </div>
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

// ── HARVEST ROW ───────────────────────────────────────────────────────────────

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
            <Badge color={row.existing_targeting.startsWith('🆕') ? '#166534' : '#b45309'} bg={row.existing_targeting.startsWith('🆕') ? 'rgba(22,101,52,.08)' : 'rgba(180,83,9,.08)'}>{row.existing_targeting}</Badge>
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

// ── NGRAM TABLE ───────────────────────────────────────────────────────────────

function NGramTable({ rows, label }: { rows: any[]; label: string }) {
  const [exp, setExp] = useState(false)
  const visible = exp ? rows : rows.slice(0, 8)
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['N-gram','Apps','Spend','Wasted','Sales','ROAS','ACOS','Waste%'].map(h => (
                <th key={h} style={{ textAlign: 'left' as const, padding: '7px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row: any, i: number) => {
              const hi = row.roas < 1.0 || row.acos > 100
              return (
                <tr key={row.ngram} style={{ background: hi ? 'rgba(220,38,38,.04)' : !hi && row.roas < 1.5 ? 'rgba(234,88,12,.03)' : i % 2 ? 'var(--surface2)' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
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
            <button onClick={() => setExp(e => !e)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {exp ? '▲ Show less' : `▼ Show all ${rows.length} rows`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── UPLOAD VIEW ───────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

interface FileEntry { file: File; campaignName: string; campaignType: string; error: string | null }

function inferType(n: string) { return n.includes('auto') ? 'auto' : n.includes('broad') ? 'broad' : n.includes('exact') ? 'exact' : n.includes('phrase') ? 'phrase' : 'other' }
function cleanName(f: string) { return f.replace(/\.(csv|xlsx)$/i,'').replace(/sponsored_products_searchterm[_\w]*/i,'').replace(/apr_\d+_\d+/i,'').replace(/__+/g,'_').replace(/^_+|_+$/g,'').replace(/_/g,' ').trim() || f.replace(/\.(csv|xlsx)$/i,'') }

function UploadView({ brands, orgId, onDone }: { brands: string[]; orgId: string; onDone: (ids: string[], days: number, brand: string) => void }) {
  const supabase    = createClient()
  const fileRef     = useRef<HTMLInputElement>(null)
  const [brand, setBrand]         = useState('')
  const [asin, setAsin]           = useState('')
  const [entries, setEntries]     = useState<FileEntry[]>([])
  const [dateRange, setDateRange] = useState(65)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => /\.(csv|xlsx)$/i.test(f.name))
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
    if (!brand.trim()) { setError('Select a brand'); return }
    if (!entries.length) { setError('Add at least one file'); return }
    let valid = true
    setEntries(prev => prev.map(e => { if (!e.campaignName.trim()) { valid = false; return { ...e, error: 'Required' } } return e }))
    if (!valid) { setError('Fill in all campaign names'); return }
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
      if (!res.ok) { setError(json.duplicate ? `Duplicate: "${json.campaign_name}" already uploaded for this date range` : json.error ?? 'Upload failed'); return }
      onDone(json.uploads.map((u: any) => u.upload_id), dateRange, brand)
    } catch (err: any) { setError(err.message) }
    finally { setUploading(false) }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Upload search term reports</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>Drop CSV or XLSX files to run negative targeting and keyword harvesting analysis.</div>

      {/* Brand */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 12 }}>1 · Brand &amp; product</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Brand <span style={{ color: 'var(--red)' }}>*</span></div>
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

      {/* Date range */}
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

      {/* Files */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 10 }}>3 · Upload files</div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)) }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '24px 20px', textAlign: 'center' as const, cursor: 'pointer', background: dragOver ? 'var(--accent-light)' : 'var(--surface2)', marginBottom: entries.length ? 12 : 0 }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>📂</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Drop files here or <span style={{ color: 'var(--accent)', textDecoration: 'underline' }}>click to browse</span></div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Hold Ctrl (Windows) or Cmd (Mac) to select multiple files at once</div>
        </div>
        <input ref={fileRef} type="file" multiple accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleChange} />
        {entries.map((e, i) => (
          <div key={i} style={{ background: 'var(--surface2)', border: `1px solid ${e.error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 7, padding: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>📄 {e.file.name}</span>
              <button onClick={() => setEntries(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, flexShrink: 0 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Campaign name <span style={{ color: 'var(--red)' }}>*</span></div>
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
          </div>
        ))}
      </div>

      {error && <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>⚠️ {error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={handleUpload} disabled={uploading || !entries.length} style={{ opacity: uploading || !entries.length ? 0.5 : 1 }}>
          {uploading ? '⟳ Uploading…' : entries.length === 0 ? 'Add files to continue' : `Upload ${entries.length} file${entries.length > 1 ? 's' : ''} & run analysis`}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ANALYSIS VIEW ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function AnalysisView({ uploadIds, dateRangeDays, brand, orgId, onBack, onGoDecisions }: { uploadIds: string[]; dateRangeDays: number; brand: string; orgId: string; onBack: () => void; onGoDecisions: (runId: string) => void }) {
  const supabase = createClient()
  const [loading, setLoading]         = useState(true)
  const [results, setResults]         = useState<any>(null)
  const [runId, setRunId]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Tab>('negatives')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [decisionMap, setDecisionMap] = useState<Map<string, any>>(new Map())
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState('')
  const [saveError, setSaveError]     = useState('')
  const [loadError, setLoadError]     = useState('')
  const [prevRun, setPrevRun]         = useState<any>(null)
  const [prevDecs, setPrevDecs]       = useState<any[]>([])
  const [histExp, setHistExp]         = useState(false)

  useEffect(() => {
    const run = async () => {
      try {
        const [res, prevRes] = await Promise.all([
          fetch('/api/ppc/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_ids: uploadIds, date_range_days: dateRangeDays, org_id: orgId, brand }) }),
          brand ? supabase.from('ppc_analysis_runs').select('id,run_name,run_at,total_spend,total_wasted,high_negatives,harvest_candidates,date_range_days').eq('org_id', orgId).eq('brand', brand).order('run_at', { ascending: false }).limit(3) : Promise.resolve({ data: [] }),
        ])
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setResults(json.results); setRunId(json.analysis_run_id)

        // Pre-populate decision map from previously logged decisions on this run
        if (json.existing_decisions?.length) {
          const preMap = new Map<string, any>()
          for (const d of json.existing_decisions) {
            // Build the same key format used by the UI
            let key = ''
            if (d.match_type === 'negative_phrase') key = `neg_phrase_${d.term}`
            else if (d.match_type === 'negative_exact') key = `neg_exact_${d.term}`
            else key = `harvest_${d.match_type.replace('harvest_','')}_ ${d.term}`
            preMap.set(key, { status: d.status, campaigns: d.campaign_names ?? [], notes: d.notes ?? '' })
          }
          setDecisionMap(preMap)
          // Auto-select all terms that already have a decision logged
          setSelected(new Set(preMap.keys()))
        }

        if (json.is_duplicate_run) {
          setToast('ℹ️ Same data as a previous run — existing decisions loaded')
          setTimeout(() => setToast(''), 5000)
        }
        const prior = ((prevRes as any).data ?? []).find((r: any) => r.id !== json.analysis_run_id) ?? null
        if (prior) {
          setPrevRun(prior)
          const { data } = await supabase.from('ppc_decisions_log').select('term,match_type,status,campaign_names,roas_at_decision,wasted_at_decision').eq('analysis_run_id', prior.id).in('status', ['actioned','not_actioning','reversed']).limit(20)
          setPrevDecs(data ?? [])
        }
      } catch (err: any) { setLoadError(err.message) }
      finally { setLoading(false) }
    }
    run()
  }, [])

  const toggle = (key: string) => {
    setSelected(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
    setDecisionMap(p => { if (p.has(key)) return p; const n = new Map(p); n.set(key, { status: 'pending', campaigns: [], notes: '' }); return n })
  }
  const update = (key: string, field: string, value: any) => setDecisionMap(p => { const n = new Map(p); n.set(key, { ...(n.get(key) ?? { status:'pending', campaigns:[], notes:'' }), [field]: value }); return n })

  const buildDecisions = () => {
    if (!results) return []
    const out: any[] = []
    for (const row of [...(results.phrase_high ?? []), ...(results.phrase_medium ?? [])]) {
      const key = `neg_phrase_${row.ngram}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
      out.push({ term: row.ngram, match_type: 'negative_phrase', priority: row.priority, campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: row.wasted_spend, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (results.exact_negatives ?? [])) {
      const key = `neg_exact_${row.search_term}`; if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
      out.push({ term: row.search_term, match_type: 'negative_exact', priority: 'HIGH', campaign_names: d.campaigns, roas_at_decision: 0, wasted_at_decision: row.wasted_spend, purchases_at_decision: 0, status: d.status, notes: d.notes, is_generic_flag: false })
    }
    for (const row of (results.harvest_candidates ?? [])) {
      for (const mt of (row.match_types?.split(', ') ?? ['Phrase'])) {
        const key = `harvest_${mt}_${row.search_term}`; if (!selected.has(key)) continue
        const d = decisionMap.get(key) ?? { status:'pending', campaigns:[], notes:'' }
        out.push({ term: row.search_term, match_type: `harvest_${mt.toLowerCase()}`, priority: row.confidence?.includes('⭐⭐⭐') ? 'HIGH' : 'MEDIUM', campaign_names: d.campaigns, roas_at_decision: row.roas, wasted_at_decision: 0, purchases_at_decision: row.purchases, status: d.status, notes: d.notes, is_generic_flag: !!row.generic_flag })
      }
    }
    return out
  }

  const handleSave = async () => {
    if (!runId || !selected.size) return
    setSaving(true); setSaveError('')
    try {
      const decisions = buildDecisions()
      const res = await fetch('/api/ppc/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: orgId, brand, analysis_run_id: runId, decisions }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setToast(`✅ ${json.saved} decision${json.saved > 1 ? 's' : ''} logged`)
      setSelected(new Set())
      setTimeout(() => setToast(''), 4000)
    } catch (err: any) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center' as const }}><div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div><div style={{ fontSize: 15, fontWeight: 600 }}>Running analysis…</div><div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>N-gram extraction · Significance testing · Generating recommendations</div></div>
  if (loadError) return <div style={{ padding: 24 }}><div style={{ color: 'var(--red)', marginBottom: 12 }}>⚠️ {loadError}</div><button className="btn-secondary" onClick={onBack}>← Back</button></div>
  if (!results) return null

  const { summary, phrase_high, phrase_medium, phrase_watch, exact_negatives, harvest_candidates, toxic_combos, ngrams } = results

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <button onClick={onBack} style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 6 }}>← PPC Manager</button>
          <div style={{ fontSize: 20, fontWeight: 700 }}>PPC analysis results</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{summary.date_range_days}-day · {brand && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{brand} · </span>}{summary.campaigns?.join(', ')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => runId && onGoDecisions(runId)}>View decisions log</button>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={onBack}>＋ New upload</button>
        </div>
      </div>

      {/* History callout */}
      {prevRun && (
        <div style={{ background: 'rgba(29,78,216,.04)', border: '1px solid rgba(29,78,216,.18)', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
          <div onClick={() => setHistExp(e => !e)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>📋</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Last analysis: {Math.floor((Date.now() - new Date(prevRun.run_at).getTime()) / 86400000)} days ago</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{new Date(prevRun.run_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} · ${prevRun.total_spend?.toFixed(2)} · {prevRun.high_negatives} HIGH negatives</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {prevDecs.filter(d => d.status === 'actioned').length > 0    && <Badge color="#166534" bg="rgba(22,101,52,.1)">✅ {prevDecs.filter(d=>d.status==='actioned').length} actioned</Badge>}
              {prevDecs.filter(d => d.status === 'not_actioning').length > 0 && <Badge color="#6b7280" bg="rgba(107,114,128,.1)">⏸ {prevDecs.filter(d=>d.status==='not_actioning').length} skipped</Badge>}
              <span style={{ fontSize: 12, color: 'var(--text3)', transition: 'transform .15s', transform: histExp ? 'rotate(180deg)' : 'none' }}>▾</span>
            </div>
          </div>
          {histExp && prevDecs.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(29,78,216,.15)', padding: '10px 14px' }}>
              {prevDecs.map((d, i) => {
                const mtc = MT_COLORS[d.match_type] ?? { color: '#6b7280', bg: 'rgba(107,114,128,.08)' }
                const st  = STATUS[d.status]
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < prevDecs.length-1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ flexShrink: 0 }}>{st?.icon ?? '⏳'}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, flex: 1 }}>{d.term}</span>
                    <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type] ?? d.match_type}</Badge>
                    {d.campaign_names?.length > 0 && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{d.campaign_names.join(', ')}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total spend',       value: `$${summary.total_spend?.toFixed(2)}` },
          { label: 'Overall ROAS',      value: `${summary.overall_roas?.toFixed(2)}x`, sub: `ACOS ${summary.overall_acos?.toFixed(1)}%` },
          { label: 'Wasted spend',      value: `$${summary.total_wasted?.toFixed(2)}`, sub: `${(summary.wasted_pct*100)?.toFixed(1)}% of spend`, accent: true },
          { label: 'Addressable waste', value: `$${summary.addressable_waste?.toFixed(2)}` },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: c.accent ? 'var(--red)' : 'var(--text)' }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Clickable insight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { icon:'🔴', label:`${phrase_high?.length??0} HIGH negatives`,         sub:'Click to view · negate now',            bg:'rgba(220,38,38,.06)', border:'rgba(220,38,38,.2)',  tab:'negatives' as Tab },
          { icon:'⚡', label:`${toxic_combos?.length??0} toxic combos`,           sub:'Click to view in N-gram tables',         bg:'rgba(234,88,12,.06)', border:'rgba(234,88,12,.2)', tab:'ngrams'    as Tab },
          { icon:'🚀', label:`${harvest_candidates?.length??0} harvest candidates`, sub:'Click to view · keywords to push',      bg:'rgba(22,101,52,.06)', border:'rgba(22,101,52,.2)', tab:'harvest'   as Tab },
        ].map(item => (
          <div key={item.label} onClick={() => setActiveTab(item.tab)} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.sub}</div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>→</span>
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{toast} — <button onClick={() => runId && onGoDecisions(runId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline', fontSize: 13, padding: 0 }}>View decisions log →</button></div>}
      {saveError && <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626' }}>⚠️ {saveError}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 8, padding: 3, marginBottom: 14, width: 'fit-content' }}>
        {([
          { key:'negatives', label:'Negatives', count:(phrase_high?.length??0)+(phrase_medium?.length??0)+(exact_negatives?.length??0) },
          { key:'harvest',   label:'Harvest',   count: harvest_candidates?.length??0 },
          { key:'ngrams',    label:'N-gram tables' },
        ] as {key:Tab;label:string;count?:number}[]).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding:'7px 16px', borderRadius:6, fontSize:12, cursor:'pointer', border:'none', display:'flex', alignItems:'center', gap:6, background: activeTab===t.key ? 'var(--surface)' : 'transparent', color: activeTab===t.key ? 'var(--text)' : 'var(--text3)', fontWeight: activeTab===t.key ? 600 : 400, boxShadow: activeTab===t.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>
            {t.label}
            {t.count !== undefined && <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, background: activeTab===t.key ? 'var(--accent)' : 'var(--surface3)', color: activeTab===t.key ? '#fff' : 'var(--text3)' }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Negatives tab */}
      {activeTab === 'negatives' && (
        <div>
          {(phrase_high?.length??0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="HIGH priority phrase negatives" sub="ROAS < 1.0 or ACOS > 100% · negate now" color="#dc2626" />
              <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                <button onClick={() => phrase_high.forEach((r: any) => { if (!selected.has(`neg_phrase_${r.ngram}`)) toggle(`neg_phrase_${r.ngram}`) })} style={{ fontSize:11, background:'rgba(220,38,38,.1)', color:'#dc2626', border:'1px solid rgba(220,38,38,.2)', borderRadius:5, padding:'4px 10px', cursor:'pointer', fontWeight:600 }}>☑ Select all HIGH ({phrase_high.length})</button>
                {selected.size > 0 && <span style={{ fontSize:11, color:'var(--text3)', alignSelf:'center' }}>{selected.size} selected</span>}
              </div>
              {phrase_high.map((r: any) => <NegRow key={r.ngram} row={r} keyStr={`neg_phrase_${r.ngram}`} selected={selected} decision={decisionMap.get(`neg_phrase_${r.ngram}`)} onToggle={toggle} onUpdate={update} campaigns={summary.campaigns??[]} />)}
            </div>
          )}
          {(phrase_medium?.length??0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="MEDIUM priority phrase negatives" sub="ROAS 1.0–1.49 · negate + monitor" color="#ea580c" />
              {phrase_medium.map((r: any) => <NegRow key={r.ngram} row={r} keyStr={`neg_phrase_${r.ngram}`} selected={selected} decision={decisionMap.get(`neg_phrase_${r.ngram}`)} onToggle={toggle} onUpdate={update} campaigns={summary.campaigns??[]} />)}
            </div>
          )}
          {(exact_negatives?.length??0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle label="Exact match negatives" sub="$15+ wasted · 0 purchases" color="#dc2626" />
              {exact_negatives.map((r: any) => <NegRow key={r.search_term} row={r} keyStr={`neg_exact_${r.search_term}`} selected={selected} decision={decisionMap.get(`neg_exact_${r.search_term}`)} onToggle={toggle} onUpdate={update} campaigns={summary.campaigns??[]} isExact />)}
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {(phrase_watch?.length??0) > 0 && <div style={{ background:'rgba(202,138,4,.06)', border:'1px solid rgba(202,138,4,.2)', borderRadius:8, padding:'12px 14px' }}><div style={{ fontSize:12, fontWeight:600, color:'#ca8a04', marginBottom:3 }}>🟡 Watch list — {phrase_watch.length} items</div><div style={{ fontSize:11, color:'var(--text3)' }}>Below significance threshold. Re-review after 30 more days.</div></div>}
            {(toxic_combos?.length??0) > 0 && <div style={{ background:'rgba(234,88,12,.06)', border:'1px solid rgba(234,88,12,.2)', borderRadius:8, padding:'12px 14px' }}><div style={{ fontSize:12, fontWeight:600, color:'#ea580c', marginBottom:3 }}>⚡ {toxic_combos.length} toxic combos</div><div style={{ fontSize:11, color:'var(--text3)' }}>Good words individually, bad combined. See N-gram tables.</div></div>}
          </div>
          {/* Log bar — inline, no fixed positioning */}
          {selected.size > 0 && (
            <div style={{ marginTop:20, background:'var(--surface)', border:'1px solid var(--accent)', borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 2px 12px rgba(0,0,0,.08)' }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{selected.size} decision{selected.size>1?'s':''} ready to log</span>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize:12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize:12, opacity:saving?0.6:1 }}>{saving?'⟳ Saving…':`Log ${selected.size} decision${selected.size>1?'s':''}`}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Harvest tab */}
      {activeTab === 'harvest' && (
        <div>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>ROAS ≥ 3.0 · $20+ spend · 3+ purchases · ranked by conviction. Click match type buttons to select.</div>
          {harvest_candidates?.length > 0 ? harvest_candidates.map((r: any) => <HarvestRow key={r.search_term} row={r} selectedKeys={selected} onToggle={toggle} decisionMap={decisionMap} onUpdate={update} />) : <div className="empty" style={{ height:120 }}><div className="ei">🔍</div><div>No harvest candidates found</div></div>}
          {selected.size > 0 && (
            <div style={{ marginTop:20, background:'var(--surface)', border:'1px solid var(--accent)', borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{selected.size} decision{selected.size>1?'s':''} ready to log</span>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} style={{ fontSize:12 }}>Clear</button>
                <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize:12, opacity:saving?0.6:1 }}>{saving?'⟳ Saving…':`Log ${selected.size} decision${selected.size>1?'s':''}`}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* N-gram tab */}
      {activeTab === 'ngrams' && (
        <div>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:14 }}>Red = ROAS &lt; 1.0 · Orange = ROAS 1.0–1.49</div>
          <NGramTable rows={ngrams?.uni??[]} label="Unigrams" />
          <NGramTable rows={ngrams?.bi??[]}  label="Bigrams" />
          <NGramTable rows={ngrams?.tri??[]} label="Trigrams" />
          {(toxic_combos?.length??0) > 0 && (
            <div>
              <div style={{ fontSize:12, fontWeight:600, marginBottom:8 }}>⚡ Toxic combinations</div>
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' as const, fontSize:12 }}>
                  <thead><tr style={{ background:'var(--surface2)' }}>{['Phrase','Type','Wasted','ROAS','ACOS','Why'].map(h=><th key={h} style={{ textAlign:'left' as const, padding:'7px 10px', fontSize:10, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.06em', color:'var(--text3)', borderBottom:'1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                  <tbody>{toxic_combos.map((r: any, i: number) => <tr key={r.ngram} style={{ background:i%2?'var(--surface2)':'var(--surface)', borderBottom:'1px solid var(--border)' }}><td style={{ padding:'7px 10px', fontFamily:'var(--mono)', fontWeight:600 }}>{r.ngram}</td><td style={{ padding:'7px 10px', color:'var(--text3)' }}>{r.combo_type}</td><td style={{ padding:'7px 10px', fontFamily:'var(--mono)', color:'#dc2626', fontWeight:600 }}>${r.wasted_spend?.toFixed(2)}</td><td style={{ padding:'7px 10px', fontFamily:'var(--mono)' }}>{r.roas?.toFixed(2)}x</td><td style={{ padding:'7px 10px', fontFamily:'var(--mono)' }}>{r.acos?.toFixed(1)}%</td><td style={{ padding:'7px 10px', fontSize:11, color:'var(--text3)' }}>{r.reason}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
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
  const [brandFilter,  setBrandFilter]  = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')
  const [runFilter,    setRunFilter]    = useState(initialRunId ?? '')
  const [termSearch,   setTermSearch]   = useState('')

  useEffect(() => { fetchDecisions() }, [brandFilter, statusFilter, typeFilter, runFilter])

  const fetchDecisions = async () => {
    setLoading(true)
    const p = new URLSearchParams({ org_id: orgId, limit: '200' })
    if (brandFilter)  p.set('brand', brandFilter)
    if (statusFilter) p.set('status', statusFilter)
    if (typeFilter)   p.set('match_type', typeFilter)
    if (runFilter)    p.set('analysis_run_id', runFilter)
    const res  = await fetch(`/api/ppc/decisions?${p}`)
    const json = await res.json()
    if (res.ok) { setDecisions(json.decisions ?? []); setTotal(json.total ?? 0) }
    setLoading(false)
  }

  const handleBulkUpdate = async () => {
    if (!bulkStatus || !selected.size) return
    setUpdating(true)
    try {
      const res = await fetch('/api/ppc/decisions', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids:[...selected], status:bulkStatus, notes:bulkNotes||undefined }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUpdateMsg(`✅ Updated ${json.updated}`)
      setSelected(new Set()); setBulkStatus(''); setBulkNotes('')
      fetchDecisions(); setTimeout(() => setUpdateMsg(''), 3000)
    } catch (err: any) { setUpdateMsg(`⚠️ ${err.message}`) }
    finally { setUpdating(false) }
  }

  const filtered = decisions.filter(d => !termSearch || d.term.toLowerCase().includes(termSearch.toLowerCase()))
  const grouped: Record<string, any> = {}
  for (const d of filtered) {
    const k = d.analysis_run_id ?? 'unlinked'
    if (!grouped[k]) grouped[k] = { run_name: d.analysis_run?.run_name ?? 'Unlinked', run_at: d.analysis_run?.run_at ?? d.decided_at, brand: d.brand ?? '', items: [] }
    grouped[k].items.push(d)
  }

  const inp: React.CSSProperties = { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:6, padding:'6px 9px', fontSize:12, color:'var(--text)' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
        <div>
          <button onClick={onBack} style={{ fontSize:11, color:'var(--text3)', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:6 }}>← PPC Manager</button>
          <div style={{ fontSize:20, fontWeight:700 }}>Decisions log</div>
          <div style={{ fontSize:12, color:'var(--text3)', marginTop:3 }}>{total} total decisions</div>
        </div>
        <button className="btn-primary" onClick={onBack} style={{ fontSize:12 }}>＋ New analysis</button>
      </div>

      {/* Status pills */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' as const }}>
        {Object.entries(STATUS).map(([k, s]) => {
          const count = decisions.filter(d => d.status === k).length
          if (!count) return null
          const active = statusFilter === k
          return <button key={k} onClick={() => setStatusFilter(active ? '' : k)} style={{ fontSize:11, fontWeight:600, padding:'5px 12px', borderRadius:20, cursor:'pointer', color:s.color, background:active?s.bg:'var(--surface)', border:`1.5px solid ${active?s.color:s.border}`, display:'inline-flex', alignItems:'center', gap:5 }}>{s.icon} {s.label}: {count}</button>
        })}
        {(brandFilter||statusFilter||typeFilter||termSearch||runFilter) && <button onClick={() => { setBrandFilter(''); setStatusFilter(''); setTypeFilter(''); setTermSearch(''); setRunFilter('') }} style={{ fontSize:11, color:'var(--text3)', background:'none', border:'1px solid var(--border)', borderRadius:20, padding:'5px 12px', cursor:'pointer' }}>✕ Clear filters</button>}
      </div>

      {/* Filters */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1.5fr', gap:10, marginBottom:14 }}>
        <div><div style={{ fontSize:10, color:'var(--text3)', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:'.06em', fontWeight:600 }}>Brand</div><select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={{ ...inp, width:'100%' }}><option value="">All brands</option>{brands.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
        <div><div style={{ fontSize:10, color:'var(--text3)', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:'.06em', fontWeight:600 }}>Type</div><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, width:'100%' }}><option value="">All types</option>{Object.entries(MT_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><div style={{ fontSize:10, color:'var(--text3)', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:'.06em', fontWeight:600 }}>Status</div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width:'100%' }}><option value="">All statuses</option>{Object.entries(STATUS).map(([v,s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}</select></div>
        <div><div style={{ fontSize:10, color:'var(--text3)', marginBottom:3, textTransform:'uppercase' as const, letterSpacing:'.06em', fontWeight:600 }}>Search term</div><input type="text" value={termSearch} onChange={e => setTermSearch(e.target.value)} placeholder="Filter by keyword…" style={{ ...inp, width:'100%', boxSizing:'border-box' as const }} /></div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{ background:'var(--accent-light)', border:'1px solid var(--accent)', borderRadius:8, padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' as const }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--accent)' }}>{selected.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={inp}><option value="">Change status to…</option>{Object.entries(STATUS).map(([v,s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}</select>
          <input type="text" value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} placeholder="Notes (optional)" style={{ ...inp, flex:1, minWidth:120 }} />
          <button className="btn-primary" onClick={handleBulkUpdate} disabled={!bulkStatus||updating} style={{ fontSize:12, opacity:!bulkStatus||updating?0.5:1 }}>{updating?'⟳ Updating…':'Apply'}</button>
          <button onClick={() => setSelected(new Set())} style={{ fontSize:11, color:'var(--text3)', background:'none', border:'none', cursor:'pointer' }}>Clear</button>
          {updateMsg && <span style={{ fontSize:12, fontWeight:600, color: updateMsg.startsWith('✅') ? 'var(--accent)' : 'var(--red)' }}>{updateMsg}</span>}
        </div>
      )}

      {filtered.length > 0 && selected.size === 0 && <div style={{ marginBottom:8 }}><button onClick={() => setSelected(new Set(filtered.map(d => d.id)))} style={{ fontSize:11, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', padding:0 }}>☑ Select all {filtered.length} visible</button></div>}

      {loading ? <div className="loading">⟳ Loading…</div>
       : filtered.length === 0 ? <div className="empty" style={{ height:160 }}><div className="ei">📋</div><div>No decisions found</div></div>
       : (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {Object.entries(grouped).map(([key, group]) => (
            <div key={key}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:13, fontWeight:700 }}>{(group as any).run_name}</span>
                {(group as any).brand && <span style={{ fontSize:11, color:'var(--accent)', fontWeight:600 }}>{(group as any).brand}</span>}
                <span style={{ fontSize:11, color:'var(--text3)' }}>{new Date((group as any).run_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</span>
                <span style={{ fontSize:11, color:'var(--text3)' }}>· {(group as any).items.length} decisions</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {(group as any).items.map((d: any) => {
                  const mtc = MT_COLORS[d.match_type] ?? { color:'#6b7280', bg:'rgba(107,114,128,.08)' }
                  const isSel = selected.has(d.id)
                  return (
                    <div key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:7, background:isSel?'var(--accent-light)':'var(--surface)', border:`1px solid ${isSel?'var(--accent)':'var(--border)'}` }}>
                      <input type="checkbox" checked={isSel} onChange={() => setSelected(p => { const n=new Set(p); n.has(d.id)?n.delete(d.id):n.add(d.id); return n })} style={{ width:14, height:14, accentColor:'var(--accent)', cursor:'pointer', flexShrink:0 }} />
                      <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:700, minWidth:160 }}>{d.term}</span>
                      <Badge color={mtc.color} bg={mtc.bg}>{MT_LABELS[d.match_type]??d.match_type}</Badge>
                      {d.is_generic_flag && <Badge color="#ea580c" bg="rgba(234,88,12,.1)">⚠️ Generic</Badge>}
                      {d.campaign_names?.length > 0 && <span style={{ fontSize:11, color:'var(--text3)', fontStyle:'italic' }}>{d.campaign_names.join(', ')}</span>}
                      {d.notes && <span style={{ fontSize:11, color:'var(--text3)', fontStyle:'italic', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const }}>"{d.notes}"</span>}
                      <div style={{ flex:1 }} />
                      {(d.roas_at_decision??0) > 0 && <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>ROAS {d.roas_at_decision?.toFixed(2)}x</span>}
                      {(d.wasted_at_decision??0) > 0 && <span style={{ fontSize:11, color:'#dc2626', fontFamily:'var(--mono)' }}>${d.wasted_at_decision?.toFixed(2)}</span>}
                      <StatusPill status={d.status} />
                      <span style={{ fontSize:10, color:'var(--text3)', minWidth:44, textAlign:'right' as const }}>{new Date(d.decided_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
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

// ─────────────────────────────────────────────────────────────────────────────
// ── MAIN DASHBOARD — orchestrates sub-views ───────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

export default function PPCDashboard({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const [view, setView]         = useState<View>('home')
  const [orgId, setOrgId]       = useState<string | null>(null)
  const [brands, setBrands]     = useState<string[]>([])
  const [recentRuns, setRecentRuns] = useState<any[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading]   = useState(true)
  // State passed between views
  const [uploadIds, setUploadIds]       = useState<string[]>([])
  const [uploadDays, setUploadDays]     = useState(65)
  const [uploadBrand, setUploadBrand]   = useState('')
  const [decisionsRunId, setDecisionsRunId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const load = async () => {
      const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
      if (!org?.id) return
      setOrgId(org.id)
      const [{ data: bData }, { data: runs }, { count }] = await Promise.all([
        supabase.from('products').select('brand'),
        supabase.from('ppc_analysis_runs').select('id,run_name,run_at,brand,date_range_days,total_spend,total_wasted,high_negatives,medium_negatives,harvest_candidates,upload_ids').eq('org_id', org.id).order('run_at', { ascending: false }).limit(10),
        supabase.from('ppc_decisions_log').select('*', { count:'exact', head:true }).eq('org_id', org.id).eq('status', 'pending'),
      ])
      if (bData) setBrands([...new Set(bData.map((r: any) => r.brand).filter(Boolean))].sort() as string[])
      setRecentRuns(runs ?? [])
      setPendingCount(count ?? 0)
      setLoading(false)
    }
    load()
  }, [])

  // Called after upload completes — transitions to analysis view
  const handleUploadDone = (ids: string[], days: number, brand: string) => {
    setUploadIds(ids); setUploadDays(days); setUploadBrand(brand); setView('analysis')
  }

  // Called after saving decisions — stay in analysis but offer to go to decisions
  const handleGoDecisions = (runId: string) => {
    setDecisionsRunId(runId); setView('decisions')
  }

  if (!orgId && !loading) return <div style={{ padding: 32, color: 'var(--text3)' }}>No organisation found.</div>

  // Route to sub-view
  if (view === 'upload')    return <UploadView brands={brands} orgId={orgId!} onDone={handleUploadDone} />
  if (view === 'analysis')  return <AnalysisView uploadIds={uploadIds} dateRangeDays={uploadDays} brand={uploadBrand} orgId={orgId!} onBack={() => setView('home')} onGoDecisions={handleGoDecisions} />
  if (view === 'decisions') return <DecisionsView orgId={orgId!} brands={brands} initialRunId={decisionsRunId} onBack={() => setView('home')} />

  // ── HOME VIEW ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>PPC — Negative targeting &amp; keyword harvesting</div>
          <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>Upload search term reports · Find wasted spend to negate · Discover keywords to push</div>
        </div>
        <button className="btn-primary" onClick={() => setView('upload')}>＋ New analysis</button>
      </div>

      {/* Quick actions */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:28 }}>
        {[
          { icon:'📂', title:'Upload & analyse', desc:'Upload search term reports and run n-gram analysis', action:() => setView('upload') },
          { icon:'📋', title:'Decisions log', desc:`Track what was actioned, when, and in which campaigns${pendingCount>0?` · ${pendingCount} pending`:''}`, action:() => setView('decisions'), hi: pendingCount>0 },
          { icon:'⏳', title:'Pending decisions', desc:pendingCount>0?`${pendingCount} decisions awaiting action in Amazon`:'All decisions actioned', action:() => setView('decisions'), hi: pendingCount>0 },
        ].map(card => (
          <div key={card.title} onClick={card.action} style={{ background:card.hi?'rgba(234,164,44,.08)':'var(--surface)', border:`1px solid ${card.hi?'rgba(234,164,44,.35)':'var(--border)'}`, borderRadius:8, padding:16, cursor:'pointer' }}>
            <div style={{ fontSize:22, marginBottom:8 }}>{card.icon}</div>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{card.title}</div>
            <div style={{ fontSize:11, color:card.hi?'#b45309':'var(--text3)' }}>{card.desc}</div>
          </div>
        ))}
      </div>

      {/* Recent runs */}
      <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'.07em', color:'var(--text3)', marginBottom:10 }}>Recent analysis runs</div>
      {loading ? <div className="loading">⟳ Loading…</div>
       : recentRuns.length === 0 ? (
          <div className="empty" style={{ height:120 }}><div className="ei">🎯</div><div>No analysis runs yet — upload your first search term report</div></div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {/* Deduplicate: show only the latest run per unique upload_ids combination */}
            {(() => {
              const seen = new Set<string>()
              const deduped = recentRuns.filter(run => {
                const key = [...(run.upload_ids ?? [])].sort().join(',')
                if (seen.has(key)) return false
                seen.add(key); return true
              })
              return deduped.map(run => {
                // Count how many times this exact data was run
                const dupeCount = recentRuns.filter(r => [...(r.upload_ids??[])].sort().join(',') === [...(run.upload_ids??[])].sort().join(',')).length
                return (
                  <div key={run.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:13, fontWeight:600 }}>{run.run_name}</span>
                        {dupeCount > 1 && (
                          <span style={{ fontSize:10, color:'var(--text3)', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 6px' }}>
                            run {dupeCount}× — showing latest
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:3, display:'flex', gap:14, flexWrap:'wrap' as const }}>
                        {run.brand && <span style={{ color:'var(--accent)', fontWeight:600 }}>{run.brand}</span>}
                        <span>{run.date_range_days}-day</span>
                        <span>${run.total_spend?.toFixed(2)} spend</span>
                        <span style={{ color:'var(--red)', fontWeight:600 }}>${run.total_wasted?.toFixed(2)} wasted</span>
                        <span style={{ color:'#dc2626' }}>{run.high_negatives} HIGH negatives</span>
                        <span style={{ color:'var(--accent)' }}>{run.harvest_candidates} harvest candidates</span>
                        <span style={{ color:'var(--text3)' }}>{new Date(run.run_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, flexShrink:0, marginLeft:16 }}>
                      <button className="btn-secondary" style={{ fontSize:11, padding:'5px 12px' }}
                        onClick={() => {
                          if (run.upload_ids?.length) {
                            setUploadIds(run.upload_ids); setUploadDays(run.date_range_days)
                            setUploadBrand(run.brand ?? ''); setView('analysis')
                          }
                        }}>
                        ⚙️ Re-open analysis
                      </button>
                      <button className="btn-secondary" style={{ fontSize:11, padding:'5px 12px' }}
                        onClick={() => { setDecisionsRunId(run.id); setView('decisions') }}>
                        📋 View decisions
                      </button>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )
      }
    </div>
  )
}
