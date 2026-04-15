'use client'
// app/ppc/analysis/page.tsx
// Shows analysis results. Allows bulk-selecting decisions to log.

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

type Priority = 'HIGH' | 'MEDIUM' | 'WATCH'
type Tab = 'negatives' | 'harvest' | 'ngrams'

interface Decision {
  term: string
  match_type: string
  priority: string
  campaign_names: string[]
  roas_at_decision: number
  wasted_at_decision: number
  purchases_at_decision: number
  status: string
  notes: string
  is_generic_flag: boolean
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGH:   'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-orange-50 text-orange-700 border-orange-200',
  WATCH:  'bg-yellow-50 text-yellow-700 border-yellow-200',
}

const STATUS_OPTIONS = [
  { value: 'pending',        label: 'Pending review' },
  { value: 'actioned',       label: 'Actioned in Amazon' },
  { value: 'not_actioning',  label: 'Not actioning' },
]

function PPCAnalysisPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = createClient()

  const uploadIds    = searchParams.get('upload_ids')?.split(',') ?? []
  const dateRangeDays = parseInt(searchParams.get('date_range_days') ?? '65')
  const brand      = searchParams.get('brand')

  const [loading, setLoading]         = useState(true)
  const [results, setResults]         = useState<any>(null)
  const [runId, setRunId]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState<Tab>('negatives')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [decisionMap, setDecisionMap] = useState<Map<string, { status: string; campaigns: string[]; notes: string }>>(new Map())
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [saveError, setSaveError]     = useState<string | null>(null)

  // Run analysis on mount
  useEffect(() => {
    if (!uploadIds.length) return
    const runAnalysis = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const { data: orgMember } = await supabase.from('orgs').select('id').limit(1).single()

        const res = await fetch('/api/ppc/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            upload_ids: uploadIds,
            date_range_days: dateRangeDays,
            org_id: orgMember?.id,
            brand: brand,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setResults(json.results)
        setRunId(json.analysis_run_id)
      } catch (err: any) {
        setSaveError(err.message)
      } finally {
        setLoading(false)
      }
    }
    runAnalysis()
  }, [])

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const selectAll = (keys: string[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      keys.forEach(k => next.add(k))
      return next
    })
  }

  const updateDecision = (key: string, field: string, value: any) => {
    setDecisionMap(prev => {
      const next = new Map(prev)
      const existing = next.get(key) ?? { status: 'pending', campaigns: [], notes: '' }
      next.set(key, { ...existing, [field]: value })
      return next
    })
  }

  const buildDecisions = (): Decision[] => {
    if (!results || !selected.size) return []
    const decisions: Decision[] = []

    // Phrase negatives
    for (const row of [...(results.phrase_high ?? []), ...(results.phrase_medium ?? [])]) {
      const key = `neg_phrase_${row.ngram}`
      if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status: 'pending', campaigns: row.recommended_scope?.split(', ') ?? [], notes: '' }
      decisions.push({
        term: row.ngram, match_type: 'negative_phrase', priority: row.priority,
        campaign_names: d.campaigns,
        roas_at_decision: row.roas, wasted_at_decision: row.wasted_spend, purchases_at_decision: row.purchases,
        status: d.status, notes: d.notes, is_generic_flag: false,
      })
    }

    // Exact negatives
    for (const row of (results.exact_negatives ?? [])) {
      const key = `neg_exact_${row.search_term}`
      if (!selected.has(key)) continue
      const d = decisionMap.get(key) ?? { status: 'pending', campaigns: row.campaigns?.split(', ') ?? [], notes: '' }
      decisions.push({
        term: row.search_term, match_type: 'negative_exact', priority: 'HIGH',
        campaign_names: d.campaigns,
        roas_at_decision: 0, wasted_at_decision: row.wasted_spend, purchases_at_decision: 0,
        status: d.status, notes: d.notes, is_generic_flag: false,
      })
    }

    // Harvest candidates
    for (const row of (results.harvest_candidates ?? [])) {
      const matchTypes = row.match_types?.split(', ') ?? ['Phrase']
      for (const mt of matchTypes) {
        const matchTypeKey = `harvest_${mt.toLowerCase()}` as string
        const key = `harvest_${mt}_${row.search_term}`
        if (!selected.has(key)) continue
        const d = decisionMap.get(key) ?? { status: 'pending', campaigns: [], notes: '' }
        decisions.push({
          term: row.search_term, match_type: matchTypeKey, priority: row.confidence?.includes('⭐⭐⭐') ? 'HIGH' : 'MEDIUM',
          campaign_names: d.campaigns,
          roas_at_decision: row.roas, wasted_at_decision: 0, purchases_at_decision: row.purchases,
          status: d.status, notes: d.notes, is_generic_flag: !!row.generic_flag,
        })
      }
    }

    return decisions
  }

  const handleSaveDecisions = async () => {
    if (!runId || !selected.size) return
    setSaving(true)
    setSaveError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: orgMember } = await supabase.from('orgs').select('id').limit(1).single()

      const decisions = buildDecisions()
      if (!decisions.length) { setSaveError('No decisions selected'); return }

      const res = await fetch('/api/ppc/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgMember?.id, brand: brand, analysis_run_id: runId, decisions }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSaved(true)
      setTimeout(() => router.push(`/ppc/decisions?run_id=${runId}`), 1200)
    } catch (err: any) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="max-w-5xl mx-auto px-4 py-16 text-center">
      <div className="text-4xl mb-4">⚙️</div>
      <p className="text-gray-600">Running analysis…</p>
      <p className="text-sm text-gray-400 mt-1">N-gram extraction, significance testing, generating recommendations</p>
    </div>
  )

  if (!results) return (
    <div className="max-w-5xl mx-auto px-4 py-16 text-center">
      <p className="text-red-600">{saveError ?? 'Analysis failed. Please try again.'}</p>
      <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600">← Go back</button>
    </div>
  )

  const { summary, phrase_high, phrase_medium, phrase_watch, exact_negatives, harvest_candidates, toxic_combos, ngrams } = results
  const allHighKeys = phrase_high.map((r: any) => `neg_phrase_${r.ngram}`)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">PPC analysis results</h1>
          <p className="text-sm text-gray-500 mt-0.5">{summary.date_range_days}-day report · {summary.campaigns?.join(', ')}</p>
        </div>
        <button onClick={() => router.push('/ppc/upload')} className="text-sm text-gray-500 hover:text-gray-700">
          ← New upload
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total spend',        value: `$${summary.total_spend?.toFixed(2)}`,   color: '' },
          { label: 'Overall ROAS',       value: `${summary.overall_roas?.toFixed(2)}x`,  color: '' },
          { label: 'Wasted spend',       value: `$${summary.total_wasted?.toFixed(2)}`,  color: 'text-red-600' },
          { label: 'Addressable waste',  value: `$${summary.addressable_waste?.toFixed(2)}`, color: 'text-orange-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-xl font-semibold mt-0.5 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'negatives', label: `Negatives (${phrase_high.length + phrase_medium.length} actionable)` },
          { key: 'harvest',   label: `Harvest (${harvest_candidates.length} candidates)` },
          { key: 'ngrams',    label: 'N-gram tables' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              activeTab === t.key ? 'bg-white shadow-sm font-medium text-gray-900' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* NEGATIVES TAB */}
      {activeTab === 'negatives' && (
        <div className="space-y-6">

          {/* Quick select bar */}
          <div className="flex gap-2 items-center">
            <button onClick={() => selectAll(allHighKeys)} className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full hover:bg-red-200">
              Select all HIGH ({phrase_high.length})
            </button>
            {selected.size > 0 && (
              <span className="text-xs text-gray-500">{selected.size} selected</span>
            )}
          </div>

          {/* HIGH phrase negatives */}
          {phrase_high.length > 0 && (
            <NegativeSection
              title="🔴 HIGH priority phrase negatives"
              subtitle="ROAS < 1.0 or ACOS > 100% · negate now"
              rows={phrase_high}
              keyPrefix="neg_phrase_"
              selected={selected}
              decisionMap={decisionMap}
              onToggle={toggleSelect}
              onUpdateDecision={updateDecision}
              campaigns={summary.campaigns ?? []}
            />
          )}

          {/* MEDIUM phrase negatives */}
          {phrase_medium.length > 0 && (
            <NegativeSection
              title="🟠 MEDIUM priority phrase negatives"
              subtitle="ROAS 1.0–1.49 · negate + monitor"
              rows={phrase_medium}
              keyPrefix="neg_phrase_"
              selected={selected}
              decisionMap={decisionMap}
              onToggle={toggleSelect}
              onUpdateDecision={updateDecision}
              campaigns={summary.campaigns ?? []}
            />
          )}

          {/* Exact negatives */}
          {exact_negatives.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Exact match negatives ($15+ wasted, 0 purchases)</h3>
              <div className="space-y-2">
                {exact_negatives.map((row: any) => {
                  const key = `neg_exact_${row.search_term}`
                  const d = decisionMap.get(key) ?? { status: 'pending', campaigns: row.campaigns?.split(', ') ?? [], notes: '' }
                  return (
                    <ExactNegativeRow key={key} row={row} rowKey={key} selected={selected.has(key)}
                      status={d.status} campaigns={d.campaigns} notes={d.notes}
                      allCampaigns={summary.campaigns ?? []}
                      onToggle={() => toggleSelect(key)}
                      onUpdate={(f, v) => updateDecision(key, f, v)} />
                  )
                })}
              </div>
            </div>
          )}

          {/* Watch list summary */}
          {phrase_watch.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-yellow-800">🟡 Watch list — {phrase_watch.length} items</p>
              <p className="text-xs text-yellow-700 mt-0.5">Below significance threshold. Re-review after 30 more days of data.</p>
            </div>
          )}

          {/* Toxic combos */}
          {toxic_combos.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm font-medium text-red-800">⚡ {toxic_combos.length} toxic combinations found</p>
              <p className="text-xs text-red-700 mt-0.5">Each component word has ROAS ≥ 2.0 individually but combined ROAS &lt; 1.0. Visible in N-gram tables.</p>
            </div>
          )}
        </div>
      )}

      {/* HARVEST TAB */}
      {activeTab === 'harvest' && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Terms qualifying for dedicated keyword targeting: ROAS ≥ 3.0, $20+ spend, 3+ purchases. Ranked by conviction score (ROAS × spend).
          </p>
          <div className="space-y-2">
            {harvest_candidates.map((row: any) => {
              const matchTypes = row.match_types?.split(', ') ?? ['Phrase']
              return (
                <div key={row.search_term} className={`bg-white border rounded-lg p-4 ${row.generic_flag ? 'border-orange-300' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">{row.search_term}</span>
                        <span className="text-xs text-gray-500">{row.confidence}</span>
                        {row.generic_flag && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full border border-orange-300">
                            {row.generic_flag}
                          </span>
                        )}
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {row.existing_targeting}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-gray-500">
                        <span>{row.purchases} purchases</span>
                        <span>ROAS {row.roas?.toFixed(2)}x</span>
                        <span>${row.cost?.toFixed(2)} spend</span>
                        <span>Conviction {row.conviction?.toFixed(0)}</span>
                        <span>Bid ${row.suggested_bid}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{row.campaign_breakdown}</p>
                    </div>
                    <div className="flex gap-1 ml-3 flex-wrap justify-end">
                      {matchTypes.map((mt: string) => {
                        const key = `harvest_${mt}_${row.search_term}`
                        return (
                          <button
                            key={mt}
                            onClick={() => toggleSelect(key)}
                            className={`text-xs px-2 py-1 rounded border transition-colors ${
                              selected.has(key)
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                            }`}
                          >
                            {selected.has(key) ? '✓ ' : ''}{mt}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* N-GRAM TAB */}
      {activeTab === 'ngrams' && (
        <div className="space-y-6">
          {(['uni', 'bi', 'tri'] as const).map(n => (
            <div key={n}>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                {n === 'uni' ? 'Unigrams' : n === 'bi' ? 'Bigrams' : 'Trigrams'} — top by wasted spend
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      {['N-gram', 'Apps', 'Spend', 'Wasted', 'Sales', 'Purchases', 'ROAS', 'ACOS', 'Waste%'].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 text-gray-500 font-medium border-b border-gray-200">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(ngrams[n] ?? []).map((row: any) => (
                      <tr key={row.ngram} className={`border-b border-gray-100 ${row.roas < 1.0 ? 'bg-red-50' : row.roas < 1.5 ? 'bg-orange-50' : ''}`}>
                        <td className="px-2 py-1.5 font-mono">{row.ngram}</td>
                        <td className="px-2 py-1.5 text-gray-600">{row.appearances}</td>
                        <td className="px-2 py-1.5">${row.total_cost?.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-red-600">${row.wasted_spend?.toFixed(2)}</td>
                        <td className="px-2 py-1.5">${row.total_sales?.toFixed(2)}</td>
                        <td className="px-2 py-1.5">{row.purchases}</td>
                        <td className="px-2 py-1.5">{row.roas?.toFixed(2)}x</td>
                        <td className="px-2 py-1.5">{row.acos?.toFixed(1)}%</td>
                        <td className="px-2 py-1.5">{(row.waste_pct * 100)?.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sticky save bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shadow-lg">
          <p className="text-sm text-gray-700">
            <span className="font-medium">{selected.size} decisions selected</span>
            {saved && <span className="ml-2 text-green-600">✓ Saved! Redirecting to decisions log…</span>}
            {saveError && <span className="ml-2 text-red-600">{saveError}</span>}
          </p>
          <div className="flex gap-3">
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">
              Clear selection
            </button>
            <button
              onClick={handleSaveDecisions}
              disabled={saving || saved}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Log ${selected.size} decision${selected.size > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function NegativeSection({ title, subtitle, rows, keyPrefix, selected, decisionMap, onToggle, onUpdateDecision, campaigns }: any) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <span className="text-xs text-gray-400">{subtitle}</span>
      </div>
      <div className="space-y-2">
        {rows.map((row: any) => {
          const key = `${keyPrefix}${row.ngram}`
          const d   = decisionMap.get(key) ?? { status: 'pending', campaigns: row.recommended_scope?.split(', ') ?? [], notes: '' }
          return (
            <div key={key}
              className={`border rounded-lg p-3 transition-colors ${selected.has(key) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}
            >
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)}
                  className="mt-0.5 rounded cursor-pointer" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-gray-900 font-mono">{row.ngram}</span>
                    <span className="text-xs text-gray-500">{row.ngram_type}</span>
                    <span className="text-xs text-red-600">${row.wasted_spend?.toFixed(2)} wasted</span>
                    <span className="text-xs text-gray-500">ROAS {row.roas?.toFixed(2)}x</span>
                    <span className="text-xs text-gray-500">ACOS {row.acos?.toFixed(1)}%</span>
                  </div>
                  {selected.has(key) && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Status</label>
                        <select className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                          value={d.status} onChange={e => onUpdateDecision(key, 'status', e.target.value)}>
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Apply to campaigns</label>
                        <div className="flex gap-1 flex-wrap">
                          {campaigns.map((c: string) => (
                            <button key={c}
                              className={`text-xs px-2 py-0.5 rounded border ${d.campaigns.includes(c) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
                              onClick={() => {
                                const next = d.campaigns.includes(c) ? d.campaigns.filter((x: string) => x !== c) : [...d.campaigns, c]
                                onUpdateDecision(key, 'campaigns', next)
                              }}>{c}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-0.5">Notes</label>
                        <input type="text" className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                          placeholder="Optional note…" value={d.notes}
                          onChange={e => onUpdateDecision(key, 'notes', e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExactNegativeRow({ row, rowKey, selected, status, campaigns, notes, allCampaigns, onToggle, onUpdate }: any) {
  return (
    <div className={`border rounded-lg p-3 transition-colors ${selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5 rounded cursor-pointer" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm font-mono text-gray-900">{row.search_term}</span>
            <span className="text-xs text-red-600">${row.wasted_spend?.toFixed(2)} wasted</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${row.coverage === 'Covered' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {row.coverage}
            </span>
          </div>
          {selected && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Status</label>
                <select className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                  value={status} onChange={e => onUpdate('status', e.target.value)}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Apply to campaigns</label>
                <div className="flex gap-1 flex-wrap">
                  {allCampaigns.map((c: string) => (
                    <button key={c}
                      className={`text-xs px-2 py-0.5 rounded border ${campaigns.includes(c) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
                      onClick={() => {
                        const next = campaigns.includes(c) ? campaigns.filter((x: string) => x !== c) : [...campaigns, c]
                        onUpdate('campaigns', next)
                      }}>{c}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Notes</label>
                <input type="text" className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                  placeholder="Optional…" value={notes} onChange={e => onUpdate('notes', e.target.value)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PPCAnalysisPageWrapper() {
  return <Suspense fallback={<div className="loading">⟳ Loading…</div>}><PPCAnalysisPage /></Suspense>
}
