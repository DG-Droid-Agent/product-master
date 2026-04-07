'use client'

import { useState, useRef, useCallback } from 'react'
import type { Product, Supplier, ChangeLog } from '@/lib/types'
import { BRANDS, brandColor } from '@/lib/types'
import SupplierPanel from './SupplierPanel'

const COLS = [
  { key: 'status',        label: 'Status',       width: 100, type: 'select', opts: ['Active','Not Listed','Discontinued'] },
  { key: 'brand',         label: 'Brand',        width: 160, type: 'select', opts: BRANDS.map(b => b.name) },
  { key: 'category',      label: 'Category',     width: 140, type: 'text' },
  { key: 'product_name',  label: 'Product Name', width: 180, type: 'text' },
  { key: 'sku_id',        label: 'SKU ID',       width: 180, type: 'text',   mono: true },
  { key: 'upc',           label: 'UPC / EAN',    width: 150, type: 'upc' },
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
  const [editCell, setEditCell]       = useState<EditCell>(null)
  const [editValue, setEditValue]     = useState('')
  const [editOriginal, setEditOriginal] = useState<Product | null>(null)
  const [pendingNew, setPendingNew]   = useState<Product | null>(null)
  const [supplierPanelSku, setSupplierPanelSku] = useState<string | null>(null)
  const [saving, setSaving]           = useState<string | null>(null) // sku being saved
  const [saveError, setSaveError]     = useState<string | null>(null)
  const [colWidths, setColWidths]     = useState<Record<string, number>>({})
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  // Track pending edit value via ref so onBlur always has latest value
  const editValueRef = useRef('')

  function startColResize(e: React.MouseEvent, key: string, currentWidth: number) {
    e.preventDefault()
    resizeRef.current = { key, startX: e.clientX, startW: currentWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = ev.clientX - resizeRef.current.startX
      const newW = Math.max(60, resizeRef.current.startW + delta)
      setColWidths(prev => ({ ...prev, [resizeRef.current!.key]: newW }))
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

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
    // Commit any pending edit first
    if (editCell) {
      const prev = allProducts.find(x => x.id === editCell.productId)
      if (prev) doCommit(prev, editCell.key, editValueRef.current)
    }
    const val = String((product as any)[key] ?? '')
    setEditCell({ productId: product.id!, key })
    setEditValue(val)
    editValueRef.current = val
    setEditOriginal({ ...product })
    setTimeout(() => (inputRef.current as any)?.focus?.(), 30)
  }

  async function doCommit(product: Product, key: string, value: string) {
    const original = editOriginal ?? product
    setEditCell(null)
    setEditOriginal(null)
    if (String((product as any)[key] ?? '') === value) return
    setSaving(product.sku_id)
    setSaveError(null)
    const ok = await onSave({ ...product, [key]: value }, original)
    setSaving(null)
    if (!ok) setSaveError(`Failed to save ${product.sku_id}`)
  }

  async function savePending() {
    if (!pendingNew) return
    const sku = pendingNew.sku_id?.trim()
    if (!sku) { setSaveError('SKU ID is required to save a new product'); return }
    if (allProducts.find(p => p.sku_id === sku)) { setSaveError(`SKU "${sku}" already exists`); return }
    setSaving('new')
    setSaveError(null)
    const ok = await onSave({ ...pendingNew, sku_id: sku })
    setSaving(null)
    if (ok) {
      setPendingNew(null)
    } else {
      setSaveError('Failed to save new product — check required fields')
    }
  }

  function statusBadge(p: Product) {
    if (p.discontinued || p.status === 'Discontinued') return <span className="badge badge-discontinued">Discontinued</span>
    if (p.status === 'Active') return <span className="badge badge-active">Active</span>
    return <span className="badge badge-notlisted">Not Listed</span>
  }

  function upcDisplay(val: string) {
    if (!val || val === 'nan' || val === '') return <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
    if (val === 'Exempt') return <span style={{ fontSize: 10, padding: '1px 6px', background: 'var(--surface3)', color: 'var(--text3)', borderRadius: 3, border: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>Exempt</span>
    return <span className="cell-text mono">{val}</span>
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
      {/* Save error banner */}
      {saveError && (
        <div style={{ background: 'var(--red-light)', borderBottom: '1px solid rgba(192,57,43,.2)', padding: '8px 16px', fontSize: 12, color: 'var(--red)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          ⚠ {saveError}
          <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14 }}>✕</button>
        </div>
      )}

      <div className="sheet-wrap">
        <table className="sheet-table">
          <thead>
            <tr>
              <th style={{ width: 36, minWidth: 36 }}>#</th>
              {COLS.map(c => (
                <th key={c.key} style={{ minWidth: colWidths[c.key] ?? c.width, width: colWidths[c.key] ?? c.width, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span>{c.label}</span>
                    <span
                      style={{ width: 4, cursor: 'col-resize', padding: '0 2px', color: 'var(--border2)', userSelect: 'none', flexShrink: 0 }}
                      onMouseDown={e => startColResize(e, c.key, colWidths[c.key] ?? c.width)}
                      title="Drag to resize">⋮</span>
                  </div>
                </th>
              ))}
              <th className="col-actions">⋯</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((p, i) => {
              const isNew   = !p.id
              const isDupe  = p.sku_id ? dupeSkus.has(p.sku_id) : false
              const isSaving = saving === p.sku_id || (isNew && saving === 'new')
              const activeSup = p.sku_id ? getActiveSup(p.sku_id) : undefined
              const supCount  = p.sku_id ? suppliersForSku(p.sku_id).length : 0

              return (
                <tr key={p.id || 'new'} className={isDupe ? 'dupe-flag' : isNew ? 'new-row' : ''}>
                  <td>
                    <div className="cell-inner" style={{ justifyContent: 'center' }}>
                      {isSaving
                        ? <span style={{ fontSize: 11, color: 'var(--accent)', animation: 'spin 1s linear infinite' }}>⟳</span>
                        : isNew ? '✦' : i + 1}
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

                    // UPC field — special display with Exempt badge
                    if (col.type === 'upc' && !isEditing && !isNew) {
                      return (
                        <td key={col.key} onClick={() => p.id && startEdit(p, col.key)}>
                          <div className="cell-inner">{upcDisplay(val)}</div>
                        </td>
                      )
                    }

                    // Editing state
                    if (isEditing || isNew) {
                      if (col.type === 'select') {
                        return (
                          <td key={col.key}>
                            <select
                              ref={inputRef as any}
                              className="cell-select"
                              value={isNew ? String((pendingNew as any)?.[col.key] ?? '') : editValue}
                              onChange={e => {
                                const v = e.target.value
                                if (isNew) {
                                  setPendingNew(prev => ({ ...prev!, [col.key]: v }))
                                } else {
                                  setEditValue(v)
                                  editValueRef.current = v
                                  // Select saves immediately on change
                                  doCommit(p, col.key, v)
                                }
                              }}>
                              {col.opts?.map(o => <option key={o}>{o}</option>)}
                            </select>
                          </td>
                        )
                      }

                      // UPC field in edit mode — text + Exempt button
                      if (col.type === 'upc') {
                        const upcVal = isNew ? String((pendingNew as any)?.upc ?? '') : editValue
                        return (
                          <td key={col.key} style={{ minWidth: 150 }}>
                            <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                              <input
                                ref={inputRef as any}
                                className="cell-edit mono"
                                value={upcVal}
                                placeholder="UPC or Exempt"
                                onChange={e => {
                                  const v = e.target.value
                                  if (isNew) setPendingNew(prev => ({ ...prev!, upc: v }))
                                  else { setEditValue(v); editValueRef.current = v }
                                }}
                                onBlur={() => { if (!isNew) doCommit(p, 'upc', editValueRef.current) }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); (e.target as HTMLElement).blur() }
                                  if (e.key === 'Escape') { setEditCell(null) }
                                }}
                                style={{ flex: 1, border: 'none', outline: 'none', padding: '0 6px', fontFamily: 'var(--mono)', fontSize: 11, background: 'transparent', color: 'var(--text)' }}
                              />
                              <button
                                title="Mark as Exempt (no UPC needed)"
                                onMouseDown={e => {
                                  e.preventDefault() // prevent input blur
                                  const v = upcVal === 'Exempt' ? '' : 'Exempt'
                                  if (isNew) setPendingNew(prev => ({ ...prev!, upc: v }))
                                  else { setEditValue(v); editValueRef.current = v; doCommit(p, 'upc', v) }
                                }}
                                style={{
                                  padding: '2px 6px', fontSize: 9, fontWeight: 600,
                                  background: upcVal === 'Exempt' ? 'var(--surface3)' : 'var(--surface2)',
                                  color: upcVal === 'Exempt' ? 'var(--text2)' : 'var(--text3)',
                                  border: '1px solid var(--border)', borderRadius: 3,
                                  cursor: 'pointer', marginRight: 4, whiteSpace: 'nowrap',
                                  fontFamily: 'var(--font)',
                                }}>
                                {upcVal === 'Exempt' ? '✓ Exempt' : 'Exempt'}
                              </button>
                            </div>
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
                              const v = e.target.value
                              if (isNew) setPendingNew(prev => ({ ...prev!, [col.key]: v }))
                              else { setEditValue(v); editValueRef.current = v }
                            }}
                            onBlur={() => { if (!isNew) doCommit(p, col.key, editValueRef.current) }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); (e.target as HTMLElement).blur() }
                              if (e.key === 'Escape') { setEditCell(null) }
                            }}
                          />
                        </td>
                      )
                    }

                    // Yellow background for empty important fields
                    const isEmpty = !val || val === 'nan' || val === ''
                    const isImportantEmpty = isEmpty && ['product_name','sku_id','upc','asin','brand','category'].includes(col.key)
                    return (
                      <td key={col.key}
                        onClick={() => p.id && startEdit(p, col.key)}
                        title={val}
                        style={isImportantEmpty ? { background: '#fffbea' } : undefined}>
                        <div className="cell-inner">
                          {col.key === 'status'
                            ? statusBadge(p)
                            : col.key === 'brand'
                            ? <span className="cell-text" style={{ color: brandColor(val) }}>{val || <span style={{color:'#c9a800',fontSize:10}}>⚠ missing</span>}</span>
                            : isImportantEmpty
                            ? <span style={{ fontSize: 10, color: '#c9a800', fontStyle: 'italic' }}>empty</span>
                            : <span className={`cell-text ${col.mono ? 'mono' : ''}`}>{val}</span>
                          }
                        </div>
                      </td>
                    )
                  })}

                  {/* Actions */}
                  <td className="actions-cell">
                    <div className="cell-inner" style={{ gap: 2 }}>
                      {isNew ? (
                        <>
                          <button
                            className="btn-icon"
                            style={{ color: 'var(--accent)', fontWeight: 600 }}
                            onClick={savePending}
                            disabled={saving === 'new'}
                            title="Save new product">
                            {saving === 'new' ? '⟳' : '✓ Save'}
                          </button>
                          <button className="btn-icon" style={{ color: 'var(--red)' }} onClick={() => { setPendingNew(null); setSaveError(null) }} title="Cancel">✕</button>
                        </>
                      ) : (
                        <>
                          {isDupe && <button className="btn-icon" style={{ color: 'var(--orange)', fontSize: 11 }} title="Duplicate SKU">⚠️</button>}
                          <button className="btn-icon" title="Suppliers & History" onClick={() => setSupplierPanelSku(p.sku_id)}>📋</button>
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

        {/* Add row footer */}
        <div className="add-row-trigger" onClick={() => { setSaveError(null); addNewRow() }}>＋ Add row</div>
      </div>

      {/* New product instructions banner */}
      {pendingNew && (
        <div style={{
          position: 'sticky', bottom: 0, background: 'var(--accent-light)',
          borderTop: '1px solid rgba(26,107,60,.2)', padding: '8px 16px',
          fontSize: 12, color: 'var(--accent)', display: 'flex', gap: 16, alignItems: 'center', zIndex: 8
        }}>
          <span>✦ New row — fill in the cells above, then click <strong>✓ Save</strong> in the actions column to save</span>
          <span style={{ color: 'var(--text3)' }}>SKU ID is required</span>
        </div>
      )}

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

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </>
  )

  function addNewRow() {
    const p: Product = {
      status: 'Active',
      brand: brandFilter || BRANDS[0].name,
      category: '', product_name: '', sku_id: '',
      prod_dim_unit: 'In', prod_weight_unit: 'Lb',
      pkg_dim_unit: 'In',  pkg_weight_unit: 'Lb',
      carton_unit: 'In',   carton_weight_unit: 'Lb',
      discontinued: false,
    }
    setPendingNew(p)
    // Scroll to top to see the new row
    setTimeout(() => {
      const newRow = document.querySelector('.new-row')
      newRow?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }
}
