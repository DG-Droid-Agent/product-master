'use client'

import type { Product } from '@/lib/types'
import { brandColor } from '@/lib/types'

export default function Pipeline({ products, onActivate, onDelete }: {
  products: Product[]
  onActivate: (p: Product) => void
  onDelete: (id: string) => void
}) {
  if (!products.length) {
    return <div className="empty"><div className="ei">✅</div><div>No pipeline items</div></div>
  }

  return (
    <div className="pipe-wrap">
      {products.map(p => (
        <div key={p.id || p.warpfy_code} className="pipe-card">
          <div>
            <div style={{ fontSize: 13, marginBottom: 3 }}>{p.product_name || 'Unnamed'}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12 }}>
              <span style={{ color: brandColor(p.brand ?? '') }}>{p.brand}</span>
              <span>{p.category}</span>
              <span style={{ fontFamily: 'var(--mono)' }}>{p.warpfy_code}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => onActivate(p)}>
              → Activate
            </button>
            {p.id && (
              <button className="btn-danger" style={{ padding: '5px 9px', fontSize: 11 }} onClick={() => onDelete(p.id!)}>
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
