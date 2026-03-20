'use client'

import { useState } from 'react'
import type { Asin, SalesVelocity, PlanningOutput } from '@/lib/inventory'
import { calcFinalVelocity, calcPlanning, statusConfig, fmtDays, fmtUnits } from '@/lib/inventory'

export default function VelocityPanel({ orgId, asin, velocity, planning, snapshotDate, onSave, onClose }: {
  orgId: string
  asin: Asin
  velocity?: SalesVelocity
  planning?: PlanningOutput
  snapshotDate: string
  onSave: (updated: Asin) => Promise<void>
  onClose: () => void
}) {
  const [teamPush, setTeamPush] = useState(asin.team_push_multiplier ?? 1.0)
  const [teamNotes, setTeamNotes] = useState(asin.team_push_notes ?? '')
  const [seasonality, setSeasonality] = useState(velocity?.seasonality_multiplier ?? 1.0)
  const [searchTrend, setSearchTrend] = useState(velocity?.search_trend_multiplier ?? 1.0)
  const [saving, setSaving] = useState(false)

  const baseVel = velocity?.base_velocity ?? 0
  const previewFinal = calcFinalVelocity(baseVel, seasonality, searchTrend, teamPush)

  // Preview planning with new velocity
  const previewPlan = previewFinal > 0 ? calcPlanning(
    asin,
    planning?.true_inventory_units ?? 0,
    previewFinal,
    0, 0
  ) : null

  const cfg = statusConfig(previewPlan?.status ?? planning?.status ?? 'healthy')

  async function save() {
    setSaving(true)
    await onSave({
      ...asin,
      team_push_multiplier: teamPush,
      team_push_notes: teamNotes,
    })
    setSaving(false)
  }

  function MultiplierSlider({ label, description, value, onChange, color }: {
    label: string; description: string; value: number;
    onChange: (v: number) => void; color: string
  }) {
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color }}>{label}</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{description}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" step="0.01" min="0.1" max="5"
              value={value}
              onChange={e => onChange(Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 1)))}
              style={{ width: 70, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right', background: 'var(--surface2)', color, outline: 'none', fontWeight: 600 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>×</span>
          </div>
        </div>
        <input type="range" min="0.1" max="3" step="0.05" value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: color }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
          <span>0.1× slow</span>
          <span style={{ color: value === 1 ? 'var(--accent)' : 'var(--text3)', fontWeight: value === 1 ? 600 : 400 }}>1.0× baseline</span>
          <span>3.0× fast</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, width: 560, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,.15)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{asin.product_name || asin.asin}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{asin.asin} · {asin.brand}</div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

          {/* Velocity breakdown */}
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 10 }}>Base Velocity (7/30/60/90 day weighted)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
              {[
                { label: '7 day', val: velocity?.velocity_7d ?? 0, weight: '40%' },
                { label: '30 day', val: velocity?.velocity_30d ?? 0, weight: '30%' },
                { label: '60 day', val: velocity?.velocity_60d ?? 0, weight: '20%' },
                { label: '90 day', val: velocity?.velocity_90d ?? 0, weight: '10%' },
              ].map(v => (
                <div key={v.label} style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--surface)', borderRadius: 6 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{v.val.toFixed(1)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{v.label}</div>
                  <div style={{ fontSize: 9, color: 'var(--accent)', marginTop: 1 }}>weight {v.weight}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Base velocity</span>
              <span style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{baseVel.toFixed(2)}/day</span>
            </div>
          </div>

          {/* Multipliers */}
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 14 }}>Velocity Multipliers</div>

          <MultiplierSlider label="S — Seasonality" description="Expected demand vs annual average" value={seasonality} onChange={setSeasonality} color="#1a4a8c" />
          <MultiplierSlider label="K — Search Trend" description="Keyword volume trend" value={searchTrend} onChange={setSearchTrend} color="#8a6a00" />

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>T — Team Push</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>Strategic investment this period</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.05" min="0.1" max="5" value={teamPush}
                  onChange={e => setTeamPush(Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 1)))}
                  style={{ width: 70, padding: '4px 8px', border: '1px solid rgba(26,107,60,.4)', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right', background: 'var(--accent-light)', color: 'var(--accent)', outline: 'none', fontWeight: 600 }} />
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>×</span>
              </div>
            </div>
            <input type="range" min="0.1" max="3" step="0.05" value={teamPush}
              onChange={e => setTeamPush(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <div style={{ marginTop: 8 }}>
              <input value={teamNotes} onChange={e => setTeamNotes(e.target.value)}
                placeholder="Why are you pushing this product? (e.g. Q4 push, launching ads, new variant)"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--font)', fontSize: 12, background: 'var(--surface2)', color: 'var(--text)', outline: 'none' }} />
            </div>
          </div>

          {/* Live preview */}
          <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: cfg.color, marginBottom: 12 }}>Live Preview</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Final Velocity', val: `${previewFinal.toFixed(2)}/day` },
                { label: 'Coverage', val: fmtDays(previewPlan?.coverage_days ?? planning?.coverage_days ?? 0) },
                { label: 'Units to Order', val: fmtUnits(previewPlan?.units_to_order ?? 0) },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--mono)', color: cfg.color }}>{item.val}</div>
                  <div style={{ fontSize: 10, color: cfg.color, opacity: .7, marginTop: 2 }}>{item.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: cfg.color, opacity: .8 }}>
              {baseVel.toFixed(2)} × {seasonality.toFixed(2)} × {searchTrend.toFixed(2)} × {teamPush.toFixed(2)} = <strong>{previewFinal.toFixed(2)}/day</strong>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '⟳ Saving…' : 'Save Multipliers'}
          </button>
        </div>
      </div>
    </div>
  )
}
