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
  // FBA position (fulfillable from Manage FBA — most accurate)
  fba_fulfillable: number
  fba_warehouse_qty: number           // afn-warehouse-quantity (total at Amazon FC)
  fba_unfulfillable: number
  fba_inbound_working: number
  fba_inbound_shipped: number
  fba_inbound_receiving: number
  // Reserved breakdown (from Reserved Inventory report)
  fba_reserved_customer_orders: number  // already sold — EXCLUDE from coverage
  fba_reserved_fc_transfer: number      // moving between FCs — count as available
  fba_reserved_fc_processing: number    // being processed — count as available
  // AWD position
  awd_available: number
  awd_inbound: number
  awd_outbound_to_fba: number
  // Sales data (from FBA report)
  units_7d: number
  units_30d: number
  units_60d: number
  units_90d: number
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
  // TRUE INVENTORY POSITION — what we count toward 150-day coverage target
  //
  // INCLUDE:
  //   + FBA fulfillable          (selling right now)
  //   + FBA inbound shipped      (en route to Amazon FC — confirmed dispatched)
  //   + FBA inbound receiving    (Amazon is processing it now)
  //   + AWD available            (bulk buffer, will auto-replenish FBA)
  //   + AWD inbound              (coming into AWD)
  //   + AWD outbound to FBA      (already moving AWD → FBA)
  //
  // EXCLUDE:
  //   - FBA unfulfillable        (damaged/stranded — cannot be sold)
  //   - Customer orders          (already sold, leaving stock soon)
  //   - FBA inbound working      (shipment created but not dispatched yet — not confirmed)

  const total =
    (snap.fba_fulfillable              ?? 0) +
    (snap.fba_inbound_shipped          ?? 0) +
    (snap.fba_inbound_receiving        ?? 0) +
    (snap.awd_available                ?? 0) +
    (snap.awd_inbound                  ?? 0) +
    (snap.awd_outbound_to_fba          ?? 0) -
    (snap.fba_reserved_customer_orders ?? 0)

  return Math.max(0, total)
}

export function calcBaseVelocity(
  v7: number,
  v30: number,
  v60: number,
  v90: number
): number {
  // Weighted: 7d×40% + 30d×30% + 60d×20% + 90d×10%
  return v7 * 0.4 + v30 * 0.3 + v60 * 0.2 + v90 * 0.1
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
  leadTimeDays: number,        // mfr + shipping to AWD (default 70)
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

  let status: PlanningOutput['status'] = 'healthy'
  let urgencyDays = 0

  if (finalVelocity > 0) {
    urgencyDays = Math.floor(trueInventory / finalVelocity)
    if (urgencyDays <= 14)      status = 'critical'
    else if (urgencyDays <= 30) status = 'order_soon'
    else if (urgencyDays <= 60) status = 'watch'
    else                        status = 'healthy'
  }

  return {
    true_inventory_units: trueInventory,
    coverage_days:        parseFloat(coverageDays.toFixed(1)),
    target_coverage_days: target,
    gap_days:             parseFloat(gapDays.toFixed(1)),
    forward_window_days:  forwardWindow,
    units_to_order:       unitsToOrder,
    units_to_send_fba:    unitsToSendFba,
    units_to_send_awd:    unitsToSendAwd,
    status,
    urgency_days:         urgencyDays,
    estimated_cost_usd:   parseFloat((unitsToOrder * unitCostUsd).toFixed(2)),
    estimated_cbm:        parseFloat((unitsToOrder * cbmPerUnit).toFixed(4)),
  }
}

// ── STATUS HELPERS ────────────────────────────────────────────────────────────

export const STATUS_CONFIG = {
  critical:   { label: 'Critical',   color: '#c0392b', bg: '#fdf0ee', border: 'rgba(192,57,43,.25)'  },
  order_soon: { label: 'Order Soon', color: '#c06b00', bg: '#fff3e0', border: 'rgba(192,107,0,.25)'  },
  watch:      { label: 'Watch',      color: '#1a4a8c', bg: '#eef3fb', border: 'rgba(26,74,140,.25)'  },
  healthy:    { label: 'Healthy',    color: '#1a6b3c', bg: '#e8f5ed', border: 'rgba(26,107,60,.25)'  },
}

export function statusConfig(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.healthy
}

export function fmtDays(days: number): string {
  if (days >= 999) return '∞'
  return `${Math.round(days)}d`
}

export function fmtUnits(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtCost(n: number): string {
  if (n === 0) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── AMAZON REPORT PARSERS ─────────────────────────────────────────────────────
//
// 4 reports, each used for different data:
//
//  File 1: FBA Report          → sales velocity (t7/t30/t60/t90) + inbound pipeline
//  File 2: Manage FBA Report   → fulfillable qty + warehouse qty (more accurate than FBA)
//  File 3: Reserved Inventory  → customer orders + fc-transfers + fc-processing
//  File 4: AWD Report          → buffer stock + inbound to AWD + outbound to FBA

export type ReportType =
  | 'fba_inventory'      // Full FBA report — velocity, inbound, age
  | 'manage_fba'         // Manage FBA — fulfillable, warehouse quantities
  | 'awd_inventory'      // AWD report — buffer stock
  | 'reserved_inventory' // Reserved breakdown — customer orders etc.
  | 'unknown'

export function detectReportType(headers: string[]): ReportType {
  const h = headers.map(x => x.toLowerCase().trim())

  // AWD — unique columns
  if (h.some(x =>
    x.includes('available in awd') ||
    x.includes('inbound to awd') ||
    x.includes('awd (units)') ||
    x.includes('available units in awd')
  )) return 'awd_inventory'

  // Reserved — unique column
  if (h.some(x =>
    x.includes('reserved_customerorders') ||
    x.includes('reserved_qty')
  )) return 'reserved_inventory'

  // Manage FBA — has afn-fulfillable-quantity but NOT velocity columns
  if (
    h.some(x => x.includes('afn-fulfillable-quantity') || x.includes('afn-warehouse-quantity')) &&
    !h.some(x => x.includes('units-shipped-t7') || x.includes('units-shipped-t30'))
  ) return 'manage_fba'

  // FBA full report — has velocity columns
  if (
    h.some(x => x.includes('units-shipped-t7') || x.includes('units-shipped-t30')) &&
    h.some(x => x.includes('snapshot-date') || x.includes('available'))
  ) return 'fba_inventory'

  return 'unknown'
}

// ── FILE 1: FBA REPORT PARSER ─────────────────────────────────────────────────
// Source: Reports → Fulfillment → Amazon Fulfilled Inventory → All Inventory
// Used for: sales velocity (t7/t30/t60/t90) + inbound shipments + inventory age

export type FbaReportRow = {
  asin: string
  sku_id: string
  product_name: string
  snapshot_date: string
  units_7d: number
  units_30d: number
  units_60d: number
  units_90d: number
  fba_inbound_working: number
  fba_inbound_shipped: number
  fba_inbound_receiving: number
  inv_age_0_90: number
  inv_age_91_180: number
  inv_age_181_270: number
  inv_age_271_365: number
  inv_age_365_plus: number
  estimated_storage_cost: number
  days_of_supply: number
  fba_level_health: string
}

export function parseFbaReport(rows: Record<string, string>[]): FbaReportRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id:        r['sku']          || '',
      product_name:  r['product-name'] || '',
      snapshot_date: r['snapshot-date'] || new Date().toISOString().split('T')[0],
      units_7d:  n(r['units-shipped-t7']),
      units_30d: n(r['units-shipped-t30']),
      units_60d: n(r['units-shipped-t60']),
      units_90d: n(r['units-shipped-t90']),
      fba_inbound_working:   n(r['inbound-working']),
      fba_inbound_shipped:   n(r['inbound-shipped']),
      fba_inbound_receiving: n(r['inbound-received']),
      inv_age_0_90:   n(r['inv-age-0-to-90-days']),
      inv_age_91_180: n(r['inv-age-91-to-180-days']),
      inv_age_181_270: n(r['inv-age-181-to-270-days']),
      inv_age_271_365: n(r['inv-age-271-to-365-days']),
      inv_age_365_plus: n(r['inv-age-366-to-455-days'] || r['inv-age-456-plus-days']),
      estimated_storage_cost: n(r['estimated-storage-cost-next-month']),
      days_of_supply:  n(r['days-of-supply']),
      fba_level_health: r['fba-inventory-level-health-status'] || '',
    }
  }).filter(Boolean) as FbaReportRow[]
}

// ── FILE 2: MANAGE FBA REPORT PARSER ─────────────────────────────────────────
// Source: Inventory → Manage FBA Inventory → Download
// Used for: fulfillable quantity + warehouse quantity (MORE ACCURATE than FBA report)

export type ManageFbaRow = {
  asin: string
  sku_id: string
  product_name: string
  fba_fulfillable: number       // afn-fulfillable-quantity — sellable right now
  fba_warehouse_total: number   // afn-warehouse-quantity — all stock at Amazon FC
  fba_unfulfillable: number     // afn-unsellable-quantity — damaged/stranded
  fba_reserved: number          // afn-reserved-quantity — all reserved
  fba_inbound_working: number
  fba_inbound_shipped: number
  fba_inbound_receiving: number
}

export function parseManageFba(rows: Record<string, string>[]): ManageFbaRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id:       r['sku']          || '',
      product_name: r['product-name'] || '',
      fba_fulfillable:       n(r['afn-fulfillable-quantity']),
      fba_warehouse_total:   n(r['afn-warehouse-quantity']),
      fba_unfulfillable:     n(r['afn-unsellable-quantity']),
      fba_reserved:          n(r['afn-reserved-quantity']),
      fba_inbound_working:   n(r['afn-inbound-working-quantity']),
      fba_inbound_shipped:   n(r['afn-inbound-shipped-quantity']),
      fba_inbound_receiving: n(r['afn-inbound-receiving-quantity']),
    }
  }).filter(Boolean) as ManageFbaRow[]
}

// ── FILE 3: RESERVED INVENTORY REPORT PARSER ─────────────────────────────────
// Source: Reports → Fulfillment → Reserved Inventory
// Used for: exact breakdown of why stock is reserved
// CRITICAL: customer orders must be EXCLUDED from coverage calculation

export type ReservedRow = {
  asin: string
  sku_id: string
  product_name: string
  reserved_total: number
  reserved_customer_orders: number  // already sold — EXCLUDE from coverage
  reserved_fc_transfers: number     // moving between FCs — COUNT as available
  reserved_fc_processing: number    // being processed — COUNT as available
}

export function parseReservedInventory(rows: Record<string, string>[]): ReservedRow[] {
  return rows.map(r => {
    const asin = r['asin'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id:       r['sku'] || r['fnsku'] || '',
      product_name: r['product-name'] || '',
      reserved_total:            n(r['reserved_qty']),
      reserved_customer_orders:  n(r['reserved_customerorders']),
      reserved_fc_transfers:     n(r['reserved_fc-transfers']),
      reserved_fc_processing:    n(r['reserved_fc-processing']),
    }
  }).filter(Boolean) as ReservedRow[]
}

// ── FILE 4: AWD INVENTORY REPORT PARSER ──────────────────────────────────────
// Source: Inventory → AWD → Download report
// Used for: AWD buffer stock, inbound to AWD, outbound to FBA
// NOTE: Amazon exports AWD with 2 metadata rows at top — parseCsv handles this

export type AwdRow = {
  asin: string
  sku_id: string
  product_name: string
  awd_available: number      // Available in AWD — main buffer stock
  awd_inbound: number        // Inbound to AWD — coming into buffer
  awd_outbound_to_fba: number // Outbound to FBA — already moving to FBA
  awd_reserved: number       // Reserved in AWD
  awd_days_of_supply: number
}

export function parseAwdInventory(rows: Record<string, string>[]): AwdRow[] {
  return rows.map(r => {
    // AWD report sometimes uses uppercase column names
    const asin = r['asin'] || r['ASIN'] || ''
    if (!asin) return null

    return {
      asin,
      sku_id:       r['sku'] || r['SKU'] || '',
      product_name: r['product name'] || r['product-name'] || r['Product Name'] || '',
      // Available: try multiple column name variants Amazon uses
      awd_available: n(
        r['available in awd (units)'] ||
        r['available units in awd (us)'] ||
        r['awd-available']
      ),
      awd_inbound: n(
        r['inbound to awd (units)'] ||
        r['awd-inbound']
      ),
      awd_outbound_to_fba: n(
        r['outbound to fba (units)'] ||
        r['awd-outbound']
      ),
      awd_reserved:      n(r['reserved in awd (units)']),
      awd_days_of_supply: n(r['days of supply (days)']),
    }
  }).filter(Boolean) as AwdRow[]
}

// ── MERGED SNAPSHOT BUILDER ───────────────────────────────────────────────────
// Combines all 4 parsed reports into a single InventorySnapshot per ASIN
// Priority: Manage FBA > FBA Report for fulfillable quantities

export function mergeIntoSnapshot(
  snapshotDate: string,
  orgId: string,
  manageFbaRows: ManageFbaRow[],
  fbaRows: FbaReportRow[],
  reservedRows: ReservedRow[],
  awdRows: AwdRow[]
): Partial<InventorySnapshot>[] {
  const mfbaByAsin     = Object.fromEntries(manageFbaRows.map(r => [r.asin, r]))
  const fbaByAsin      = Object.fromEntries(fbaRows.map(r => [r.asin, r]))
  const reservedByAsin = Object.fromEntries(reservedRows.map(r => [r.asin, r]))
  const awdByAsin      = Object.fromEntries(awdRows.map(r => [r.asin, r]))

  const allAsins = new Set([
    ...manageFbaRows.map(r => r.asin),
    ...fbaRows.map(r => r.asin),
    ...reservedRows.map(r => r.asin),
    ...awdRows.map(r => r.asin),
  ])

  return Array.from(allAsins).map(asin => {
    const mfba = mfbaByAsin[asin]
    const fba  = fbaByAsin[asin]
    const res  = reservedByAsin[asin]
    const awd  = awdByAsin[asin]

    // Fulfillable: Manage FBA is more accurate — use as primary
    const fba_fulfillable     = mfba?.fba_fulfillable   ?? 0
    const fba_warehouse_qty   = mfba?.fba_warehouse_total ?? 0
    const fba_unfulfillable   = mfba?.fba_unfulfillable ?? 0

    // Inbound: Manage FBA first, FBA report as fallback
    const fba_inbound_working   = mfba?.fba_inbound_working   ?? fba?.fba_inbound_working   ?? 0
    const fba_inbound_shipped   = mfba?.fba_inbound_shipped   ?? fba?.fba_inbound_shipped   ?? 0
    const fba_inbound_receiving = mfba?.fba_inbound_receiving ?? fba?.fba_inbound_receiving ?? 0

    // Reserved: from Reserved report (most granular breakdown)
    const fba_reserved_customer_orders = res?.reserved_customer_orders ?? 0
    const fba_reserved_fc_transfer     = res?.reserved_fc_transfers    ?? 0
    const fba_reserved_fc_processing   = res?.reserved_fc_processing   ?? 0

    // AWD: from AWD report
    const awd_available      = awd?.awd_available       ?? 0
    const awd_inbound        = awd?.awd_inbound         ?? 0
    const awd_outbound_to_fba = awd?.awd_outbound_to_fba ?? 0

    // Sales velocity data from FBA report
    const units_7d  = fba?.units_7d  ?? 0
    const units_30d = fba?.units_30d ?? 0
    const units_60d = fba?.units_60d ?? 0
    const units_90d = fba?.units_90d ?? 0

    const true_inventory_units = calcTrueInventory({
      fba_fulfillable,
      fba_inbound_shipped,
      fba_inbound_receiving,
      fba_reserved_customer_orders,
      awd_available,
      awd_inbound,
      awd_outbound_to_fba,
    })

    return {
      org_id:        orgId,
      snapshot_date: snapshotDate,
      asin,
      sku_id:        mfba?.sku_id || fba?.sku_id || awd?.sku_id || '',
      product_name:  mfba?.product_name || fba?.product_name || awd?.product_name || '',
      fba_fulfillable,
      fba_warehouse_qty,
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
      units_7d,
      units_30d,
      units_60d,
      units_90d,
      true_inventory_units,
    }
  })
}

// ── VELOCITY BUILDER ──────────────────────────────────────────────────────────
// Builds SalesVelocity rows from FBA report t7/t30/t60/t90 data

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
    const base = calcBaseVelocity(v7, v30, v60, v90)
    const teamPush   = teamPushByAsin[r.asin] ?? 1.0
    const seasonality  = 1.0  // populated later via Brand Analytics
    const searchTrend  = 1.0  // populated later via Helium 10

    return {
      org_id:       orgId,
      asin:         r.asin,
      snapshot_date: r.snapshot_date,
      units_7d:  r.units_7d,
      units_30d: r.units_30d,
      units_60d: r.units_60d,
      units_90d: r.units_90d,
      velocity_7d:  parseFloat(v7.toFixed(4)),
      velocity_30d: parseFloat(v30.toFixed(4)),
      velocity_60d: parseFloat(v60.toFixed(4)),
      velocity_90d: parseFloat(v90.toFixed(4)),
      base_velocity:          parseFloat(base.toFixed(4)),
      seasonality_multiplier: seasonality,
      search_trend_multiplier: searchTrend,
      team_push_multiplier:   teamPush,
      final_velocity: parseFloat(calcFinalVelocity(base, seasonality, searchTrend, teamPush).toFixed(4)),
    }
  })
}

// ── MASTER UPLOAD HANDLER ─────────────────────────────────────────────────────
// Pass all uploaded file contents — auto-detects each type, parses, and returns
// merged snapshots + velocity rows ready to upsert into Supabase

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

  let manageFbaRows: ManageFbaRow[]  = []
  let fbaRows: FbaReportRow[]        = []
  let reservedRows: ReservedRow[]    = []
  let awdRows: AwdRow[]              = []

  for (const file of files) {
    const { headers, rows } = parseCsv(file.content)
    const type = detectReportType(headers)
    detectedTypes[file.name] = type

    switch (type) {
      case 'manage_fba':         manageFbaRows = parseManageFba(rows);          break
      case 'fba_inventory':      fbaRows       = parseFbaReport(rows);          break
      case 'reserved_inventory': reservedRows  = parseReservedInventory(rows);  break
      case 'awd_inventory':      awdRows       = parseAwdInventory(rows);       break
      default:
        errors.push(`Could not detect report type for: ${file.name}`)
    }
  }

  const snapshots    = mergeIntoSnapshot(snapshotDate, orgId, manageFbaRows, fbaRows, reservedRows, awdRows)
  const velocityRows = buildVelocityRows(fbaRows, orgId, teamPushByAsin)

  return { snapshots, velocityRows, detectedTypes, errors }
}

// ── GENERIC CSV PARSER ────────────────────────────────────────────────────────
// Handles tab and comma delimited files.
// AWD files have 2 metadata rows at the top (Timestamp, Merchant ID) — skipped automatically.

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (allLines.length < 2) return { headers: [], rows: [] }

  // Skip AWD metadata rows (Timestamp, Merchant ID) at top
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
      startIndex = i
      break
    }
  }

  const lines = allLines.slice(startIndex)
  if (lines.length < 2) return { headers: [], rows: [] }

  // Detect delimiter
  const firstLine = lines[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const headers = firstLine
    .split(delimiter)
    .map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())

  const rows = lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.replace(/^"|"$/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))

  return { headers, rows }
}

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

function n(val: string | undefined): number {
  if (!val) return 0
  const parsed = parseFloat(val.replace(/,/g, ''))
  return isNaN(parsed) ? 0 : parsed
}