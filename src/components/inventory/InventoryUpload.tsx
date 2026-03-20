'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import {
  parseCsv, detectReportType, parseFbaInventory, parseAwdInventory,
  calcTrueInventory, calcBaseVelocity, calcFinalVelocity, calcPlanning,
  type InventorySnapshot, type SalesVelocity, type PlanningOutput
} from '@/lib/inventory'

type UploadedFile = {
  name: string
  type: 'fba_inventory' | 'awd_inventory' | 'sales_report' | 'unknown'
  rows: number
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
  data?: any
}

type SalesPeriod = 7 | 30 | 60 | 90

export default function InventoryUpload({ orgId, userEmail, onComplete }: {
  orgId: string
  userEmail: string
  onComplete: () => void
}) {
  const supabase = createClient()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().split('T')[0])
  const [result, setResult] = useState<{ asins: number; message: string } | null>(null)

  const handleFiles = useCallback((fileList: FileList) => {
    const newFiles: UploadedFile[] = []
    Array.from(fileList).forEach(file => {
      if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt') && !file.name.endsWith('.tsv')) return
      const reader = new FileReader()
      reader.onload = e => {
        const text = e.target?.result as string
        const { headers, rows } = parseCsv(text)
        const type = detectReportType(headers)
        setFiles(prev => [...prev, {
          name: file.name,
          type,
          rows: rows.length,
          status: 'pending',
          data: { text, headers, rows },
        }])
      }
      reader.readAsText(file)
    })
  }, [])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  function overrideType(i: number, type: UploadedFile['type']) {
    setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, type } : f))
  }

  async function processAll() {
    if (!orgId) { alert('No org found — check Supabase setup'); return }
    if (files.length === 0) { alert('Add files first'); return }
    setProcessing(true)
    setResult(null)

    const fbaFile = files.find(f => f.type === 'fba_inventory')
    const awdFile = files.find(f => f.type === 'awd_inventory')

    // Parse FBA data
    const fbaData: Record<string, Partial<InventorySnapshot>> = {}
    if (fbaFile?.data) {
      const parsed = parseFbaInventory(fbaFile.data.rows)
      parsed.forEach(p => { if (p.asin) fbaData[p.asin] = p })
    }

    // Parse AWD data
    const awdData: Record<string, Partial<InventorySnapshot>> = {}
    if (awdFile?.data) {
      const parsed = parseAwdInventory(awdFile.data.rows)
      parsed.forEach(p => { if (p.asin) awdData[p.asin] = p })
    }

    // Merge all ASINs
    const allAsins = new Set([...Object.keys(fbaData), ...Object.keys(awdData)])
    if (allAsins.size === 0) {
      setProcessing(false)
      setResult({ asins: 0, message: 'No ASINs found. Check your file format.' })
      return
    }

    // Get existing ASIN records from DB
    const { data: existingAsins } = await supabase
      .from('asins')
      .select('*')
      .eq('org_id', orgId)

    const asinMap: Record<string, any> = {}
    existingAsins?.forEach(a => { asinMap[a.asin] = a })

    // Get product master data for enrichment
    const { data: products } = await supabase
      .from('products')
      .select('sku_id, product_name, brand, category, asin, cbm')

    const productByAsin: Record<string, any> = {}
    products?.forEach(p => { if (p.asin) productByAsin[p.asin] = p })

    // Get supplier costs
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('sku_id, usd_per_unit, cbm, carton_qty, is_active')

    const supplierBySkuId: Record<string, any> = {}
    suppliers?.forEach(s => { if (s.is_active || !supplierBySkuId[s.sku_id]) supplierBySkuId[s.sku_id] = s })

    const snapshots: any[] = []
    const asinUpserts: any[] = []

    for (const asin of allAsins) {
      const fba = fbaData[asin] ?? {}
      const awd = awdData[asin] ?? {}
      const product = productByAsin[asin]
      const existingAsin = asinMap[asin]

      const snap: any = {
        org_id: orgId,
        snapshot_date: snapshotDate,
        asin,
        sku_id: fba.sku_id || existingAsin?.sku_id || product?.sku_id || '',
        product_name: fba.product_name || existingAsin?.product_name || product?.product_name || '',
        fba_fulfillable: fba.fba_fulfillable ?? 0,
        fba_unfulfillable: fba.fba_unfulfillable ?? 0,
        fba_inbound_working: fba.fba_inbound_working ?? 0,
        fba_inbound_shipped: fba.fba_inbound_shipped ?? 0,
        fba_inbound_receiving: fba.fba_inbound_receiving ?? 0,
        fba_reserved_customer_orders: fba.fba_reserved_customer_orders ?? 0,
        fba_reserved_fc_transfer: fba.fba_reserved_fc_transfer ?? 0,
        fba_reserved_fc_processing: 0,
        awd_available: awd.awd_available ?? 0,
        awd_inbound: awd.awd_inbound ?? 0,
        awd_outbound_to_fba: awd.awd_outbound_to_fba ?? 0,
        true_inventory_units: calcTrueInventory({ ...fba, ...awd }),
      }
      snapshots.push(snap)

      // Upsert ASIN record
      asinUpserts.push({
        org_id: orgId,
        asin,
        sku_id: snap.sku_id,
        product_name: snap.product_name,
        brand: existingAsin?.brand || product?.brand || '',
        category: existingAsin?.category || product?.category || '',
        lead_time_manufacturing: existingAsin?.lead_time_manufacturing ?? 40,
        lead_time_shipping_awd: existingAsin?.lead_time_shipping_awd ?? 30,
        lead_time_awd_to_fba: existingAsin?.lead_time_awd_to_fba ?? 14,
        target_coverage_days: existingAsin?.target_coverage_days ?? 150,
        fba_buffer_days: existingAsin?.fba_buffer_days ?? 30,
        team_push_multiplier: existingAsin?.team_push_multiplier ?? 1.0,
        team_push_notes: existingAsin?.team_push_notes ?? '',
        keyword_1: existingAsin?.keyword_1 ?? '',
        keyword_2: existingAsin?.keyword_2 ?? '',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
    }

    // Save snapshots
    const { error: snapError } = await supabase
      .from('inventory_snapshots')
      .upsert(snapshots, { onConflict: 'org_id,asin,snapshot_date' })

    if (snapError) {
      setProcessing(false)
      setResult({ asins: 0, message: 'Error saving snapshots: ' + snapError.message })
      return
    }

    // Upsert ASINs
    await supabase.from('asins').upsert(asinUpserts, { onConflict: 'org_id,asin' })

    // Generate placeholder velocity if not provided
    // (real velocity comes from sales report upload)
    const { data: existingVel } = await supabase
      .from('sales_velocity')
      .select('asin')
      .eq('org_id', orgId)
      .eq('snapshot_date', snapshotDate)

    const existingVelAsins = new Set(existingVel?.map(v => v.asin) ?? [])
    const velInserts: any[] = []

    for (const snap of snapshots) {
      if (existingVelAsins.has(snap.asin)) continue
      // Get team push from asin record
      const asinRec = asinUpserts.find(a => a.asin === snap.asin)
      const teamPush = asinRec?.team_push_multiplier ?? 1.0
      // Placeholder velocity — will be updated when sales report uploaded
      velInserts.push({
        org_id: orgId,
        asin: snap.asin,
        snapshot_date: snapshotDate,
        units_7d: 0, units_30d: 0, units_60d: 0, units_90d: 0,
        velocity_7d: 0, velocity_30d: 0, velocity_60d: 0, velocity_90d: 0,
        base_velocity: 0,
        seasonality_multiplier: 1.0,
        search_trend_multiplier: 1.0,
        team_push_multiplier: teamPush,
        final_velocity: 0,
      })
    }

    if (velInserts.length > 0) {
      await supabase.from('sales_velocity').upsert(velInserts, { onConflict: 'org_id,asin,snapshot_date' })
    }

    // Generate planning output
    const planInserts: any[] = []
    for (const snap of snapshots) {
      const asinRec = asinUpserts.find(a => a.asin === snap.asin)
      if (!asinRec) continue
      const { data: velRec } = await supabase
        .from('sales_velocity')
        .select('*')
        .eq('org_id', orgId)
        .eq('asin', snap.asin)
        .eq('snapshot_date', snapshotDate)
        .single()

      const finalVel = velRec?.final_velocity ?? 0
      const skuId = snap.sku_id
      const supplier = skuId ? supplierBySkuId[skuId] : null
      const unitCost = supplier?.usd_per_unit ?? 0
      const cbmPerUnit = supplier && supplier.carton_qty > 0 ? (supplier.cbm / supplier.carton_qty) : 0

      const planCalc = calcPlanning(asinRec, snap.true_inventory_units, finalVel, unitCost, cbmPerUnit)
      planInserts.push({ org_id: orgId, asin: snap.asin, snapshot_date: snapshotDate, ...planCalc })
    }

    if (planInserts.length > 0) {
      await supabase.from('planning_output').upsert(planInserts, { onConflict: 'org_id,asin,snapshot_date' })
    }

    // Log upload
    await supabase.from('upload_log').insert({
      org_id: orgId,
      uploaded_by: userEmail,
      file_name: files.map(f => f.name).join(', '),
      file_type: files.map(f => f.type).join(', '),
      rows_processed: snapshots.length,
      snapshot_date: snapshotDate,
      status: 'success',
    })

    setProcessing(false)
    setFiles([])
    setResult({ asins: snapshots.length, message: `Successfully processed ${snapshots.length} ASINs for ${snapshotDate}` })
  }

  const typeLabels: Record<string, string> = {
    fba_inventory: '📦 FBA Inventory',
    awd_inventory: '🏭 AWD Inventory',
    sales_report: '📈 Sales Report',
    unknown: '❓ Unknown',
  }

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Upload Amazon Reports</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Upload your weekly Amazon reports. The app auto-detects each file type.
        </div>
      </div>

      {/* Instructions */}
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: 'var(--text2)' }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>📋 Which files to download from Amazon:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
          <div>① <strong>FBA Inventory</strong> — Seller Central → Reports → Fulfilment → Inventory → All Inventory</div>
          <div>② <strong>AWD Inventory</strong> — Seller Central → Inventory → AWD → Download inventory</div>
        </div>
      </div>

      {/* Snapshot date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Snapshot Date</label>
        <input
          type="date"
          value={snapshotDate}
          onChange={e => setSnapshotDate(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font)', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', outline: 'none' }}
        />
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>Usually today or Monday of this week</span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border2)'}`,
          borderRadius: 10, padding: '32px 20px', textAlign: 'center',
          background: dragging ? 'var(--accent-light)' : 'var(--surface2)',
          transition: 'all .15s', cursor: 'pointer', marginBottom: 16,
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input id="file-input" type="file" accept=".csv,.txt,.tsv" multiple style={{ display: 'none' }}
          onChange={e => e.target.files && handleFiles(e.target.files)} />
        <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: dragging ? 'var(--accent)' : 'var(--text2)', marginBottom: 4 }}>
          Drop files here or click to browse
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>Accepts CSV, TSV, TXT — Amazon report format</div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 8
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{f.rows} rows</div>
              </div>
              <select
                value={f.type}
                onChange={e => overrideType(i, e.target.value as UploadedFile['type'])}
                style={{ padding: '5px 9px', border: `1px solid ${f.type === 'unknown' ? '#c06b00' : 'var(--border)'}`, borderRadius: 5, fontFamily: 'var(--font)', fontSize: 12, background: f.type === 'unknown' ? 'var(--orange-light)' : 'var(--surface2)', color: 'var(--text)', outline: 'none' }}
              >
                <option value="fba_inventory">📦 FBA Inventory</option>
                <option value="awd_inventory">🏭 AWD Inventory</option>
                <option value="sales_report">📈 Sales Report</option>
                <option value="unknown">❓ Unknown</option>
              </select>
              <button className="btn-icon" style={{ color: 'var(--red)' }} onClick={() => removeFile(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          background: result.asins > 0 ? 'var(--accent-light)' : 'var(--orange-light)',
          border: `1px solid ${result.asins > 0 ? 'rgba(26,107,60,.3)' : 'rgba(192,107,0,.3)'}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13
        }}>
          {result.asins > 0 ? '✓ ' : '⚠ '}{result.message}
          {result.asins > 0 && (
            <button className="btn-secondary" style={{ marginLeft: 16, fontSize: 12, padding: '4px 10px' }} onClick={onComplete}>
              View Dashboard →
            </button>
          )}
        </div>
      )}

      {/* Process button */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          className="btn-primary"
          onClick={processAll}
          disabled={processing || files.length === 0}
          style={{ opacity: processing || files.length === 0 ? 0.6 : 1 }}
        >
          {processing ? '⟳ Processing…' : `Process ${files.length} file${files.length !== 1 ? 's' : ''}`}
        </button>
        {files.length > 0 && (
          <button className="btn-secondary" onClick={() => setFiles([])}>Clear all</button>
        )}
      </div>

      {/* Upload history */}
      <UploadHistory orgId={orgId} />
    </div>
  )
}

function UploadHistory({ orgId }: { orgId: string }) {
  const supabase = createClient()
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    if (!orgId) return
    supabase.from('upload_log').select('*').eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setLogs(data ?? []))
  }, [orgId])

  if (!logs.length) return null

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 10 }}>Recent Uploads</div>
      {logs.map(l => (
        <div key={l.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <span style={{ color: l.status === 'success' ? 'var(--accent)' : 'var(--red)' }}>{l.status === 'success' ? '✓' : '✕'}</span>
          <span style={{ color: 'var(--text2)' }}>{l.snapshot_date}</span>
          <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{l.file_name}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{l.rows_processed} ASINs</span>
          <span style={{ color: 'var(--text3)', fontSize: 11 }}>{l.uploaded_by?.split('@')[0]}</span>
        </div>
      ))}
    </div>
  )
}

// Need useEffect for UploadHistory
import { useEffect } from 'react'
