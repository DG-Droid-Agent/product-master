// app/api/ppc/analyse/route.ts
// Clean model: 1 run per portfolio per bulk upload
// [A1] runAnalysis NOT exported
// [A2] cs >= 10 spend threshold
// [A3] 1 run per portfolio — reuse if exists
// [A4] Decision carry-forward
// [A5] autoRunName
// [A6] dates stored on run
// [A7] Toxic combo $10+ threshold
// [A8] Per-campaign attribution

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface SearchTermRow {
  search_term: string
  campaign_name: string
  portfolio?: string
  targeting_type?: 'keyword' | 'pt'
  pt_expression?: string
  cost: number
  purchases: number
  sales: number
  matched_keyword?: string
}

// ── N-GRAM HELPERS ─────────────────────────────────────────────────────────────

function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w => w.length > 1 || /[a-z]/.test(w)) ?? []
  if (words.length < n) return []
  return Array.from({ length: words.length - n + 1 }, (_, i) => words.slice(i, i + n).join(' '))
}

function buildNgramTable(rows: SearchTermRow[], n: number) {
  const buckets = new Map<string, { cost: number; sales: number; purchases: number; wasted: number; count: number }>()
  for (const row of rows) {
    const wasted = row.purchases === 0 ? row.cost : 0
    for (const gram of getNgrams(row.search_term, n)) {
      const b = buckets.get(gram) ?? { cost: 0, sales: 0, purchases: 0, wasted: 0, count: 0 }
      b.cost += row.cost; b.sales += row.sales; b.purchases += row.purchases
      b.wasted += wasted; b.count += 1
      buckets.set(gram, b)
    }
  }
  return Array.from(buckets.entries()).map(([ngram, b]) => ({
    ngram, appearances: b.count, total_cost: b.cost, wasted_spend: b.wasted,
    total_sales: b.sales, purchases: b.purchases,
    roas:      b.cost > 0 ? b.sales / b.cost : 0,
    acos:      b.sales > 0 ? b.cost / b.sales * 100 : b.cost > 0 ? 100 : 0,
    waste_pct: b.cost > 0 ? b.wasted / b.cost : 0,
  })).sort((a, b) => b.wasted_spend - a.wasted_spend)
}

function findCoreTerms(uni: any[]): Set<string> {
  return new Set([...uni].sort((a, b) => b.total_cost - a.total_cost).slice(0, 15).filter(u => u.roas >= 2.0).map(u => u.ngram))
}

function classifyPriority(row: any, ngramSize: number): 'HIGH' | 'MEDIUM' | 'WATCH' | null {
  const { appearances, wasted_spend: wasted, roas, acos } = row
  const significant = ngramSize === 1 ? (appearances >= 10 || wasted >= 25) : (appearances >= 20 || wasted >= 30)
  if (!significant) return 'WATCH'
  if (roas < 1.0 || acos > 100) return 'HIGH'
  if (roas < 1.5) return 'MEDIUM'
  if (roas < 2.0) return 'WATCH'
  return null
}

const MATERIAL_MODIFIERS = new Set(['coir','coco','natural','jute','sisal','bamboo','rubber','pvc','polypropylene','nylon'])
function genericFlag(term: string): string {
  const words = term.trim().split(/\s+/)
  if (words.length === 1) return '⚠️ Generic — single word, too broad'
  if (words.length === 2 && !words.some(w => MATERIAL_MODIFIERS.has(w.toLowerCase()))) return '⚠️ Generic — no product modifier'
  return ''
}

// ── PT ANALYSIS ────────────────────────────────────────────────────────────────

function analysePT(ptRows: SearchTermRow[], campaigns: string[]) {
  if (!ptRows.length) return { pt_negatives: [], pt_harvest: [] }
  const exprMap = new Map<string, { cost: number; sales: number; orders: number; campaigns: string[] }>()
  for (const row of ptRows) {
    const expr = row.pt_expression || 'unknown'
    const b    = exprMap.get(expr) ?? { cost: 0, sales: 0, orders: 0, campaigns: [] }
    b.cost += row.cost; b.sales += row.sales; b.orders += row.purchases
    if (!b.campaigns.includes(row.campaign_name)) b.campaigns.push(row.campaign_name)
    exprMap.set(expr, b)
  }
  const ptNegatives: any[] = []
  const ptHarvest:   any[] = []
  for (const [expr, b] of exprMap) {
    if (expr === 'unknown') continue
    const roas = b.cost > 0 ? b.sales / b.cost : 0
    if (roas < 1.0 && b.cost >= 10) {
      const campBreakdown = campaigns.map(c => {
        const cr = ptRows.filter(r => r.campaign_name === c && (r.pt_expression || '') === expr)
        const cs = cr.reduce((s, r) => s + r.cost, 0)
        const ss = cr.reduce((s, r) => s + r.sales, 0)
        return cs > 0 ? { name: c, spend: cs, roas: cs > 0 ? ss / cs : 0 } : null
      }).filter(Boolean) as { name: string; spend: number; roas: number }[]
      const recCamps = campBreakdown.filter(c => c.roas < 1.0 && c.spend >= 10).map(c => c.name)
      ptNegatives.push({
        pt_expression: expr, wasted_spend: b.cost - b.sales > 0 ? b.cost - b.sales : b.cost,
        total_spend: b.cost, total_sales: b.sales, roas,
        acos: b.sales > 0 ? b.cost / b.sales * 100 : 100,
        priority: roas === 0 ? 'HIGH' : 'MEDIUM',
        campaigns: b.campaigns, camp_breakdown: campBreakdown,
        recommended_scope: recCamps.join(', ') || b.campaigns.join(', '),
        action: expr.startsWith('asin=') ? `Exclude ASIN ${expr.replace(/asin="|"/g, '')} from product targeting` : `Add "${expr}" as negative product target`,
      })
    }
    if (roas >= 3.0 && b.cost >= 20 && b.orders >= 3) {
      ptHarvest.push({
        pt_expression: expr, total_spend: b.cost, total_sales: b.sales, orders: b.orders, roas,
        acos: b.sales > 0 ? b.cost / b.sales * 100 : 0, conviction: roas * b.cost,
        confidence: b.orders >= 10 && roas >= 5 ? '⭐⭐⭐ HIGH' : b.orders >= 5 && roas >= 3 ? '⭐⭐ MEDIUM' : '⭐ EMERGING',
        campaigns: b.campaigns,
        action: expr.startsWith('asin=') ? `Add ${expr.replace(/asin="|"/g, '')} as explicit PT target — already converting at ${roas.toFixed(2)}x` : `Expand "${expr}" targeting — strong performer`,
      })
    }
  }
  return {
    pt_negatives: ptNegatives.sort((a, b) => b.total_spend - a.total_spend),
    pt_harvest:   ptHarvest.sort((a, b) => b.conviction - a.conviction),
  }
}

// ── KEYWORD ANALYSIS ──────────────────────────────────────────────────────────

function analyseKeywords(rows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[]) {
  const campaigns = [...new Set(rows.map(r => r.campaign_name))]
  const aggMap = new Map<string, SearchTermRow>()
  for (const row of rows) {
    const ex = aggMap.get(row.search_term)
    if (ex) { ex.cost += row.cost; ex.purchases += row.purchases; ex.sales += row.sales }
    else aggMap.set(row.search_term, { ...row })
  }
  const agg = Array.from(aggMap.values())
  const uni  = buildNgramTable(agg, 1)
  const bi   = buildNgramTable(agg, 2)
  const tri  = buildNgramTable(agg, 3)
  const core = findCoreTerms(uni)
  const existingKwSet = new Set(existingKeywords.map(k => k.toLowerCase().trim()).filter(k => k !== 'close-match'))
  const phraseCandidates: any[] = []

  const processNgram = (row: any, ngramSize: number) => {
    if (row.ngram.split(' ').every((w: string) => core.has(w))) return
    const pri = classifyPriority(row, ngramSize)
    if (!pri) return
    const recCamps = campaigns.filter(c => {
      const cr = rows.filter(r => r.campaign_name === c && r.search_term.toLowerCase().includes(row.ngram))
      const cs = cr.reduce((s, r) => s + r.cost, 0)
      const ss = cr.reduce((s, r) => s + r.sales, 0)
      return cs >= 10 && ss / cs < 1.0
    })
    const autoRows  = rows.filter(r => r.campaign_name.toLowerCase().includes('auto')  && r.search_term.toLowerCase().includes(row.ngram))
    const broadRows = rows.filter(r => r.campaign_name.toLowerCase().includes('broad') && r.search_term.toLowerCase().includes(row.ngram))
    const autoSpend  = autoRows.reduce((s, r) => s + r.cost, 0)
    const broadSpend = broadRows.reduce((s, r) => s + r.cost, 0)
    phraseCandidates.push({
      ...row, priority: pri, ngram_type: ngramSize === 1 ? 'Unigram' : `${ngramSize}-gram`,
      campaigns: [autoSpend > 0 && 'auto', broadSpend > 0 && 'broad'].filter(Boolean).join(', '),
      auto_spend: autoSpend, broad_spend: broadSpend,
      auto_roas:  autoSpend  > 0 ? autoRows.reduce((s, r) => s + r.sales, 0)  / autoSpend  : 0,
      broad_roas: broadSpend > 0 ? broadRows.reduce((s, r) => s + r.sales, 0) / broadSpend : 0,
      recommended_scope: recCamps.length > 0 ? recCamps.join(', ') : campaigns.join(', '),
    })
  }

  for (const row of uni) { if (!core.has(row.ngram)) processNgram(row, 1) }
  for (const row of [...bi, ...tri]) processNgram(row, row.ngram.split(' ').length)

  const phraseHigh   = phraseCandidates.filter(p => p.priority === 'HIGH').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)
  const phraseMedium = phraseCandidates.filter(p => p.priority === 'MEDIUM').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)
  const phraseWatch  = phraseCandidates.filter(p => p.priority === 'WATCH').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)

  const phraseNegDict = new Map(phraseCandidates.filter(p => ['HIGH','MEDIUM'].includes(p.priority)).map(p => [p.ngram, p.priority]))
  const exactNegatives = agg
    .filter(r => r.purchases === 0 && r.cost >= 15)
    .sort((a, b) => b.cost - a.cost)
    .map(row => {
      const tl      = row.search_term.toLowerCase()
      const matches = Array.from(phraseNegDict.keys()).filter(p => tl.includes(p))
      const highMed = matches.filter(p => ['HIGH','MEDIUM'].includes(phraseNegDict.get(p)!))
      const camps   = [...new Set(rows.filter(r => r.search_term.toLowerCase() === tl).map(r => r.campaign_name))]
      return { search_term: row.search_term, cost: row.cost, wasted_spend: row.cost, roas: 0, acos: 100, coverage: highMed.length > 0 ? 'Covered' : matches.length > 0 ? 'Partial' : 'Not covered', covered_by: (highMed.length > 0 ? highMed : matches).join(', '), campaigns: camps.join(', ') }
    })

  const goodWords  = new Set(uni.filter(u => u.roas >= 2.0).map(u => u.ngram))
  const toxicCombos = [...bi, ...tri]
    .filter(row => row.roas < 1.0 && row.ngram.split(' ').every((w: string) => goodWords.has(w)))
    .map(row => {
      const campRows     = rows.filter(r => r.search_term.toLowerCase().includes(row.ngram))
      const campBreakdown = campaigns.map(c => {
        const cr = campRows.filter(r => r.campaign_name === c)
        const cs = cr.reduce((s, r) => s + r.cost, 0)
        const ss = cr.reduce((s, r) => s + r.sales, 0)
        return cs > 0 ? { name: c, spend: cs, roas: cs > 0 ? ss / cs : 0 } : null
      }).filter(Boolean) as { name: string; spend: number; roas: number }[]
      const recCamps = campBreakdown.filter(c => c.roas < 1.0 && c.spend >= 10).map(c => c.name)
      return { ...row, combo_type: row.ngram.split(' ').length === 2 ? 'bigram' : 'trigram', reason: `Each word ROAS≥2.0 but combined ROAS=${row.roas.toFixed(2)}`, priority: 'HIGH', recommended_scope: recCamps.join(', ') || campaigns.join(', '), camp_breakdown: campBreakdown }
    })
    .sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)

  const TARGET_ACOS = 1 / 3.0
  const harvestCandidates = agg
    .filter(r => r.cost > 0 && r.sales / r.cost >= 3.0 && r.cost >= 20 && r.purchases >= 3)
    .map(row => {
      const roas = row.sales / row.cost
      const p    = row.purchases
      const tl   = row.search_term.toLowerCase().trim()
      const isExact = existingKwSet.has(tl)
      const partial = !isExact ? [...existingKwSet].filter(k => k.includes(tl) || tl.includes(k)) : []
      const matchTypes = [...(p >= 5 ? ['Exact'] : []), 'Phrase', ...(p >= 3 && row.search_term.split(' ').length <= 2 ? ['Broad'] : [])]
      const avgOV  = row.sales / p
      const campBreakdown = campaigns.map(c => {
        const cr = rows.filter(r => r.campaign_name === c && r.search_term.toLowerCase() === tl)
        const cs = cr.reduce((s, r) => s + r.cost, 0)
        const ss = cr.reduce((s, r) => s + r.sales, 0)
        const cp = cr.reduce((s, r) => s + r.purchases, 0)
        return cs > 0 ? `${c}: ${cp} orders @ ROAS ${(ss/cs).toFixed(1)}x` : null
      }).filter(Boolean).join(' | ')
      return {
        search_term: row.search_term, purchases: p, cost: row.cost, sales: row.sales, roas,
        acos: row.cost / row.sales, conviction: roas * row.cost,
        confidence: p >= 10 && roas >= 5 ? '⭐⭐⭐ HIGH' : p >= 5 && roas >= 3 ? '⭐⭐ MEDIUM' : '⭐ EMERGING',
        match_types: matchTypes.join(', '),
        existing_targeting: isExact ? '⚠️ Already targeted' : partial.length > 0 ? `⚡ Partially covered: ${partial.join(', ')}` : '🆕 New — not targeted',
        campaign_breakdown: campBreakdown, avg_order_value: avgOV,
        suggested_bid: Math.min(3.00, Math.max(0.20, +(avgOV * TARGET_ACOS).toFixed(2))),
        generic_flag: genericFlag(row.search_term),
      }
    })
    .sort((a: any, b: any) => b.conviction - a.conviction)

  const totalCost   = agg.reduce((s, r) => s + r.cost, 0)
  const totalSales  = agg.reduce((s, r) => s + r.sales, 0)
  const totalWasted = agg.reduce((s, r) => s + (r.purchases === 0 ? r.cost : 0), 0)
  const addressable = phraseHigh.reduce((s: number, r: any) => s + r.wasted_spend, 0)
                    + phraseMedium.reduce((s: number, r: any) => s + r.wasted_spend, 0)
                    + exactNegatives.filter(e => e.coverage !== 'Covered').reduce((s, r) => s + r.wasted_spend, 0)

  return {
    summary: {
      total_terms: agg.length, total_spend: totalCost, total_sales: totalSales,
      total_wasted: totalWasted, overall_roas: totalCost > 0 ? totalSales / totalCost : 0,
      overall_acos: totalSales > 0 ? totalCost / totalSales * 100 : 0,
      wasted_pct: totalCost > 0 ? totalWasted / totalCost : 0,
      addressable_waste: addressable, campaigns, date_range_days: dateRangeDays,
    },
    phrase_high: phraseHigh, phrase_medium: phraseMedium, phrase_watch: phraseWatch,
    exact_negatives: exactNegatives, toxic_combos: toxicCombos, harvest_candidates: harvestCandidates,
    ngrams: { uni: uni.slice(0, 20), bi: bi.slice(0, 20), tri: tri.slice(0, 15) },
    core_terms: [...core],
  }
}

// ── SINGLE PORTFOLIO ANALYSIS ─────────────────────────────────────────────────
// [A1] NOT exported

async function runPortfolioAnalysis(rows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[]) {
  const kwRows = rows.filter(r => r.targeting_type !== 'pt')
  const ptRows = rows.filter(r => r.targeting_type === 'pt')
  const campaigns = [...new Set(rows.map(r => r.campaign_name))]
  const kwResult  = analyseKeywords(kwRows.length ? kwRows : rows, dateRangeDays, existingKeywords)
  const ptResult  = ptRows.length ? analysePT(ptRows, campaigns) : { pt_negatives: [], pt_harvest: [] }
  return { ...kwResult, ...ptResult }
}

// ── API ROUTE ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { upload_ids, date_range_days, org_id, brand, portfolio, force } = await request.json()
    if (!upload_ids?.length || !date_range_days || !org_id || !portfolio) {
      return NextResponse.json({ error: 'Missing: upload_ids, date_range_days, org_id, portfolio' }, { status: 400 })
    }

    // Fetch upload metadata
    const { data: uploadMeta } = await supabase.from('ppc_uploads')
      .select('asin, report_start_date, report_end_date, campaign_name, is_bulk_file')
      .in('id', upload_ids)

    // [A3] Check if this portfolio already has a saved run — reuse it
    const { data: existingRun } = await supabase
      .from('ppc_analysis_runs')
      .select('id, results_json, analysed_at')
      .eq('org_id', org_id)
      .eq('portfolio', portfolio)
      .in('upload_ids', [upload_ids]) // approximate — exact match below
      .order('run_at', { ascending: false })
      .limit(10)
      .then(async ({ data }) => {
        // Exact upload_ids match
        const exact = (data ?? []).find((r: any) => {
          const sorted = [...(r.upload_ids ?? [])].sort().join(',')
          return sorted === [...upload_ids].sort().join(',')
        })
        return { data: exact ?? null }
      })

    // Return cached results if available and not forcing refresh
    if (!force && existingRun?.results_json) {
      const { data: existingDecisions } = await supabase
        .from('ppc_decisions_log')
        .select('term, match_type, status, campaign_names, notes, is_generic_flag, decided_at, portfolio')
        .eq('analysis_run_id', existingRun.id)
        .order('decided_at', { ascending: false })
      return NextResponse.json({
        analysis_run_id:    existingRun.id,
        portfolio,
        from_cache:         true,
        analysed_at:        existingRun.analysed_at,
        existing_decisions: existingDecisions ?? [],
        results:            existingRun.results_json,
      })
    }

    // Fetch rows for this portfolio only — indexed query, fast
    const allRows: any[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('ppc_search_terms')
        .select('search_term, campaign_name, portfolio, targeting_type, pt_expression, cost, purchases, sales, matched_keyword')
        .in('upload_id', upload_ids)
        .eq('org_id', org_id)
        .eq('portfolio', portfolio)
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      if (data?.length) allRows.push(...data)
      if (!data?.length || data.length < PAGE) break
      offset += PAGE
    }

    if (!allRows.length) return NextResponse.json({ error: `No data found for portfolio: ${portfolio}` }, { status: 404 })

    const existingKeywords = [...new Set(allRows.map((r: any) => r.matched_keyword).filter(Boolean))] as string[]
    const results = await runPortfolioAnalysis(allRows as SearchTermRow[], date_range_days, existingKeywords)

    // [A5] Build run name
    const dates     = (uploadMeta ?? []).flatMap((u: any) => [u.report_start_date, u.report_end_date].filter(Boolean))
    const startDate = dates.length ? dates.reduce((a: string, b: string) => a < b ? a : b) : null
    const endDate   = dates.length ? dates.reduce((a: string, b: string) => a > b ? a : b) : null
    const fmt       = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
    const dateLabel = startDate && endDate ? `${fmt(startDate)} – ${fmt(endDate)}` : null
    const runName   = [brand, portfolio, dateLabel].filter(Boolean).join(' · ')

    // Create or update the run for this portfolio
    let runId: string
    if (existingRun?.id) {
      runId = existingRun.id
    } else {
      const { data: inserted, error: runError } = await supabase
        .from('ppc_analysis_runs').insert({
          org_id, brand: brand ?? null,
          report_start_date: startDate ?? null,
          report_end_date: endDate ?? null,
          run_name: runName,
          upload_ids, date_range_days,
          is_bulk_run: true,
          portfolio,
          portfolio_roas:    results.summary.overall_roas,
          total_spend:       results.summary.total_spend,
          total_wasted:      results.summary.total_wasted,
          total_terms:       results.summary.total_terms,
          high_negatives:    results.phrase_high.length,
          medium_negatives:  results.phrase_medium.length,
          harvest_candidates: results.harvest_candidates.length,
          run_by: user.id,
        }).select('id').single()
      if (runError) throw runError
      runId = inserted.id
    }

    // Save trimmed results
    const trimNgrams = (r: any) => r ? { ...r, ngrams: { uni: (r.ngrams?.uni ?? []).slice(0, 20), bi: (r.ngrams?.bi ?? []).slice(0, 20), tri: (r.ngrams?.tri ?? []).slice(0, 15) } } : r
    await supabase.from('ppc_analysis_runs')
      .update({ results_json: trimNgrams(results), analysed_at: new Date().toISOString(),
        portfolio_roas: results.summary.overall_roas, total_spend: results.summary.total_spend,
        total_wasted: results.summary.total_wasted, high_negatives: results.phrase_high.length,
        harvest_candidates: results.harvest_candidates.length })
      .eq('id', runId)

    // [A4] Carry forward decisions
    const { data: existingDecisions } = await supabase
      .from('ppc_decisions_log')
      .select('term, match_type, status, campaign_names, notes, is_generic_flag, decided_at, portfolio')
      .eq('analysis_run_id', runId)
      .order('decided_at', { ascending: false })

    return NextResponse.json({
      analysis_run_id:    runId,
      portfolio,
      from_cache:         false,
      analysed_at:        new Date().toISOString(),
      existing_decisions: existingDecisions ?? [],
      results,
    })

  } catch (err: any) {
    console.error('PPC analysis error:', err)
    return NextResponse.json({ error: err.message ?? 'Analysis failed' }, { status: 500 })
  }
}

// ── GET: load all portfolio runs for a bulk upload ────────────────────────────
// Used by dashboard to build the full sidebar

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const uploadId = searchParams.get('upload_id')
    const orgId    = searchParams.get('org_id')
    if (!uploadId || !orgId) return NextResponse.json({ error: 'Missing upload_id or org_id' }, { status: 400 })

    // Get all runs for this bulk upload
    const { data: runs } = await supabase
      .from('ppc_analysis_runs')
      .select('id, portfolio, run_name, analysed_at, total_spend, total_wasted, high_negatives, harvest_candidates, results_json')
      .eq('org_id', orgId)
      .eq('is_bulk_run', true)
      .contains('upload_ids', [uploadId])
      .order('total_spend', { ascending: false })

    // Build portfolio health for sidebar
    const portfolioRuns = (runs ?? []).filter((r: any) => r.portfolio).map((r: any) => {
      const wasted_pct = r.total_spend > 0 ? r.total_wasted / r.total_spend : 0
      const high       = r.high_negatives ?? 0
      return {
        portfolio:         r.portfolio,
        run_id:            r.id,
        analysed_at:       r.analysed_at,
        total_spend:       r.total_spend,
        total_wasted:      r.total_wasted,
        wasted_pct,
        high_negatives:    high,
        harvest_candidates: r.harvest_candidates,
        has_results:       !!r.results_json,
        health: wasted_pct > 0.30 || high > 3 ? 'red' : wasted_pct > 0.15 || high > 0 ? 'amber' : 'green',
      }
    })

    return NextResponse.json({ portfolio_runs: portfolioRuns })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
