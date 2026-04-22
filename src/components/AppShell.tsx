'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Product, Supplier, ChangeLog, Cost } from '@/lib/types'
import { BRANDS, calcUsd } from '@/lib/types'
import ProductSheet from './ProductSheet'
import CostMaster from './CostMaster'
import UpcManager from './UpcManager'
import Pipeline from './Pipeline'
import InventoryDashboard from './inventory/InventoryDashboard'
import PPCDashboard from './ppc/PPCDashboard'

type Tab =
  | 'catalog'
  | 'pipeline'
  | 'upc'
  | 'costs'
  | 'inventory'
  | 'ppc'
  | 'ai'
  | 'finance'
  | 'suppliers'
  | 'orders'

type ModuleDef = {
  id: Tab
  label: string
  group: 'catalog' | 'intelligence' | 'operations'
  status: 'live' | 'beta' | 'soon'
  icon: string
}

const MODULES: ModuleDef[] = [
  { id: 'catalog',   label: 'Products',          group: 'catalog',      status: 'live', icon: 'P' },
  { id: 'pipeline',  label: 'Pipeline',          group: 'catalog',      status: 'live', icon: 'L' },
  { id: 'upc',       label: 'UPC Registry',      group: 'catalog',      status: 'live', icon: 'U' },
  { id: 'costs',     label: 'Cost Master',       group: 'catalog',      status: 'live', icon: '$' },
  { id: 'inventory', label: 'Inventory Planner', group: 'intelligence', status: 'beta', icon: 'I' },
  { id: 'ppc',       label: 'PPC Manager',       group: 'intelligence', status: 'live', icon: 'A' },
  { id: 'ai',        label: 'AI Agent',          group: 'intelligence', status: 'soon', icon: '*' },
  { id: 'suppliers', label: 'Suppliers',         group: 'operations',   status: 'soon', icon: 'S' },
  { id: 'orders',    label: 'Orders',            group: 'operations',   status: 'soon', icon: 'O' },
  { id: 'finance',   label: 'Finance',           group: 'operations',   status: 'soon', icon: 'F' },
]

export default function AppShell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const supabase = createClient()

  const [tab, setTab]                   = useState<Tab>('catalog')
  const [products, setProducts]         = useState<Product[]>([])
  const [suppliers, setSuppliers]       = useState<Supplier[]>([])
  const [changelog, setChangelog]       = useState<ChangeLog[]>([])
  const [costs, setCosts]               = useState<Cost[]>([])
  const [brandFilter, setBrandFilter]   = useState('')
  const [search, setSearch]             = useState('')
  const [catFilter, setCatFilter]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading]           = useState(true)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function saveProduct(updated: Product, original?: Product) {
    const { error } = updated.id
      ? await supabase.from('products').update({ ...updated, updated_at: new Date().toISOString() }).eq('id', updated.id)
      : await supabase.from('products').insert(updated)
    if (error) { alert('Save failed: ' + error.message); return false }

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

  // ── DERIVED ───────────────────────────────────────────────────────────────
  const activeProducts   = products.filter(p => p.sku_id)
  const pipelineProducts = products.filter(p => !p.sku_id)
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort() as string[]

  const brandCounts: Record<string, number> = {}
  products.forEach(p => { if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] ?? 0) + 1 })

  const filtered = activeProducts.filter(p => {
    if (brandFilter && p.brand !== brandFilter) return false
    if (catFilter && p.category !== catFilter) return false
    if (statusFilter === 'Discontinued' && !p.discontinued) return false
    if (statusFilter === 'Active' && (p.discontinued || p.status !== 'Active')) return false
    if (statusFilter === 'Not Listed' && (p.discontinued || p.status !== 'Not Listed')) return false
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
    const rows = [headers, ...filtered.map(p => headers.map(h => String((p as Record<string, unknown>)[h] ?? '')))]
    dlCsv('product_master.csv', rows)
  }

  function dlCsv(name: string, rows: string[][]) {
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = name; a.click()
  }

  const showToolbar = tab === 'catalog' || tab === 'pipeline' || tab === 'costs'
  const currentModule = MODULES.find(m => m.id === tab)
  const isSoonModule  = currentModule?.status === 'soon'

  const moduleGroups: Array<{ title: string; key: 'catalog' | 'intelligence' | 'operations' }> = [
    { title: 'Catalog',       key: 'catalog' },
    { title: 'Intelligence',  key: 'intelligence' },
    { title: 'Operations',    key: 'operations' },
  ]

  return (
    <div className="wfy-app">
      {/* ───────────────────────── SIDEBAR ───────────────────────── */}
      <aside className="wfy-sidebar">
        <div className="wfy-brand">
          <div className="wfy-brand-mark" aria-hidden>W</div>
          <div className="wfy-brand-text">
            <div className="wfy-brand-name">Warpfy</div>
            <div className="wfy-brand-tag">E-commerce OS</div>
          </div>
        </div>

        <nav className="wfy-nav">
          {moduleGroups.map(group => (
            <div className="wfy-nav-group" key={group.key}>
              <div className="wfy-nav-heading">{group.title}</div>
              {MODULES.filter(m => m.group === group.key).map(m => {
                const isActive = tab === m.id
                const isSoon   = m.status === 'soon'
                return (
                  <button
                    key={m.id}
                    className={`wfy-nav-item ${isActive ? 'is-active' : ''} ${isSoon ? 'is-soon' : ''}`}
                    onClick={() => setTab(m.id)}
                    type="button"
                  >
                    <span className="wfy-nav-icon">{m.icon}</span>
                    <span className="wfy-nav-label">{m.label}</span>
                    {m.status === 'beta' && <span className="wfy-pill wfy-pill-accent">Beta</span>}
                    {m.status === 'soon' && <span className="wfy-pill wfy-pill-muted">Soon</span>}
                    {isActive && !isSoon && m.id === 'catalog'   && <span className="wfy-nav-count">{activeProducts.length}</span>}
                    {isActive && !isSoon && m.id === 'pipeline'  && <span className="wfy-nav-count">{pipelineProducts.length}</span>}
                    {isActive && !isSoon && m.id === 'costs'     && <span className="wfy-nav-count">{costs.length}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="wfy-sidebar-section">
          <div className="wfy-nav-heading">Brand</div>
          <button
            className={`wfy-brand-item ${!brandFilter ? 'is-active' : ''}`}
            onClick={() => setBrandFilter('')}
            type="button"
          >
            <span className="wfy-brand-dot" style={{ background: '#5B5F68' }} />
            <span className="wfy-brand-label">All Brands</span>
            <span className="wfy-brand-count mono">{products.length}</span>
          </button>
          {BRANDS.filter(b => brandCounts[b.name]).map(b => (
            <button
              key={b.name}
              className={`wfy-brand-item ${brandFilter === b.name ? 'is-active' : ''}`}
              onClick={() => setBrandFilter(b.name)}
              type="button"
            >
              <span className="wfy-brand-dot" style={{ background: b.color }} />
              <span className="wfy-brand-label">{b.name === 'The Fine Living Company' ? 'Fine Living Co.' : b.name}</span>
              <span className="wfy-brand-count mono">{brandCounts[b.name]}</span>
            </button>
          ))}
        </div>

        <div className="wfy-sidebar-footer">
          <div className="wfy-user">
            <div className="wfy-user-avatar">{(user.email ?? '?').charAt(0).toUpperCase()}</div>
            <div className="wfy-user-meta">
              <div className="wfy-user-email">{user.email}</div>
              <div className="wfy-user-org">Warpfy · Workspace</div>
            </div>
          </div>
          <button className="wfy-signout" onClick={onSignOut} type="button" aria-label="Sign out">⏻</button>
        </div>
      </aside>

      {/* ───────────────────────── MAIN ───────────────────────── */}
      <main className="wfy-main">
        <header className="wfy-topbar">
          <div className="wfy-topbar-title">
            <span className="wfy-topbar-module">{currentModule?.label ?? 'Warpfy'}</span>
            {currentModule?.status === 'beta' && <span className="wfy-pill wfy-pill-accent">Beta</span>}
          </div>

          <button className="wfy-cmdk" type="button" disabled title="Coming in AI Agent release">
            <span className="wfy-cmdk-icon">⌕</span>
            <span className="wfy-cmdk-label">Ask Warpfy…</span>
            <span className="wfy-cmdk-kbd mono">⌘K</span>
          </button>

          <div className="wfy-topbar-right">
            <span className="wfy-status">
              <span className="wfy-status-dot" />
              <span className="wfy-status-label">Connected</span>
            </span>
          </div>
        </header>

        {showToolbar && (
          <div className="wfy-toolbar">
            <div className="wfy-search">
              <span className="wfy-search-icon">⌕</span>
              <input
                type="text"
                placeholder="Search name, SKU, UPC, ASIN…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {(tab === 'catalog' || tab === 'pipeline') && (
              <>
                <select className="wfy-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
                <select className="wfy-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option>Active</option>
                  <option>Not Listed</option>
                  <option>Discontinued</option>
                </select>
              </>
            )}
            {tab === 'catalog' && <button className="wfy-btn wfy-btn-ghost" onClick={exportProductsCsv}>↓ Export</button>}
            <span className="wfy-result-count mono">
              {tab === 'catalog'  && `${filtered.length} products`}
              {tab === 'pipeline' && `${pipelineProducts.length} items`}
              {tab === 'costs'    && `${costs.length} entries`}
            </span>
          </div>
        )}

        {dupeSkus.size > 0 && tab === 'catalog' && (
          <div className="wfy-banner wfy-banner-warning">
            <span className="wfy-banner-icon">⚠</span>
            <strong>{dupeSkus.size} duplicate SKUs</strong> need review
            <span className="wfy-banner-chip mono">{[...dupeSkus].join(', ')}</span>
          </div>
        )}

        <div className="wfy-content">
          {loading ? (
            <div className="wfy-loading">
              <div className="wfy-spinner" />
              <div>Loading workspace…</div>
            </div>
          ) : isSoonModule ? (
            <ComingSoonPanel moduleLabel={currentModule?.label ?? 'Module'} onBack={() => setTab('catalog')} />
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
              {tab === 'inventory' && <InventoryDashboard userEmail={user.email ?? ''} />}
              {tab === 'ppc' && <PPCDashboard userEmail={user.email ?? ''} />}
            </>
          )}
        </div>
      </main>

      {/* Inline styles for the new shell — scoped via wfy-* prefix */}
      <style jsx global>{`
        .wfy-app {
          display: grid;
          grid-template-columns: var(--sidebar-width) 1fr;
          height: 100vh;
          background: var(--bg);
          color: var(--text);
          font-family: var(--font-sans);
        }

        /* ── SIDEBAR ────────────────────────────────────────────────────────── */
        .wfy-sidebar {
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .wfy-brand {
          display: flex;
          align-items: center;
          gap: var(--space-5);
          padding: var(--space-7) var(--space-6) var(--space-6);
          border-bottom: 1px solid var(--border-subtle);
        }
        .wfy-brand-mark {
          width: 28px; height: 28px;
          border-radius: var(--radius-md);
          background: var(--accent);
          color: #fff;
          display: grid; place-items: center;
          font-weight: var(--weight-bold);
          font-size: var(--text-md);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 24px var(--accent-glow);
        }
        .wfy-brand-name {
          font-weight: var(--weight-semibold);
          font-size: var(--text-md);
          letter-spacing: -0.01em;
          color: var(--text);
          line-height: 1.1;
        }
        .wfy-brand-tag {
          font-size: var(--text-xs);
          color: var(--text-3);
          margin-top: 2px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .wfy-nav { padding: var(--space-5) var(--space-3); }
        .wfy-nav-group { margin-bottom: var(--space-5); }
        .wfy-nav-heading {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-3);
          padding: 0 var(--space-4) var(--space-3);
          font-weight: var(--weight-medium);
        }
        .wfy-nav-item {
          display: flex;
          align-items: center;
          gap: var(--space-5);
          width: 100%;
          padding: var(--space-4) var(--space-5);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-2);
          font-size: var(--text-base);
          font-family: inherit;
          cursor: pointer;
          text-align: left;
          transition: background var(--duration-fast) var(--ease), color var(--duration-fast) var(--ease);
        }
        .wfy-nav-item:hover { background: var(--surface-2); color: var(--text); }
        .wfy-nav-item.is-active {
          background: var(--surface-3);
          color: var(--text);
          box-shadow: inset 2px 0 0 var(--accent);
        }
        .wfy-nav-item.is-soon { opacity: 0.6; }
        .wfy-nav-item.is-soon:hover { opacity: 1; }

        .wfy-nav-icon {
          width: 20px; height: 20px;
          display: grid; place-items: center;
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: var(--weight-semibold);
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-2);
          flex-shrink: 0;
        }
        .wfy-nav-item.is-active .wfy-nav-icon {
          background: var(--accent-tint);
          border-color: var(--accent-tint-2);
          color: var(--accent);
        }
        .wfy-nav-label { flex: 1; }
        .wfy-nav-count {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
          color: var(--text-3);
          font-variant-numeric: tabular-nums;
        }

        .wfy-pill {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          border-radius: var(--radius-xs);
          font-size: 10px;
          font-weight: var(--weight-semibold);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .wfy-pill-accent { background: var(--accent-tint); color: var(--accent); }
        .wfy-pill-muted  { background: var(--surface-3); color: var(--text-3); }

        .wfy-sidebar-section {
          padding: 0 var(--space-3) var(--space-5);
          border-top: 1px solid var(--border-subtle);
          padding-top: var(--space-5);
          margin-top: auto;
        }
        .wfy-brand-item {
          display: flex;
          align-items: center;
          gap: var(--space-5);
          width: 100%;
          padding: var(--space-3) var(--space-5);
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-2);
          font-size: var(--text-sm);
          font-family: inherit;
          cursor: pointer;
          text-align: left;
          transition: background var(--duration-fast) var(--ease);
        }
        .wfy-brand-item:hover { background: var(--surface-2); color: var(--text); }
        .wfy-brand-item.is-active { background: var(--surface-2); color: var(--text); }
        .wfy-brand-dot {
          width: 8px; height: 8px;
          border-radius: var(--radius-full);
          flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.04);
        }
        .wfy-brand-label { flex: 1; }
        .wfy-brand-count { font-size: var(--text-xs); color: var(--text-3); }

        .wfy-sidebar-footer {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-5) var(--space-6);
          border-top: 1px solid var(--border-subtle);
        }
        .wfy-user {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          flex: 1;
          min-width: 0;
        }
        .wfy-user-avatar {
          width: 28px; height: 28px;
          border-radius: var(--radius-full);
          background: var(--surface-3);
          color: var(--text);
          display: grid; place-items: center;
          font-weight: var(--weight-semibold);
          font-size: var(--text-xs);
          flex-shrink: 0;
        }
        .wfy-user-meta { min-width: 0; overflow: hidden; }
        .wfy-user-email {
          font-size: var(--text-xs);
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wfy-user-org { font-size: 10px; color: var(--text-3); margin-top: 1px; }
        .wfy-signout {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-3);
          width: 28px; height: 28px;
          cursor: pointer;
          font-size: var(--text-sm);
          transition: all var(--duration-fast) var(--ease);
        }
        .wfy-signout:hover { color: var(--text); border-color: var(--border-strong); }

        /* ── MAIN AREA ──────────────────────────────────────────────────────── */
        .wfy-main {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }

        .wfy-topbar {
          height: var(--topbar-height);
          display: flex;
          align-items: center;
          gap: var(--space-6);
          padding: 0 var(--space-7);
          border-bottom: 1px solid var(--border);
          background: var(--bg);
          flex-shrink: 0;
        }
        .wfy-topbar-title {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }
        .wfy-topbar-module {
          font-size: var(--text-md);
          font-weight: var(--weight-semibold);
          color: var(--text);
          letter-spacing: -0.01em;
        }

        .wfy-cmdk {
          flex: 1;
          max-width: 480px;
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: 0 var(--space-5);
          height: 30px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-3);
          font-family: inherit;
          font-size: var(--text-sm);
          cursor: not-allowed;
          transition: all var(--duration-fast) var(--ease);
        }
        .wfy-cmdk:not(:disabled):hover { border-color: var(--border-strong); color: var(--text-2); }
        .wfy-cmdk-icon { font-size: var(--text-md); }
        .wfy-cmdk-label { flex: 1; text-align: left; }
        .wfy-cmdk-kbd {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: var(--radius-xs);
          color: var(--text-3);
        }

        .wfy-topbar-right {
          display: flex;
          align-items: center;
          gap: var(--space-5);
        }
        .wfy-status {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          font-size: var(--text-xs);
          color: var(--text-3);
        }
        .wfy-status-dot {
          width: 6px; height: 6px;
          border-radius: var(--radius-full);
          background: var(--success);
          box-shadow: 0 0 8px var(--success);
        }

        /* ── TOOLBAR ────────────────────────────────────────────────────────── */
        .wfy-toolbar {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-5) var(--space-7);
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg);
          flex-shrink: 0;
        }
        .wfy-search {
          flex: 1;
          max-width: 360px;
          position: relative;
          display: flex;
          align-items: center;
        }
        .wfy-search-icon {
          position: absolute;
          left: var(--space-5);
          color: var(--text-3);
          font-size: var(--text-md);
          pointer-events: none;
        }
        .wfy-search input {
          width: 100%;
          height: 30px;
          padding: 0 var(--space-5) 0 var(--space-9);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text);
          font-family: inherit;
          font-size: var(--text-sm);
          transition: all var(--duration-fast) var(--ease);
        }
        .wfy-search input:hover { border-color: var(--border-strong); }
        .wfy-search input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: var(--shadow-accent);
        }
        .wfy-search input::placeholder { color: var(--text-3); }

        .wfy-select {
          height: 30px;
          padding: 0 var(--space-5);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text);
          font-family: inherit;
          font-size: var(--text-sm);
          cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease);
        }
        .wfy-select:hover { border-color: var(--border-strong); }
        .wfy-select:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-accent); }

        .wfy-btn {
          height: 30px;
          padding: 0 var(--space-5);
          border-radius: var(--radius-md);
          font-family: inherit;
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          cursor: pointer;
          transition: all var(--duration-fast) var(--ease);
          display: inline-flex;
          align-items: center;
          gap: var(--space-3);
          border: 1px solid transparent;
        }
        .wfy-btn-ghost {
          background: transparent;
          border-color: var(--border);
          color: var(--text-2);
        }
        .wfy-btn-ghost:hover { background: var(--surface-2); color: var(--text); border-color: var(--border-strong); }
        .wfy-btn-primary {
          background: var(--accent);
          color: #fff;
        }
        .wfy-btn-primary:hover { background: var(--accent-hover); }

        .wfy-result-count {
          margin-left: auto;
          font-size: var(--text-xs);
          color: var(--text-3);
        }

        /* ── BANNER ─────────────────────────────────────────────────────────── */
        .wfy-banner {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-5) var(--space-7);
          font-size: var(--text-sm);
          border-bottom: 1px solid var(--border-subtle);
        }
        .wfy-banner-warning {
          background: var(--warning-tint);
          color: var(--warning);
        }
        .wfy-banner-icon { font-size: var(--text-md); }
        .wfy-banner-chip {
          margin-left: auto;
          padding: 2px 6px;
          background: rgba(0,0,0,0.25);
          border-radius: var(--radius-xs);
          font-size: var(--text-xs);
          color: var(--text);
        }

        /* ── CONTENT ────────────────────────────────────────────────────────── */
        .wfy-content {
          flex: 1;
          overflow: auto;
          background: var(--bg);
        }

        .wfy-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-5);
          padding: var(--space-11);
          color: var(--text-3);
          font-size: var(--text-sm);
          height: 100%;
        }
        .wfy-spinner {
          width: 24px; height: 24px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: var(--radius-full);
          animation: wfy-spin 0.8s linear infinite;
        }
        @keyframes wfy-spin { to { transform: rotate(360deg); } }

        /* ── COMING SOON ────────────────────────────────────────────────────── */
        .wfy-soon {
          max-width: 640px;
          margin: var(--space-12) auto;
          padding: var(--space-11);
          text-align: center;
        }
        .wfy-soon-badge {
          display: inline-flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-5);
          background: var(--accent-tint);
          color: var(--accent);
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: var(--weight-semibold);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: var(--space-7);
        }
        .wfy-soon-title {
          font-size: var(--text-2xl);
          font-weight: var(--weight-semibold);
          color: var(--text);
          margin-bottom: var(--space-5);
          letter-spacing: -0.02em;
        }
        .wfy-soon-body {
          font-size: var(--text-md);
          color: var(--text-2);
          line-height: var(--leading-relaxed);
          margin-bottom: var(--space-9);
        }
      `}</style>
    </div>
  )
}

function ComingSoonPanel({ moduleLabel, onBack }: { moduleLabel: string; onBack: () => void }) {
  const copy: Record<string, string> = {
    'AI Agent':       'A unified intelligence layer that reads across your catalog, inventory, and advertising data. Ask questions, surface insights, and draft decisions — grounded in your real numbers.',
    'Suppliers':      'Supplier relationship management with cost history, lead times, carton data, and reorder workflows. Your Cost Master extended into full supplier operations.',
    'Orders':         'Purchase order generation from inventory signals, approvals, and tracking through manufacturing and shipping.',
    'Finance':        'Unit economics, landed cost tracking, and P&L by SKU, brand, and channel. Connects your Cost Master, advertising spend, and sales data.',
  }
  return (
    <div className="wfy-soon">
      <div className="wfy-soon-badge">◆ Coming in next release</div>
      <div className="wfy-soon-title">{moduleLabel}</div>
      <div className="wfy-soon-body">{copy[moduleLabel] ?? 'This module is part of the Warpfy roadmap.'}</div>
      <button className="wfy-btn wfy-btn-primary" onClick={onBack} type="button">← Back to Products</button>
    </div>
  )
}
