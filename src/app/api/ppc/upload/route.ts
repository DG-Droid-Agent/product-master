// app/api/ppc/upload/route.ts
// [U1] createServerSupabaseClient — fixes 401
// [U2] brand as text not FK
// [U3] duplicate upload blocked
// [U4] batch insert 500 rows
// NEW: detects bulk Amazon bulk file, splits by portfolio, tags targeting_type + pt_expression

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import * as XLSX from 'xlsx'

const COLUMN_MAP: Record<string, string[]> = {
  search_term:     ['customer search term', 'search term', 'query'],
  cost:            ['total cost (usd)', 'spend', 'cost', 'total spend'],
  purchases:       ['purchases', 'orders', '7 day total orders', 'total orders', 'units ordered'],
  sales:           ['sales (usd)', 'sales', '7 day total sales', 'total sales', 'revenue'],
  matched_keyword: ['keywords', 'keyword'],
  impressions:     ['impressions'],
  clicks:          ['clicks'],
}

function normaliseColumns(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  const rowLower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
  for (const [std, variants] of Object.entries(COLUMN_MAP)) {
    for (const v of variants) {
      if (rowLower[v] !== undefined) { result[std] = rowLower[v]; break }
    }
  }
  return result
}

function isBulkFile(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    return wb.SheetNames.includes('SP Search Term Report')
  } catch { return false }
}

function parseBulkFile(buffer: Buffer): { rows: any[]; portfolios: string[]; portfolioSummary: any[] } {
  const wb  = XLSX.read(buffer, { type: 'buffer' })
  const ws  = wb.Sheets['SP Search Term Report']
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[]
  const rows: any[] = []

  for (const r of raw) {
    const searchTerm   = String(r['Customer Search Term'] ?? '').trim()
    const campaignName = String(r['Campaign Name (Informational only)'] ?? '').trim()
    const portfolio    = String(r['Portfolio Name (Informational only)'] ?? '').trim() || 'Unassigned'
    const ptId         = r['Product Targeting ID']
    const keywordId    = r['Keyword ID']
    const ptExpr       = String(r['Product Targeting Expression'] ?? '').trim()
    const keywordText  = String(r['Keyword Text'] ?? '').trim()
    const spend        = parseFloat(r['Spend'])       || 0
    const sales        = parseFloat(r['Sales'])       || 0
    const orders       = parseInt(r['Orders'])        || 0
    const impressions  = parseInt(r['Impressions'])   || 0
    const clicks       = parseInt(r['Clicks'])        || 0

    if (!searchTerm || !campaignName) continue

    // Classification logic:
    // PT row = has a Product Targeting ID AND no Keyword ID
    // Keyword row = has a Keyword ID (even if also has PT ID — keyword wins)
    // Both IDs come through as numbers from XLSX — check for null/undefined/NaN/''/0
    const ptIdValid = ptId !== null && ptId !== undefined && ptId !== '' && !Number.isNaN(Number(ptId)) && Number(ptId) !== 0
    const kwIdValid = keywordId !== null && keywordId !== undefined && keywordId !== '' && !Number.isNaN(Number(keywordId)) && Number(keywordId) !== 0
    const targetingType: 'keyword' | 'pt' = (ptIdValid && !kwIdValid) ? 'pt' : 'keyword'

    rows.push({
      search_term:     searchTerm,
      campaign_name:   campaignName,
      portfolio,
      targeting_type:  targetingType,
      pt_expression:   targetingType === 'pt' ? ptExpr || null : null,
      matched_keyword: keywordText || null,
      cost:            spend,
      purchases:       orders,
      sales,
      roas:            spend > 0 ? sales / spend : 0,
      impressions,
      clicks,
      acos:            sales > 0 ? spend / sales * 100 : spend > 0 ? 100 : 0,
    })
  }

  const portfolios = [...new Set(rows.map(r => r.portfolio))].filter(p => p !== 'Unassigned').sort()

  // Build portfolio spend summary for the selector UI
  const portfolioStats: Record<string, { spend: number; rows: number; campaigns: Set<string> }> = {}
  for (const r of rows) {
    if (!r.portfolio || r.portfolio === 'Unassigned') continue
    if (!portfolioStats[r.portfolio]) portfolioStats[r.portfolio] = { spend: 0, rows: 0, campaigns: new Set() }
    portfolioStats[r.portfolio].spend += r.cost
    portfolioStats[r.portfolio].rows  += 1
    portfolioStats[r.portfolio].campaigns.add(r.campaign_name)
  }
  const portfolioSummary = Object.entries(portfolioStats)
    .map(([name, s]) => ({ name, spend: Math.round(s.spend * 100) / 100, rows: s.rows, campaigns: s.campaigns.size }))
    .sort((a, b) => b.spend - a.spend)

  return { rows, portfolios, portfolioSummary }
}

function parseIndividualFile(buffer: Buffer): any[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames.find(n =>
    n.toLowerCase().includes('search') || n.toLowerCase().includes('sponsored')
  ) ?? wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()                        // [U1]
    const { data: { session } } = await supabase.auth.getSession()      // [U5]
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = session.user

    const formData        = await request.formData()
    const files           = formData.getAll('files') as File[]
    const orgId           = formData.get('org_id') as string
    const brand           = formData.get('brand') as string | null       // [U2] text not FK
    const asin            = formData.get('asin') as string | null
    const campaignNames   = JSON.parse(formData.get('campaign_names') as string ?? '[]') as string[]
    const campaignTypes   = JSON.parse(formData.get('campaign_types') as string ?? '[]') as string[]
    const dateRangeDays   = parseInt(formData.get('date_range_days') as string)
    const reportStartDate = formData.get('report_start_date') as string | null
    const reportEndDate   = formData.get('report_end_date') as string | null

    if (!files.length || !orgId || isNaN(dateRangeDays)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const uploadResults = []

    for (let i = 0; i < files.length; i++) {
      const file   = files[i]
      const buffer = Buffer.from(await file.arrayBuffer())
      const bulk   = isBulkFile(buffer)

      if (bulk) {
        // ── BULK FILE ─────────────────────────────────────────────────────
        const bulkCampaignName = `BULK:${file.name}`

        // [U3] Bulk duplicate check FIRST — before parsing the file (saves 887MB + 19s)
        const { data: existingBulk } = await supabase
          .from('ppc_uploads').select('id, uploaded_at')
          .eq('org_id', orgId)
          .eq('campaign_name', bulkCampaignName)
          .order('uploaded_at', { ascending: false })
          .limit(1)
        if (existingBulk?.length) {
          const uploadedDate = new Date(existingBulk[0].uploaded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          return NextResponse.json({
            error: `This bulk file was already uploaded on ${uploadedDate}. Delete the existing upload in Supabase first if you want to re-upload.`,
            duplicate: true,
            campaign_name: bulkCampaignName,
            existing_upload_id: existingBulk[0].id,
          }, { status: 409 })
        }

        // Only parse the file after confirming it's not a duplicate
        const { rows, portfolios, portfolioSummary } = parseBulkFile(buffer)
        if (!rows.length) {
          return NextResponse.json({ error: `No valid rows in bulk file: ${file.name}` }, { status: 400 })
        }

        const { data: upload, error: uploadError } = await supabase
          .from('ppc_uploads').insert({
            org_id: orgId, brand: brand ?? null, asin: asin ?? null,
            campaign_name: bulkCampaignName, campaign_type: 'other',
            date_range_days: dateRangeDays,
            report_start_date: reportStartDate ?? null, report_end_date: reportEndDate ?? null,
            filename: file.name, row_count: rows.length, uploaded_by: user.id,
            is_bulk_file: true, portfolios, portfolio_summary: portfolioSummary,
          }).select().single()
        if (uploadError) throw uploadError

        const termRows = rows.map(r => ({
          upload_id: upload.id, org_id: orgId, brand: brand ?? null,
          campaign_name: r.campaign_name, portfolio: r.portfolio,
          targeting_type: r.targeting_type, pt_expression: r.pt_expression,
          search_term: r.search_term, matched_keyword: r.matched_keyword,
          cost: r.cost, purchases: r.purchases, sales: r.sales,
          roas: r.roas, impressions: r.impressions, clicks: r.clicks, acos: r.acos,
        }))

        const BATCH = 500  // [U4]
        for (let j = 0; j < termRows.length; j += BATCH) {
          const { error } = await supabase.from('ppc_search_terms').insert(termRows.slice(j, j + BATCH))
          if (error) throw error
        }

        uploadResults.push({ upload_id: upload.id, campaign_name: bulkCampaignName, row_count: rows.length, is_bulk: true, portfolios, portfolio_summary: portfolioSummary })

      } else {
        // ── INDIVIDUAL FILE ───────────────────────────────────────────────
        const campaignName = campaignNames[i] ?? file.name.replace(/\.(csv|xlsx)$/i, '')
        const campaignType = campaignTypes[i] ?? 'other'

        // [U3] duplicate check
        if (reportStartDate && reportEndDate) {
          const { data: existing } = await supabase
            .from('ppc_uploads').select('id')
            .eq('org_id', orgId).eq('campaign_name', campaignName)
            .eq('report_start_date', reportStartDate).eq('report_end_date', reportEndDate)
            .maybeSingle()
          if (existing) {
            return NextResponse.json({ error: `Duplicate: "${campaignName}" for this date range already exists.`, duplicate: true, campaign_name: campaignName }, { status: 409 })
          }
        }

        const rawRows = parseIndividualFile(buffer)
        const rows    = rawRows.map(normaliseColumns).filter(r => r.search_term)
        if (!rows.length) {
          return NextResponse.json({ error: `No valid rows in: ${file.name}` }, { status: 400 })
        }

        const { data: upload, error: uploadError } = await supabase
          .from('ppc_uploads').insert({
            org_id: orgId, brand: brand ?? null, asin: asin ?? null,
            campaign_name: campaignName, campaign_type: campaignType,
            date_range_days: dateRangeDays,
            report_start_date: reportStartDate ?? null, report_end_date: reportEndDate ?? null,
            filename: file.name, row_count: rows.length, uploaded_by: user.id,
            is_bulk_file: false,
          }).select().single()
        if (uploadError) throw uploadError

        const termRows = rows.map(r => ({
          upload_id: upload.id, org_id: orgId, brand: brand ?? null,
          campaign_name: campaignName, portfolio: null,
          targeting_type: 'keyword' as const, pt_expression: null,
          search_term: String(r.search_term).trim(),
          matched_keyword: r.matched_keyword ? String(r.matched_keyword).trim() : null,
          cost:        parseFloat(r.cost)      || 0,
          purchases:   parseInt(r.purchases)   || 0,
          sales:       parseFloat(r.sales)     || 0,
          roas:        parseFloat(r.cost) > 0  ? parseFloat(r.sales) / parseFloat(r.cost) : 0,
          impressions: parseInt(r.impressions) || null,
          clicks:      parseInt(r.clicks)      || null,
          acos:        parseFloat(r.sales) > 0 ? parseFloat(r.cost) / parseFloat(r.sales) * 100 : null,
        }))

        const BATCH = 500  // [U4]
        for (let j = 0; j < termRows.length; j += BATCH) {
          const { error } = await supabase.from('ppc_search_terms').insert(termRows.slice(j, j + BATCH))
          if (error) throw error
        }

        uploadResults.push({ upload_id: upload.id, campaign_name: campaignName, row_count: rows.length, is_bulk: false, portfolios: [] })
      }
    }

    return NextResponse.json({ success: true, uploads: uploadResults })

  } catch (err: any) {
    console.error('PPC upload error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 })
  }
}