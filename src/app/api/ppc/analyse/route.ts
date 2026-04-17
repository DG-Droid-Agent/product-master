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

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w => w.length > 1 || /[a-z]/.test(w)) ?? []
  if (words.length < n) return []
  return Array.from({ length: words.length - n + 1 }, (_, i) => words.slice(i, i + n).join(' '))
}

// Extract core product words from portfolio name
// e.g. "Utensil Holder w/Hooks B07KWRCXP5" -> ["utensil","holder","hooks"]
function extractPortfolioCore(portfolioName: string): Set<string> {
  const stop = new Set(['with','and','the','for','all','new','top','set','pro','kit','pack','best','our','sp','kw','kwds','broad','exact','phrase','auto','mod','rnk','st','sb','sd'])
  const asinPat = /^[A-Z0-9]{10}$/
  const words = (portfolioName || '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(words.filter(w => w.length > 2 && !stop.has(w) && !asinPat.test(w.toUpperCase())))
}

// Per-campaign breakdown for a search term or n-gram
function getCampBreakdown(
  ngram: string,
  rows: SearchTermRow[],
  campaigns: string[],
  exactMatch = false
): { name: string; spend: number; sales: number; roas: number; orders: number; clicks: number }[] {
  return campaigns.map(c => {
    const cr = rows.filter(r =>
      r.campaign_name === c &&
      (exactMatch ? r.search_term.toLowerCase() === ngram : r.search_term.toLowerCase().includes(ngram))
    )
    if (!cr.length) return null
    const cs = cr.reduce((s, r) => s + r.cost, 0)
    const ss = cr.reduce((s, r) => s + r.sales, 0)
    const op = cr.reduce((s, r) => s + r.purchases, 0)
    const ck = cr.reduce((s, r) => s + ((r as any).clicks ?? 0), 0)
    if (cs === 0) return null
    return { name: c, spend: cs, sales: ss, roas: ss / cs, orders: op, clicks: ck }
  }).filter(Boolean) as { name: string; spend: number; sales: number; roas: number; orders: number; clicks: number }[]
}

// Recommended campaigns to negate: spend >= $10 AND ROAS < 1.0
function getRecommendedNegates(bd: { name: string; spend: number; roas: number }[]): string[] {
  return bd.filter(c => c.spend >= 10 && c.roas < 1.0).map(c => c.name)
}

// N-gram table built on AGGREGATED rows
function buildNgramTable(agg: (SearchTermRow & { clicks?: number })[], n: number) {
  const buckets = new Map<string, { cost: number; sales: number; purchases: number; wasted: number; clicks: number; count: number }>()
  for (const row of agg) {
    const wasted = row.purchases === 0 ? row.cost : 0
    for (const gram of getNgrams(row.search_term, n)) {
      const b = buckets.get(gram) ?? { cost: 0, sales: 0, purchases: 0, wasted: 0, clicks: 0, count: 0 }
      b.cost += row.cost; b.sales += row.sales; b.purchases += row.purchases
      b.wasted += wasted; b.clicks += (row.clicks ?? 0); b.count += 1
      buckets.set(gram, b)
    }
  }
  return Array.from(buckets.entries()).map(([ngram, b]) => ({
    ngram, appearances: b.count, total_cost: b.cost, wasted_spend: b.wasted,
    total_sales: b.sales, purchases: b.purchases, clicks: b.clicks,
    roas:      b.cost > 0 ? b.sales / b.cost : 0,
    acos:      b.sales > 0 ? b.cost / b.sales * 100 : b.cost > 0 ? 100 : 0,
    waste_pct: b.cost > 0 ? b.wasted / b.cost : 0,
  })).sort((a, b) => b.wasted_spend - a.wasted_spend)
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
  for (const [expr, b] of exprMap.entries()) {
    const roas = b.cost > 0 ? b.sales / b.cost : 0
    if (b.cost >= 10 && roas < 1.0) {
      ptNegatives.push({ pt_expression: expr, total_spend: b.cost, total_sales: b.sales, orders: b.orders, roas, priority: 'HIGH', campaigns: b.campaigns })
    }
    if (b.orders >= 3 && b.cost >= 20 && roas >= 3.0) {
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

// ── SOTA KEYWORD ANALYSIS ─────────────────────────────────────────────────────
//
// METHODOLOGY:
// 1. Term-level exact negatives: specific bad search terms (30+ clicks OR $15+ spend, 0 purchases)
// 2. N-gram phrase negatives: only when 30+ aggregate clicks AND no campaign converts the n-gram well
// 3. Portfolio product word protection: words from portfolio name are never flagged
// 4. Per-campaign-type scoping: recommend negating only in campaigns where the term performs poorly
// 5. Harvest candidates: high-ROAS, high-spend terms to push to Exact/Phrase/Broad
// 6. Toxic combos: word combinations that waste despite each word converting alone

function analyseKeywords(rows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[], portfolioName = '') {
  const campaigns = [...new Set(rows.map(r => r.campaign_name))]

  // Step 1: Aggregate by search term across all campaigns
  const aggMap = new Map<string, SearchTermRow & { clicks: number }>()
  for (const row of rows) {
    const ex = aggMap.get(row.search_term)
    if (ex) {
      ex.cost += row.cost; ex.purchases += row.purchases; ex.sales += row.sales
      ex.clicks += ((row as any).clicks ?? 0)
    } else {
      aggMap.set(row.search_term, { ...row, clicks: (row as any).clicks ?? 0 })
    }
  }
  const agg = Array.from(aggMap.values())

  // Step 2: Build n-gram tables
  const uni = buildNgramTable(agg, 1)
  const bi  = buildNgramTable(agg, 2)
  const tri = buildNgramTable(agg, 3)

  // Step 3: Core term protection (3 layers)
  // A) Top-20 unigrams by spend with ROAS >= 2.0
  const coreBySpend = new Set(
    [...uni].sort((a, b) => b.total_cost - a.total_cost).slice(0, 20)
      .filter(u => u.roas >= 2.0 && u.ngram.length >= 3).map(u => u.ngram)
  )
  // B) Product words extracted from portfolio name
  const coreFromPortfolio = extractPortfolioCore(portfolioName)
  // C) Any unigram converting at ROAS >= 2.0 in ANY campaign with $5+ spend
  const coreByPerformance = new Set<string>()
  for (const u of uni) {
    if (u.ngram.length < 3) continue  // skip 1-2 char words (a, b, xl, oz etc)
    for (const c of campaigns) {
      const cr = rows.filter(r => r.campaign_name === c && r.search_term.toLowerCase().includes(u.ngram))
      const cs = cr.reduce((s, r) => s + r.cost, 0)
      const ss = cr.reduce((s, r) => s + r.sales, 0)
      if (cs >= 5 && ss / cs >= 2.0) { coreByPerformance.add(u.ngram); break }
    }
  }
  const core = new Set([...coreBySpend, ...coreFromPortfolio, ...coreByPerformance])

  const existingKwSet = new Set(existingKeywords.map(k => k.toLowerCase().trim()).filter(k => k !== 'close-match'))
  const phraseNegDict = new Map<string, string>()

  // ── A: TERM-LEVEL EXACT NEGATIVES ──────────────────────────────────────────
  // Specific search terms that are definitively non-converting
  const exactNegatives = agg
    .filter(r => {
      if (r.purchases > 0) return false
      const qualifiesBySpend  = r.cost >= 15
      const qualifiesByClicks = (r.clicks ?? 0) >= 30
      if (!qualifiesBySpend && !qualifiesByClicks) return false
      // Exclude if any single campaign converts this exact term well
      for (const c of campaigns) {
        const cr = rows.filter(rr => rr.campaign_name === c && rr.search_term === r.search_term)
        const cs = cr.reduce((s, rr) => s + rr.cost, 0)
        const ss = cr.reduce((s, rr) => s + rr.sales, 0)
        if (cs >= 5 && ss / cs >= 2.0) return false
      }
      return true
    })
    .sort((a, b) => b.cost - a.cost)
    .map(row => {
      const tl       = row.search_term.toLowerCase()
      const campBD   = getCampBreakdown(tl, rows, campaigns, true)
      const recCamps = getRecommendedNegates(campBD)
      const matches  = Array.from(phraseNegDict.keys()).filter(p => tl.includes(p))
      const highMed  = matches.filter(p => ['HIGH','MEDIUM'].includes(phraseNegDict.get(p)!))
      return {
        search_term: row.search_term, cost: row.cost, wasted_spend: row.cost,
        clicks: row.clicks ?? 0, roas: 0, acos: 100,
        coverage: highMed.length > 0 ? 'Covered by phrase' : matches.length > 0 ? 'Partial' : 'Not covered',
        covered_by: (highMed.length > 0 ? highMed : matches).join(', '),
        campaigns: campBD.map(c => c.name).join(', '),
        camp_breakdown: campBD,
        recommended_scope: recCamps.join(', ') || campBD.map(c => c.name).join(', '),
      }
    })

  // ── B: N-GRAM PHRASE NEGATIVES ─────────────────────────────────────────────
  const phraseCandidates: any[] = []

  const processNgram = (row: any, ngramSize: number) => {
    const ng = row.ngram
    // Core protection
    if (ngramSize === 1 && core.has(ng)) return
    if (ngramSize > 1 && ng.split(' ').every((w: string) => core.has(w))) return

    // Statistical significance: 30+ aggregate clicks OR $25+ wasted
    const totalClicks = row.clicks ?? 0
    if (totalClicks < 30 && row.wasted_spend < 25) return

    // Priority classification
    const { roas, acos, wasted_spend: wasted } = row
    let priority: 'HIGH' | 'MEDIUM' | 'WATCH' | null = null
    if (roas < 1.0 || acos > 100) priority = 'HIGH'
    else if (roas < 1.5) priority = 'MEDIUM'
    else if (roas < 2.0) priority = 'WATCH'
    if (!priority) return

    // Per-campaign breakdown
    const campBD = getCampBreakdown(ng, rows, campaigns, false)

    // SOTA check: skip if ANY campaign converts this n-gram well
    if (campBD.some(c => c.spend >= 5 && c.roas >= 2.0)) return

    const recCamps = getRecommendedNegates(campBD)
    const negBroadAuto = campBD.filter(c => (c.name.toLowerCase().includes('broad') || c.name.toLowerCase().includes('auto')) && c.spend >= 10 && c.roas < 1.0).map(c => c.name)
    const negExact     = campBD.filter(c => c.name.toLowerCase().includes('exact') && c.spend >= 10 && c.roas < 1.0).map(c => c.name)
    const autoSpend    = campBD.filter(c => c.name.toLowerCase().includes('auto')).reduce((s, c) => s + c.spend, 0)
    const broadSpend   = campBD.filter(c => c.name.toLowerCase().includes('broad')).reduce((s, c) => s + c.spend, 0)
    const autoSales    = campBD.filter(c => c.name.toLowerCase().includes('auto')).reduce((s, c) => s + c.sales, 0)
    const broadSales   = campBD.filter(c => c.name.toLowerCase().includes('broad')).reduce((s, c) => s + c.sales, 0)

    phraseCandidates.push({
      ...row, priority,
      ngram_type: ngramSize === 1 ? 'Unigram' : ngramSize === 2 ? 'Bigram' : 'Trigram',
      camp_breakdown: campBD,
      recommended_scope: recCamps.join(', ') || campBD.filter(c => c.spend > 0).map(c => c.name).join(', '),
      negate_broad_auto: negBroadAuto.join(', '),
      negate_exact: negExact.join(', '),
      auto_spend: autoSpend, broad_spend: broadSpend,
      auto_roas:  autoSpend  > 0 ? autoSales  / autoSpend  : 0,
      broad_roas: broadSpend > 0 ? broadSales / broadSpend : 0,
    })
    phraseNegDict.set(ng, priority)
  }

  for (const row of uni) processNgram(row, 1)
  for (const row of [...bi, ...tri]) processNgram(row, row.ngram.split(' ').length)

  const phraseHigh   = phraseCandidates.filter(p => p.priority === 'HIGH').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)
  const phraseMedium = phraseCandidates.filter(p => p.priority === 'MEDIUM').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)
  const phraseWatch  = phraseCandidates.filter(p => p.priority === 'WATCH').sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)

  // ── C: TOXIC COMBOS ────────────────────────────────────────────────────────
  const goodWords = new Set(uni.filter(u => u.roas >= 2.0).map(u => u.ngram))
  const toxicCombos = [...bi, ...tri]
    .filter(row => row.roas < 1.0 && row.ngram.split(' ').every((w: string) => goodWords.has(w)))
    .map(row => {
      const campBD   = getCampBreakdown(row.ngram, rows, campaigns, false)
      const recCamps = campBD.filter(c => c.roas < 1.0 && c.spend >= 10).map(c => c.name)
      return { ...row, combo_type: row.ngram.split(' ').length === 2 ? 'bigram' : 'trigram', reason: `Each word ROAS≥2.0 but combined ROAS=${row.roas.toFixed(2)}`, priority: 'HIGH', recommended_scope: recCamps.join(', ') || campaigns.join(', '), camp_breakdown: campBD }
    })
    .sort((a: any, b: any) => b.wasted_spend - a.wasted_spend)

  // ── D: HARVEST CANDIDATES ──────────────────────────────────────────────────
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
      const campBD = getCampBreakdown(tl, rows, campaigns, true)
      return {
        search_term: row.search_term, purchases: p, cost: row.cost, sales: row.sales, roas,
        acos: row.cost / row.sales, conviction: roas * row.cost,
        confidence: p >= 10 && roas >= 5 ? '⭐⭐⭐ HIGH' : p >= 5 && roas >= 3 ? '⭐⭐ MEDIUM' : '⭐ EMERGING',
        match_types: matchTypes.join(', '),
        existing_targeting: isExact ? '⚠️ Already targeted' : partial.length > 0 ? `⚡ Partially covered: ${partial.join(', ')}` : '🆕 New — not targeted',
        campaign_breakdown: campBD.map(c => `${c.name}: ${c.orders} orders @ ROAS ${c.roas.toFixed(1)}x`).join(' | '),
        avg_order_value: avgOV,
        suggested_bid: Math.min(3.00, Math.max(0.20, +(avgOV * TARGET_ACOS).toFixed(2))),
        generic_flag: genericFlag(row.search_term),
      }
    })
    .sort((a: any, b: any) => b.conviction - a.conviction)

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  const totalCost   = agg.reduce((s, r) => s + r.cost, 0)
  const totalSales  = agg.reduce((s, r) => s + r.sales, 0)
  const totalWasted = agg.reduce((s, r) => s + (r.purchases === 0 ? r.cost : 0), 0)
  const addressable = phraseHigh.reduce((s: number, r: any) => s + r.wasted_spend, 0)
                    + phraseMedium.reduce((s: number, r: any) => s + r.wasted_spend, 0)
                    + exactNegatives.filter(e => e.coverage !== 'Covered by phrase').reduce((s, r) => s + r.wasted_spend, 0)

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

async function runPortfolioAnalysis(rows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[], portfolioName = '') {
  const kwRows = rows.filter(r => r.targeting_type !== 'pt')
  const ptRows = rows.filter(r => r.targeting_type === 'pt')
  const campaigns = [...new Set(rows.map(r => r.campaign_name))]
  const kwResult  = analyseKeywords(kwRows.length ? kwRows : rows, dateRangeDays, existingKeywords, portfolioName)
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
    if (!upload_ids?.length || !date_range_days || !org_id) {
      return NextResponse.json({ error: 'Missing: upload_ids, date_range_days, org_id' }, { status: 400 })
    }

    // Fetch upload metadata
    const { data: uploadMeta } = await supabase.from('ppc_uploads')
      .select('asin, report_start_date, report_end_date, campaign_name, is_bulk_file')
      .in('id', upload_ids)

    // [A3] Check if this portfolio already has a saved run — reuse it
    // Use .contains() for array column — .in() does not work on array columns
    const { data: runMatches } = await supabase
      .from('ppc_analysis_runs')
      .select('id, results_json, analysed_at, upload_ids')
      .eq('org_id', org_id)
      .eq('portfolio', portfolio)
      .eq('is_bulk_run', true)
      .order('run_at', { ascending: false })
      .limit(20)

    // Exact upload_ids match in JS
    const sortedInput = [...upload_ids].sort().join(',')
    const existingRun = (runMatches ?? []).find((r: any) =>
      [...(r.upload_ids ?? [])].sort().join(',') === sortedInput
    ) ?? null

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

    // Fetch rows — filter by portfolio if provided (bulk), otherwise fetch all
    const allRows: any[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      let query = supabase
        .from('ppc_search_terms')
        .select('search_term, campaign_name, portfolio, targeting_type, pt_expression, cost, purchases, sales, matched_keyword')
        .in('upload_id', upload_ids)
        .eq('org_id', org_id)
      if (portfolio) query = query.eq('portfolio', portfolio)
      const { data, error } = await query.range(offset, offset + PAGE - 1)
      if (error) throw error
      if (data?.length) allRows.push(...data)
      if (!data?.length || data.length < PAGE) break
      offset += PAGE
    }

    if (!allRows.length) return NextResponse.json({ error: `No data found for this upload` }, { status: 404 })

    const existingKeywords = [...new Set(allRows.map((r: any) => r.matched_keyword).filter(Boolean))] as string[]
    const results = await runPortfolioAnalysis(allRows as SearchTermRow[], date_range_days, existingKeywords, portfolio ?? '')

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
          portfolio: portfolio || null,
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

    // Build portfolio health for sidebar — deduplicate by portfolio name, keep most recent
    const seenPortfolios = new Set<string>()
    const portfolioRuns = (runs ?? [])
      .filter((r: any) => r.portfolio)
      .filter((r: any) => {
        if (seenPortfolios.has(r.portfolio)) return false
        seenPortfolios.add(r.portfolio)
        return true
      })
      .map((r: any) => {
        const wasted_pct = r.total_spend > 0 ? r.total_wasted / r.total_spend : 0
        const high       = r.high_negatives ?? 0
        return {
          portfolio:          r.portfolio,
          run_id:             r.id,
          analysed_at:        r.analysed_at,
          total_spend:        r.total_spend,
          total_wasted:       r.total_wasted,
          wasted_pct,
          high_negatives:     high,
          harvest_candidates: r.harvest_candidates,
          has_results:        !!r.results_json,
          health: wasted_pct > 0.30 || high > 3 ? 'red' : wasted_pct > 0.15 || high > 0 ? 'amber' : 'green',
        }
      })

    return NextResponse.json({ portfolio_runs: portfolioRuns })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
