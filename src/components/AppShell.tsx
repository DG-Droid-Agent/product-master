'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Product, Supplier, ChangeLog, Cost } from '@/lib/types'
import { BRANDS, brandColor, calcUsd, FX } from '@/lib/types'
import ProductSheet from './ProductSheet'
import CostMaster from './CostMaster'
import UpcManager from './UpcManager'
import Pipeline from './Pipeline'

type Tab = 'catalog' | 'pipeline' | 'upc' | 'costs'

export default function AppShell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const supabase = createClient()

  const [tab, setTab]               = useState<Tab>('catalog')
  const [products, setProducts]     = useState<Product[]>([])
  const [suppliers, setSuppliers]   = useState<Supplier[]>([])
  const [changelog, setChangelog]   = useState<ChangeLog[]>([])
  const [costs, setCosts]           = useState<Cost[]>([])
  const [brandFilter, setBrandFilter] = useState('')
  const [search, setSearch]         = useState('')
  const [catFilter, setCatFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading]       = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prods }, { data: sups }, { data: logs }, { data: costsData }] = await Promise.all([
      supabase.from('products').select('*').order('brand').order('category').order('product_name'),
      supabase.from('suppliers').select('*').order('sku_id').order('is_active', { ascending: false }),
      supabase.from('change_log').select('*').order('changed_at', { ascending: false }).limit(500),
      supabase.from('costs').select('*').order('brand').order('sku_id'),
    ])
    setProducts(prods ?? [])
    setSuppliers(sups ?? [])
    setChangelog(logs ?? [])
    setCosts(costsData ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── AUDIT LOG ─────────────────────────────────────────────────────────────
  async function logChange(sku_id: string, product_name: string, field_name: string, old_value: string, new_value: string) {
    if (old_value === new_value) return
    await supabase.from('change_log').insert({
      sku_id,
      product_name,
      changed_by: user.email ?? 'unknown',
      field_name,
      old_value: old_value || '',
      new_value: new_value || '',
      changed_at: new Date().toISOString(),
    })
  }

  // ── PRODUCT SAVE with audit ────────────────────────────────────────────────
  async function saveProduct(updated: Product, original?: Product) {
    const { error } = updated.id
      ? await supabase.from('products').update({ ...updated, updated_at: new Date().toISOString() }).eq('id', updated.id)
      : await supabase.from('products').insert(updated)
    if (error) { alert('Save failed: ' + error.message); return false }

    // Log changed fields
    if (original) {
      const fields = Object.keys(updated) as (keyof Product)[]
      for (const f of fields) {
        const oldVal = String(original[f] ?? '')
        const newVal = String(updated[f] ?? '')
        if (oldVal !== newVal && f !== 'updated_at' && f !== 'id') {
          await logChange(updated.sku_id, updated.product_name, f, oldVal, newVal)
        }
      }
    }
    await loadData()
    return true
  }

  async function deleteProduct(id: string) {
    if (!confirm('Delete this product?')) return
    const p = products.find(x => x.id === id)
    if (p) await logChange(p.sku_id, p.product_name, 'DELETED', p.product_name, '')
    await supabase.from('products').delete().eq('id', id)
    await loadData()
  }

  // ── SUPPLIER SAVE ─────────────────────────────────────────────────────────
  async function saveSupplier(s: Supplier) {
    const { error } = s.id
      ? await supabase.from('suppliers').update({ ...s, updated_at: new Date().toISOString() }).eq('id', s.id)
      : await supabase.from('suppliers').insert(s)
    if (error) { alert('Supplier save failed: ' + error.message); return }
    const p = products.find(x => x.sku_id === s.sku_id)
    await logChange(s.sku_id, p?.product_name ?? '', 'supplier:' + (s.supplier_name ?? ''), '', JSON.stringify({ cost: s.cost, currency: s.currency, carton_qty: s.carton_qty }))
    await loadData()
  }

  async function deleteSupplier(id: string) {
    await supabase.from('suppliers').delete().eq('id', id)
    await loadData()
  }

  // ── COST SAVE (legacy costs table) ────────────────────────────────────────
  async function saveCost(cost: Cost) {
    const usd = calcUsd(cost.cost ?? 0, cost.currency ?? 'USD')
    const payload = { ...cost, usd_per_unit: usd }
    const { error } = cost.id
      ? await supabase.from('costs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', cost.id)
      : await supabase.from('costs').insert(payload)
    if (error) { alert('Save failed: ' + error.message); return }
    await loadData()
  }

  async function deleteCost(id: string) {
    if (!confirm('Remove this cost entry?')) return
    await supabase.from('costs').delete().eq('id', id)
    await loadData()
  }

  // ── DERIVED DATA ──────────────────────────────────────────────────────────
  const activeProducts   = products.filter(p => p.sku_id)
  const pipelineProducts = products.filter(p => !p.sku_id)
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort() as string[]

  const brandCounts: Record<string, number> = {}
  products.forEach(p => { if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] ?? 0) + 1 })

  const filtered = activeProducts.filter(p => {
    if (brandFilter && p.brand !== brandFilter) return false
    if (catFilter && p.category !== catFilter) return false
    if (statusFilter === "Discontinued" && !p.discontinued) return false
    if (statusFilter === "Active" && (p.discontinued || p.status !== "Active")) return false
    if (statusFilter === "Not Listed" && (p.discontinued || p.status !== "Not Listed")) return false
    if (search) {
      const hay = [p.product_name, p.sku_id, p.asin, p.upc, p.brand, p.category, p.color, p.warpfy_code].join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  })

  const skuCounts: Record<string, number> = {}
  activeProducts.forEach(p => { if (p.sku_id) skuCounts[p.sku_id] = (skuCounts[p.sku_id] ?? 0) + 1 })
  const dupeSkus = new Set(Object.keys(skuCounts).filter(k => skuCounts[k] > 1))

  function exportProductsCsv() {
    const headers = ['status','brand','category','product_name','sku_id','upc','asin','warpfy_code',
      'color','size','pack_size','material','prod_length','prod_width','prod_height','prod_dim_unit',
      'prod_weight','prod_weight_unit','pkg_length','pkg_width','pkg_height','pkg_dim_unit',
      'pkg_weight','pkg_weight_unit','units_per_carton','carton_l','carton_b','carton_h',
      'carton_unit','carton_weight','carton_weight_unit','cbm','discontinued']
    const rows = [headers, ...filtered.map(p => headers.map(h => String((p as any)[h] ?? '')))]
    dlCsv('product_master.csv', rows)
  }

  function dlCsv(name: string, rows: string[][]) {
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = name; a.click()
  }

  const showTopbar = tab === 'catalog' || tab === 'pipeline' || tab === 'costs'

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="s-logo">
          <div className="s-wordmark">Product Master</div>
          <div className="s-sub">Catalog &amp; UPC Registry</div>
          <div className="s-user">{user.email}</div>
        </div>

        <div className="s-section">Views</div>
        {(['catalog','pipeline','upc','costs'] as Tab[]).map(t => (
          <div key={t} className={`s-nav ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'catalog' ? '📦' : t === 'pipeline' ? '🔄' : t === 'upc' ? '🏷️' : '💰'}
            {' '}{t === 'catalog' ? 'Products' : t === 'pipeline' ? 'Pipeline' : t === 'upc' ? 'UPC Manager' : 'Cost Master'}
            <span className="s-badge">
              {t === 'catalog'  && activeProducts.length}
              {t === 'pipeline' && pipelineProducts.length}
              {t === 'upc'      && 'pools'}
              {t === 'costs'    && costs.length}
            </span>
          </div>
        ))}

        <div className="s-section">Brand</div>
        <div style={{ padding: '4px 6px 8px' }}>
          <div className={`s-brand ${!brandFilter ? 'active' : ''}`} onClick={() => setBrandFilter('')}>
            <span className="brand-dot" style={{ background: '#aaa' }} />
            All Brands
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{products.length}</span>
          </div>
          {BRANDS.filter(b => brandCounts[b.name]).map(b => (
            <div key={b.name} className={`s-brand ${brandFilter === b.name ? 'active' : ''}`} onClick={() => setBrandFilter(b.name)}>
              <span className="brand-dot" style={{ background: b.color }} />
              {b.name === 'The Fine Living Company' ? 'Fine Living Co.' : b.name}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{brandCounts[b.name]}</span>
            </div>
          ))}
        </div>

        <div className="s-footer">
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setTab('catalog')}>
            ＋ Add Product
          </button>
          <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 11 }} onClick={onSignOut}>
            ⏻ Sign Out
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="main-area">
        {showTopbar && (
          <div className="topbar">
            <div className="search-wrap">
              <span className="search-icon">⌕</span>
              <input type="text" placeholder="Search name, SKU, UPC, ASIN…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {(tab === 'catalog' || tab === 'pipeline') && (
              <>
                <select className="f-sel" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
                <select className="f-sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option>Active</option>
                  <option>Not Listed</option>
                  <option>Discontinued</option>
                </select>
              </>
            )}
            {tab === 'catalog' && <button className="btn-secondary" onClick={exportProductsCsv}>↓ Export</button>}
            <span className="result-ct">
              {tab === 'catalog' && `${filtered.length} products`}
              {tab === 'pipeline' && `${pipelineProducts.length} items`}
              {tab === 'costs' && `${costs.length} entries`}
            </span>
          </div>
        )}

        {dupeSkus.size > 0 && tab === 'catalog' && (
          <div className="dupe-banner">
            ⚠️ <strong>{dupeSkus.size} duplicate SKUs</strong> need review
            <span className="dupe-badge">{[...dupeSkus].join(', ')}</span>
          </div>
        )}

        <div className="content">
          {loading ? (
            <div className="loading">⟳ Loading data…</div>
          ) : (
            <>
              {tab === 'catalog' && (
                <ProductSheet
                  products={filtered}
                  allProducts={products}
                  dupeSkus={dupeSkus}
                  suppliers={suppliers}
                  changelog={changelog}
                  userEmail={user.email ?? ''}
                  brandFilter={brandFilter}
                  onSave={saveProduct}
                  onDelete={deleteProduct}
                  onSaveSupplier={saveSupplier}
                  onDeleteSupplier={deleteSupplier}
                />
              )}
              {tab === 'pipeline' && (
                <Pipeline
                  products={pipelineProducts.filter(p => {
                    if (brandFilter && p.brand !== brandFilter) return false
                    if (search) {
                      const hay = [p.product_name, p.warpfy_code, p.brand].join(' ').toLowerCase()
                      return hay.includes(search.toLowerCase())
                    }
                    return true
                  })}
                  onActivate={() => setTab('catalog')}
                  onDelete={deleteProduct}
                />
              )}
              {tab === 'upc' && <UpcManager products={activeProducts} onRefresh={loadData} />}
              {tab === 'costs' && (
                <CostMaster
                  costs={costs.filter(c => !brandFilter || c.brand === brandFilter)}
                  products={activeProducts}
                  onSave={saveCost}
                  onDelete={deleteCost}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
