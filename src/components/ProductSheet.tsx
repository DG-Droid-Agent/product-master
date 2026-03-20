'use client'

import { useState, useRef } from 'react'
import type { Product, Supplier, ChangeLog } from '@/lib/types'
import { BRANDS, brandColor } from '@/lib/types'
import SupplierPanel from './SupplierPanel'

const COLS = [
  { key: 'status',        label: 'Status',       width: 100, type: 'select', opts: ['Active','Not Listed'] },
  { key: 'brand',         label: 'Brand',        width: 160, type: 'select', opts: BRANDS.map(b => b.name) },
  { key: 'category',      label: 'Category',     width: 140, type: 'text' },
  { key: 'product_name',  label: 'Product Name', width: 180, type: 'text' },
  { key: 'sku_id',        label: 'SKU ID',       width: 180, type: 'text',   mono: true },
  { key: 'upc',           label: 'UPC / EAN',    width: 140, type: 'text',   mono: true },
  { key: 'asin',          label: 'ASIN',         width: 120, type: 'text',   mono: true },
  { key: 'warpfy_code',   label: 'Warpfy',       width: 110, type: 'text',   mono: true },
  { key: 'color',         label: 'Color',        width: 110, type: 'text' },
  { key: 'size',          label: 'Size',         width: 90,  type: 'text' },
  { key: 'pack_size',     label: 'Pack',         width: 70,  type: 'text' },
  { key: 'material',      label: 'Material',     width: 110, type: 'text' },
  { key: '_prod_dims',    label: 'Prod Dims',    width: 130, type: 'dims',   fields: ['prod_length','prod_width','prod_height'] },
  { key: '_pkg_dims',     label: 'Pkg Dims',     width: 130, type: 'dims',   fields: ['pkg_length','pkg_width','pkg_height'] },
  { key: '_suppliers',    label: 'Suppliers',    width: 120, type: 'supplier_summary' },
]

type EditCell = { productId: string; key: string } | null

export default function ProductSheet({
  products, allProducts, dupeSkus, suppliers, changelog, userEmail,
  brandFilter, onSave, onDelete, onSaveSupplier, onDeleteSupplier
}: {
  products: Product[]
  allProducts: Product[]
  dupeSkus: Set<string>
  suppliers: Supplier[]
  changelog: ChangeLog[]
  userEmail: string
  brandFilter: string
  onSave: (p: Product, original?: Product) => Promise<boolean>
  onDelete: (id: string) => void
  onSaveSupplier: (s: Supplier) => Promise<void>
  onDeleteSupplier: (id: string) => Promise<void>
}) {
  const [editCell, setEditCell] = useState<EditCell>(null)
  const [editValue, setEditValue] = useState('')
  const [editOriginal, setEditOriginal] = useState<Product | null>(null)
  const [pendingNew, setPendingNew] = useState<Product | null>(null)
  const [supplierPanelSku, setSupplierPanelSku] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  function suppliersForSku(skuId: string) {
    return suppliers.filter(s => s.sku_id === skuId)
  }
  function changelogForSku(skuId: string) {
    return changelog.filter(c => c.sku_id === skuId)
  }

  function getActiveSup(skuId: string): Supplier | undefined {
    const sups = suppliersForSku(skuId)
    return sups.find(s => s.is_active) ?? sups[0]
  }

  function startEdit(product: Product, key: string) {
    setEditCell({ productId: product.id!, key })
    setEditValue(String((product as any)[key] ?? ''))
    setEditOriginal({ ...product })
    setTimeout(() => (inputRef.current as any)?.focus?.(), 30)
  }

  async function commitEdit(product: Product, key: string, value: string) {
    setEditCell(null)
    if (String((product as any)[key] ?? '') === value) return
    await onSave({ ...product, [key]: value }, editOriginal ?? undefined)
    setEditOriginal(null)
  }

  function addNewRow() {
    const p: Product = {
      status: 'Active', brand: brandFilter || BRANDS[0].name,
      category: '', product_name: '', sku_id: '',
      prod_dim_unit: 'In', prod_weight_unit: 'Lb',
      pkg_dim_unit: 'In',  pkg_weight_unit: 'Lb',
      carton_unit: 'In',   carton_weight_unit: 'Lb',
      discontinued: false,
    }
    setPendingNew(p)
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
    const vals = fields.map(f => {
      const v = (p as any)[f]
      return v ? parseFloat(String(v)).toFixed(1) : '—'
    })
    return vals.join(' × ')
  }

  const panelProduct = supplierPanelSku ? (allProducts.find(p => p.sku_id === supplierPanelSku) ?? null) : null

  const allRows = [...(pendingNew ? [pendingNew] : []), ...products]

  return (
    <>
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
              const isNew  = !p.id
              const isDupe = p.sku_id ? dupeSkus.has(p.sku_id) : false
              const activeSup = p.sku_id ? getActiveSup(p.sku_id) : undefined
              const supCount  = p.sku_id ? suppliersForSku(p.sku_id).length : 0

              return (
                <tr key={p.id || 'new'} className={isDupe ? 'dupe-flag' : isNew ? 'new-row' : ''}>
                  <td>
                    <div className="cell-inner" style={{ justifyContent: 'center' }}>
                      {isNew ? '✦' : i + 1}
                    </div>
                  </td>

                  {COLS.map(col => {
                    const isEditing = !isNew && editCell?.productId === p.id && editCell?.key === col.key
                    const val = String((p as any)[col.key] ?? '')

                    // Supplier summary cell
                    if (col.type === 'supplier_summary') {
                      return (
                        <td key={col.key}>
                          <div className="cell-inner">
                            {isNew ? (
                              <span className="cell-text" style={{ color: 'var(--text3)' }}>Save first</span>
                            ) : supCount === 0 ? (
                              <button style={{ fontSize: 11, padding: '2px 8px', background: 'var(--orange-light)', color: 'var(--orange)', border: '1px solid rgba(192,107,0,.3)', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                onClick={() => setSupplierPanelSku(p.sku_id)}>
                                ＋ Add supplier
                              </button>
                            ) : (
                              <button style={{ fontSize: 11, padding: '2px 8px', background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid rgba(26,107,60,.3)', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                onClick={() => setSupplierPanelSku(p.sku_id)}>
                                🏭 {supCount} supplier{supCount !== 1 ? 's' : ''}
                                {activeSup?.usd_per_unit ? ` · $${parseFloat(String(activeSup.usd_per_unit)).toFixed(2)}` : ''}
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    }

                    if (col.type === 'dims') {
                      return (
                        <td key={col.key}>
                          <div className="cell-inner">
                            <span className="cell-text mono" style={{ color: 'var(--text3)' }}>
                              {dimsDisplay(p, col.fields!)}
                            </span>
                          </div>
                        </td>
                      )
                    }

                    if (isEditing || (isNew && col.type !== 'dims')) {
                      if (col.type === 'select') {
                        return (
                          <td key={col.key}>
                            <select ref={inputRef as any} className="cell-select"
                              value={isNew ? String((pendingNew as any)?.[col.key] ?? '') : editValue}
                              onChange={e => {
                                if (isNew) setPendingNew(prev => ({ ...prev!, [col.key]: e.target.value }))
                                else setEditValue(e.target.value)
                              }}
                              onBlur={() => { if (!isNew) commitEdit(p, col.key, editValue) }}>
                              {col.opts?.map(o => <option key={o}>{o}</option>)}
                            </select>
                          </td>
                        )
                      }
                      return (
                        <td key={col.key}>
                          <input ref={inputRef as any}
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
                          <button className="btn-icon" title="History" onClick={() => { setSupplierPanelSku(p.sku_id) }}>📋</button>
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

      {/* Supplier + History panel */}
      {supplierPanelSku && panelProduct && (
        <SupplierPanel
          skuId={supplierPanelSku}
          productName={panelProduct.product_name}
          suppliers={suppliersForSku(supplierPanelSku)}
          changelog={changelogForSku(supplierPanelSku)}
          userEmail={userEmail}
          onSave={onSaveSupplier}
          onDelete={onDeleteSupplier}
          onClose={() => setSupplierPanelSku(null)}
        />
      )}
    </>
  )
}
