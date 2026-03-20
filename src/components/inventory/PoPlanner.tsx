'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { PurchaseOrder, PoLineItem } from '@/lib/inventory'
import { fmtUnits, fmtCost, statusConfig } from '@/lib/inventory'

type PlanningRow = {
  asin: any
  snap?: any
  vel?: any
  plan?: any
}

const PO_STATUS = ['draft','confirmed','in_production','shipped','received'] as const
const PO_STATUS_CONFIG = {
  draft:         { label: 'Draft',         color: 'var(--text3)',  bg: 'var(--surface3)' },
  confirmed:     { label: 'Confirmed',     color: '#1a4a8c',       bg: '#eef3fb' },
  in_production: { label: 'In Production', color: '#8a6a00',       bg: '#fff3e0' },
  shipped:       { label: 'Shipped',       color: '#1a6b3c',       bg: '#e8f5ed' },
  received:      { label: 'Received',      color: 'var(--text2)',  bg: 'var(--surface2)' },
}

export default function PoPlanner({ orgId, userEmail, pos, planningRows, onRefresh }: {
  orgId: string
  userEmail: string
  pos: PurchaseOrder[]
  planningRows: PlanningRow[]
  onRefresh: () => void
}) {
  const supabase = createClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPos, setSelectedPos] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newPo, setNewPo] = useState({
    supplier_name: '',
    po_number: '',
    raised_date: new Date().toISOString().split('T')[0],
    expected_ship_date: '',
    notes: '',
    selected_asins: [] as string[],
  })

  // ASINs that need ordering (units_to_order > 0)
  const orderableRows = planningRows.filter(r => (r.plan?.units_to_order ?? 0) > 0)
    .sort((a, b) => (a.plan?.urgency_days ?? 999) - (b.plan?.urgency_days ?? 999))

  function toggleAsin(asin: string) {
    setNewPo(prev => ({
      ...prev,
      selected_asins: prev.selected_asins.includes(asin)
        ? prev.selected_asins.filter(a => a !== asin)
        : [...prev.selected_asins, asin]
    }))
  }

  function selectAll() {
    setNewPo(prev => ({ ...prev, selected_asins: orderableRows.map(r => r.asin.asin) }))
  }

  async function createPo() {
    if (!newPo.supplier_name.trim()) { alert('Supplier name required'); return }
    if (newPo.selected_asins.length === 0) { alert('Select at least one ASIN'); return }
    setCreating(true)

    // Build line items from planning data
    const lineItems: Omit<PoLineItem, 'id' | 'po_id'>[] = newPo.selected_asins.map(asin => {
      const row = planningRows.find(r => r.asin.asin === asin)
      const units = row?.plan?.units_to_order ?? 0
      const cbmPerUnit = row?.plan?.estimated_cbm && units > 0 ? row.plan.estimated_cbm / units : 0
      const unitCost = row?.plan?.estimated_cost_usd && units > 0 ? row.plan.estimated_cost_usd / units : 0
      return {
        asin,
        sku_id: row?.asin.sku_id ?? '',
        product_name: row?.asin.product_name ?? '',
        units,
        cartons: 0, // will calculate from supplier carton qty later
        cbm: parseFloat((units * cbmPerUnit).toFixed(4)),
        unit_cost_usd: parseFloat(unitCost.toFixed(4)),
        total_cost_usd: parseFloat((units * unitCost).toFixed(2)),
      }
    })

    const totalUnits = lineItems.reduce((s, l) => s + l.units, 0)
    const totalCbm = lineItems.reduce((s, l) => s + l.cbm, 0)
    const totalCost = lineItems.reduce((s, l) => s + l.total_cost_usd, 0)

    // Create PO
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      org_id: orgId,
      po_number: newPo.po_number || `PO-${Date.now().toString().slice(-6)}`,
      supplier_name: newPo.supplier_name,
      status: 'draft',
      raised_date: newPo.raised_date,
      expected_ship_date: newPo.expected_ship_date || null,
      notes: newPo.notes,
      total_units: totalUnits,
      total_cbm: parseFloat(totalCbm.toFixed(4)),
      total_cost_usd: parseFloat(totalCost.toFixed(2)),
      created_by: userEmail,
    }).select().single()

    if (error || !po) { alert('Error creating PO: ' + error?.message); setCreating(false); return }

    // Create line items
    await supabase.from('po_line_items').insert(lineItems.map(l => ({ ...l, po_id: po.id })))

    setCreating(false)
    setShowCreate(false)
    setNewPo({ supplier_name: '', po_number: '', raised_date: new Date().toISOString().split('T')[0], expected_ship_date: '', notes: '', selected_asins: [] })
    onRefresh()
  }

  async function updatePoStatus(poId: string, status: string) {
    await supabase.from('purchase_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', poId)
    onRefresh()
  }

  async function deletePo(poId: string) {
    if (!confirm('Delete this PO?')) return
    await supabase.from('purchase_orders').delete().eq('id', poId)
    onRefresh()
  }

  return (
    <div style={{ padding: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Purchase Orders</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {orderableRows.length} ASINs need reordering · {pos.filter(p => p.status === 'draft').length} draft POs
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          ＋ Create PO
        </button>
      </div>

      {/* Create PO panel */}
      {showCreate && (
        <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', marginBottom: 16 }}>New Purchase Order</div>

          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="fg">
              <label>Supplier Name</label>
              <input value={newPo.supplier_name} onChange={e => setNewPo(p => ({ ...p, supplier_name: e.target.value }))} placeholder="Factory / supplier name" />
            </div>
            <div className="fg">
              <label>PO Number (optional)</label>
              <input value={newPo.po_number} onChange={e => setNewPo(p => ({ ...p, po_number: e.target.value }))} placeholder="Auto-generated if blank" />
            </div>
            <div className="fg">
              <label>Date Raised</label>
              <input type="date" value={newPo.raised_date} onChange={e => setNewPo(p => ({ ...p, raised_date: e.target.value }))} />
            </div>
            <div className="fg">
              <label>Expected Ship Date</label>
              <input type="date" value={newPo.expected_ship_date} onChange={e => setNewPo(p => ({ ...p, expected_ship_date: e.target.value }))} />
            </div>
            <div className="fg full">
              <label>Notes</label>
              <input value={newPo.notes} onChange={e => setNewPo(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>

          {/* ASIN selection */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)' }}>
                Select ASINs to include ({newPo.selected_asins.length} selected)
              </div>
              <button className="btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={selectAll}>
                Select all ({orderableRows.length})
              </button>
            </div>

            {orderableRows.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13, background: 'var(--surface2)', borderRadius: 7 }}>
                No ASINs need reordering right now
              </div>
            ) : (
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 7 }}>
                {orderableRows.map((row, i) => {
                  const isSelected = newPo.selected_asins.includes(row.asin.asin)
                  const cfg = statusConfig(row.plan?.status ?? 'healthy')
                  return (
                    <div key={row.asin.asin}
                      onClick={() => toggleAsin(row.asin.asin)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        borderBottom: i < orderableRows.length - 1 ? '1px solid var(--border)' : 'none',
                        background: isSelected ? 'var(--accent-light)' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)',
                        cursor: 'pointer', transition: 'background .1s',
                      }}>
                      <input type="checkbox" checked={isSelected} readOnly
                        style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                      <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {row.plan?.urgency_days ?? 0}d left
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.asin.product_name || row.asin.asin}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{row.asin.asin}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#c06b00', fontFamily: 'var(--mono)' }}>{fmtUnits(row.plan?.units_to_order ?? 0)} units</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtCost(row.plan?.estimated_cost_usd ?? 0)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary */}
          {newPo.selected_asins.length > 0 && (() => {
            const selRows = orderableRows.filter(r => newPo.selected_asins.includes(r.asin.asin))
            const totalUnits = selRows.reduce((s, r) => s + (r.plan?.units_to_order ?? 0), 0)
            const totalCost = selRows.reduce((s, r) => s + (r.plan?.estimated_cost_usd ?? 0), 0)
            return (
              <div style={{ display: 'flex', gap: 20, padding: '10px 14px', background: 'var(--accent-light)', borderRadius: 7, marginBottom: 14, fontSize: 13 }}>
                <span><strong style={{ color: 'var(--accent)' }}>{newPo.selected_asins.length}</strong> <span style={{ color: 'var(--text2)' }}>ASINs</span></span>
                <span><strong style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{fmtUnits(totalUnits)}</strong> <span style={{ color: 'var(--text2)' }}>units</span></span>
                <span><strong style={{ color: 'var(--accent)' }}>{fmtCost(totalCost)}</strong> <span style={{ color: 'var(--text2)' }}>est. cost</span></span>
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn-primary" onClick={createPo} disabled={creating || newPo.selected_asins.length === 0}>
              {creating ? '⟳ Creating…' : 'Create PO'}
            </button>
          </div>
        </div>
      )}

      {/* PO list */}
      {pos.length === 0 && !showCreate ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
          <div>No purchase orders yet. Create one from reorder recommendations above.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pos.map(po => {
            const sc = PO_STATUS_CONFIG[po.status as keyof typeof PO_STATUS_CONFIG] ?? PO_STATUS_CONFIG.draft
            const lines = (po as any).po_line_items ?? []
            const isExpanded = selectedPos === po.id
            return (
              <div key={po.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {/* PO header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
                  onClick={() => setSelectedPos(isExpanded ? null : po.id!)}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>
                    {sc.label}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{po.po_number || 'Draft PO'} — {po.supplier_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {po.raised_date && `Raised ${po.raised_date}`}
                      {po.expected_ship_date && ` · Ships ${po.expected_ship_date}`}
                      {` · ${lines.length} ASINs`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}>{fmtUnits(po.total_units)} units</div>
                    <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{fmtCost(po.total_cost_usd)}</div>
                  </div>
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Status control */}
                    <div style={{ padding: '10px 16px', background: 'var(--surface2)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>Status:</span>
                      {PO_STATUS.map(s => {
                        const c = PO_STATUS_CONFIG[s]
                        return (
                          <button key={s} onClick={() => updatePoStatus(po.id!, s)} style={{
                            padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                            background: po.status === s ? c.bg : 'var(--surface)',
                            color: po.status === s ? c.color : 'var(--text3)',
                            border: `1px solid ${po.status === s ? c.color + '44' : 'var(--border)'}`,
                            fontWeight: po.status === s ? 600 : 400,
                          }}>{c.label}</button>
                        )
                      })}
                      <button className="btn-danger" style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px' }} onClick={() => deletePo(po.id!)}>Delete</button>
                    </div>

                    {/* Line items */}
                    {lines.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface3)' }}>
                            {['Product', 'ASIN', 'Units', 'Unit Cost', 'Total'].map(h => (
                              <th key={h} style={{ padding: '7px 14px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l: PoLineItem, i: number) => (
                            <tr key={l.id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                              <td style={{ padding: '8px 14px', fontSize: 12 }}>{l.product_name || '—'}</td>
                              <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{l.asin}</td>
                              <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{fmtUnits(l.units)}</td>
                              <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)' }}>{l.unit_cost_usd ? `$${l.unit_cost_usd.toFixed(3)}` : '—'}</td>
                              <td style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>{fmtCost(l.total_cost_usd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {po.notes && (
                      <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)' }}>
                        📝 {po.notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
