// app/api/ppc/upload/route.ts
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

function parseFile(buffer: Buffer): Record<string, any>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames.find(n =>
    n.toLowerCase().includes('search') || n.toLowerCase().includes('sponsored')
  ) ?? wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const files           = formData.getAll('files') as File[]
    const orgId           = formData.get('org_id') as string
    const brand           = formData.get('brand') as string | null        // text, not FK
    const asin            = formData.get('asin') as string | null
    const campaignNames   = JSON.parse(formData.get('campaign_names') as string ?? '[]') as string[]
    const campaignTypes   = JSON.parse(formData.get('campaign_types') as string ?? '[]') as string[]
    const dateRangeDays   = parseInt(formData.get('date_range_days') as string)
    const reportStartDate = formData.get('report_start_date') as string | null
    const reportEndDate   = formData.get('report_end_date') as string | null

    if (!files.length || !orgId || !campaignNames.length || isNaN(dateRangeDays)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (files.length !== campaignNames.length) {
      return NextResponse.json({ error: 'Each file must have a corresponding campaign name' }, { status: 400 })
    }

    const uploadResults = []

    for (let i = 0; i < files.length; i++) {
      const file         = files[i]
      const campaignName = campaignNames[i]
      const campaignType = campaignTypes[i] ?? 'other'

      // Duplicate check
      if (reportStartDate && reportEndDate) {
        const { data: existing } = await supabase
          .from('ppc_uploads')
          .select('id')
          .eq('org_id', orgId)
          .eq('campaign_name', campaignName)
          .eq('report_start_date', reportStartDate)
          .eq('report_end_date', reportEndDate)
          .maybeSingle()

        if (existing) {
          return NextResponse.json({
            error: `Duplicate: "${campaignName}" for this date range already exists. Delete it first or use a different date range.`,
            duplicate: true,
            campaign_name: campaignName,
          }, { status: 409 })
        }
      }

      // Parse file
      const buffer  = Buffer.from(await file.arrayBuffer())
      const rawRows = parseFile(buffer)
      const rows    = rawRows.map(normaliseColumns).filter(r => r.search_term)

      if (!rows.length) {
        return NextResponse.json({ error: `No valid rows in: ${file.name}` }, { status: 400 })
      }

      // Save upload record
      const { data: upload, error: uploadError } = await supabase
        .from('ppc_uploads')
        .insert({
          org_id: orgId,
          brand:  brand ?? null,
          asin:   asin ?? null,
          campaign_name:     campaignName,
          campaign_type:     campaignType,
          date_range_days:   dateRangeDays,
          report_start_date: reportStartDate ?? null,
          report_end_date:   reportEndDate   ?? null,
          filename:          file.name,
          row_count:         rows.length,
          uploaded_by:       user.id,
        })
        .select()
        .single()

      if (uploadError) throw uploadError

      // Save search term rows in batches
      const termRows = rows.map(r => ({
        upload_id:       upload.id,
        org_id:          orgId,
        brand:           brand ?? null,
        campaign_name:   campaignName,
        search_term:     String(r.search_term).trim(),
        matched_keyword: r.matched_keyword ? String(r.matched_keyword).trim() : null,
        cost:            parseFloat(r.cost)      || 0,
        purchases:       parseInt(r.purchases)   || 0,
        sales:           parseFloat(r.sales)     || 0,
        roas:            parseFloat(r.cost) > 0  ? parseFloat(r.sales) / parseFloat(r.cost) : 0,
        impressions:     parseInt(r.impressions) || null,
        clicks:          parseInt(r.clicks)      || null,
        acos:            parseFloat(r.sales) > 0 ? parseFloat(r.cost) / parseFloat(r.sales) * 100 : null,
      }))

      const BATCH = 500
      for (let j = 0; j < termRows.length; j += BATCH) {
        const { error } = await supabase.from('ppc_search_terms').insert(termRows.slice(j, j + BATCH))
        if (error) throw error
      }

      uploadResults.push({ upload_id: upload.id, campaign_name: campaignName, row_count: rows.length })
    }

    return NextResponse.json({ success: true, uploads: uploadResults })

  } catch (err: any) {
    console.error('PPC upload error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 })
  }
}
