'use client'
// app/ppc/decisions/page.tsx
// Decisions log — filterable by brand, ASIN, status, match type.
// Allows bulk status updates.

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:       { label: 'Pending review',         color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  actioned:      { label: 'Actioned in Amazon',      color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  not_actioning: { label: 'Not actioning',           color: 'text-gray-600',   bg: 'bg-gray-50 border-gray-200' },
  reversed:      { label: 'Reversed',               color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  negative_phrase: 'Neg · Phrase',
  negative_exact:  'Neg · Exact',
  harvest_exact:   'Harvest · Exact',
  harvest_phrase:  'Harvest · Phrase',
  harvest_broad:   'Harvest · Broad',
}

const MATCH_TYPE_COLORS: Record<string, string> = {
  negative_phrase: 'bg-red-50 text-red-700',
  negative_exact:  'bg-red-100 text-red-800',
  harvest_exact:   'bg-green-50 text-green-700',
  harvest_phrase:  'bg-green-100 text-green-800',
  harvest_broad:   'bg-blue-50 text-blue-700',
}

function PPCDecisionsPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  const [orgId, setOrgId]           = useState<string | null>(null)
  const [brands, setBrands]         = useState<{ id: string; name: string }[]>([])
  const [decisions, setDecisions]   = useState<any[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [updating, setUpdating]     = useState(false)
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkNotes, setBulkNotes]   = useState('')
  const [updateMsg, setUpdateMsg]   = useState('')

  // Filters
  const [brandFilter, setBrandFilter]   = useState(searchParams.get('brand') ?? '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [typeFilter, setTypeFilter]     = useState(searchParams.get('match_type') ?? '')
  const [runFilter, setRunFilter]       = useState(searchParams.get('run_id') ?? '')
  const [termSearch, setTermSearch]     = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('orgs').select('id').limit(1).single()
        .then(({ data }) => {
          if (data?.id) {
            setOrgId(data.id)
            supabase.from('products').select('brand').then(({ data: b }) => {
              if (b) setBrands([...new Set(b.map((r: any) => r.brand).filter(Boolean))].sort())
            })
          }
        })
    })
  }, [])

  useEffect(() => {
    if (!orgId) return
    fetchDecisions()
  }, [orgId, brandFilter, statusFilter, typeFilter, runFilter])

  const fetchDecisions = async () => {
    setLoading(true)
    const params = new URLSearchParams({ org_id: orgId!, limit: '200' })
    if (brandFilter)  params.set('brand', brandFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (typeFilter)   params.set('match_type', typeFilter)
    if (runFilter)    params.set('analysis_run_id', runFilter)

    const res = await fetch(`/api/ppc/decisions?${params}`)
    const json = await res.json()
    if (res.ok) {
      setDecisions(json.decisions ?? [])
      setTotal(json.total ?? 0)
    }
    setLoading(false)
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const filtered = filteredDecisions.map(d => d.id)
    setSelected(new Set(filtered))
  }

  const handleBulkUpdate = async () => {
    if (!bulkStatus || !selected.size) return
    setUpdating(true)
    setUpdateMsg('')
    try {
      const res = await fetch('/api/ppc/decisions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], status: bulkStatus, notes: bulkNotes || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setUpdateMsg(`✓ Updated ${json.updated} decision${json.updated > 1 ? 's' : ''}`)
      setSelected(new Set())
      setBulkStatus('')
      setBulkNotes('')
      fetchDecisions()
    } catch (err: any) {
      setUpdateMsg(`Error: ${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  const filteredDecisions = decisions.filter(d =>
    !termSearch || d.term.toLowerCase().includes(termSearch.toLowerCase())
  )

  // Group by analysis run for display
  const groupedByRun: Record<string, { run_name: string; run_at: string; items: any[] }> = {}
  for (const d of filteredDecisions) {
    const runId = d.analysis_run_id ?? 'unlinked'
    const runName = d.analysis_run?.run_name ?? 'Unlinked decisions'
    const runAt   = d.analysis_run?.run_at ?? d.decided_at
    if (!groupedByRun[runId]) groupedByRun[runId] = { run_name: runName, run_at: runAt, items: [] }
    groupedByRun[runId].items.push(d)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">PPC decisions log</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total decisions across all runs</p>
        </div>
        <button
          onClick={() => router.push('/ppc/upload')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + New analysis
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 grid grid-cols-5 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Brand</label>
          <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
            <option value="">All brands</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Status</label>
          <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Type</label>
          <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(MATCH_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Search term</label>
          <input type="text" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder="Filter by keyword…" value={termSearch} onChange={e => setTermSearch(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button onClick={() => { setBrandFilter(''); setStatusFilter(''); setTypeFilter(''); setTermSearch(''); setRunFilter('') }}
            className="w-full text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded px-2 py-1.5">
            Clear filters
          </button>
        </div>
      </div>

      {/* Status summary pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
          const count = decisions.filter(d => d.status === status).length
          if (!count) return null
          return (
            <button key={status}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              className={`text-xs px-3 py-1 rounded-full border cursor-pointer ${cfg.bg} ${cfg.color} ${statusFilter === status ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}>
              {cfg.label}: {count}
            </button>
          )
        })}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
          <select className="border border-blue-300 rounded px-2 py-1 text-sm bg-white"
            value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
            <option value="">Change status to…</option>
            {Object.entries(STATUS_CONFIG).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
          </select>
          <input type="text" className="border border-blue-300 rounded px-2 py-1 text-sm bg-white flex-1 min-w-32"
            placeholder="Notes (optional)" value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} />
          <button onClick={handleBulkUpdate} disabled={!bulkStatus || updating}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {updating ? 'Updating…' : 'Apply'}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-blue-600 hover:text-blue-800">Clear</button>
          {updateMsg && <span className="text-sm text-green-700">{updateMsg}</span>}
        </div>
      )}

      {/* Select all */}
      {filteredDecisions.length > 0 && !selected.size && (
        <div className="flex items-center gap-3 mb-2">
          <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800">
            Select all {filteredDecisions.length} visible
          </button>
        </div>
      )}

      {/* Decisions grouped by run */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : filteredDecisions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No decisions found.</p>
          <button onClick={() => router.push('/ppc/upload')} className="mt-3 text-sm text-blue-600">
            Run an analysis to get started →
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByRun).map(([runId, group]) => (
            <div key={runId}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium text-gray-700">{group.run_name}</h3>
                <span className="text-xs text-gray-400">
                  {new Date(group.run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-xs text-gray-400">· {group.items.length} decisions</span>
              </div>
              <div className="space-y-1.5">
                {group.items.map(d => {
                  const sc = STATUS_CONFIG[d.status]
                  return (
                    <div key={d.id}
                      className={`border rounded-lg px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        selected.has(d.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)}
                        className="rounded cursor-pointer flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium text-gray-900">{d.term}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${MATCH_TYPE_COLORS[d.match_type] ?? 'bg-gray-100 text-gray-600'}`}>
                            {MATCH_TYPE_LABELS[d.match_type] ?? d.match_type}
                          </span>
                          {d.is_generic_flag && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">⚠️ Generic</span>
                          )}
                          <span className="text-xs text-gray-400">{d.campaign_names?.join(', ')}</span>
                        </div>
                        {d.notes && <p className="text-xs text-gray-500 mt-0.5 italic">"{d.notes}"</p>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {d.roas_at_decision > 0 && (
                          <span className="text-xs text-gray-400">ROAS {d.roas_at_decision?.toFixed(2)}x</span>
                        )}
                        {d.wasted_at_decision > 0 && (
                          <span className="text-xs text-red-500">${d.wasted_at_decision?.toFixed(2)} wasted</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>
                          {sc.label}
                        </span>
                        {d.decided_by_user?.email && (
                          <span className="text-xs text-gray-400 hidden lg:block">
                            {d.decided_by_user.email.split('@')[0]}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(d.decided_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PPCDecisionsPageWrapper() {
  return <Suspense fallback={<div className="loading">⟳ Loading…</div>}><PPCDecisionsPage /></Suspense>
}
