'use client'

import { useState } from 'react'
import type { Cost, Product } from '@/lib/types'
import { brandColor, FX } from '@/lib/types'

export default function CostMaster({ costs, products, onSave, onDelete }: {
  costs: Cost[]
  products: Product[]
  onSave: (c: Cost) => void
  onDelete: (id: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Partial<Cost>>({ currency: 'USD', term: 'EXW' })

  function calcUsd(cost: string | number, currency: string) {
    return ((parseFloat(String(cost)) || 0) * (FX[currency] ?? 1))
  }

  function updateCost(cost: Cost, field: keyof Cost, value: string) {
    const updated = { ...cost, [field]: value }
    if (field === 'cost' || field === 'currency') {
      updated.usd_per_unit = calcUsd(updated.cost ?? 0, updated.currency ?? 'USD')
    }
    onSave(updated)
  }

  async function submitAdd() {
    if (!form.sku_id) { alert('Select a product'); return }
    const p = products.find(x => x.sku_id === form.sku_id)
    onSave({
      sku_id: form.sku_id!,
      product_name: p?.product_name ?? '',
      brand: p?.brand ?? '',
      supplier: form.supplier ?? '',
      cost: parseFloat(String(form.cost)) || 0,
      currency: form.currency ?? 'USD',
      term: form.term ?? 'EXW',
      usd_per_unit: calcUsd(form.cost ?? 0, form.currency ?? 'USD'),
      notes: form.notes ?? '',
    })
    setShowAdd(false)
    setForm({ currency: 'USD', term: 'EXW' })
  }

  return (
    <div className="cost-wrap">
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>＋ Add Entry</button>
      </div>

      {showAdd && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>New Cost Entry</div>
          <div className="form-grid">
            <div className="fg full">
              <label>Product / SKU</label>
              <select value={form.sku_id ?? ''} onChange={e => setForm(f => ({ ...f, sku_id: e.target.value }))}>
                <option value="">— Select product —</option>
                {products.map(p => <option key={p.sku_id} value={p.sku_id}>{p.sku_id} — {(p.product_name ?? '').slice(0, 55)}</option>)}
              </select>
            </div>
            <div className="fg full">
              <label>Supplier</label>
              <input placeholder="Supplier / factory name" value={form.supplier ?? ''} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
            </div>
            <div className="fg">
              <label>Cost</label>
              <input type="number" step="0.01" placeholder="0.00" value={form.cost ?? ''} onChange={e => setForm(f => ({ ...f, cost: parseFloat(e.target.value) }))} />
            </div>
            <div className="fg">
              <label>Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD','RMB','CNY','INR','EUR','GBP'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Term</label>
              <select value={form.term} onChange={e => setForm(f => ({ ...f, term: e.target.value }))}>
                {['EXW','FOB','CIF','DDP'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Notes</label>
              <input placeholder="Optional" value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={submitAdd}>Save</button>
          </div>
        </div>
      )}

      <div className="cost-table-card">
        <table className="cost-tbl">
          <thead>
            <tr>
              <th>SKU / Product</th>
              <th>Brand</th>
              <th>Supplier</th>
              <th>Cost</th>
              <th>Currency</th>
              <th>Term</th>
              <th>USD / Unit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 && (
              <tr><td colSpan={8}><div className="empty"><div className="ei">💰</div><div>No cost entries yet</div></div></td></tr>
            )}
            {costs.map(c => (
              <tr key={c.id}>
                <td>
                  <div className="cell-inner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                    <span style={{ fontSize: 12 }}>{(c.product_name ?? '').slice(0, 50)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>{c.sku_id}</span>
                  </div>
                </td>
                <td><div className="cell-inner"><span style={{ color: brandColor(c.brand ?? ''), fontSize: 12 }}>{c.brand}</span></div></td>
                <td>
                  <input className="cost-input" defaultValue={c.supplier ?? ''} placeholder="Supplier"
                    onBlur={e => updateCost(c, 'supplier', e.target.value)} />
                </td>
                <td>
                  <input className="cost-input" type="number" step="0.01" defaultValue={String(c.cost ?? '')} style={{ width: 90 }}
                    onBlur={e => updateCost(c, 'cost', e.target.value)} />
                </td>
                <td>
                  <select className="cost-sel" value={c.currency ?? 'USD'} onChange={e => updateCost(c, 'currency', e.target.value)}>
                    {['USD','RMB','CNY','INR','EUR','GBP'].map(x => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td>
                  <select className="cost-sel" value={c.term ?? 'EXW'} onChange={e => updateCost(c, 'term', e.target.value)}>
                    {['EXW','FOB','CIF','DDP'].map(x => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td><div className="cell-inner"><span className="usd-val">${parseFloat(String(c.usd_per_unit ?? 0)).toFixed(3)}</span></div></td>
                <td>
                  <div className="cell-inner">
                    <button className="btn-danger" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => c.id && onDelete(c.id)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
