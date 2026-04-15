// app/api/ppc/decisions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const orgId     = searchParams.get('org_id')
    const brand     = searchParams.get('brand')
    const status    = searchParams.get('status')
    const matchType = searchParams.get('match_type')
    const runId     = searchParams.get('analysis_run_id')
    const limit     = parseInt(searchParams.get('limit') ?? '100')
    const offset    = parseInt(searchParams.get('offset') ?? '0')

    if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    let query = supabase
      .from('ppc_decisions_log')
      .select(`*, analysis_run:analysis_run_id(run_name, run_at)`, { count: 'exact' })
      .eq('org_id', orgId)
      .order('decided_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (brand)     query = query.eq('brand', brand)
    if (status)    query = query.eq('status', status)
    if (matchType) query = query.eq('match_type', matchType)
    if (runId)     query = query.eq('analysis_run_id', runId)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({ decisions: data, total: count })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { org_id, brand, analysis_run_id, decisions } = await request.json()
    if (!org_id || !analysis_run_id || !decisions?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const rows = decisions.map((d: any) => ({
      org_id,
      brand:                 brand ?? null,
      analysis_run_id,
      term:                  d.term,
      match_type:            d.match_type,
      priority:              d.priority ?? null,
      campaign_names:        d.campaign_names,
      roas_at_decision:      d.roas_at_decision ?? null,
      wasted_at_decision:    d.wasted_at_decision ?? null,
      purchases_at_decision: d.purchases_at_decision ?? null,
      status:                d.status ?? 'pending',
      decided_by:            user.id,
      decided_at:            new Date().toISOString(),
      actioned_at:           d.status === 'actioned' ? new Date().toISOString() : null,
      actioned_by:           d.status === 'actioned' ? user.id : null,
      notes:                 d.notes ?? null,
      is_generic_flag:       d.is_generic_flag ?? false,
    }))

    const { data, error } = await supabase.from('ppc_decisions_log').insert(rows).select()
    if (error) throw error

    return NextResponse.json({ saved: data?.length ?? 0, decisions: data })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { ids, status, notes } = await request.json()
    if (!ids?.length || !status) {
      return NextResponse.json({ error: 'ids[] and status required' }, { status: 400 })
    }

    const valid = ['pending','actioned','not_actioning','reversed']
    if (!valid.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${valid.join(', ')}` }, { status: 400 })
    }

    const payload: Record<string, any> = { status }
    if (notes !== undefined) payload.notes = notes
    if (status === 'actioned') {
      payload.actioned_at = new Date().toISOString()
      payload.actioned_by = user.id
    }

    const { data, error } = await supabase
      .from('ppc_decisions_log').update(payload).in('id', ids).select()
    if (error) throw error

    return NextResponse.json({ updated: data?.length ?? 0, decisions: data })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
