'use client'

import { useState, useRef } from 'react'
import type { Product, Cost } from '@/lib/types'
import { BRANDS, brandColor } from '@/lib/types'

const COLS = [
  { key: 'status',        label: 'Status',         width: 100, type: 'select', opts: ['Active','Not Listed'] },
  { key: 'brand',         label: 'Brand',          width: 160, type: 'select', opts: BRANDS.map(b => b.name) },
  { key: 'category',      label: 'Category',       width: 140, type: 'text' },
  { key: 'product_name',  label: 'Product Name',   width: 180, type: 'text' },
  { key: 'sku_id',        label: 'SKU ID',         width: 180, type: 'text', mono: true },
  { key: 'upc',           label: 'UPC / EAN',      width: 140, type: 'text', mono: true },
  { key: 'asin',          label: 'ASIN',           width: 120, type: 'text', mono: true },
  { key: 'warpfy_code',   label: 'Warpfy',         width: 110, type: 'text', mono: true },
  { key: 'color',         label: 'Color',          width: 110, type: 'text' },
  { key: 'size',          label: 'Size',           width: 90,  type: 'text' },
  { key: 'pack_size',     label: 'Pack',           width: 70,  type: 'text' },
  { key: 'material',      label: 'Material',       width: 110, type: 'text' },
  { key: '_prod_dims',    label: 'Prod Dims',      width: 130, type: 'dims', fields: ['prod_length','prod_width','prod_height'] },
  { key: '_pkg_dims',     label: 'Pkg Dims',       width: 130, type: 'dims', fields: ['pkg_length','pkg_width','pkg_height'] },
  { key: 'units_per_carton', label: 'Ctn Qty',     width: 80,  type: 'text', mono: true },
  { key: '_ctn_dims',     label: 'Carton Dims',    width: 150, type: 'dims', fields: ['carton_l','carton_b','carton_h'] },
  { key: 'carton_weight', label: 'Ctn Wt',         width: 80,  type: 'text', mono: true },
  { key: 'cbm',           label: 'CBM',            width: 90,  type: 'text', mono: true },
  { key: '_cost',         label: 'USD/Unit',       width: 90,  type: 'computed' },
]

type EditCell = { productId: string; key: string } | null

export default function ProductSheet({
  products, allProducts, dupeSkus, costs, onSave, onDelete, brandFilter
}: {
  products: Product[]
  allProducts: Product[]
  dupeSkus: Set<string>
  costs: Cost[]
  onSave: (p: Product) => Promise<boolean>
  onDelete: (id: string) => void
  brandFilter: string
}) {
  const [editCell, setEditCell] = useState<EditCell>(null)
  const [editValue, setEditValue] = useState('')
  const [pendingNew, setPendingNew] = useState<Product | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  function getUsd(skuId: string) {
    const c = costs.find(x => x.sku_id === skuId)
    return c?.usd_per_unit ? `$${parseFloat(String(c.usd_per_unit)).toFixed(2)}` : ''
  }

  function startEdit(product: Product, key: string) {
    setEditCell({ productId: product.id!, key })
    setEditValue(String((product as any)[key] ?? ''))
    setTimeout(() => (inputRef.current as any)?.focus?.(), 30)
  }

  async function commitEdit(product: Product, key: string, value: string) {
    setEditCell(null)
    if (String((product as any)[key] ?? '') === value) return
    await onSave({ ...product, [key]: value })
  }

  function addNewRow() {
    const newProduct: Product = {
      status: 'Active',
      brand: brandFilter || BRANDS[0].name,
      category: '', product_name: '', sku_id: '',
      prod_dim_unit: 'In', prod_weight_unit: 'Lb',
      pkg_dim_unit: 'In', pkg_weight_unit: 'Lb',
      carton_unit: 'In', carton_weight_unit: 'Lb',
      discontinued: false,
    }
    setPendingNew(newProduct)
  }

  async function savePending() {
    if (!pendingNew) return
    if (!pendingNew.sku_id) { alert('SKU ID is required'); return }
    if (allProducts.find(p => p.sku_id === pendingNew.sku_id)) { alert('SKU already exists'); return }
    const ok = await onSave(pendingNew)
    if (ok) setPendingNew(null)
  }

  function statusBadge(p: Product) {
    if (p.discontinued) return <span className="badge badge-discontinued">Discontinued</span>
    if (p.status === 'Active') return <span className="badge badge-active">Active</span>
    return <span className="badge badge-notlisted">Not Listed</span>
  }

  function dimsDisplay(p: Product, fields: string[]) {
    return fields.map(f => {
      const v = (p as any)[f]
      return v ? parseFloat(String(v)).toFixed(1) : '—'
    }).join(' × ')
  }

  const allRows = [...(pendingNew ? [pendingNew] : []), ...products]

  return (
    <div className="sheet-wrap">
      <table className="sheet-table">
        <thead>
          <tr>
            <th>#</th>
            {COLS.map(c => <th key={c.key} style={{ minWidth: c.width }}>{c.label}</th>)}
            <th className="col-actions">⋯</th>
          </tr>
        </thead>
        <tbody>
          {allRows.map((p, i) => {
            const isNew = !p.id
            const isDupe = p.sku_id ? dupeSkus.has(p.sku_id) : false
            return (
              <tr key={p.id || 'new'} className={isDupe ? 'dupe-flag' : isNew ? 'new-row' : ''}>
                <td>
                  <div className="cell-inner" style={{ justifyContent: 'center' }}>
                    {isNew ? '✦' : i + 1}
                  </div>
                </td>
                {COLS.map(col => {
                  const isEditing = editCell?.productId === p.id && editCell?.key === col.key
                  const val = String((p as any)[col.key] ?? '')

                  if (col.type === 'computed') {
                    return <td key={col.key}><div className="cell-inner"><span className="cell-text accent">{p.sku_id ? getUsd(p.sku_id) : ''}</span></div></td>
                  }
                  if (col.type === 'dims') {
                    return <td key={col.key}><div className="cell-inner"><span className="cell-text mono" style={{ color: 'var(--text3)' }}>{dimsDisplay(p, col.fields!)}</span></div></td>
                  }
                  if (isEditing || isNew) {
                    if (col.type === 'select') {
                      return (
                        <td key={col.key}>
                          <select
                            ref={inputRef as any}
                            className="cell-select"
                            value={isNew ? String((pendingNew as any)?.[col.key] ?? '') : editValue}
                            onChange={e => {
                              if (isNew) setPendingNew(prev => ({ ...prev!, [col.key]: e.target.value }))
                              else setEditValue(e.target.value)
                            }}
                            onBlur={() => {
                              if (!isNew) commitEdit(p, col.key, editValue)
                            }}
                          >
                            {col.opts?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        </td>
                      )
                    }
                    return (
                      <td key={col.key}>
                        <input
                          ref={inputRef as any}
                          className={`cell-edit ${col.mono ? 'mono' : ''}`}
                          value={isNew ? String((pendingNew as any)?.[col.key] ?? '') : editValue}
                          onChange={e => {
                            if (isNew) setPendingNew(prev => ({ ...prev!, [col.key]: e.target.value }))
                            else setEditValue(e.target.value)
                          }}
                          onBlur={() => { if (!isNew) commitEdit(p, col.key, editValue) }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); (e.target as HTMLElement).blur() }
                            if (e.key === 'Escape') { setEditCell(null) }
                          }}
                        />
                      </td>
                    )
                  }

                  return (
                    <td key={col.key} onClick={() => p.id && startEdit(p, col.key)} title={val}>
                      <div className="cell-inner">
                        {col.key === 'status'
                          ? statusBadge(p)
                          : col.key === 'brand'
                          ? <span className="cell-text" style={{ color: brandColor(val) }}>{val}</span>
                          : <span className={`cell-text ${col.mono ? 'mono' : ''}`}>{val}</span>
                        }
                      </div>
                    </td>
                  )
                })}
                <td className="actions-cell">
                  <div className="cell-inner" style={{ gap: 2 }}>
                    {isNew ? (
                      <>
                        <button className="btn-icon" style={{ color: 'var(--accent)' }} onClick={savePending} title="Save">✓</button>
                        <button className="btn-icon" style={{ color: 'var(--red)' }} onClick={() => setPendingNew(null)} title="Cancel">✕</button>
                      </>
                    ) : (
                      <>
                        {isDupe && <button className="btn-icon" style={{ color: 'var(--orange)', fontSize: 11 }} title="Duplicate SKU">⚠️</button>}
                        <button className="btn-icon" onClick={() => {
                          const dup = { ...p, id: undefined, sku_id: '', product_name: (p.product_name || '') + ' (copy)', upc: '' }
                          setPendingNew(dup)
                        }} title="Duplicate">⎘</button>
                        <button className="btn-icon" style={{ color: 'var(--red)' }} onClick={() => p.id && onDelete(p.id)} title="Delete">✕</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="add-row-trigger" onClick={addNewRow}>＋ Add row</div>
    </div>
  )
}
