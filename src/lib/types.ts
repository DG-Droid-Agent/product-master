export type Product = {
  id?: string
  status: string
  brand: string
  category: string
  product_name: string
  sku_id: string
  warpfy_code?: string
  upc?: string
  asin?: string
  fnsku?: string
  color?: string
  size?: string
  capacity?: string
  material?: string
  pack_size?: string
  image_url?: string
  prod_length?: number
  prod_width?: number
  prod_height?: number
  prod_dim_unit?: string
  prod_weight?: number
  prod_weight_unit?: string
  pkg_length?: number
  pkg_width?: number
  pkg_height?: number
  pkg_dim_unit?: string
  pkg_weight?: number
  pkg_weight_unit?: string
  units_per_carton?: number
  carton_l?: number
  carton_b?: number
  carton_h?: number
  carton_unit?: string
  carton_weight?: number
  carton_weight_unit?: string
  cbm?: number
  discontinued?: boolean
  created_at?: string
  updated_at?: string
}

export type Cost = {
  id?: string
  sku_id: string
  product_name?: string
  brand?: string
  supplier?: string
  cost?: number
  currency?: string
  term?: string
  usd_per_unit?: number
  notes?: string
  created_at?: string
  updated_at?: string
}

export type UpcAssignment = {
  id?: string
  upc: string
  sku_id?: string
  brand_pool?: string
  status?: 'verified' | 'duplicate' | 'free'
  assigned_at?: string
}

export const BRANDS = [
  { name: 'Eco Living',              color: '#1a7a40' },
  { name: 'The Fine Living Company', color: '#5b3fa8' },
  { name: 'ZERO JET LAG',            color: '#c04a1a' },
  { name: 'Kesol',                   color: '#1a5a9a' },
  { name: 'Well Lean',               color: '#8a6a00' },
]

export const FX: Record<string, number> = {
  USD: 1, RMB: 0.138, CNY: 0.138, INR: 0.012, EUR: 1.08, GBP: 1.27
}

export function brandColor(name: string) {
  return BRANDS.find(b => b.name === name)?.color ?? '#888'
}
