'use client'
// app/ppc/page.tsx
// PPC module home — shows recent runs, quick stats, navigation.

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PPCHomePage() {
  const router   = useRouter()
  const supabase = createClient()
  const [recentRuns, setRecentRuns] = useState<any[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: orgMember } = await supabase.from('orgs').select('id').limit(1).single()
      if (!orgMember) return

      const [{ data: runs }, { count }] = await Promise.all([
        supabase.from('ppc_analysis_runs').select('*').eq('org_id', orgMember.id)
          .order('run_at', { ascending: false }).limit(5),
        supabase.from('ppc_decisions_log').select('*', { count: 'exact', head: true })
          .eq('org_id', orgMember.id).eq('status', 'pending'),
      ])

      setRecentRuns(runs ?? [])
      setPendingCount(count ?? 0)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">PPC — Negative targeting & keyword harvesting</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload search term reports, find wasted spend to negate, discover keywords to harvest.
          </p>
        </div>
        <button
          onClick={() => router.push('/ppc/upload')}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + New analysis
        </button>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <button onClick={() => router.push('/ppc/upload')}
          className="bg-white border border-gray-200 rounded-lg p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">📂</div>
          <p className="text-sm font-medium text-gray-900">Upload & analyse</p>
          <p className="text-xs text-gray-500 mt-0.5">Upload search term reports and run n-gram analysis</p>
        </button>
        <button onClick={() => router.push('/ppc/decisions')}
          className="bg-white border border-gray-200 rounded-lg p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">📋</div>
          <p className="text-sm font-medium text-gray-900">Decisions log</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Track what was actioned, when, and in which campaigns
            {pendingCount > 0 && <span className="ml-1 text-orange-600 font-medium">· {pendingCount} pending</span>}
          </p>
        </button>
        <button onClick={() => router.push('/ppc/decisions?status=pending')}
          className={`border rounded-lg p-5 text-left hover:shadow-sm transition-all ${
            pendingCount > 0 ? 'bg-orange-50 border-orange-200 hover:border-orange-300' : 'bg-white border-gray-200 hover:border-blue-300'
          }`}>
          <div className="text-2xl mb-2">⏳</div>
          <p className="text-sm font-medium text-gray-900">Pending decisions</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {pendingCount > 0
              ? <span className="text-orange-700 font-medium">{pendingCount} decisions awaiting action in Amazon</span>
              : 'All decisions actioned'}
          </p>
        </button>
      </div>

      {/* Recent analysis runs */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Recent analysis runs</h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : recentRuns.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-500">No analysis runs yet.</p>
            <button onClick={() => router.push('/ppc/upload')} className="mt-2 text-sm text-blue-600 hover:text-blue-800">
              Run your first analysis →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRuns.map(run => (
              <div key={run.id}
                className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between hover:border-gray-300 cursor-pointer"
                onClick={() => router.push(`/ppc/decisions?run_id=${run.id}`)}
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{run.run_name}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                    <span>{run.date_range_days}-day report</span>
                    <span>${run.total_spend?.toFixed(2)} spend</span>
                    <span>${run.total_wasted?.toFixed(2)} wasted</span>
                    <span>{run.high_negatives} HIGH negatives</span>
                    <span>{run.harvest_candidates} harvest candidates</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <p className="text-xs text-gray-400">
                    {new Date(run.run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-blue-600 mt-0.5">View decisions →</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
