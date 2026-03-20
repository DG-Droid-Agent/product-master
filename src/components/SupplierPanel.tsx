'use client'

import { useState } from 'react'
import type { Supplier, ChangeLog } from '@/lib/types'
import { CURRENCIES, TERMS, calcUsd, fmtDims, fmtNum } from '@/lib/types'

type Props = {
  skuId: string
  productName: string
  suppliers: Supplier[]
  changelog: ChangeLog[]
  userEmail: string
  onSave: (s: Supplier) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

type Tab = 'suppliers' | 'history'

export default function SupplierPanel({
  skuId, productName, suppliers, changelog, userEmail, onSave, onDelete, onClose
}: Props) {
  const [tab, setTab] = useState<Tab>('suppliers')
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)

  function newSupplier(): Supplier {
    return {
      sku_id: skuId,
      supplier_name: '',
      is_active: suppliers.length === 0,
      cost: undefined,
      currency: 'USD',
      term: 'EXW',
      carton_unit: 'In',
      carton_weight_unit: 'Lb',
    }
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.supplier_name?.trim()) { alert('Supplier name is required'); return }
    setSaving(true)
    await onSave({
      ...editing,
      usd_per_unit: calcUsd(editing.cost ?? 0, editing.currency ?? 'USD'),
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    setEditing(null)
  }

  function field(label: string, key: keyof Supplier, type = 'text', opts?: string[]) {
    if (!editing) return null
    const val = editing[key] as any ?? ''
    if (opts) {
      return (
        <div className="fg">
          <label>{label}</label>
          <select value={val} onChange={e => setEditing(prev => ({ ...prev!, [key]: e.target.value }))}>
            {opts.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      )
    }
    if (type === 'checkbox') {
      return (
        <div className="fg" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 20 }}>
          <input type="checkbox" id={`chk-${key}`} checked={!!val}
            onChange={e => setEditing(prev => ({ ...prev!, [key]: e.target.checked }))}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
          <label htmlFor={`chk-${key}`} style={{ textTransform: 'none', fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>
            {label}
          </label>
        </div>
      )
    }
    return (
      <div className="fg">
        <label>{label}</label>
        <input type={type} step={type === 'number' ? '0.0001' : undefined}
          value={val}
          onChange={e => setEditing(prev => ({ ...prev!, [key]: type === 'number' ? parseFloat(e.target.value) || '' : e.target.value }))}
          placeholder={type === 'number' ? '0.00' : ''}
        />
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        width: 680, maxWidth: '95vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.15)'
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{productName}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{skuId}</div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {(['suppliers','history'] as Tab[]).map(t => (
            <div key={t} onClick={() => setTab(t)} style={{
              padding: '10px 14px', fontSize: 13, cursor: 'pointer',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              color: tab === t ? 'var(--accent)' : 'var(--text3)',
              marginBottom: -1, transition: 'all .15s', fontWeight: tab === t ? 500 : 400
            }}>
              {t === 'suppliers' ? `🏭 Suppliers (${suppliers.length})` : `📋 History (${changelog.length})`}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

          {/* ── SUPPLIERS TAB ── */}
          {tab === 'suppliers' && (
            <div>
              {/* Supplier cards */}
              {suppliers.length === 0 && !editing && (
                <div className="empty" style={{ height: 140 }}>
                  <div className="ei">🏭</div>
                  <div>No suppliers yet — add one below</div>
                </div>
              )}

              {suppliers.map(s => (
                <div key={s.id} style={{
                  background: s.is_active ? 'var(--accent-light)' : 'var(--surface2)',
                  border: `1px solid ${s.is_active ? 'rgba(26,107,60,.25)' : 'var(--border)'}`,
                  borderRadius: 8, padding: '12px 14px', marginBottom: 10
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{s.supplier_name || 'Unnamed Supplier'}</span>
                      {s.is_active && (
                        <span style={{
                          background: 'var(--accent)', color: '#fff', fontSize: 9,
                          fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '.06em'
                        }}>ACTIVE</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => setEditing({ ...s })} title="Edit">✎</button>
                      <button className="btn-icon" style={{ color: 'var(--red)' }}
                        onClick={() => { if (confirm('Delete this supplier?')) s.id && onDelete(s.id) }}
                        title="Delete">✕</button>
                    </div>
                  </div>

                  {/* Two-column data grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
                    {[
                      ['Cost', s.cost ? `${fmtNum(s.cost)} ${s.currency ?? ''}` : '—'],
                      ['USD / Unit', s.usd_per_unit ? `$${fmtNum(s.usd_per_unit, 3)}` : '—'],
                      ['Term', s.term ?? '—'],
                      ['Carton Qty', s.carton_qty ? String(s.carton_qty) : '—'],
                      ['Carton Dims', fmtDims(s.carton_l, s.carton_b, s.carton_h, s.carton_unit)],
                      ['Carton Weight', s.carton_weight ? `${fmtNum(s.carton_weight)} ${s.carton_weight_unit ?? ''}` : '—'],
                      ['CBM', s.cbm ? fmtNum(s.cbm, 5) : '—'],
                      ['Notes', s.notes || '—'],
                    ].map(([label, val]) => (
                      <div key={label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 90, flexShrink: 0 }}>{label}</span>
                        <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Edit / Add form */}
              {editing ? (
                <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', borderRadius: 8, padding: 16, marginTop: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 14, color: 'var(--accent)' }}>
                    {editing.id ? '✎ Edit Supplier' : '＋ New Supplier'}
                  </div>
                  <div className="form-grid">
                    {field('Supplier Name', 'supplier_name')}
                    {field('Active for Orders', 'is_active', 'checkbox')}
                  </div>

                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--accent)', margin: '14px 0 10px', paddingTop: 14, borderTop: '1px solid var(--border)' }}>Cost</div>
                  <div className="form-grid">
                    {field('Cost', 'cost', 'number')}
                    {field('Currency', 'currency', 'select', CURRENCIES)}
                    {field('Term', 'term', 'select', TERMS)}
                    {field('Notes', 'notes')}
                  </div>

                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--accent)', margin: '14px 0 10px', paddingTop: 14, borderTop: '1px solid var(--border)' }}>Master Carton</div>
                  <div className="form-grid">
                    {field('Units / Carton', 'carton_qty', 'number')}
                    {field('Dim Unit', 'carton_unit', 'select', ['In','cm'])}
                    {field('Length (L)', 'carton_l', 'number')}
                    {field('Breadth (B)', 'carton_b', 'number')}
                    {field('Height (H)', 'carton_h', 'number')}
                    {field('Weight Unit', 'carton_weight_unit', 'select', ['Lb','kg'])}
                    {field('Carton Weight', 'carton_weight', 'number')}
                    {field('CBM', 'cbm', 'number')}
                  </div>

                  {/* Auto CBM hint */}
                  {editing.carton_l && editing.carton_b && editing.carton_h && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
                      Auto CBM ({editing.carton_unit === 'In' ? 'inches' : 'cm'}):&nbsp;
                      <strong style={{ color: 'var(--accent)' }}>
                        {editing.carton_unit === 'In'
                          ? ((editing.carton_l * editing.carton_b * editing.carton_h) / 61023.74).toFixed(5)
                          : ((editing.carton_l * editing.carton_b * editing.carton_h) / 1000000).toFixed(5)
                        } m³
                      </strong>
                      <button style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid rgba(26,107,60,.3)', borderRadius: 3, cursor: 'pointer' }}
                        onClick={() => {
                          const cbm = editing.carton_unit === 'In'
                            ? (editing.carton_l! * editing.carton_b! * editing.carton_h!) / 61023.74
                            : (editing.carton_l! * editing.carton_b! * editing.carton_h!) / 1000000
                          setEditing(prev => ({ ...prev!, cbm: parseFloat(cbm.toFixed(6)) }))
                        }}>
                        Use this
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                    <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                      {saving ? '⟳ Saving…' : 'Save Supplier'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                  onClick={() => setEditing(newSupplier())}>
                  ＋ Add Supplier
                </button>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {tab === 'history' && (
            <div>
              {changelog.length === 0 ? (
                <div className="empty" style={{ height: 140 }}>
                  <div className="ei">📋</div>
                  <div>No changes recorded yet</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['When','Who','Field','Old Value','New Value'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '8px 10px', fontSize: 10,
                          fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em',
                          color: 'var(--text3)', borderBottom: '1px solid var(--border)',
                          background: 'var(--surface3)'
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {changelog.map((c, i) => (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', fontFamily: 'var(--mono)' }}>
                          {c.changed_at ? new Date(c.changed_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text2)' }}>
                          {c.changed_by?.split('@')[0] ?? '—'}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                          {c.field_name}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--red)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.old_value || <span style={{ color: 'var(--text3)' }}>empty</span>}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.new_value || <span style={{ color: 'var(--text3)' }}>empty</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
