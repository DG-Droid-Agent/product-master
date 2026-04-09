'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { Asin, InventorySnapshot, SalesVelocity, PlanningOutput, PurchaseOrder } from '@/lib/inventory'
import { calcFinalVelocity, calcPlanning, statusConfig, fmtDays, fmtUnits, fmtCost } from '@/lib/inventory'
import InventoryUpload from './InventoryUpload'
import VelocityPanel, { type VelocitySavePayload } from './VelocityPanel'
import PoPlanner from './PoPlanner'

type Tab = 'dashboard' | 'upload' | 'po'
type Filter = 'all' | 'critical' | 'order_soon' | 'watch' | 'healthy'
type SortKey = 'product_name' | 'brand' | 'fba' | 'awd' | 'total' | 'coverage' | 'velocity' | 'to_order' | 'est_cost' | 'status'
type SortDir = 'asc' | 'desc'
type BulkMode = 'edit' | 'apply' | null

const STATUS_ORDER: Record<string, number> = { critical: 0, order_soon: 1, watch: 2, healthy: 3 }

type Row = { asin: Asin; snap?: InventorySnapshot; vel?: SalesVelocity; plan?: PlanningOutput }

// ── Bulk Apply Panel ─────────────────────────────────────────────────────────
function BulkApplyPanel({ rows, onSave, onClose }: {
  rows: Row[]
  onSave: (s: number | null, k: number | null, t: number | null) => Promise<void>
  onClose: () => void
}) {
  const [sVal, setSVal] = useState<string>('')
  const [kVal, setKVal] = useState<string>('')
  const [tVal, setTVal] = useState<string>('')
  const [saving, setSaving] = useState(false)

  async function apply() {
    setSaving(true)
    await onSave(
      sVal !== '' ? parseFloat(sVal) : null,
      kVal !== '' ? parseFloat(kVal) : null,
      tVal !== '' ? parseFloat(tVal) : null,
    )
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: 460, maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.15)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Bulk Apply Multipliers</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{rows.length} products selected — leave blank to keep existing value</div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {[
            { label: 'S — Seasonality',   val: sVal, set: setSVal, color: '#1a4a8c' },
            { label: 'K — Search Trend',   val: kVal, set: setKVal, color: '#8a6a00' },
            { label: 'T — Team Push',      val: tVal, set: setTVal, color: 'var(--accent)' },
          ].map(m => (
            <div key={m.label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{m.label}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" step="0.05" min="0.1" max="5" placeholder="—"
                    value={m.val}
                    onChange={e => m.set(e.target.value)}
                    style={{ width: 80, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right', background: 'var(--surface2)', color: m.color, outline: 'none' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>×</span>
                </div>
              </div>
              {m.val !== '' && (
                <input type="range" min="0.1" max="3" step="0.05" value={parseFloat(m.val) || 1}
                  onChange={e => m.set(e.target.value)}
                  style={{ width: '100%', accentColor: m.color }} />
              )}
            </div>
          ))}

          {/* Preview of affected products */}
          <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 12px', marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 8 }}>Products affected</div>
            {rows.map(r => (
              <div key={r.asin.asin} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)', color: 'var(--text2)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{r.asin.product_name || r.asin.asin}</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>
                  S×{sVal !== '' ? parseFloat(sVal).toFixed(2) : (r.vel?.seasonality_multiplier ?? 1).toFixed(2)}{' '}
                  K×{kVal !== '' ? parseFloat(kVal).toFixed(2) : (r.vel?.search_trend_multiplier ?? 1).toFixed(2)}{' '}
                  T×{tVal !== '' ? parseFloat(tVal).toFixed(2) : (r.asin.team_push_multiplier ?? 1).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={apply} disabled={saving || (sVal === '' && kVal === '' && tVal === '')}>
            {saving ? '⟳ Applying…' : `Apply to ${rows.length} products`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bulk Edit Panel (per-product rows) ────────────────────────────────────────
function BulkEditPanel({ rows, velocities, onSave, onClose }: {
  rows: Row[]
  velocities: SalesVelocity[]
  onSave: (edits: Array<{ asin: string; s: number; k: number; t: number }>) => Promise<void>
  onClose: () => void
}) {
  const [edits, setEdits] = useState(() =>
    rows.map(r => ({
      asin:         r.asin.asin!,
      product_name: r.asin.product_name || r.asin.asin!,
      s: r.vel?.seasonality_multiplier  ?? 1.0,
      k: r.vel?.search_trend_multiplier ?? 1.0,
      t: r.asin.team_push_multiplier    ?? 1.0,
    }))
  )
  const [saving, setSaving] = useState(false)

  function update(asin: string, field: 's' | 'k' | 't', val: number) {
    setEdits(prev => prev.map(e => e.asin === asin ? { ...e, [field]: val } : e))
  }

  async function save() {
    setSaving(true)
    await onSave(edits.map(e => ({ asin: e.asin, s: e.s, k: e.k, t: e.t })))
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: 700, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.15)' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Edit Multipliers — {rows.length} products</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>S = Seasonality · K = Search Trend · T = Team Push</div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface3)', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', textAlign: 'left', borderBottom: '2px solid var(--border2)' }}>Product</th>
                {[
                  { key: 's', label: 'S Seasonality', color: '#1a4a8c' },
                  { key: 'k', label: 'K Search Trend', color: '#8a6a00' },
                  { key: 't', label: 'T Team Push', color: 'var(--accent)' },
                ].map(col => (
                  <th key={col.key} style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: col.color, textAlign: 'center', borderBottom: '2px solid var(--border2)', whiteSpace: 'nowrap' }}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {edits.map((e, i) => (
                <tr key={e.asin} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{e.product_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>{e.asin}</div>
                  </td>
                  {(['s', 'k', 't'] as const).map(field => {
                    const colors = { s: '#1a4a8c', k: '#8a6a00', t: 'var(--accent)' }
                    const color = colors[field]
                    return (
                      <td key={field} style={{ padding: '8px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <input type="range" min="0.1" max="3" step="0.05" value={e[field]}
                            onChange={ev => update(e.asin, field, parseFloat(ev.target.value))}
                            style={{ width: 100, accentColor: color }} />
                          <input type="number" step="0.05" min="0.1" max="5" value={e[field]}
                            onChange={ev => { const v = parseFloat(ev.target.value); if (!isNaN(v)) update(e.asin, field, Math.max(0.1, Math.min(5, v))) }}
                            style={{ width: 60, padding: '3px 6px', border: `1px solid ${e[field] !== 1 ? color : 'var(--border)'}`, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right', background: e[field] !== 1 ? 'var(--surface2)' : 'var(--surface2)', color, outline: 'none' }}
                          />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '⟳ Saving…' : `Save ${rows.length} products`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function InventoryDashboard({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const [tab, setTab]               = useState<Tab>('dashboard')
  const [filter, setFilter]         = useState<Filter>('all')
  const [search, setSearch]         = useState('')
  const [sortKey, setSortKey]       = useState<SortKey>('status')
  const [sortDir, setSortDir]       = useState<SortDir>('asc')
  const [loading, setLoading]       = useState(true)
  const [asins, setAsins]           = useState<Asin[]>([])
  const [snapshots, setSnapshots]   = useState<InventorySnapshot[]>([])
  const [velocities, setVelocities] = useState<SalesVelocity[]>([])
  const [planning, setPlanning]     = useState<PlanningOutput[]>([])
  const [pos, setPos]               = useState<PurchaseOrder[]>([])
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null)
  const [orgId, setOrgId]           = useState<string>('')
  const [snapshotDate, setSnapshotDate] = useState<string>('')
  // Bulk selection state
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [bulkMode, setBulkMode]     = useState<BulkMode>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: orgs } = await supabase.from('orgs').select('*').limit(1)
    const org = orgs?.[0]
    if (!org) { setLoading(false); return }
    setOrgId(org.id)

    const { data: latestSnap } = await supabase
      .from('inventory_snapshots').select('snapshot_date')
      .eq('org_id', org.id).order('snapshot_date', { ascending: false }).limit(1)
    const latestDate = latestSnap?.[0]?.snapshot_date ?? new Date().toISOString().split('T')[0]
    setSnapshotDate(latestDate)

    const [{ data: asinData }, { data: snapData }, { data: velData }, { data: planData }, { data: poData }] = await Promise.all([
      supabase.from('asins').select('*').eq('org_id', org.id).eq('is_active', true).order('brand').order('product_name'),
      supabase.from('inventory_snapshots').select('*').eq('org_id', org.id).eq('snapshot_date', latestDate),
      supabase.from('sales_velocity').select('*').eq('org_id', org.id).eq('snapshot_date', latestDate),
      supabase.from('planning_output').select('*').eq('org_id', org.id).eq('snapshot_date', latestDate),
      supabase.from('purchase_orders').select('*, po_line_items(*)').eq('org_id', org.id).order('created_at', { ascending: false }),
    ])
    setAsins(asinData ?? [])
    setSnapshots(snapData ?? [])
    setVelocities(velData ?? [])
    setPlanning(planData ?? [])
    setPos(poData ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const rows: Row[] = asins.map(a => ({
    asin: a,
    snap: snapshots.find(s => s.asin === a.asin),
    vel:  velocities.find(v => v.asin === a.asin),
    plan: planning.find(p => p.asin === a.asin),
  }))

  const filtered = rows.filter(r => {
    if (filter !== 'all' && r.plan?.status !== filter) return false
    if (search) {
      const hay = [r.asin.asin, r.asin.product_name, r.asin.brand, r.asin.sku_id, r.asin.category].join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let av: any, bv: any
    switch (sortKey) {
      case 'product_name': av = a.asin.product_name ?? ''; bv = b.asin.product_name ?? ''; break
      case 'brand':        av = a.asin.brand ?? '';        bv = b.asin.brand ?? '';        break
      case 'fba':          av = a.snap?.fba_fulfillable ?? 0;  bv = b.snap?.fba_fulfillable ?? 0;  break
      case 'awd':          av = a.snap?.awd_available ?? 0;    bv = b.snap?.awd_available ?? 0;    break
      case 'total':        av = a.plan?.true_inventory_units ?? 0; bv = b.plan?.true_inventory_units ?? 0; break
      case 'coverage':     av = a.plan?.coverage_days ?? 0;    bv = b.plan?.coverage_days ?? 0;    break
      case 'velocity':     av = a.vel?.final_velocity ?? 0;    bv = b.vel?.final_velocity ?? 0;    break
      case 'to_order':     av = a.plan?.units_to_order ?? 0;   bv = b.plan?.units_to_order ?? 0;   break
      case 'est_cost':     av = a.plan?.estimated_cost_usd ?? 0; bv = b.plan?.estimated_cost_usd ?? 0; break
      case 'status':       av = STATUS_ORDER[a.plan?.status ?? 'healthy'] ?? 3; bv = STATUS_ORDER[b.plan?.status ?? 'healthy'] ?? 3; break
      default:             av = 0; bv = 0
    }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span style={{ color: 'var(--text3)', marginLeft: 3 }}>↕</span>
    return <span style={{ color: 'var(--accent)', marginLeft: 3 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const kpis = {
    total:             rows.length,
    critical:          rows.filter(r => r.plan?.status === 'critical').length,
    orderSoon:         rows.filter(r => r.plan?.status === 'order_soon').length,
    watch:             rows.filter(r => r.plan?.status === 'watch').length,
    totalUnitsToOrder: rows.reduce((s, r) => s + (r.plan?.units_to_order ?? 0), 0),
    totalCost:         rows.reduce((s, r) => s + (r.plan?.estimated_cost_usd ?? 0), 0),
    avgCoverage:       rows.length ? rows.reduce((s, r) => s + (r.plan?.coverage_days ?? 0), 0) / rows.length : 0,
  }

  const hasData = snapshots.length > 0 || velocities.length > 0
  const allVisibleSelected = sorted.length > 0 && sorted.every(r => selected.has(r.asin.asin!))
  const selectedRows = rows.filter(r => selected.has(r.asin.asin!))

  function toggleSelect(asin: string) {
    setSelected(prev => { const n = new Set(prev); n.has(asin) ? n.delete(asin) : n.add(asin); return n })
  }
  function toggleAll() {
    if (allVisibleSelected) setSelected(prev => { const n = new Set(prev); sorted.forEach(r => n.delete(r.asin.asin!)); return n })
    else setSelected(prev => { const n = new Set(prev); sorted.forEach(r => n.add(r.asin.asin!)); return n })
  }

  // ── Save helpers ─────────────────────────────────────────────────────────
  async function saveOneSKT(asinStr: string, s: number, k: number, t: number, baseVel: number, snap?: InventorySnapshot, skuId?: string) {
    const newFinal = calcFinalVelocity(baseVel, s, k, t)
    await supabase.from('asins').update({
      team_push_multiplier: t, team_push_updated_at: new Date().toISOString(),
    }).eq('org_id', orgId).eq('asin', asinStr)

    await supabase.from('sales_velocity').update({
      seasonality_multiplier: s, search_trend_multiplier: k,
      team_push_multiplier: t, final_velocity: newFinal,
    }).eq('org_id', orgId).eq('asin', asinStr).eq('snapshot_date', snapshotDate)

    if (snap) {
      const { data: suppliers } = await supabase.from('suppliers')
        .select('sku_id, usd_per_unit, cbm, carton_qty').eq('sku_id', skuId ?? '').limit(1)
      const supplier   = suppliers?.[0]
      const unitCost   = supplier?.usd_per_unit ?? 0
      const cbmPerUnit = supplier && supplier.carton_qty > 0 ? supplier.cbm / supplier.carton_qty : 0
      const asinRec    = asins.find(a => a.asin === asinStr)
      if (asinRec) {
        const planCalc = calcPlanning({ ...asinRec, asin: asinStr }, snap.true_inventory_units ?? 0, newFinal, unitCost, cbmPerUnit)
        await supabase.from('planning_output').upsert(
          { org_id: orgId, asin: asinStr, snapshot_date: snapshotDate, ...planCalc },
          { onConflict: 'org_id,asin,snapshot_date' }
        )
      }
    }
  }

  if (loading) return <div className="loading">⟳ Loading inventory data…</div>

  const thStyle: React.CSSProperties = {
    padding: '9px 10px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '.07em', color: 'var(--text3)', borderBottom: '2px solid var(--border2)',
    textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
  }
  const thAct: React.CSSProperties = { ...thStyle, color: 'var(--accent)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', padding: '0 20px', flexShrink: 0 }}>
        {([
          { key: 'dashboard', label: '📊 Dashboard' },
          { key: 'upload',    label: '↑ Upload Reports' },
          { key: 'po',        label: `📋 Purchase Orders (${pos.filter(p => p.status === 'draft').length} draft)` },
        ] as { key: Tab; label: string }[]).map(t => (
          <div key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '11px 16px', fontSize: 13, cursor: 'pointer',
            borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`,
            color: tab === t.key ? 'var(--accent)' : 'var(--text3)',
            marginBottom: -1, transition: 'all .15s', fontWeight: tab === t.key ? 500 : 400, whiteSpace: 'nowrap',
          }}>{t.label}</div>
        ))}
        {snapshotDate && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            Last upload: {new Date(snapshotDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'dashboard' && (
          <div style={{ padding: 20 }}>

            {!hasData && (
              <div style={{ background: 'var(--orange-light)', border: '1px solid rgba(192,107,0,.3)', borderRadius: 8, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                <span style={{ fontSize: 20 }}>📂</span>
                <div><strong>No inventory data yet.</strong>{' '}
                  <span style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setTab('upload')}>↑ Upload Reports</span>
                </div>
              </div>
            )}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total ASINs',    value: kpis.total,                       color: 'var(--text)',   bg: 'var(--surface)' },
                { label: 'Critical',       value: kpis.critical,                    color: '#c0392b',       bg: '#fdf0ee' },
                { label: 'Order Soon',     value: kpis.orderSoon,                   color: '#c06b00',       bg: '#fff3e0' },
                { label: 'Watch',          value: kpis.watch,                       color: '#1a4a8c',       bg: '#eef3fb' },
                { label: 'Avg Coverage',   value: fmtDays(kpis.avgCoverage),        color: 'var(--accent)', bg: 'var(--surface)' },
                { label: 'Units to Order', value: fmtUnits(kpis.totalUnitsToOrder), color: 'var(--text)',   bg: 'var(--surface)' },
                { label: 'Est. PO Value',  value: fmtCost(kpis.totalCost),          color: 'var(--accent)', bg: 'var(--surface)' },
              ].map(k => (
                <div key={k.label} style={{ background: k.bg, border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 6 }}>{k.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 600, color: k.color, fontFamily: 'var(--mono)' }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Search + filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 13, pointerEvents: 'none' }}>⌕</span>
                <input style={{ width: '100%', padding: '6px 10px 6px 28px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font)', fontSize: 13, background: 'var(--surface2)', outline: 'none', color: 'var(--text)' }}
                  placeholder="Search ASIN, SKU, product name…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {(['all', 'critical', 'order_soon', 'watch', 'healthy'] as Filter[]).map(f => {
                const cfg = f === 'all' ? { label: 'All', color: 'var(--text2)', bg: 'var(--surface2)', border: 'var(--border)' } : statusConfig(f)
                const isActive = filter === f
                return (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                    background: isActive ? cfg.bg : 'var(--surface)',
                    color: isActive ? (f === 'all' ? 'var(--text)' : cfg.color) : 'var(--text3)',
                    border: `1px solid ${isActive ? (f === 'all' ? 'var(--border2)' : cfg.border) : 'var(--border)'}`,
                    fontWeight: isActive ? 500 : 400,
                  }}>
                    {f === 'all' ? `All (${rows.length})` : f === 'order_soon' ? `Order Soon (${kpis.orderSoon})` : f === 'critical' ? `Critical (${kpis.critical})` : f === 'watch' ? `Watch (${kpis.watch})` : `Healthy (${rows.filter(r => r.plan?.status === 'healthy').length})`}
                  </button>
                )
              })}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{sorted.length} ASINs</span>
            </div>

            {/* Bulk action toolbar — shown when rows are selected */}
            {selected.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid rgba(26,107,60,.25)', borderRadius: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>{selected.size} product{selected.size > 1 ? 's' : ''} selected</span>
                <div style={{ flex: 1 }} />
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setBulkMode('edit')}>
                  ✏️ Edit Each
                </button>
                <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => setBulkMode('apply')}>
                  ⚡ Bulk Apply Same Values
                </button>
                <button className="btn-icon" style={{ color: 'var(--text3)' }} onClick={() => setSelected(new Set())} title="Clear selection">✕</button>
              </div>
            )}

            {/* Table */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface3)' }}>
                      <th style={{ ...thStyle, cursor: 'default', width: 36, textAlign: 'center' }}>
                        <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                          title="Select all visible" style={{ cursor: 'pointer' }} />
                      </th>
                      <th style={sortKey === 'status' ? thAct : thStyle} onClick={() => handleSort('status')}>Status<SortIcon col="status" /></th>
                      <th style={sortKey === 'product_name' ? thAct : thStyle} onClick={() => handleSort('product_name')}>Product<SortIcon col="product_name" /></th>
                      <th style={thStyle}>ASIN</th>
                      <th style={sortKey === 'brand' ? thAct : thStyle} onClick={() => handleSort('brand')}>Brand<SortIcon col="brand" /></th>
                      <th style={sortKey === 'fba' ? thAct : thStyle} onClick={() => handleSort('fba')}>FBA<SortIcon col="fba" /></th>
                      <th style={sortKey === 'awd' ? thAct : thStyle} onClick={() => handleSort('awd')}>AWD<SortIcon col="awd" /></th>
                      <th style={sortKey === 'total' ? thAct : thStyle} onClick={() => handleSort('total')}>Total<SortIcon col="total" /></th>
                      <th style={sortKey === 'coverage' ? thAct : thStyle} onClick={() => handleSort('coverage')}>Coverage<SortIcon col="coverage" /></th>
                      <th style={sortKey === 'velocity' ? thAct : thStyle} onClick={() => handleSort('velocity')}>Velocity<SortIcon col="velocity" /></th>
                      <th style={thStyle}>Multipliers</th>
                      <th style={sortKey === 'to_order' ? thAct : thStyle} onClick={() => handleSort('to_order')}>To Order<SortIcon col="to_order" /></th>
                      <th style={sortKey === 'est_cost' ? thAct : thStyle} onClick={() => handleSort('est_cost')}>Est. Cost<SortIcon col="est_cost" /></th>
                      <th style={{ ...thStyle, cursor: 'default' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.length === 0 && (
                      <tr><td colSpan={14} style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
                        {hasData ? 'No ASINs match your filters' : 'Upload reports to see inventory data'}
                      </td></tr>
                    )}
                    {sorted.map(({ asin: a, snap, vel, plan }, i) => {
                      const cfg = statusConfig(plan?.status ?? 'healthy')
                      const coveragePct = Math.min(100, ((plan?.coverage_days ?? 0) / (a.target_coverage_days)) * 100)
                      const isSelected = selected.has(a.asin!)
                      return (
                        <tr key={a.asin} style={{ background: isSelected ? 'var(--accent-light)' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)', cursor: 'pointer' }}
                          onClick={() => setSelectedAsin(selectedAsin === a.asin ? null : a.asin!)}>
                          <td style={{ padding: '10px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(a.asin!)} style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ padding: '10px 10px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap' }}>{cfg.label}</span>
                          </td>
                          <td style={{ padding: '10px 10px', maxWidth: 180 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.product_name || '—'}</div>
                            <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>{a.sku_id || ''}</div>
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{a.asin}</td>
                          <td style={{ padding: '10px 10px', fontSize: 12, color: 'var(--text2)' }}>{a.brand || '—'}</td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                            <div>{fmtUnits(snap?.fba_fulfillable ?? 0)}</div>
                            {(snap?.fba_inbound_shipped ?? 0) > 0 && <div style={{ fontSize: 10, color: 'var(--text3)' }}>+{fmtUnits(snap!.fba_inbound_shipped)} inbound</div>}
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                            <div>{fmtUnits(snap?.awd_available ?? 0)}</div>
                            {(snap?.awd_inbound ?? 0) > 0 && <div style={{ fontSize: 10, color: 'var(--text3)' }}>+{fmtUnits(snap!.awd_inbound)} inbound</div>}
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500 }}>{fmtUnits(plan?.true_inventory_units ?? 0)}</td>
                          <td style={{ padding: '10px 10px', minWidth: 110 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${coveragePct}%`, background: cfg.color, borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: cfg.color, fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtDays(plan?.coverage_days ?? 0)}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>
                            {vel?.final_velocity ? `${vel.final_velocity.toFixed(1)}/day` : '—'}
                          </td>
                          <td style={{ padding: '10px 10px' }}>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {[
                                { label: 'S', val: vel?.seasonality_multiplier ?? 1,  title: 'Seasonality',  color1: '#1a4a8c' },
                                { label: 'K', val: vel?.search_trend_multiplier ?? 1, title: 'Search Trend', color1: '#8a6a00' },
                                { label: 'T', val: a.team_push_multiplier ?? 1,       title: 'Team Push',    color1: 'var(--accent)' },
                              ].map(m => (
                                <span key={m.label} title={`${m.title}: ${m.val}x`} style={{
                                  fontSize: 10, padding: '1px 5px', borderRadius: 3,
                                  background: m.val > 1 ? 'var(--accent-light)' : m.val < 1 ? '#fdf0ee' : 'var(--surface3)',
                                  color: m.val > 1 ? m.color1 : m.val < 1 ? '#c0392b' : 'var(--text3)',
                                  fontFamily: 'var(--mono)',
                                }}>{m.label}×{m.val.toFixed(2)}</span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: (plan?.units_to_order ?? 0) > 0 ? '#c06b00' : 'var(--text3)' }}>
                            {(plan?.units_to_order ?? 0) > 0 ? fmtUnits(plan!.units_to_order) : '—'}
                          </td>
                          <td style={{ padding: '10px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)' }}>
                            {fmtCost(plan?.estimated_cost_usd ?? 0)}
                          </td>
                          <td style={{ padding: '10px 10px' }}>
                            <button className="btn-icon" style={{ fontSize: 12 }}
                              onClick={e => { e.stopPropagation(); setSelectedAsin(a.asin!) }}
                              title="Edit multipliers">✎</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <InventoryUpload orgId={orgId} userEmail={userEmail} onComplete={() => { loadData(); setTab('dashboard') }} />
        )}
        {tab === 'po' && (
          <PoPlanner orgId={orgId} userEmail={userEmail} pos={pos} planningRows={rows} onRefresh={loadData} />
        )}
      </div>

      {/* ── Single product velocity panel ── */}
      {selectedAsin && (() => {
        const asinRecord = asins.find(a => a.asin === selectedAsin)
        if (!asinRecord) return null
        const vel  = velocities.find(v => v.asin === selectedAsin)
        const snap = snapshots.find(s => s.asin === selectedAsin)
        const plan = planning.find(p => p.asin === selectedAsin)
        return (
          <VelocityPanel
            orgId={orgId} asin={asinRecord} velocity={vel} planning={plan} snapshotDate={snapshotDate}
            onSave={async (payload: VelocitySavePayload) => {
              const { asin: updated, teamPush, teamNotes, seasonality, searchTrend } = payload
              await supabase.from('asins').update({
                team_push_multiplier: teamPush, team_push_notes: teamNotes,
                team_push_updated_at: new Date().toISOString(),
              }).eq('org_id', orgId).eq('asin', updated.asin)
              await saveOneSKT(updated.asin!, seasonality, searchTrend, teamPush, vel?.base_velocity ?? 0, snap, updated.sku_id)
              await loadData()
              setSelectedAsin(null)
            }}
            onClose={() => setSelectedAsin(null)}
          />
        )
      })()}

      {/* ── Bulk Edit Panel (per-product) ── */}
      {bulkMode === 'edit' && (
        <BulkEditPanel
          rows={selectedRows}
          velocities={velocities}
          onSave={async (edits) => {
            for (const edit of edits) {
              const r = rows.find(r => r.asin.asin === edit.asin)
              await saveOneSKT(edit.asin, edit.s, edit.k, edit.t, r?.vel?.base_velocity ?? 0, r?.snap, r?.asin.sku_id)
            }
            await loadData()
            setBulkMode(null)
            setSelected(new Set())
          }}
          onClose={() => setBulkMode(null)}
        />
      )}

      {/* ── Bulk Apply Panel (same values) ── */}
      {bulkMode === 'apply' && (
        <BulkApplyPanel
          rows={selectedRows}
          onSave={async (s, k, t) => {
            for (const r of selectedRows) {
              const asinStr = r.asin.asin!
              const newS = s ?? r.vel?.seasonality_multiplier  ?? 1
              const newK = k ?? r.vel?.search_trend_multiplier ?? 1
              const newT = t ?? r.asin.team_push_multiplier    ?? 1
              await saveOneSKT(asinStr, newS, newK, newT, r.vel?.base_velocity ?? 0, r.snap, r.asin.sku_id)
            }
            await loadData()
            setBulkMode(null)
            setSelected(new Set())
          }}
          onClose={() => setBulkMode(null)}
        />
      )}
    </div>
  )
}
