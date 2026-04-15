// app/api/ppc/analyse/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface SearchTermRow {
  search_term: string
  campaign_name: string
  cost: number
  purchases: number
  sales: number
  matched_keyword?: string
}

interface NGramResult {
  ngram: string
  appearances: number
  total_cost: number
  wasted_spend: number
  total_sales: number
  purchases: number
  roas: number
  acos: number
  waste_pct: number
}

const MATERIAL_MODIFIERS = new Set([
  'coir','coco','natural','jute','sisal','bamboo','rubber','pvc','polypropylene','nylon'
])

function getNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g)?.filter(w => w.length > 1 || /[a-z]/.test(w)) ?? []
  if (words.length < n) return []
  return Array.from({ length: words.length - n + 1 }, (_, i) => words.slice(i, i + n).join(' '))
}

function buildNgramTable(rows: SearchTermRow[], n: number): NGramResult[] {
  const buckets = new Map<string, { cost: number; sales: number; purchases: number; wasted: number; count: number }>()
  for (const row of rows) {
    const wasted = row.purchases === 0 ? row.cost : 0
    for (const gram of getNgrams(row.search_term, n)) {
      const b = buckets.get(gram) ?? { cost:0, sales:0, purchases:0, wasted:0, count:0 }
      b.cost += row.cost; b.sales += row.sales; b.purchases += row.purchases
      b.wasted += wasted; b.count += 1
      buckets.set(gram, b)
    }
  }
  return Array.from(buckets.entries()).map(([ngram, b]) => ({
    ngram,
    appearances: b.count,
    total_cost:    b.cost,
    wasted_spend:  b.wasted,
    total_sales:   b.sales,
    purchases:     b.purchases,
    roas:      b.cost > 0 ? b.sales / b.cost : 0,
    acos:      b.sales > 0 ? b.cost / b.sales * 100 : b.cost > 0 ? 100 : 0,
    waste_pct: b.cost > 0 ? b.wasted / b.cost : 0,
  })).sort((a, b) => b.wasted_spend - a.wasted_spend)
}

function findCoreTerms(uni: NGramResult[]): Set<string> {
  return new Set(
    [...uni].sort((a, b) => b.total_cost - a.total_cost)
            .slice(0, 15)
            .filter(u => u.roas >= 2.0)
            .map(u => u.ngram)
  )
}

// ROAS < 1.0 OR ACOS > 100% ONLY — no waste% trigger
function classifyPriority(row: NGramResult, matchType: 'phrase' | 'exact', ngramSize: number): 'HIGH' | 'MEDIUM' | 'WATCH' | null {
  const { appearances, wasted_spend: wasted, roas, acos } = row
  const significant = matchType === 'phrase'
    ? (ngramSize === 1 ? (appearances >= 10 || wasted >= 25) : (appearances >= 20 || wasted >= 30))
    : (appearances >= 15 || wasted >= 15)
  if (!significant) return 'WATCH'
  if (roas < 1.0 || acos > 100) return 'HIGH'
  if (roas < 1.5) return 'MEDIUM'
  if (roas < 2.0) return 'WATCH'
  return null
}

function genericFlag(term: string): string {
  const words = term.trim().split(/\s+/)
  if (words.length === 1) return '⚠️ Generic — single word, too broad for niche product'
  if (words.length === 2 && !words.some(w => MATERIAL_MODIFIERS.has(w.toLowerCase())))
    return '⚠️ Generic — 2-word term without product-specific modifier'
  return ''
}

export async function runAnalysis(rows: SearchTermRow[], dateRangeDays: number, existingKeywords: string[]) {
  const campaigns = [...new Set(rows.map(r => r.campaign_name))]

  // Portfolio aggregation
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

  // ── PHRASE NEGATIVES ──────────────────────────────────────────────────────
  const phraseCandidates: any[] = []

  const processNgram = (row: NGramResult, ngramSize: number) => {
    if (row.ngram.split(' ').every(w => core.has(w))) return
    const pri = classifyPriority(row, 'phrase', ngramSize)
    if (!pri) return

    // Per-campaign ROAS — recommend only campaigns where ROAS < 1.0
    const recCamps = campaigns.filter(c => {
      const cr = rows.filter(r => r.campaign_name === c && r.search_term.toLowerCase().includes(row.ngram))
      const cs = cr.reduce((s, r) => s + r.cost, 0)
      const ss = cr.reduce((s, r) => s + r.sales, 0)
      return cs > 0 && ss / cs < 1.0
    })

    const autoRows  = rows.filter(r => r.campaign_name.toLowerCase().includes('auto')  && r.search_term.toLowerCase().includes(row.ngram))
    const broadRows = rows.filter(r => r.campaign_name.toLowerCase().includes('broad') && r.search_term.toLowerCase().includes(row.ngram))
    const autoSpend  = autoRows.reduce((s, r) => s + r.cost, 0)
    const broadSpend = broadRows.reduce((s, r) => s + r.cost, 0)

    phraseCandidates.push({
      ...row,
      priority: pri,
      ngram_type: ngramSize === 1 ? 'Unigram' : `${ngramSize}-gram`,
      campaigns: [autoSpend > 0 && 'auto', broadSpend > 0 && 'broad'].filter(Boolean).join(', '),
      auto_spend: autoSpend,
      broad_spend: broadSpend,
      auto_roas:  autoSpend  > 0 ? autoRows.reduce((s, r) => s + r.sales, 0) / autoSpend : 0,
      broad_roas: broadSpend > 0 ? broadRows.reduce((s, r) => s + r.sales, 0) / broadSpend : 0,
      recommended_scope: recCamps.length > 0 ? recCamps.join(', ') : campaigns.join(', '),
    })
  }

  for (const row of uni) { if (!core.has(row.ngram)) processNgram(row, 1) }
  for (const row of [...bi, ...tri]) processNgram(row, row.ngram.split(' ').length)

  const phraseHigh   = phraseCandidates.filter(p => p.priority === 'HIGH').sort((a, b) => b.wasted_spend - a.wasted_spend)
  const phraseMedium = phraseCandidates.filter(p => p.priority === 'MEDIUM').sort((a, b) => b.wasted_spend - a.wasted_spend)
  const phraseWatch  = phraseCandidates.filter(p => p.priority === 'WATCH').sort((a, b) => b.wasted_spend - a.wasted_spend)

  // ── EXACT NEGATIVES ───────────────────────────────────────────────────────
  const phraseNegDict = new Map(phraseCandidates.filter(p => ['HIGH','MEDIUM'].includes(p.priority)).map(p => [p.ngram, p.priority]))
  const exactNegatives = agg
    .filter(r => r.purchases === 0 && r.cost >= 15)
    .sort((a, b) => b.cost - a.cost)
    .map(row => {
      const tl      = row.search_term.toLowerCase()
      const matches = Array.from(phraseNegDict.keys()).filter(p => tl.includes(p))
      const highMed = matches.filter(p => ['HIGH','MEDIUM'].includes(phraseNegDict.get(p)!))
      const camps   = [...new Set(rows.filter(r => r.search_term.toLowerCase() === tl).map(r => r.campaign_name))]
      return {
        search_term: row.search_term, cost: row.cost, wasted_spend: row.cost,
        roas: 0, acos: 100,
        coverage:   highMed.length > 0 ? 'Covered' : matches.length > 0 ? 'Partial' : 'Not covered',
        covered_by: (highMed.length > 0 ? highMed : matches).join(', '),
        campaigns:  camps.join(', '),
      }
    })

  // ── TOXIC COMBOS ──────────────────────────────────────────────────────────
  const goodWords = new Set(uni.filter(u => u.roas >= 2.0).map(u => u.ngram))
  const toxicCombos = [...bi, ...tri]
    .filter(row => row.roas < 1.0 && row.ngram.split(' ').every(w => goodWords.has(w)))
    .map(row => ({ ...row, combo_type: row.ngram.split(' ').length === 2 ? 'bigram' : 'trigram', reason: `Each word ROAS≥2.0 but combined ROAS=${row.roas.toFixed(2)}` }))
    .sort((a, b) => b.wasted_spend - a.wasted_spend)

  // ── HARVEST CANDIDATES ────────────────────────────────────────────────────
  const TARGET_ACOS = 1 / 3.0
  const harvestCandidates = agg
    .filter(r => r.cost > 0 && r.sales / r.cost >= 3.0 && r.cost >= 20 && r.purchases >= 3)
    .map(row => {
      const roas = row.sales / row.cost
      const conviction = roas * row.cost
      const p = row.purchases
      const words = row.search_term.split(' ').length
      const matchTypes = [...(p >= 5 ? ['Exact'] : []), 'Phrase', ...(p >= 3 && words <= 2 ? ['Broad'] : [])]
      const tl = row.search_term.toLowerCase().trim()
      const isExact  = existingKwSet.has(tl)
      const partial  = !isExact ? [...existingKwSet].filter(k => k.includes(tl) || tl.includes(k)) : []
      const avgOV    = row.sales / p
      const campBreakdown = campaigns.map(c => {
        const cr = rows.filter(r => r.campaign_name === c && r.search_term.toLowerCase() === tl)
        const cs = cr.reduce((s, r) => s + r.cost, 0)
        const ss = cr.reduce((s, r) => s + r.sales, 0)
        const cp = cr.reduce((s, r) => s + r.purchases, 0)
        return cs > 0 ? `${c}: ${cp} orders @ ROAS ${(ss/cs).toFixed(1)}x` : null
      }).filter(Boolean).join(' | ')

      return {
        search_term: row.search_term, purchases: p, cost: row.cost, sales: row.sales,
        roas, acos: row.cost / row.sales, conviction,
        confidence: p >= 10 && roas >= 5 ? '⭐⭐⭐ HIGH' : p >= 5 && roas >= 3 ? '⭐⭐ MEDIUM' : '⭐ EMERGING',
        match_types: matchTypes.join(', '),
        existing_targeting: isExact ? '⚠️ Already targeted' : partial.length > 0 ? `⚡ Partially covered: ${partial.join(', ')}` : '🆕 New — not targeted',
        campaign_breakdown: campBreakdown,
        avg_order_value: avgOV,
        suggested_bid: Math.min(3.00, Math.max(0.20, +(avgOV * TARGET_ACOS).toFixed(2))),
        generic_flag: genericFlag(row.search_term),
      }
    })
    .sort((a, b) => b.conviction - a.conviction)

  const totalCost   = agg.reduce((s, r) => s + r.cost, 0)
  const totalSales  = agg.reduce((s, r) => s + r.sales, 0)
  const totalWasted = agg.reduce((s, r) => s + (r.purchases === 0 ? r.cost : 0), 0)
  const addressable = phraseHigh.reduce((s, r) => s + r.wasted_spend, 0)
                    + phraseMedium.reduce((s, r) => s + r.wasted_spend, 0)
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
    ngrams: { uni: uni.slice(0,20), bi: bi.slice(0,20), tri: tri.slice(0,15) },
    core_terms: [...core],
  }
}

// ── API ROUTE ─────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { upload_ids, date_range_days, org_id, brand, run_name } = await request.json()
    if (!upload_ids?.length || !date_range_days || !org_id) {
      return NextResponse.json({ error: 'Missing: upload_ids, date_range_days, org_id' }, { status: 400 })
    }

    const { data: termRows, error: termError } = await supabase
      .from('ppc_search_terms')
      .select('search_term, campaign_name, cost, purchases, sales, matched_keyword')
      .in('upload_id', upload_ids)
      .eq('org_id', org_id)

    if (termError) throw termError
    if (!termRows?.length) return NextResponse.json({ error: 'No data found for these uploads' }, { status: 404 })

    const existingKeywords = [...new Set(termRows.map((r: any) => r.matched_keyword).filter(Boolean))] as string[]
    const results = await runAnalysis(termRows as SearchTermRow[], date_range_days, existingKeywords)

    const { data: runData, error: runError } = await supabase
      .from('ppc_analysis_runs')
      .insert({
        org_id, brand: brand ?? null,
        run_name: run_name ?? `Analysis ${new Date().toLocaleDateString('en-GB')}`,
        upload_ids, date_range_days,
        portfolio_roas:    results.summary.overall_roas,
        total_spend:       results.summary.total_spend,
        total_wasted:      results.summary.total_wasted,
        total_terms:       results.summary.total_terms,
        high_negatives:    results.phrase_high.length,
        medium_negatives:  results.phrase_medium.length,
        harvest_candidates: results.harvest_candidates.length,
        run_by: user.id,
      })
      .select().single()

    if (runError) throw runError

    return NextResponse.json({ analysis_run_id: runData.id, results })

  } catch (err: any) {
    console.error('PPC analysis error:', err)
    return NextResponse.json({ error: err.message ?? 'Analysis failed' }, { status: 500 })
  }
}
