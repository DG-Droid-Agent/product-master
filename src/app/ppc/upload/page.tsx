'use client'
// app/ppc/upload/page.tsx

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const CAMPAIGN_TYPES = ['auto', 'broad', 'exact', 'phrase', 'other']
const DATE_RANGES = [
  { label: '7 days',  value: 7  },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '65 days', value: 65 },
  { label: 'Custom',  value: 0  },
]

interface FileEntry {
  file: File
  campaignName: string
  campaignType: string
  error: string | null
}

function inferType(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('auto'))   return 'auto'
  if (n.includes('broad'))  return 'broad'
  if (n.includes('exact'))  return 'exact'
  if (n.includes('phrase')) return 'phrase'
  return 'other'
}

function cleanName(filename: string): string {
  return filename
    .replace(/\.(csv|xlsx)$/i, '')
    .replace(/sponsored_products_searchterm[_\w]*/i, '')
    .replace(/apr_\d+_\d+/i, '')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_/g, ' ')
    .trim() || filename.replace(/\.(csv|xlsx)$/i, '')
}

export default function PPCUploadPage() {
  const router       = useRouter()
  const supabase     = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [brand, setBrand]         = useState('')
  const [brands, setBrands]       = useState<string[]>([])
  const [asin, setAsin]           = useState('')
  const [entries, setEntries]     = useState<FileEntry[]>([])
  const [dateRange, setDateRange] = useState(65)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  useState(() => {
    supabase.from('products').select('brand').then(({ data }) => {
      if (data) setBrands([...new Set(data.map((r: any) => r.brand).filter(Boolean))].sort())
    })
  })

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter(f => /\.(csv|xlsx)$/i.test(f.name))
    if (!valid.length) return
    setEntries(prev => {
      const existing = new Set(prev.map(e => e.file.name))
      const fresh = valid
        .filter(f => !existing.has(f.name))
        .map(f => ({ file: f, campaignName: cleanName(f.name), campaignType: inferType(f.name), error: null }))
      return [...prev, ...fresh]
    })
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }, [addFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    addFiles(Array.from(e.dataTransfer.files))
  }, [addFiles])

  const updateEntry = (i: number, field: keyof FileEntry, value: string) =>
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value, error: null } : e))

  const removeEntry = (i: number) =>
    setEntries(prev => prev.filter((_, idx) => idx !== i))

  const validate = (): boolean => {
    if (!brand.trim())   { setError('Select a brand'); return false }
    if (!entries.length) { setError('Add at least one file'); return false }
    if (!dateRange)      { setError('Select a date range'); return false }
    let ok = true
    setEntries(prev => prev.map(e => {
      if (!e.campaignName.trim()) { ok = false; return { ...e, error: 'Required' } }
      return e
    }))
    if (!ok) { setError('Fill in all campaign names'); return false }
    return true
  }

  const handleUpload = async () => {
    setError(null)
    if (!validate()) return
    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in — please sign in and try again')
      const { data: org } = await supabase.from('orgs').select('id').limit(1).single()
      if (!org) throw new Error('No organisation found')

      const form = new FormData()
      entries.forEach(e => form.append('files', e.file))
      form.append('org_id',          org.id)
      form.append('brand',           brand)
      form.append('asin',            asin)
      form.append('campaign_names',  JSON.stringify(entries.map(e => e.campaignName.trim())))
      form.append('campaign_types',  JSON.stringify(entries.map(e => e.campaignType)))
      form.append('date_range_days', String(dateRange))
      if (startDate) form.append('report_start_date', startDate)
      if (endDate)   form.append('report_end_date',   endDate)

      const res  = await fetch('/api/ppc/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) {
        setError(json.duplicate
          ? `Duplicate: "${json.campaign_name}" for this date range already exists.`
          : json.error ?? 'Upload failed')
        return
      }
      const ids = json.uploads.map((u: any) => u.upload_id).join(',')
      router.push(`/ppc/analysis?upload_ids=${ids}&date_range_days=${dateRange}&brand=${encodeURIComponent(brand)}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: 16, marginBottom: 12,
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
    letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 12, display: 'block',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '7px 10px', fontSize: 13, color: 'var(--text)',
    boxSizing: 'border-box' as const,
  }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>

      {/* Back + title */}
      <button onClick={() => router.push('/ppc')}
        style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10 }}>
        ← PPC Manager
      </button>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Upload search term reports</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20 }}>
        Drop one or more files to run negative targeting and keyword harvesting analysis.
        Hold <kbd style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', fontSize: 11 }}>Ctrl</kbd> when selecting to pick multiple files at once.
      </div>

      {/* 1 · Brand */}
      <div style={sectionStyle}>
        <span style={labelStyle}>1 · Brand &amp; product</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Brand <span style={{ color: 'var(--red)' }}>*</span></div>
            <select value={brand} onChange={e => setBrand(e.target.value)} style={inputStyle}>
              <option value="">Select brand…</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>ASIN <span style={{ color: 'var(--text3)' }}>(optional)</span></div>
            <input type="text" placeholder="B0XXXXXXXXX" value={asin}
              onChange={e => setAsin(e.target.value.toUpperCase())}
              style={{ ...inputStyle, fontFamily: 'var(--mono)' }} />
          </div>
        </div>
      </div>

      {/* 2 · Date range */}
      <div style={sectionStyle}>
        <span style={labelStyle}>2 · Date range</span>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
          Must match the date range you set in Amazon when exporting the report.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 }}>
          {DATE_RANGES.map(opt => (
            <button key={opt.value} onClick={() => setDateRange(opt.value)} style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: dateRange === opt.value ? 'var(--accent)' : 'var(--surface2)',
              color:      dateRange === opt.value ? '#fff' : 'var(--text)',
              border:     `1px solid ${dateRange === opt.value ? 'var(--accent)' : 'var(--border)'}`,
              fontWeight: dateRange === opt.value ? 600 : 400,
            }}>{opt.label}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>Start date (optional)</div>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>End date (optional)</div>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* 3 · Files */}
      <div style={sectionStyle}>
        <span style={labelStyle}>3 · Upload files</span>

        {/* Drop zone — click triggers ref, no nested input */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 8, padding: '24px 20px', textAlign: 'center' as const,
            cursor: 'pointer', transition: 'all .15s',
            background: dragOver ? 'var(--accent-light)' : 'var(--surface2)',
            marginBottom: entries.length ? 12 : 0,
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
            Drop CSV or XLSX files here, or <span style={{ color: 'var(--accent)', textDecoration: 'underline' }}>click to browse</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Select multiple files at once — hold Ctrl (Windows) or Cmd (Mac)
          </div>
        </div>

        {/* Single hidden input — multiple attribute enables multi-select */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx"
          style={{ display: 'none' }}
          onChange={handleChange}
        />

        {/* File list */}
        {entries.map((entry, i) => (
          <div key={i} style={{
            background: 'var(--surface2)', borderRadius: 7, padding: 12,
            border: `1px solid ${entry.error ? 'var(--red)' : 'var(--border)'}`,
            marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '90%' }}>
                📄 {entry.file.name}
              </span>
              <button onClick={() => removeEntry(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 13, padding: 0, flexShrink: 0 }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>
                  Campaign name <span style={{ color: 'var(--red)' }}>*</span>
                </div>
                <input type="text" value={entry.campaignName} placeholder="e.g. coir_basic_auto"
                  onChange={e => updateEntry(i, 'campaignName', e.target.value)}
                  style={{ ...inputStyle, fontSize: 12, padding: '5px 8px', border: `1px solid ${entry.error ? 'var(--red)' : 'var(--border)'}` }} />
                {entry.error && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>{entry.error}</div>}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Type</div>
                <select value={entry.campaignType} onChange={e => updateEntry(i, 'campaignType', e.target.value)}
                  style={{ ...inputStyle, fontSize: 12, padding: '5px 8px' }}>
                  {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'var(--red-light, rgba(220,38,38,.08))', border: '1px solid var(--red)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--red)',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
        <button className="btn-secondary" onClick={() => router.push('/ppc')}>← Back</button>
        <button
          className="btn-primary"
          onClick={handleUpload}
          disabled={uploading || entries.length === 0}
          style={{ opacity: uploading || entries.length === 0 ? 0.5 : 1 }}
        >
          {uploading ? '⟳ Uploading…'
            : entries.length === 0 ? 'Add files to continue'
            : `Upload ${entries.length} file${entries.length > 1 ? 's' : ''} & run analysis`}
        </button>
      </div>

    </div>
  )
}
