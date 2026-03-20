'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Product, Cost } from '@/lib/types'
import { BRANDS, brandColor, FX } from '@/lib/types'
import ProductSheet from './ProductSheet'
import CostMaster from './CostMaster'
import UpcManager from './UpcManager'
import Pipeline from './Pipeline'

type Tab = 'catalog' | 'pipeline' | 'upc' | 'costs'

export default function AppShell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const supabase = createClient()

  const [tab, setTab] = useState<Tab>('catalog')
  const [products, setProducts] = useState<Product[]>([])
  const [costs, setCosts] = useState<Cost[]>([])
  const [brandFilter, setBrandFilter] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)

  // Load all data from Supabase
  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prods }, { data: costsData }] = await Promise.all([
      supabase.from('products').select('*').order('brand').order('category').order('product_name'),
      supabase.from('costs').select('*').order('brand').order('sku_id'),
    ])
    setProducts(prods ?? [])
    setCosts(costsData ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Derived counts
  const activeProducts = products.filter(p => p.sku_id)
  const pipelineProducts = products.filter(p => !p.sku_id)
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort()

  // Brand counts
  const brandCounts: Record<string, number> = {}
  products.forEach(p => { if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] ?? 0) + 1 })

  // Filtered products for catalog
  const filtered = activeProducts.filter(p => {
    if (brandFilter && p.brand !== brandFilter) return false
    if (catFilter && p.category !== catFilter) return false
    if (statusFilter && p.status !== statusFilter) return false
    if (search) {
      const hay = [p.product_name, p.sku_id, p.asin, p.upc, p.brand, p.category, p.color, p.warpfy_code].join(' ').toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  })

  // Dupe detection
  const skuCounts: Record<string, number> = {}
  activeProducts.forEach(p => { if (p.sku_id) skuCounts[p.sku_id] = (skuCounts[p.sku_id] ?? 0) + 1 })
  const dupeSkus = new Set(Object.keys(skuCounts).filter(k => skuCounts[k] > 1))

  // Save product to Supabase
  async function saveProduct(product: Product) {
    const { error } = product.id
      ? await supabase.from('products').update({ ...product, updated_at: new Date().toISOString() }).eq('id', product.id)
      : await supabase.from('products').insert(product)
    if (error) { alert('Save failed: ' + error.message); return false }
    await loadData()
    return true
  }

  async function deleteProduct(id: string) {
    if (!confirm('Delete this product?')) return
    await supabase.from('products').delete().eq('id', id)
    await loadData()
  }

  async function saveCost(cost: Cost) {
    const usd = ((parseFloat(String(cost.cost)) || 0) * (FX[cost.currency ?? 'USD'] ?? 1))
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

  function exportProductsCsv() {
    const headers = ['status','brand','category','product_name','sku_id','upc','asin','warpfy_code',
      'color','size','pack_size','material','prod_length','prod_width','prod_height','prod_dim_unit',
      'prod_weight','prod_weight_unit','pkg_length','pkg_width','pkg_height','pkg_dim_unit',
      'pkg_weight','pkg_weight_unit','units_per_carton','carton_l','carton_b','carton_h',
      'carton_unit','carton_weight','carton_weight_unit','cbm','discontinued']
    const rows = [headers, ...filtered.map(p => headers.map(h => String((p as any)[h] ?? '')))]
    downloadCsv('product_master.csv', rows)
  }

  function exportCostsCsv() {
    const headers = ['sku_id','product_name','brand','supplier','cost','currency','term','usd_per_unit','notes']
    const rows = [headers, ...costs.map(c => headers.map(h => String((c as any)[h] ?? '')))]
    downloadCsv('cost_master.csv', rows)
  }

  function downloadCsv(name: string, rows: string[][]) {
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = name
    a.click()
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
            {t === 'catalog'  && '📦'} {t === 'pipeline' && '🔄'} {t === 'upc' && '🏷️'} {t === 'costs' && '💰'}
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
        {/* Topbar */}
        {showTopbar && (
          <div className="topbar">
            <div className="search-wrap">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                placeholder="Search name, SKU, UPC, ASIN…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {(tab === 'catalog' || tab === 'pipeline') && (
              <>
                <select className="f-sel" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
                <select className="f-sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="Active">Active</option>
                  <option value="Not Listed">Not Listed</option>
                </select>
              </>
            )}
            {tab === 'catalog' && (
              <button className="btn-secondary" onClick={exportProductsCsv}>↓ Export</button>
            )}
            {tab === 'costs' && (
              <button className="btn-secondary" onClick={exportCostsCsv}>↓ Export CSV</button>
            )}
            <span className="result-ct">
              {tab === 'catalog' && `${filtered.length} products`}
              {tab === 'pipeline' && `${pipelineProducts.length} items`}
              {tab === 'costs' && `${costs.length} entries`}
            </span>
          </div>
        )}

        {/* Dupe banner */}
        {dupeSkus.size > 0 && tab === 'catalog' && (
          <div className="dupe-banner">
            ⚠️ <strong>{dupeSkus.size} duplicate SKUs</strong> need review
            <span className="dupe-badge">{[...dupeSkus].join(', ')}</span>
          </div>
        )}

        {/* Content */}
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
                  costs={costs}
                  onSave={saveProduct}
                  onDelete={deleteProduct}
                  brandFilter={brandFilter}
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
                  onActivate={(p) => { setTab('catalog') }}
                  onDelete={deleteProduct}
                />
              )}
              {tab === 'upc' && (
                <UpcManager products={activeProducts} onRefresh={loadData} />
              )}
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
