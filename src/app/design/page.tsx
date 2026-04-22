'use client'

/* ============================================================================
   /design — Warpfy Design System reference page
   ----------------------------------------------------------------------------
   Visual reference for every token and component pattern. Bookmark this.
   When working with AI, paste the live URL as reference.
   ============================================================================ */

export default function DesignSystemPage() {
  return (
    <div className="ds-page">
      <header className="ds-header">
        <div className="ds-header-left">
          <div className="ds-mark">W</div>
          <div>
            <div className="ds-title">Warpfy Design System</div>
            <div className="ds-sub">v1.0 · April 2026</div>
          </div>
        </div>
        <a className="ds-link" href="/">← Back to app</a>
      </header>

      <main className="ds-main">
        {/* COLOR */}
        <Section title="Color" number="01">
          <div className="ds-subsection">
            <div className="ds-label">Surfaces</div>
            <div className="ds-swatches">
              <Swatch name="bg" var="--bg" />
              <Swatch name="surface" var="--surface" />
              <Swatch name="surface-2" var="--surface-2" />
              <Swatch name="surface-3" var="--surface-3" />
              <Swatch name="surface-raised" var="--surface-raised" />
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Text</div>
            <div className="ds-swatches">
              <Swatch name="text" var="--text" sample />
              <Swatch name="text-2" var="--text-2" sample />
              <Swatch name="text-3" var="--text-3" sample />
              <Swatch name="text-4" var="--text-4" sample />
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Accent · Electric Blue</div>
            <div className="ds-swatches">
              <Swatch name="accent" var="--accent" />
              <Swatch name="accent-hover" var="--accent-hover" />
              <Swatch name="accent-pressed" var="--accent-pressed" />
              <Swatch name="accent-tint" var="--accent-tint" />
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Semantic</div>
            <div className="ds-swatches">
              <Swatch name="success" var="--success" />
              <Swatch name="warning" var="--warning" />
              <Swatch name="danger" var="--danger" />
              <Swatch name="info" var="--info" />
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Borders</div>
            <div className="ds-swatches">
              <Swatch name="border" var="--border" />
              <Swatch name="border-strong" var="--border-strong" />
              <Swatch name="border-subtle" var="--border-subtle" />
            </div>
          </div>
        </Section>

        {/* TYPOGRAPHY */}
        <Section title="Typography" number="02">
          <div className="ds-type">
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-3xl · 32</span>
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>Operating system for modern sellers</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-2xl · 24</span>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, letterSpacing: '-0.01em' }}>$12,847 wasted spend</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-xl · 20</span>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600 }}>Page title / section header</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-lg · 16</span>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 500 }}>Subsection header</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-md · 14</span>
              <div style={{ fontSize: 'var(--text-md)' }}>Emphasized body copy and card labels</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-base · 13</span>
              <div style={{ fontSize: 'var(--text-base)' }}>Default UI text — buttons, menu items, forms</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-sm · 12</span>
              <div style={{ fontSize: 'var(--text-sm)' }}>Table cells and dense data</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">text-xs · 11</span>
              <div style={{ fontSize: 'var(--text-xs)' }}>METADATA, BADGES, CAPTIONS</div>
            </div>
            <div className="ds-type-row">
              <span className="ds-type-tag mono">mono · tabular</span>
              <div className="mono" style={{ fontSize: 'var(--text-md)' }}>$1,847.62 · 31,429 units · 72.4% coverage</div>
            </div>
          </div>
        </Section>

        {/* SPACING */}
        <Section title="Spacing" number="03">
          <div className="ds-spacing">
            {[
              ['space-2', 4], ['space-3', 6], ['space-4', 8], ['space-5', 12],
              ['space-6', 16], ['space-7', 20], ['space-8', 24], ['space-9', 32],
              ['space-10', 40], ['space-11', 48], ['space-12', 64],
            ].map(([name, px]) => (
              <div key={name} className="ds-spacing-row">
                <span className="ds-type-tag mono">{name}</span>
                <div className="ds-spacing-bar" style={{ width: `${px}px` }} />
                <span className="mono ds-spacing-val">{px}px</span>
              </div>
            ))}
          </div>
        </Section>

        {/* COMPONENTS */}
        <Section title="Components" number="04">
          <div className="ds-subsection">
            <div className="ds-label">Buttons</div>
            <div className="ds-row">
              <button className="ds-btn ds-btn-primary">Primary</button>
              <button className="ds-btn ds-btn-ghost">Ghost</button>
              <button className="ds-btn ds-btn-danger">Danger</button>
              <button className="ds-btn ds-btn-primary" disabled>Disabled</button>
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Pills / Badges</div>
            <div className="ds-row">
              <span className="ds-pill ds-pill-accent">Live</span>
              <span className="ds-pill ds-pill-success">Healthy</span>
              <span className="ds-pill ds-pill-warning">At Risk</span>
              <span className="ds-pill ds-pill-danger">Critical</span>
              <span className="ds-pill ds-pill-muted">Soon</span>
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Cards</div>
            <div className="ds-grid">
              <div className="ds-card">
                <div className="ds-card-label">Total spend</div>
                <div className="ds-card-value mono">$12,847.62</div>
                <div className="ds-card-delta ds-delta-up mono">↑ 14.2%</div>
              </div>
              <div className="ds-card">
                <div className="ds-card-label">Wasted spend</div>
                <div className="ds-card-value mono" style={{ color: 'var(--danger)' }}>$1,284.60</div>
                <div className="ds-card-delta ds-delta-down mono">↓ 3.8%</div>
              </div>
              <div className="ds-card">
                <div className="ds-card-label">Coverage</div>
                <div className="ds-card-value mono" style={{ color: 'var(--success)' }}>142 days</div>
                <div className="ds-card-delta mono" style={{ color: 'var(--text-3)' }}>Target: 150</div>
              </div>
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Inputs</div>
            <div className="ds-row">
              <input className="ds-input" placeholder="Search…" />
              <select className="ds-input" defaultValue="">
                <option value="">All Brands</option>
                <option>The Fine Living Company</option>
              </select>
            </div>
          </div>

          <div className="ds-subsection">
            <div className="ds-label">Coverage bar</div>
            <div className="ds-cov">
              <div className="ds-cov-label">
                <span>Bamboo Cutting Board</span>
                <span className="mono">127 days</span>
              </div>
              <div className="ds-cov-track">
                <div className="ds-cov-fill" style={{ width: '84%', background: 'var(--success)' }} />
              </div>
            </div>
            <div className="ds-cov" style={{ marginTop: 12 }}>
              <div className="ds-cov-label">
                <span>Silicone Mat Large</span>
                <span className="mono">42 days</span>
              </div>
              <div className="ds-cov-track">
                <div className="ds-cov-fill" style={{ width: '28%', background: 'var(--danger)' }} />
              </div>
            </div>
          </div>
        </Section>

        {/* ELEVATION */}
        <Section title="Elevation" number="05">
          <div className="ds-row ds-row-elev">
            <div className="ds-elev" style={{ boxShadow: 'var(--shadow-sm)' }}>shadow-sm</div>
            <div className="ds-elev" style={{ boxShadow: 'var(--shadow-md)' }}>shadow-md</div>
            <div className="ds-elev" style={{ boxShadow: 'var(--shadow-lg)' }}>shadow-lg</div>
            <div className="ds-elev" style={{ boxShadow: 'var(--shadow-popover)' }}>popover</div>
          </div>
        </Section>

        <footer className="ds-footer">
          <div>Warpfy Design System · v1.0</div>
          <div className="mono">Last updated · {new Date().toISOString().split('T')[0]}</div>
        </footer>
      </main>

      <style jsx global>{`
        .ds-page { min-height: 100vh; background: var(--bg); color: var(--text); font-family: var(--font-sans); }
        .ds-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: var(--space-7) var(--space-11);
          border-bottom: 1px solid var(--border);
          position: sticky; top: 0; background: var(--bg); z-index: 10;
        }
        .ds-header-left { display: flex; align-items: center; gap: var(--space-5); }
        .ds-mark {
          width: 32px; height: 32px; border-radius: var(--radius-md);
          background: var(--accent); color: #fff;
          display: grid; place-items: center;
          font-weight: var(--weight-bold); font-size: var(--text-md);
          box-shadow: 0 0 24px var(--accent-glow);
        }
        .ds-title { font-size: var(--text-md); font-weight: var(--weight-semibold); letter-spacing: -0.01em; }
        .ds-sub { font-size: var(--text-xs); color: var(--text-3); margin-top: 2px; }
        .ds-link { color: var(--text-2); text-decoration: none; font-size: var(--text-sm); }
        .ds-link:hover { color: var(--accent); }

        .ds-main { max-width: 1080px; margin: 0 auto; padding: var(--space-11) var(--space-11) var(--space-12); }
        .ds-section { margin-bottom: var(--space-12); }
        .ds-section-head {
          display: flex; align-items: baseline; gap: var(--space-5);
          margin-bottom: var(--space-9);
          padding-bottom: var(--space-5);
          border-bottom: 1px solid var(--border);
        }
        .ds-section-num {
          font-family: var(--font-mono); font-size: var(--text-xs);
          color: var(--text-3); letter-spacing: 0.1em;
        }
        .ds-section-title { font-size: var(--text-xl); font-weight: var(--weight-semibold); letter-spacing: -0.01em; }
        .ds-subsection { margin-bottom: var(--space-9); }
        .ds-label {
          font-size: var(--text-xs); color: var(--text-3);
          text-transform: uppercase; letter-spacing: 0.08em;
          margin-bottom: var(--space-5);
          font-weight: var(--weight-medium);
        }
        .ds-row { display: flex; flex-wrap: wrap; gap: var(--space-5); align-items: center; }
        .ds-row-elev { padding: var(--space-9) 0; }
        .ds-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-5); }

        .ds-swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-5); }
        .ds-swatch {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          overflow: hidden; background: var(--surface);
        }
        .ds-swatch-chip { height: 72px; }
        .ds-swatch-meta { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-subtle); }
        .ds-swatch-name { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
        .ds-swatch-var { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); margin-top: 2px; }
        .ds-swatch-text { padding: var(--space-5); font-size: var(--text-md); }

        .ds-type-row { display: flex; align-items: baseline; gap: var(--space-7); padding: var(--space-5) 0; border-bottom: 1px dashed var(--border-subtle); }
        .ds-type-tag {
          width: 140px; font-size: 10px; color: var(--text-3);
          text-transform: uppercase; letter-spacing: 0.08em;
          font-family: var(--font-mono);
        }

        .ds-spacing { display: flex; flex-direction: column; gap: var(--space-3); }
        .ds-spacing-row { display: flex; align-items: center; gap: var(--space-7); }
        .ds-spacing-bar { height: 12px; background: var(--accent); border-radius: var(--radius-xs); }
        .ds-spacing-val { font-size: var(--text-xs); color: var(--text-3); }

        .ds-btn {
          height: 32px; padding: 0 var(--space-6);
          border: 1px solid transparent; border-radius: var(--radius-md);
          font-family: inherit; font-size: var(--text-sm); font-weight: var(--weight-medium);
          cursor: pointer; transition: all var(--duration-fast) var(--ease);
        }
        .ds-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ds-btn-primary { background: var(--accent); color: #fff; }
        .ds-btn-primary:not(:disabled):hover { background: var(--accent-hover); }
        .ds-btn-ghost { background: transparent; border-color: var(--border); color: var(--text); }
        .ds-btn-ghost:hover { background: var(--surface-2); border-color: var(--border-strong); }
        .ds-btn-danger { background: var(--danger-tint); border-color: var(--danger-tint); color: var(--danger); }
        .ds-btn-danger:hover { background: var(--danger); color: #fff; }

        .ds-pill {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: var(--radius-xs);
          font-size: 10px; font-weight: var(--weight-semibold);
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .ds-pill-accent { background: var(--accent-tint); color: var(--accent); }
        .ds-pill-success { background: var(--success-tint); color: var(--success); }
        .ds-pill-warning { background: var(--warning-tint); color: var(--warning); }
        .ds-pill-danger { background: var(--danger-tint); color: var(--danger); }
        .ds-pill-muted { background: var(--surface-3); color: var(--text-3); }

        .ds-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: var(--space-7);
        }
        .ds-card-label { font-size: var(--text-xs); color: var(--text-3); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: var(--space-4); }
        .ds-card-value { font-size: var(--text-2xl); font-weight: var(--weight-semibold); letter-spacing: -0.02em; }
        .ds-card-delta { font-size: var(--text-xs); margin-top: var(--space-3); }
        .ds-delta-up { color: var(--success); }
        .ds-delta-down { color: var(--danger); }

        .ds-input {
          height: 32px; padding: 0 var(--space-5);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-md); color: var(--text);
          font-family: inherit; font-size: var(--text-sm);
          min-width: 200px;
        }
        .ds-input:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-accent); }

        .ds-cov { display: flex; flex-direction: column; gap: var(--space-3); }
        .ds-cov-label { display: flex; justify-content: space-between; font-size: var(--text-sm); color: var(--text-2); }
        .ds-cov-track { height: 6px; background: var(--surface-3); border-radius: var(--radius-full); overflow: hidden; }
        .ds-cov-fill { height: 100%; border-radius: var(--radius-full); transition: width 0.6s var(--ease-out); }

        .ds-elev {
          width: 160px; height: 100px; background: var(--surface);
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          display: grid; place-items: center;
          font-size: var(--text-xs); color: var(--text-3);
          font-family: var(--font-mono);
        }

        .ds-footer {
          display: flex; justify-content: space-between;
          margin-top: var(--space-12); padding-top: var(--space-7);
          border-top: 1px solid var(--border);
          font-size: var(--text-xs); color: var(--text-3);
        }
      `}</style>
    </div>
  )
}

function Section({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  return (
    <section className="ds-section">
      <div className="ds-section-head">
        <div className="ds-section-num">{number}</div>
        <div className="ds-section-title">{title}</div>
      </div>
      {children}
    </section>
  )
}

function Swatch({ name, var: cssVar, sample }: { name: string; var: string; sample?: boolean }) {
  if (sample) {
    return (
      <div className="ds-swatch">
        <div className="ds-swatch-text" style={{ color: `var(${cssVar})` }}>The quick brown fox</div>
        <div className="ds-swatch-meta">
          <div className="ds-swatch-name">{name}</div>
          <div className="ds-swatch-var">{cssVar}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-chip" style={{ background: `var(${cssVar})` }} />
      <div className="ds-swatch-meta">
        <div className="ds-swatch-name">{name}</div>
        <div className="ds-swatch-var">{cssVar}</div>
      </div>
    </div>
  )
}
