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
// Detects which Amazon report type a CSV is based on its headers

export type ReportType = 'fba_inventory' | 'awd_inventory' | 'sales_report' | 'unknown'

export function detectReportType(headers: string[]): ReportType {
  const h = headers.map(x => x.toLowerCase().trim())
  if (h.includes('asin') && h.some(x => x.includes('afn-fulfillable') || x.includes('fulfillable-quantity'))) {
    return 'fba_inventory'
  }
  if (h.some(x => x.includes('awd') || x.includes('warehousing'))) {
    return 'awd_inventory'
  }
  if (h.includes('asin') && h.some(x => x.includes('units-ordered') || x.includes('ordered-units'))) {
    return 'sales_report'
  }
  return 'unknown'
}

export function parseFbaInventory(rows: Record<string, string>[]): Partial<InventorySnapshot>[] {
  return rows.map(r => {
    // Handle both old and new Amazon report column names
    const asin = r['asin'] || r['ASIN'] || ''
    if (!asin) return null
    return {
      asin,
      sku_id: r['seller-sku'] || r['sku'] || '',
      product_name: r['product-name'] || r['item-name'] || '',
      fba_fulfillable: parseInt(r['afn-fulfillable-quantity'] || r['fulfillable-quantity'] || '0') || 0,
      fba_unfulfillable: parseInt(r['afn-unsellable-quantity'] || r['unsellable-quantity'] || '0') || 0,
      fba_inbound_working: parseInt(r['afn-inbound-working-quantity'] || r['inbound-working'] || '0') || 0,
      fba_inbound_shipped: parseInt(r['afn-inbound-shipped-quantity'] || r['inbound-shipped'] || '0') || 0,
      fba_inbound_receiving: parseInt(r['afn-inbound-receiving-quantity'] || r['inbound-receiving'] || '0') || 0,
      fba_reserved_customer_orders: parseInt(r['afn-reserved-quantity'] || r['reserved-quantity'] || '0') || 0,
      fba_reserved_fc_transfer: parseInt(r['afn-reserved-future-supply'] || '0') || 0,
      fba_reserved_fc_processing: 0,
      awd_available: 0,
      awd_inbound: 0,
      awd_outbound_to_fba: 0,
    }
  }).filter(Boolean) as Partial<InventorySnapshot>[]
}

export function parseAwdInventory(rows: Record<string, string>[]): Partial<InventorySnapshot>[] {
  return rows.map(r => {
    const asin = r['asin'] || r['ASIN'] || ''
    if (!asin) return null
    return {
      asin,
      awd_available: parseInt(r['available-units'] || r['awd-available'] || r['inventory-quantity'] || '0') || 0,
      awd_inbound: parseInt(r['inbound-units'] || r['awd-inbound'] || '0') || 0,
      awd_outbound_to_fba: parseInt(r['outbound-units'] || r['awd-outbound'] || r['transfer-quantity'] || '0') || 0,
    }
  }).filter(Boolean) as Partial<InventorySnapshot>[]
}

export function parseSalesReport(rows: Record<string, string>[], period: 7 | 30 | 60 | 90): Record<string, number> {
  // Returns asin → units sold
  const result: Record<string, number> = {}
  rows.forEach(r => {
    const asin = r['asin'] || r['ASIN'] || ''
    if (!asin) return
    const units = parseInt(r['units-ordered'] || r['ordered-units'] || r['quantity'] || '0') || 0
    result[asin] = (result[asin] ?? 0) + units
  })
  return result
}

// Generic CSV parser (handles tab and comma delimited)
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }

  // Detect delimiter
  const firstLine = lines[0]
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const headers = firstLine.split(delimiter).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
  const rows = lines.slice(1).map(line => {
    const vals = line.split(delimiter).map(v => v.replace(/^"|"$/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  }).filter(r => Object.values(r).some(v => v))

  return { headers, rows }
}
