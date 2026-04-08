// ── INVENTORY TYPES ───────────────────────────────────────────────────────────

export type Org = {
  id: string
  name: string
  slug: string
}

export type Asin = {
  id?: string
  org_id?: string
  asin: string
  sku_id?: string
  product_name?: string
  brand?: string
  category?: string
  lead_time_manufacturing: number   // days, default 40
  lead_time_shipping_awd: number    // days, default 30
  lead_time_awd_to_fba: number      // days, default 14
  target_coverage_days: number      // default 150
  fba_buffer_days: number           // default 30
  team_push_multiplier: number      // default 1.0
  team_push_notes?: string
  team_push_updated_at?: string
  keyword_1?: string
  keyword_2?: string
  is_active?: boolean
}

export type InventorySnapshot = {
  id?: string
  org_id?: string
  snapshot_date: string
  asin: string
  sku_id?: string
  product_name?: string
  // FBA
  fba_fulfillable: number
  fba_unfulfillable: number
  fba_inbound_working: number
  fba_inbound_shipped: number
  fba_inbound_receiving: number
  fba_reserved_customer_orders: number
  fba_reserved_fc_transfer: number
  fba_reserved_fc_processing: number
  // AWD
  awd_available: number
  awd_inbound: number
  awd_outbound_to_fba: number
  // Computed
  true_inventory_units: number
}

export type SalesVelocity = {
  id?: string
  org_id?: string
  asin: string
  snapshot_date: string
  units_7d: number
  units_30d: number
  units_60d: number
  units_90d: number
  velocity_7d: number
  velocity_30d: number
  velocity_60d: number
  velocity_90d: number
  base_velocity: number
  seasonality_multiplier: number
  search_trend_multiplier: number
  team_push_multiplier: number
  final_velocity: number
}

export type PlanningOutput = {
  id?: string
  org_id?: string
  asin: string
  snapshot_date: string
  true_inventory_units: number
  coverage_days: number
  target_coverage_days: number
  gap_days: number
  forward_window_days: number
  units_to_order: number
  units_to_send_fba: number
  units_to_send_awd: number
  status: 'critical' | 'order_soon' | 'watch' | 'healthy'
  urgency_days: number
  estimated_cost_usd: number
  estimated_cbm: number
}

export type PurchaseOrder = {
  id?: string
  org_id?: string
  po_number?: string
  supplier_name?: string
  status: 'draft' | 'confirmed' | 'in_production' | 'shipped' | 'received'
  raised_date?: string
  expected_ship_date?: string
  expected_awd_date?: string
  expected_fba_date?: string
  total_units: number
  total_cbm: number
  total_cost_usd: number
  notes?: string
  created_by?: string
  created_at?: string
  line_items?: PoLineItem[]
}

export type PoLineItem = {
  id?: string
  po_id?: string
  asin?: string
  sku_id?: string
  product_name?: string
  units: number
  cartons: number
  cbm: number
  unit_cost_usd: number
  total_cost_usd: number
}

export type UploadLog = {
  id?: string
  uploaded_by?: string
  file_name?: string
  file_type?: string
  rows_processed?: number
  snapshot_date?: string
  status?: string
  error_message?: string
  created_at?: string
}

// ── COMBINED VIEW (what the dashboard shows per ASIN) ─────────────────────────
export type InventoryRow = {
  asin: Asin
  snapshot?: InventorySnapshot
  velocity?: SalesVelocity
  planning?: PlanningOutput
}

// ── PLANNING ENGINE ───────────────────────────────────────────────────────────

export function calcTrueInventory(snap: Partial<InventorySnapshot>): number {
  return (
    (snap.fba_fulfillable ?? 0) +
    (snap.fba_inbound_shipped ?? 0) +
    (snap.fba_inbound_receiving ?? 0) +
    (snap.awd_available ?? 0) +
    (snap.awd_inbound ?? 0) +
    (snap.awd_outbound_to_fba ?? 0)
    // Intentionally exclude: fba_unfulfillable, fba_reserved_customer_orders
    // fba_inbound_working excluded (not confirmed shipped yet)
  )
}

export function calcBaseVelocity(v: Partial<SalesVelocity>): number {
  // Weighted: 7d×40% + 30d×30% + 60d×20% + 90d×10%
  return (
    (v.velocity_7d ?? 0) * 0.4 +
    (v.velocity_30d ?? 0) * 0.3 +
    (v.velocity_60d ?? 0) * 0.2 +
    (v.velocity_90d ?? 0) * 0.1
  )
}

export function calcFinalVelocity(
  baseVelocity: number,
  seasonality: number,
  searchTrend: number,
  teamPush: number
): number {
  return baseVelocity * seasonality * searchTrend * teamPush
}

export function calcForwardWindow(
  leadTimeDays: number,        // mfr + shipping to AWD
  targetCoverage: number,      // default 150
  currentCoverageDays: number  // current true inventory ÷ velocity
): number {
  const gap = Math.max(0, targetCoverage - currentCoverageDays)
  return leadTimeDays + gap
}

export function calcPlanning(
  asin: Asin,
  trueInventory: number,
  finalVelocity: number,
  unitCostUsd: number,
  cbmPerUnit: number
): Omit<PlanningOutput, 'id' | 'org_id' | 'asin' | 'snapshot_date'> {
  const leadTime = asin.lead_time_manufacturing + asin.lead_time_shipping_awd
  const target = asin.target_coverage_days
  const fbaBuffer = asin.fba_buffer_days

  const coverageDays = finalVelocity > 0 ? trueInventory / finalVelocity : 999
  const gapDays = Math.max(0, target - coverageDays)
  const forwardWindow = calcForwardWindow(leadTime, target, coverageDays)
  const unitsToOrder = Math.max(0, Math.ceil(gapDays * finalVelocity))
  const unitsToSendFba = Math.ceil(finalVelocity * fbaBuffer)
  const unitsToSendAwd = Math.max(0, unitsToOrder - unitsToSendFba)

  // Status thresholds
  let status: PlanningOutput['status'] = 'healthy'
  let urgencyDays = 0
  if (finalVelocity > 0) {
    urgencyDays = Math.floor(trueInventory / finalVelocity)
    if (urgencyDays <= 14) status = 'critical'
    else if (urgencyDays <= 30) status = 'order_soon'
    else if (urgencyDays <= 60) status = 'watch'
    else status = 'healthy'
  }

  return {
    true_inventory_units: trueInventory,
    coverage_days: parseFloat(coverageDays.toFixed(1)),
    target_coverage_days: target,
    gap_days: parseFloat(gapDays.toFixed(1)),
    forward_window_days: forwardWindow,
    units_to_order: unitsToOrder,
    units_to_send_fba: unitsToSendFba,
    units_to_send_awd: unitsToSendAwd,
    status,
    urgency_days: urgencyDays,
    estimated_cost_usd: parseFloat((unitsToOrder * unitCostUsd).toFixed(2)),
    estimated_cbm: parseFloat((unitsToOrder * cbmPerUnit).toFixed(4)),
  }
}

// ── STATUS HELPERS ────────────────────────────────────────────────────────────
export const STATUS_CONFIG = {
  critical:   { label: 'Critical',    color: '#c0392b', bg: '#fdf0ee', border: 'rgba(192,57,43,.25)' },
  order_soon: { label: 'Order Soon',  color: '#c06b00', bg: '#fff3e0', border: 'rgba(192,107,0,.25)' },
  watch:      { label: 'Watch',       color: '#1a4a8c', bg: '#eef3fb', border: 'rgba(26,74,140,.25)' },
  healthy:    { label: 'Healthy',     color: '#1a6b3c', bg: '#e8f5ed', border: 'rgba(26,107,60,.25)' },
}

export function statusConfig(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.healthy
}

export function fmtDays(days: number): string {
  if (days >= 999) return '∞'
  return `${Math.round(days)}d`
}

export function fmtUnits(n: number): string {
  if (n >= 1000) return `${(n/1000).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtCost(n: number): string {
  if (n === 0) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── AMAZON REPORT PARSERS ─────────────────────────────────────────────────────
// Paste this section into your inventory.ts, replacing everything from
// "AMAZON REPORT PARSERS" to the end of the file.
//
// Handles all 4 Amazon reports:
//   1. FBA report          → velocity (t7/t30/t60/t90) + inbound + age data
//   2. Manage FBA report   → afn-fulfillable-quantity + afn-warehouse-quantity
//   3. Reserved report     → customer orders + fc-transfers + fc-processing
//   4. AWD report          → available + inbound + outbound to FBA

export type ReportType =
  | 'fba_inventory'      // Full FBA report — velocity, inbound, age
  | 'manage_fba'         // Manage FBA — fulfillable, warehouse quantities
  | 'awd_inventory'      // AWD report — buffer stock
  | 'reserved_inventory' // Reserved breakdown — customer orders etc.
  | 'unknown'

export function detectReportType(headers: string[]): ReportType {
  const h = headers.map(x => x.toLowerCase().trim())

  // AWD — has "available in awd" or "inbound to awd" columns
  if (h.some(x => x.includes('available in awd') || x.includes('inbound to awd') || x.includes('awd (units)'))) {
    return 'awd_inventory'
  }

  // Reserved — has reserved_customerorders column
  if (h.some(x => x.includes('reserved_customerorders') || x.includes('reserved_qty'))) {
    return 'reserved_inventory'
  }

  // Manage FBA — has afn-fulfillable-quantity but NOT units-shipped-t7
  if (
    h.some(x => x.includes('afn-fulfillable-quantity') || x.includes('afn-warehouse-quantity')) &&
    !h.some(x => x.includes('units-shipped-t7') || x.includes('units-shipped-t30'))
  ) {
    return 'manage_fba'
  }

  // FBA full report — has units-shipped-t7 (velocity data) + snapshot-date
  if (
    h.some(x => x.includes('units-shipped-t7') || x.includes('units-shipped-t30')) &&
    h.some(x => x.includes('snapshot-date') || x.includes('available'))
  ) {
    return 'fba_inventory'
  }

  return 'unknown'
}

// ── 1. FBA REPORT PARSER ──────────────────────────────────────────────────────
// Source: Seller Central → Reports → Fulfillment → Amazon Fulfilled Inventory
// Provides: sales velocity, inbound shipments, inventory age, storage fees
// Does NOT provide: fulfillable quantity (use Manage FBA for that)

export type FbaReportRow = {
  asin: string
  sku_id: string
  product_name: string
  snapshot_date: string
  // Sales velocity inputs
  units_7d: number
  units_30d: number
  units_60d: number
  units_90d: number
  // Inbound pipeline
  fba_inbound_working: number
  fba_inbound_shipped: number
  fba_inbound_receiving: number
  // Inventory age flags
  inv_age_0_90: number
  inv_age_91_180: number
  inv_age_181_270: number
  inv_age_271_365: number
  inv_age_365_plus: number
  // Storage
  estimated_storage_cost: number
  // Health
  days_of_supply: number
  fba_level_health: string
}

export function parseFbaReport(rows: Record<string, string>[]): FbaReportRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id: r['sku'] || '',
      product_name: r['product-name'] || '',
      snapshot_date: r['snapshot-date'] || new Date().toISOString().split('T')[0],
      units_7d: parseFloat(r['units-shipped-t7'] || '0') || 0,
      units_30d: parseFloat(r['units-shipped-t30'] || '0') || 0,
      units_60d: parseFloat(r['units-shipped-t60'] || '0') || 0,
      units_90d: parseFloat(r['units-shipped-t90'] || '0') || 0,
      fba_inbound_working: parseInt(r['inbound-working'] || '0') || 0,
      fba_inbound_shipped: parseInt(r['inbound-shipped'] || '0') || 0,
      fba_inbound_receiving: parseInt(r['inbound-received'] || '0') || 0,
      inv_age_0_90: parseInt(r['inv-age-0-to-90-days'] || '0') || 0,
      inv_age_91_180: parseInt(r['inv-age-91-to-180-days'] || '0') || 0,
      inv_age_181_270: parseInt(r['inv-age-181-to-270-days'] || '0') || 0,
      inv_age_271_365: parseInt(r['inv-age-271-to-365-days'] || '0') || 0,
      inv_age_365_plus: parseInt(r['inv-age-366-to-455-days'] || r['inv-age-456-plus-days'] || '0') || 0,
      estimated_storage_cost: parseFloat(r['estimated-storage-cost-next-month'] || '0') || 0,
      days_of_supply: parseFloat(r['days-of-supply'] || '0') || 0,
      fba_level_health: r['fba-inventory-level-health-status'] || '',
    }
  }).filter(Boolean) as FbaReportRow[]
}

// ── 2. MANAGE FBA REPORT PARSER ───────────────────────────────────────────────
// Source: Seller Central → Inventory → Manage FBA Inventory → Download
// Provides: fulfillable quantity, warehouse quantity, reserved quantity
// Use this (not FBA report) for actual sellable stock numbers

export type ManageFbaRow = {
  asin: string
  sku_id: string
  product_name: string
  // These are the accurate fulfillable numbers
  fba_fulfillable: number        // afn-fulfillable-quantity — sellable right now
  fba_warehouse_total: number    // afn-warehouse-quantity — all stock at Amazon FC
  fba_unfulfillable: number      // afn-unsellable-quantity — damaged/stranded
  fba_reserved: number           // afn-reserved-quantity — all reserved
  fba_inbound_working: number    // afn-inbound-working-quantity
  fba_inbound_shipped: number    // afn-inbound-shipped-quantity
  fba_inbound_receiving: number  // afn-inbound-receiving-quantity
}

export function parseManageFba(rows: Record<string, string>[]): ManageFbaRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id: r['sku'] || '',
      product_name: r['product-name'] || '',
      fba_fulfillable: parseInt(r['afn-fulfillable-quantity'] || '0') || 0,
      fba_warehouse_total: parseInt(r['afn-warehouse-quantity'] || '0') || 0,
      fba_unfulfillable: parseInt(r['afn-unsellable-quantity'] || '0') || 0,
      fba_reserved: parseInt(r['afn-reserved-quantity'] || '0') || 0,
      fba_inbound_working: parseInt(r['afn-inbound-working-quantity'] || '0') || 0,
      fba_inbound_shipped: parseInt(r['afn-inbound-shipped-quantity'] || '0') || 0,
      fba_inbound_receiving: parseInt(r['afn-inbound-receiving-quantity'] || '0') || 0,
    }
  }).filter(Boolean) as ManageFbaRow[]
}

// ── 3. RESERVED INVENTORY REPORT PARSER ──────────────────────────────────────
// Source: Seller Central → Reports → Fulfillment → Reserved Inventory
// Provides: breakdown of exactly WHY stock is reserved
// Critical for: excluding customer orders from true inventory count

export type ReservedRow = {
  asin: string
  sku_id: string
  product_name: string
  reserved_total: number
  reserved_customer_orders: number  // Already sold — EXCLUDE from coverage calc
  reserved_fc_transfers: number     // Moving between FCs — COUNT as available
  reserved_fc_processing: number    // Being processed — COUNT as available
}

export function parseReservedInventory(rows: Record<string, string>[]): ReservedRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id: r['sku'] || r['fnsku'] || '',
      product_name: r['product-name'] || '',
      reserved_total: parseInt(r['reserved_qty'] || '0') || 0,
      reserved_customer_orders: parseInt(r['reserved_customerorders'] || '0') || 0,
      reserved_fc_transfers: parseInt(r['reserved_fc-transfers'] || '0') || 0,
      reserved_fc_processing: parseInt(r['reserved_fc-processing'] || '0') || 0,
    }
  }).filter(Boolean) as ReservedRow[]
}

// ── 4. AWD INVENTORY REPORT PARSER ───────────────────────────────────────────
// Source: Seller Central → Inventory → AWD → Download report
// Provides: AWD buffer stock, inbound to AWD, outbound to FBA
// Note: Amazon exports this with 2 metadata rows at top — we skip them

export type AwdRow = {
  asin: string
  sku_id: string
  product_name: string
  awd_available: number       // Available in AWD (units) — main buffer
  awd_inbound: number         // Inbound to AWD (units) — coming into buffer
  awd_outbound_to_fba: number // Outbound to FBA (units) — already moving to FBA
  awd_reserved: number        // Reserved in AWD (units)
  awd_days_of_supply: number  // Days of Supply (days)
}

export function parseAwdInventory(rows: Record<string, string>[]): AwdRow[] {
  return rows.map(r => {
    // AWD report uses "ASIN" uppercase sometimes
    const asin = r['asin'] || r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id: r['sku'] || '',
      product_name: r['product name'] || r['product-name'] || '',
      awd_available: parseInt(r['available in awd (units)'] || r['available units in awd (us)'] || r['awd-available'] || '0') || 0,
      awd_inbound: parseInt(r['inbound to awd (units)'] || r['awd-inbound'] || '0') || 0,
      awd_outbound_to_fba: parseInt(r['outbound to fba (units)'] || r['awd-outbound'] || '0') || 0,
      awd_reserved: parseInt(r['reserved in awd (units)'] || '0') || 0,
      awd_days_of_supply: parseFloat(r['days of supply (days)'] || '0') || 0,
    }
  }).filter(Boolean) as AwdRow[]
}

// ── MERGED SNAPSHOT BUILDER ───────────────────────────────────────────────────
// Combines all 4 parsed reports into a single InventorySnapshot per ASIN
// Call this after parsing all uploaded files

export function mergeIntoSnapshot(
  snapshotDate: string,
  orgId: string,
  manageFbaRows: ManageFbaRow[],
  fbaRows: FbaReportRow[],
  reservedRows: ReservedRow[],
  awdRows: AwdRow[]
): Partial<InventorySnapshot>[] {

  // Index each report by ASIN for fast lookup
  const manageFbaByAsin = Object.fromEntries(manageFbaRows.map(r => [r.asin, r]))
  const fbaByAsin = Object.fromEntries(fbaRows.map(r => [r.asin, r]))
  const reservedByAsin = Object.fromEntries(reservedRows.map(r => [r.asin, r]))
  const awdByAsin = Object.fromEntries(awdRows.map(r => [r.asin, r]))

  // Get all unique ASINs across all reports
  const allAsins = new Set([
    ...manageFbaRows.map(r => r.asin),
    ...fbaRows.map(r => r.asin),
    ...reservedRows.map(r => r.asin),
    ...awdRows.map(r => r.asin),
  ])

  return Array.from(allAsins).map(asin => {
    const mfba = manageFbaByAsin[asin]
    const fba = fbaByAsin[asin]
    const res = reservedByAsin[asin]
    const awd = awdByAsin[asin]

    // Fulfillable: use Manage FBA (more accurate) with FBA as fallback
    const fba_fulfillable = mfba?.fba_fulfillable ?? 0
    const fba_unfulfillable = mfba?.fba_unfulfillable ?? 0

    // Inbound: use Manage FBA first, fall back to FBA report
    const fba_inbound_working = mfba?.fba_inbound_working ?? fba?.fba_inbound_working ?? 0
    const fba_inbound_shipped = mfba?.fba_inbound_shipped ?? fba?.fba_inbound_shipped ?? 0
    const fba_inbound_receiving = mfba?.fba_inbound_receiving ?? fba?.fba_inbound_receiving ?? 0

    // Reserved breakdown: use Reserved report (most granular)
    const fba_reserved_customer_orders = res?.reserved_customer_orders ?? 0
    const fba_reserved_fc_transfer = res?.reserved_fc_transfers ?? 0
    const fba_reserved_fc_processing = res?.reserved_fc_processing ?? 0

    // AWD: from AWD report
    const awd_available = awd?.awd_available ?? 0
    const awd_inbound = awd?.awd_inbound ?? 0
    const awd_outbound_to_fba = awd?.awd_outbound_to_fba ?? 0

    // True inventory = what we can actually count toward 150-day coverage
    const true_inventory_units = calcTrueInventory({
      fba_fulfillable,
      fba_inbound_shipped,
      fba_inbound_receiving,
      awd_available,
      awd_inbound,
      awd_outbound_to_fba,
    })

    return {
      org_id: orgId,
      snapshot_date: snapshotDate,
      asin,
      sku_id: mfba?.sku_id || fba?.sku_id || awd?.sku_id || '',
      product_name: mfba?.product_name || fba?.product_name || awd?.product_name || '',
      fba_fulfillable,
      fba_unfulfillable,
      fba_inbound_working,
      fba_inbound_shipped,
      fba_inbound_receiving,
      fba_reserved_customer_orders,
      fba_reserved_fc_transfer,
      fba_reserved_fc_processing,
      awd_available,
      awd_inbound,
      awd_outbound_to_fba,
      true_inventory_units,
    }
  })
}

// ── VELOCITY BUILDER ──────────────────────────────────────────────────────────
// Builds SalesVelocity rows from the FBA report's t7/t30/t60/t90 data

export function buildVelocityRows(
  fbaRows: FbaReportRow[],
  orgId: string,
  teamPushByAsin: Record<string, number> = {}
): Partial<SalesVelocity>[] {
  return fbaRows.map(r => {
    const v7  = r.units_7d  / 7
    const v30 = r.units_30d / 30
    const v60 = r.units_60d / 60
    const v90 = r.units_90d / 90

    // Weighted: 7d×40% + 30d×30% + 60d×20% + 90d×10%
    const base = v7 * 0.4 + v30 * 0.3 + v60 * 0.2 + v90 * 0.1

    const teamPush = teamPushByAsin[r.asin] ?? 1.0

    // Seasonality + search trend default to 1.0 until APIs connected
    const seasonality = 1.0
    const searchTrend = 1.0

    return {
      org_id: orgId,
      asin: r.asin,
      snapshot_date: r.snapshot_date,
      units_7d: r.units_7d,
      units_30d: r.units_30d,
      units_60d: r.units_60d,
      units_90d: r.units_90d,
      velocity_7d: parseFloat(v7.toFixed(4)),
      velocity_30d: parseFloat(v30.toFixed(4)),
      velocity_60d: parseFloat(v60.toFixed(4)),
      velocity_90d: parseFloat(v90.toFixed(4)),
      base_velocity: parseFloat(base.toFixed(4)),
      seasonality_multiplier: seasonality,
      search_trend_multiplier: searchTrend,
      team_push_multiplier: teamPush,
      final_velocity: parseFloat((base * seasonality * searchTrend * teamPush).toFixed(4)),
    }
  })
}

// ── MASTER UPLOAD HANDLER ─────────────────────────────────────────────────────
// Call this with all uploaded file contents — it auto-detects each file type,
// parses them, and returns merged snapshots + velocity rows ready for Supabase

export type UploadResult = {
  snapshots: Partial<InventorySnapshot>[]
  velocityRows: Partial<SalesVelocity>[]
  detectedTypes: Record<string, ReportType>
  errors: string[]
}

export function processUploadedFiles(
  files: Array<{ name: string; content: string }>,
  orgId: string,
  snapshotDate: string,
  teamPushByAsin: Record<string, number> = {}
): UploadResult {
  const errors: string[] = []
  const detectedTypes: Record<string, ReportType> = {}

  let manageFbaRows: ManageFbaRow[] = []
  let fbaRows: FbaReportRow[] = []
  let reservedRows: ReservedRow[] = []
  let awdRows: AwdRow[] = []

  for (const file of files) {
    const { headers, rows } = parseCsv(file.content)
    const type = detectReportType(headers)
    detectedTypes[file.name] = type

    switch (type) {
      case 'manage_fba':
        manageFbaRows = parseManageFba(rows)
        break
      case 'fba_inventory':
        fbaRows = parseFbaReport(rows)
        break
      case 'reserved_inventory':
        reservedRows = parseReservedInventory(rows)
        break
      case 'awd_inventory':
        awdRows = parseAwdInventory(rows)
        break
      default:
        errors.push(`Could not detect report type for: ${file.name}`)
    }
  }

  const snapshots = mergeIntoSnapshot(
    snapshotDate, orgId,
    manageFbaRows, fbaRows, reservedRows, awdRows
  )

  const velocityRows = buildVelocityRows(fbaRows, orgId, teamPushByAsin)

  return { snapshots, velocityRows, detectedTypes, errors }
}

// ── GENERIC CSV PARSER ────────────────────────────────────────────────────────
// Handles tab and comma delimited files.
// AWD files have 2 metadata rows at the top — this skips them automatically.

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (allLines.length < 2) return { headers: [], rows: [] }

  // AWD files start with "Timestamp," or "Merchant ID," metadata rows — skip them
  let startIndex = 0
  for (let i = 0; i < Math.min(5, allLines.length); i++) {
    const line = allLines[i].toLowerCase()
    if (
      line.startsWith('timestamp') ||
      line.startsWith('merchant id') ||
      line.startsWith('report date') ||
      line.startsWith('currency')
    ) {
      startIndex = i + 1
    } else {
      // First non-metadata line is the header
      startIndex = i
      break
    }
  }

  const lines = allLines.slice(startIndex)
  if (lines.length < 2) return { headers: [], rows: [] }

  // Detect delimiter from header line
  const firstLine = lines[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const headers = firstLine.split(delimiter).map(h =>
    h.replace(/^"|"$/g, '').trim().toLowerCase()
  )

  const rows = lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.replace(/^"|"$/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))

  return { headers, rows }
}