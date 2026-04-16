// app/api/ppc/analyse/route.ts
// [A1] runAnalysis NOT exported
// [A2] cs >= 10 spend threshold for recommendations
// [A3] Duplicate run detection
// [A4] Decision carry-forward
// [A5] autoRunName from brand+ASIN+dates
// [A6] asin/report dates stored on run
// [A7] Toxic combo $10+ threshold
// [A8] Per-campaign attribution
// NEW: per-portfolio analysis, PT negative detection, PT harvest detection

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

// ── N-GRAM HELPERS ────────────────────────────────────────────────────────────

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

// [A2] threshold: spend >= 10 AND ROAS < 1.0
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

// ── PT ANALYSIS ───────────────────────────────────────────────────────────────
// Runs on PT rows — finds negative PT targets and harvest PT targets

function analysePT(ptRows: SearchTermRow[], campaigns: string[]) {
  if (!ptRows.length) return { pt_negatives: [], pt_harvest: [] }

  // Group by pt_expression across all campaigns in this portfolio
  const exprMap = new Map<string, { cost: number; sales: number; orders: number; campaigns: string[] }>()

  for (const row of ptRows) {
    const expr = row.pt_expression || 'unknown'
    const b    = exprMap.get(expr) ?? { cost: 0, sales: 0, orders: 0, campaigns: [] }
    b.cost   += row.cost
    b.sales  += row.sales
    b.orders += row.purchases
    if (!b.campaigns.includes(row.campaign_name)) b.campaigns.push(row.campaign_name)
    exprMap.set(expr, b)
  }

  const ptNegatives: any[] = []
  const ptHarvest:   any[] = []

  for (const [expr, b] of exprMap) {
    if (expr === 'unknown') continue
    const roas = b.cost > 0 ? b.sales / b.cost : 0

    // [A2] pattern: $10+ spend threshold for recommendations
    if (roas < 1.0 && b.cost >= 10) {
      // Per-campaign breakdown for this expression
      const campBreakdown = campaigns.map(c => {
        const cr = ptRows.filter(r => r.campaign_name === c && (r.pt_expression || '') === expr)
        const cs = cr.reduce((s, r) => s + r.cost, 0)
        const ss = cr.reduce((s, r) => s + r.sales, 0)
        return cs > 0 ? { name: c, spend: cs, roas: cs > 0 ? ss / cs : 0 } : null
      }).filter(Boolean) as { name: string; spend: number; roas: number }[]

      const recCamps = campBreakdown.filter(c => c.roas < 1.0 && c.spend >= 10).map(c => c.name)

      ptNegatives.push({
        pt_expression:     expr,
        wasted_spend:      b.cost - b.sales > 0 ? b.cost - b.sales : b.cost,
        total_spend:       b.cost,
        total_sales:       b.sales,
        roas,
        acos:              b.sales > 0 ? b.cost / b.sales * 100 : 100,
        priority:          roas === 0 ? 'HIGH' : 'MEDIUM',
        campaigns:         b.campaigns,
        camp_breakdown:    campBreakdown,
        recommended_scope: recCamps.join(', ') || b.campaigns.join(', '),
        action:            expr.startsWith('asin=')
          ? `Exclude ASIN ${expr.replace(/asin="|"/g, '')} from product targeting`
          : `Add "${expr}" as negative product target`,
      })
    }

    if (roas >= 3.0 && b.cost >= 20 && b.orders >= 3) {
      ptHarvest.push({
        pt_expression: expr,
        total_spend:   b.cost,
        total_sales:   b.sales,
        orders:        b.orders,
        roas,
        acos:          b.sales > 0 ? b.cost / b.sales * 100 : 0,
        conviction:    roas * b.cost,
        confidence:    b.orders >= 10 && roas >= 5 ? '⭐⭐⭐ HIGH' : b.orders >= 5 && roas >= 3 ? '⭐⭐ MEDIUM' : '⭐ EMERGING',
        campaigns:     b.campaigns,
        action:        expr.startsWith('asin=')
          ? `Add ${expr.replace(/asin="|"/g, '')} as explicit PT target — already converting at ${roas.toFixed(2)}x`
          : `Expand "${expr}" targeting — strong performer`,
      })
    }
  }

  return {
    pt_negatives: ptNegatives.sort((a, b) => b.total_spend - a.total_spend),
    pt_harvest:   ptHarvest.sort((a, b) => b.conviction - a.conviction),
  }
}

// ── KEYWORD ANALYSIS (unchanged from v1 with all bug fixes) ───────────────────

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

    // [A2] $10+ spend per campaign
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
      ...row, priority: pri,
      ngram_type: ngramSize === 1 ? 'Unigram' : `${ngramSize}-gram`,
      campaigns: [autoSpend > 0 && 'auto', broadSpend > 0 && 'broad'].filter(Boolean).join(', '),
      auto_spend: autoSpend, broad_spend: broadSpend,   // [A8]
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

  // [A7] Toxic combos — $10+ spend threshold
  const goodWords = new Set(uni.filter(u => u.roas >= 2.0).map(u => u.ngram))
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
      const recCamps = campBreakdown.filter(c => c.roas < 1.0 && c.spend >= 10).map(c => c.name) // [A7]
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
        campaign_breakdown: campBreakdown,
        avg_order_value: avgOV,
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

// ── MAIN: run per portfolio ───────────────────────────────────────────────────
// [A1] NOT exported
async function runAnalysis(allRows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[], isBulk: boolean) {
  if (!isBulk) {
    // Individual file — use ALL rows for keyword n-gram analysis
    // PT rows have valid customer search terms (what the shopper typed)
    const ptRows   = allRows.filter(r => r.targeting_type === 'pt')
    const campaigns = [...new Set(allRows.map(r => r.campaign_name))]
    const kwResult  = analyseKeywords(allRows, dateRangeDays, existingKeywords)
    const ptResult  = ptRows.length ? analysePT(ptRows, campaigns) : { pt_negatives: [], pt_harvest: [] }
    return {
      is_bulk: false,
      portfolios: null,
      account: { ...kwResult, ...ptResult },
    }
  }

  // Bulk file — run per portfolio + account totals
  const portfolioNames = [...new Set(allRows.map(r => r.portfolio).filter(Boolean))] as string[]

  // Portfolio-level results
  const portfolioResults: Record<string, any> = {}

  for (const portfolio of portfolioNames) {
    const portRows  = allRows.filter(r => r.portfolio === portfolio)
    const ptRows    = portRows.filter(r => r.targeting_type === 'pt')
    const campaigns = [...new Set(portRows.map(r => r.campaign_name))]

    // Use ALL rows for keyword n-gram analysis — customer search terms are valid
    // regardless of whether the impression came from a keyword or PT targeting
    const kwResult = analyseKeywords(portRows, dateRangeDays, existingKeywords)
    const ptResult = ptRows.length ? analysePT(ptRows, campaigns) : { pt_negatives: [], pt_harvest: [] }

    portfolioResults[portfolio] = {
      portfolio,
      ...kwResult,
      ...ptResult,
    }
  }

  // Account-level totals — use ALL rows for keyword n-gram analysis
  const allPtRows    = allRows.filter(r => r.targeting_type === 'pt')
  const allCampaigns = [...new Set(allRows.map(r => r.campaign_name))]
  const accountKw    = analyseKeywords(allRows, dateRangeDays, existingKeywords)
  const accountPt    = analysePT(allPtRows, allCampaigns)

  // Portfolio health summary for sidebar colour coding
  const portfolioHealth = Object.values(portfolioResults).map((p: any) => ({
    portfolio:         p.portfolio,
    total_spend:       p.summary.total_spend,
    total_wasted:      p.summary.total_wasted,
    overall_roas:      p.summary.overall_roas,
    wasted_pct:        p.summary.wasted_pct,
    high_negatives:    p.phrase_high.length,
    medium_negatives:  p.phrase_medium.length,
    pt_negatives:      p.pt_negatives.length,
    harvest_kw:        p.harvest_candidates.length,
    harvest_pt:        p.pt_harvest.length,
    // Health signal: red = wasted > 30% or HIGH negatives > 3
    //                amber = wasted 15-30% or HIGH negatives 1-3
    //                green = wasted < 15% and no HIGH negatives
    health: (() => {
      const w = p.summary.wasted_pct
      const h = p.phrase_high.length + p.pt_negatives.filter((n: any) => n.priority === 'HIGH').length
      if (w > 0.30 || h > 3) return 'red'
      if (w > 0.15 || h > 0) return 'amber'
      return 'green'
    })(),
  })).sort((a, b) => b.total_wasted - a.total_wasted)

  return {
    is_bulk: true,
    portfolios: portfolioNames,
    portfolio_health: portfolioHealth,
    portfolio_results: portfolioResults,
    account: { ...accountKw, ...accountPt },
  }
}

// ── API ROUTE POST ────────────────────────────────────────────────────────────
// ── GET: load saved results for a run ────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('run_id')
    const orgId = searchParams.get('org_id')
    if (!runId || !orgId) return NextResponse.json({ error: 'Missing run_id or org_id' }, { status: 400 })

    const { data: run } = await supabase
      .from('ppc_analysis_runs')
      .select('id, results_json, analysed_at, run_name, upload_ids, is_bulk_run, date_range_days')
      .eq('id', runId).eq('org_id', orgId).single()

    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (!run.results_json) return NextResponse.json({ has_results: false })

    return NextResponse.json({
      has_results: true,
      analysis_run_id: run.id,
      analysed_at: run.analysed_at,
      results: run.results_json,
      existing_decisions: [],
      is_duplicate_run: false,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()  // [U1]
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { upload_ids, date_range_days, org_id, brand, run_name, force, selected_portfolios } = await request.json()
    if (!upload_ids?.length || !date_range_days || !org_id) {
      return NextResponse.json({ error: 'Missing: upload_ids, date_range_days, org_id' }, { status: 400 })
    }

    // Fetch upload metadata + term rows in parallel [A5]
    const { data: uploadMeta } = await supabase.from('ppc_uploads')
      .select('asin, report_start_date, report_end_date, campaign_name, campaign_type, is_bulk_file, portfolios')
      .in('id', upload_ids)

    // Supabase default row limit is 1000 — paginate to get all rows for bulk files
    const allTermRows: any[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('ppc_search_terms')
        .select('search_term, campaign_name, portfolio, targeting_type, pt_expression, cost, purchases, sales, matched_keyword')
        .in('upload_id', upload_ids)
        .eq('org_id', org_id)
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      if (data?.length) allTermRows.push(...data)
      if (!data?.length || data.length < PAGE) break
      offset += PAGE
    }
    const termRows = allTermRows

    if (!termRows?.length) return NextResponse.json({ error: 'No data found for these uploads' }, { status: 404 })

    const isBulk = (uploadMeta ?? []).some((u: any) => u.is_bulk_file)

    // Filter to selected portfolios if provided — reduces engine work significantly
    const filteredRows = (isBulk && selected_portfolios?.length)
      ? termRows.filter((r: any) => selected_portfolios.includes(r.portfolio))
      : termRows

    const existingKeywords = [...new Set(filteredRows.map((r: any) => r.matched_keyword).filter(Boolean))] as string[]

    // [A5] Build auto run name
    const asins        = [...new Set((uploadMeta ?? []).map((u: any) => u.asin).filter(Boolean))]
    const dates        = (uploadMeta ?? []).flatMap((u: any) => [u.report_start_date, u.report_end_date].filter(Boolean))
    const startDate    = dates.length ? dates.reduce((a: string, b: string) => a < b ? a : b) : null
    const endDate      = dates.length ? dates.reduce((a: string, b: string) => a > b ? a : b) : null
    const fmt          = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
    const dateLabel    = startDate && endDate && startDate !== endDate ? `${fmt(startDate)} – ${fmt(endDate)}` : startDate ? fmt(startDate)! : null
    const autoRunName  = [brand, asins.length ? asins.join(', ') : null, dateLabel, isBulk ? 'Full account bulk' : null].filter(Boolean).join(' · ')

    // [A3] Duplicate run detection — must come before saved results check
    const sortedIds = [...upload_ids].sort()
    const { data: existingRuns } = await supabase
      .from('ppc_analysis_runs').select('id, upload_ids, run_at, is_bulk_run')
      .eq('org_id', org_id).order('run_at', { ascending: false }).limit(20)

    const duplicate = existingRuns?.find((r: any) => {
      const sorted = [...(r.upload_ids ?? [])].sort()
      const idsMatch = sorted.length === sortedIds.length && sorted.every((id: string, i: number) => id === sortedIds[i])
      // Only reuse a run if the bulk flag matches — don't reuse pre-portfolio runs
      const bulkMatches = (r.is_bulk_run ?? false) === isBulk
      return idsMatch && bulkMatches
    })

    // ── CHECK FOR SAVED RESULTS ──────────────────────────────────────────────
    // If this run already has results saved and force=true is not set, return them instantly
    if (!force && duplicate?.id) {
      const { data: savedRun } = await supabase
        .from('ppc_analysis_runs')
        .select('results_json, analysed_at')
        .eq('id', duplicate.id)
        .single()

      if (savedRun?.results_json) {
        const { data: existingDecisions } = await supabase
          .from('ppc_decisions_log')
          .select('term, match_type, status, campaign_names, notes, is_generic_flag, decided_at, portfolio')
          .eq('analysis_run_id', duplicate.id)
          .order('decided_at', { ascending: false })

        return NextResponse.json({
          analysis_run_id:    duplicate.id,
          is_duplicate_run:   true,
          from_cache:         true,
          analysed_at:        savedRun.analysed_at,
          existing_decisions: existingDecisions ?? [],
          results:            savedRun.results_json,
        })
      }
    }

    const results = await runAnalysis(filteredRows as SearchTermRow[], date_range_days, existingKeywords, isBulk)

    let runData: any
    if (duplicate) {
      runData = duplicate
    } else {
      const summary = isBulk ? results.account.summary : (results as any).account.summary
      const { data: inserted, error: runError } = await supabase
        .from('ppc_analysis_runs').insert({
          org_id, brand: brand ?? null,
          asin: asins[0] ?? null,                         // [A6]
          report_start_date: startDate ?? null,            // [A6]
          report_end_date: endDate ?? null,                // [A6]
          run_name: run_name ?? autoRunName ?? `Analysis ${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}`,
          upload_ids, date_range_days,
          is_bulk_run: isBulk,
          portfolio: (selected_portfolios?.length === 1) ? selected_portfolios[0] : null,
          portfolio_roas:    summary.overall_roas,
          total_spend:       summary.total_spend,
          total_wasted:      summary.total_wasted,
          total_terms:       summary.total_terms,
          high_negatives:    isBulk ? (results.portfolio_health ?? []).reduce((s: number, p: any) => s + p.high_negatives, 0) : (results as any).account.phrase_high.length,
          medium_negatives:  isBulk ? (results.portfolio_health ?? []).reduce((s: number, p: any) => s + p.medium_negatives, 0) : (results as any).account.phrase_medium.length,
          harvest_candidates: isBulk ? (results.portfolio_health ?? []).reduce((s: number, p: any) => s + p.harvest_kw, 0) : (results as any).account.harvest_candidates.length,
          run_by: user.id,
        }).select().single()
      if (runError) throw runError
      runData = inserted
    }

    // [A4] Carry forward existing decisions
    const { data: existingDecisions } = await supabase
      .from('ppc_decisions_log')
      .select('term, match_type, status, campaign_names, notes, is_generic_flag, decided_at, portfolio')
      .eq('analysis_run_id', runData.id)
      .order('decided_at', { ascending: false })

    // ── SAVE RESULTS TO DB ───────────────────────────────────────────────────
    // Trim n-gram tables before saving — UI only shows top 20/20/15 anyway
    // Full tables are 14MB+; trimmed is ~285KB, well within Supabase 1MB limit
    const trimNgrams = (r: any) => r ? {
      ...r,
      ngrams: {
        uni: (r.ngrams?.uni ?? []).slice(0, 20),
        bi:  (r.ngrams?.bi  ?? []).slice(0, 20),
        tri: (r.ngrams?.tri ?? []).slice(0, 15),
      }
    } : r

    const resultsToSave = results.is_bulk ? {
      ...results,
      account: trimNgrams(results.account),
      portfolio_results: Object.fromEntries(
        Object.entries(results.portfolio_results ?? {}).map(([k, v]) => [k, trimNgrams(v)])
      ),
    } : trimNgrams(results)

    // Save results — failure here should not crash the response
    const saveError = await supabase
      .from('ppc_analysis_runs')
      .update({ results_json: resultsToSave, analysed_at: new Date().toISOString() })
      .eq('id', runData.id)
      .then(({ error }) => error?.message ?? null)

    if (saveError) {
      console.error('Failed to save results_json:', saveError)
      // Continue — return results even if save failed, user can still see them
    }

    return NextResponse.json({
      analysis_run_id:    runData.id,
      is_duplicate_run:   !!duplicate,   // [A3]
      from_cache:         false,
      save_failed:        !!saveError,
      analysed_at:        new Date().toISOString(),
      existing_decisions: existingDecisions ?? [],  // [A4]
      results,
    })

  } catch (err: any) {
    console.error('PPC analysis error:', err)
    return NextResponse.json({ error: err.message ?? 'Analysis failed' }, { status: 500 })
  }
}