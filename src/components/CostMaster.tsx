'use client'

import { useState, useRef } from 'react'
import type { Cost, Product } from '@/lib/types'
import { brandColor, FX } from '@/lib/types'

const VALID_CURRENCIES = ['USD','RMB','CNY','INR','EUR','GBP']
const VALID_TERMS = ['EXW','FOB','CIF','DDP']

export default function CostMaster({ costs, products, onSave, onDelete }: {
  costs: Cost[]
  products: Product[]
  onSave: (c: Cost) => void
  onDelete: (id: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Partial<Cost>>({ currency: 'USD', term: 'EXW' })
  const [uploadResult, setUploadResult] = useState<{ updated: number; added: number; errors: string[] } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  // ── DOWNLOAD TEMPLATE ──────────────────────────────────────────────────────
  function downloadTemplate() {
    const headers = ['sku_id','product_name','brand','supplier','cost','currency','term','notes']
    const instructions = [
      '# INSTRUCTIONS: Fill in or update the fields below. DO NOT change the sku_id column.',
      '# Save as CSV and upload using the Bulk Upload CSV button.',
      '# currency options: USD, RMB, CNY, INR, EUR, GBP',
      '# term options: EXW, FOB, CIF, DDP',
      '# Rows with empty supplier and cost will be skipped.',
      '#',
    ]

    // Existing entries pre-filled
    const existingRows = costs.map(c => [
      c.sku_id ?? '',
      c.product_name ?? '',
      c.brand ?? '',
      c.supplier ?? '',
      c.cost ?? '',
      c.currency ?? 'USD',
      c.term ?? 'EXW',
      c.notes ?? '',
    ])

    // Products with no cost entry yet — blank rows for team to fill in
    const skusWithCosts = new Set(costs.map(c => c.sku_id))
    const blankRows = products
      .filter(p => p.sku_id && !skusWithCosts.has(p.sku_id))
      .map(p => [p.sku_id!, p.product_name ?? '', p.brand ?? '', '', '', 'USD', 'EXW', ''])

    const allRows = [...existingRows, ...blankRows]

    const csvLines = [
      ...instructions,
      headers.join(','),
      ...allRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ]

    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvLines.join('\n'))
    a.download = 'cost_master_template.csv'
    a.click()
  }

  // ── PARSE & UPLOAD CSV ─────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      await processCsvUpload(ev.target?.result as string)
    }
    reader.readAsText(file)
    e.target.value = '' // allow re-upload of same file
  }

  async function processCsvUpload(csvText: string) {
    setUploading(true)
    setUploadResult(null)

    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    if (lines.length < 2) {
      setUploadResult({ updated: 0, added: 0, errors: ['File appears empty or has no data rows.'] })
      setUploading(false)
      return
    }

    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim())
    const idx = (name: string) => headers.indexOf(name)
    const skuIdx      = idx('sku_id')
    const supplierIdx = idx('supplier')
    const costIdx     = idx('cost')
    const currencyIdx = idx('currency')
    const termIdx     = idx('term')
    const notesIdx    = idx('notes')

    if (skuIdx === -1) {
      setUploadResult({ updated: 0, added: 0, errors: ['Could not find sku_id column. Make sure you are using the downloaded template.'] })
      setUploading(false)
      return
    }

    const errors: string[] = []
    let updated = 0
    let added = 0

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      const sku = cols[skuIdx]?.trim()
      if (!sku) continue

      const product = products.find(p => p.sku_id === sku)
      if (!product) {
        errors.push(`Row ${i + 1}: SKU "${sku}" not found — skipped`)
        continue
      }

      const supplier  = supplierIdx  >= 0 ? cols[supplierIdx]?.trim()  ?? '' : ''
      const costRaw   = costIdx      >= 0 ? cols[costIdx]?.trim()      ?? '' : ''
      const currency  = currencyIdx  >= 0 ? (cols[currencyIdx]?.trim().toUpperCase()  || 'USD') : 'USD'
      const term      = termIdx      >= 0 ? (cols[termIdx]?.trim().toUpperCase()      || 'EXW') : 'EXW'
      const notes     = notesIdx     >= 0 ? cols[notesIdx]?.trim()     ?? '' : ''

      // Skip rows with no meaningful data
      if (!supplier && !costRaw && !notes) continue

      // Validate cost
      const costNum = parseFloat(costRaw)
      if (costRaw && isNaN(costNum)) {
        errors.push(`Row ${i + 1}: SKU "${sku}" — cost "${costRaw}" is not a valid number — skipped`)
        continue
      }

      // Validate currency
      if (!VALID_CURRENCIES.includes(currency)) {
        errors.push(`Row ${i + 1}: SKU "${sku}" — currency "${currency}" not valid. Use: ${VALID_CURRENCIES.join(', ')} — skipped`)
        continue
      }

      // Validate term
      if (!VALID_TERMS.includes(term)) {
        errors.push(`Row ${i + 1}: SKU "${sku}" — term "${term}" not valid. Use: ${VALID_TERMS.join(', ')} — skipped`)
        continue
      }

      const usd = calcUsd(costNum || 0, currency)
      const existing = costs.find(c => c.sku_id === sku)

      if (existing) {
        onSave({
          ...existing,
          supplier:    supplier  || existing.supplier,
          cost:        costRaw   ? costNum : existing.cost,
          currency:    currency  || existing.currency,
          term:        term      || existing.term,
          notes:       notes     || existing.notes,
          usd_per_unit: costRaw  ? usd : existing.usd_per_unit,
        })
        updated++
      } else {
        onSave({
          sku_id:       sku,
          product_name: product.product_name ?? '',
          brand:        product.brand ?? '',
          supplier,
          cost:         costNum || 0,
          currency,
          term,
          usd_per_unit: usd,
          notes,
        })
        added++
      }
    }

    setUploadResult({ updated, added, errors })
    setUploading(false)
  }

  function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current); current = ''
      } else {
        current += ch
      }
    }
    result.push(current)
    return result
  }

  return (
    <div className="cost-wrap">

      {/* Action bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-secondary" onClick={downloadTemplate}>
          ↓ Download Template
        </button>
        <label style={{ cursor: 'pointer' }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
          <span className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {uploading ? '⟳ Uploading…' : '↑ Bulk Upload CSV'}
          </span>
        </label>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>＋ Add Entry</button>
      </div>

      {/* Workflow hint */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7,
        padding: '9px 14px', marginBottom: 12, fontSize: 11, color: 'var(--text3)',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'
      }}>
        <span style={{ color: 'var(--text2)', fontWeight: 500 }}>Bulk update:</span>
        <span>① Download Template</span>
        <span style={{ color: 'var(--border2)' }}>→</span>
        <span>② Fill in Excel / Sheets (save as CSV)</span>
        <span style={{ color: 'var(--border2)' }}>→</span>
        <span>③ Upload CSV — existing entries update, new ones are added</span>
      </div>

      {/* Upload result */}
      {uploadResult && (
        <div style={{
          background: uploadResult.errors.length > 0 ? 'var(--orange-light)' : 'var(--accent-light)',
          border: `1px solid ${uploadResult.errors.length > 0 ? 'rgba(192,107,0,.3)' : 'rgba(26,107,60,.3)'}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 14
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                {uploadResult.errors.length === 0 ? '✓ Upload complete' : '⚠ Upload completed with warnings'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', gap: 16 }}>
                {uploadResult.updated > 0 && <span>✓ {uploadResult.updated} row{uploadResult.updated !== 1 ? 's' : ''} updated</span>}
                {uploadResult.added > 0   && <span>✓ {uploadResult.added} row{uploadResult.added !== 1 ? 's' : ''} added</span>}
                {uploadResult.errors.length > 0 && <span style={{ color: 'var(--orange)' }}>⚠ {uploadResult.errors.length} skipped</span>}
              </div>
              {uploadResult.errors.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {uploadResult.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--orange)', fontFamily: 'var(--mono)', marginTop: 3 }}>{e}</div>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-icon" onClick={() => setUploadResult(null)}>✕</button>
          </div>
        </div>
      )}

      {/* Add single entry */}
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
                {VALID_CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Term</label>
              <select value={form.term} onChange={e => setForm(f => ({ ...f, term: e.target.value }))}>
                {VALID_TERMS.map(t => <option key={t}>{t}</option>)}
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

      {/* Cost table */}
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
              <tr><td colSpan={8}>
                <div className="empty"><div className="ei">💰</div><div>No cost entries yet — download the template to bulk add</div></div>
              </td></tr>
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
                    {VALID_CURRENCIES.map(x => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td>
                  <select className="cost-sel" value={c.term ?? 'EXW'} onChange={e => updateCost(c, 'term', e.target.value)}>
                    {VALID_TERMS.map(x => <option key={x}>{x}</option>)}
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
