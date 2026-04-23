'use client'

/* ============================================================================
   ProductStats — Day 2
   ----------------------------------------------------------------------------
   Clickable stat cards that sit above the ProductSheet. Cards reflect the
   full product set (not the filtered set), so the user can see totals even
   when filters are active. Clicking a card sets the status filter to match.
   ============================================================================ */

import type { Product } from '@/lib/types'

type Props = {
  products: Product[]
  filtered: Product[]
  dupeCount: number
  currentStatusFilter: string
  onStatusFilter: (status: string) => void
}

export default function ProductStats({
  products, filtered, dupeCount, currentStatusFilter, onStatusFilter,
}: Props) {
  const active       = products.filter(p => !p.discontinued && p.status === 'Active').length
  const notListed    = products.filter(p => !p.discontinued && p.status === 'Not Listed').length
  const discontinued = products.filter(p => p.discontinued || p.status === 'Discontinued').length
  const total        = products.length

  const cards = [
    { key: '',             label: 'Total',        value: total,        variant: 'default'  as const },
    { key: 'Active',       label: 'Active',       value: active,       variant: 'accent'   as const },
    { key: 'Not Listed',   label: 'Not Listed',   value: notListed,    variant: 'default'  as const },
    { key: 'Discontinued', label: 'Discontinued', value: discontinued, variant: 'default'  as const },
  ]

  return (
    <div className="ps-bar">
      {cards.map(c => {
        const isActive = currentStatusFilter === c.key
        const valueClass = c.variant === 'accent' ? 'is-accent' : ''
        return (
          <button
            key={c.label}
            type="button"
            className={`ps-card ${isActive ? 'is-active' : ''}`}
            onClick={() => onStatusFilter(isActive ? '' : c.key)}
            title={isActive ? `Clear ${c.label} filter` : `Filter to ${c.label}`}
          >
            <div className="ps-card-label">{c.label}</div>
            <div className={`ps-card-value ${valueClass}`}>{c.value.toLocaleString()}</div>
            <div className="ps-card-meta">
              {c.key === '' ? `${filtered.length} shown` : `${((c.value / Math.max(1, total)) * 100).toFixed(0)}% of catalog`}
            </div>
          </button>
        )
      })}
      <div className="ps-card" style={{ cursor: 'default' }} onClick={e => e.preventDefault()}>
        <div className="ps-card-label">Duplicates</div>
        <div className={`ps-card-value ${dupeCount > 0 ? 'is-warning' : ''}`}>{dupeCount}</div>
        <div className="ps-card-meta">
          {dupeCount > 0 ? 'needs review' : 'none detected'}
        </div>
      </div>
    </div>
  )
}
