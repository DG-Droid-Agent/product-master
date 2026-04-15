'use client'
// app/ppc/upload/page.tsx
// Upload search term report files, tag campaigns, confirm date range.

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const CAMPAIGN_TYPES = ['auto', 'broad', 'exact', 'phrase', 'other']
const DATE_RANGE_OPTIONS = [
  { label: '7 days',       value: 7 },
  { label: '30 days',      value: 30 },
  { label: '60 days',      value: 60 },
  { label: '65 days',      value: 65 },
  { label: 'Custom range', value: 0 },
]

interface FileEntry {
  file: File
  campaignName: string
  campaignType: string
  error: string | null
}

export default function PPCUploadPage() {
  const router  = useRouter()
  const supabase = createClient()

  const [brand, setBrand]           = useState<string>('')
  const [brands, setBrands]         = useState<string[]>([])
  const [asin, setAsin]             = useState('')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [dateRangeDays, setDateRangeDays] = useState<number>(65)
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate]     = useState('')
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [dragOver, setDragOver]     = useState(false)

  // Load brands on mount
  useState(() => {
    supabase.from('products').select('brand').then(({ data }) => {
      if (data) setBrands([...new Set(data.map((r: any) => r.brand).filter(Boolean))].sort())
    })
  })

  const addFiles = useCallback((newFiles: File[]) => {
    const entries: FileEntry[] = newFiles.map(f => ({
      file: f,
      campaignName: f.name.replace(/\.(csv|xlsx)$/i, '').replace(/_/g, ' '),
      campaignType: f.name.toLowerCase().includes('auto') ? 'auto'
        : f.name.toLowerCase().includes('broad') ? 'broad'
        : f.name.toLowerCase().includes('exact') ? 'exact'
        : 'other',
      error: null,
    }))
    setFileEntries(prev => [...prev, ...entries])
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(csv|xlsx)$/i.test(f.name))
    if (files.length) addFiles(files)
  }

  const updateEntry = (index: number, field: keyof FileEntry, value: string) => {
    setFileEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e))
  }

  const removeEntry = (index: number) => {
    setFileEntries(prev => prev.filter((_, i) => i !== index))
  }

  const validate = () => {
    let valid = true
    setFileEntries(prev => prev.map(e => {
      if (!e.campaignName.trim()) {
        valid = false
        return { ...e, error: 'Campaign name required' }
      }
      return { ...e, error: null }
    }))
    if (!brand.trim())    { setError('Select a brand'); return false }
    if (!fileEntries.length) { setError('Add at least one file'); return false }
    if (!dateRangeDays)   { setError('Select a date range'); return false }
    return valid
  }

  const handleUpload = async () => {
    if (!validate()) return
    setUploading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: orgMember } = await supabase
        .from('orgs').select('id').limit(1).single()
      if (!orgMember) throw new Error('No organisation found')

      const formData = new FormData()
      fileEntries.forEach(e => formData.append('files', e.file))
      formData.append('org_id',         orgMember.id)
      formData.append('brand',       brand)
      formData.append('asin',           asin)
      formData.append('campaign_names', JSON.stringify(fileEntries.map(e => e.campaignName.trim())))
      formData.append('campaign_types', JSON.stringify(fileEntries.map(e => e.campaignType)))
      formData.append('date_range_days', String(dateRangeDays))
      if (reportStartDate) formData.append('report_start_date', reportStartDate)
      if (reportEndDate)   formData.append('report_end_date',   reportEndDate)

      const res = await fetch('/api/ppc/upload', { method: 'POST', body: formData })
      const json = await res.json()

      if (!res.ok) {
        if (json.duplicate) {
          setError(`Duplicate detected: "${json.campaign_name}" for this date range is already uploaded. Choose a different date range or delete the existing upload.`)
        } else {
          throw new Error(json.error ?? 'Upload failed')
        }
        return
      }

      // Navigate to analysis page with the new upload IDs
      const uploadIds = json.uploads.map((u: any) => u.upload_id).join(',')
      router.push(`/ppc/analysis?upload_ids=${uploadIds}&date_range_days=${dateRangeDays}&brand=${encodeURIComponent(brand ?? '')}`)

    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">PPC — Upload search term reports</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload one or more search term report files to run negative targeting and keyword harvesting analysis.
          You can combine multiple campaigns from the same portfolio into a single analysis.
        </p>
      </div>

      {/* Brand + ASIN */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">1. Brand & product</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Brand <span className="text-red-500">*</span></label>
            <select
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              value={brand}
              onChange={e => setBrand(e.target.value)}
            >
              <option value="">Select brand…</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">ASIN (optional — for product-level tracking)</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
              placeholder="B0XXXXXXXXX"
              value={asin}
              onChange={e => setAsin(e.target.value.toUpperCase())}
            />
          </div>
        </div>
      </div>

      {/* Date range */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">2. Date range</h2>
        <p className="text-xs text-gray-500 mb-3">
          This affects significance thresholds. Make sure it matches the date range you set in Amazon when downloading the report.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {DATE_RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                dateRangeDays === opt.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
              onClick={() => setDateRangeDays(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {dateRangeDays === 0 && (
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Start date</label>
              <input type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">End date</label>
              <input type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
            </div>
          </div>
        )}
        {dateRangeDays > 0 && (
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Report start date (optional)</label>
              <input type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Report end date (optional)</label>
              <input type="date" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      {/* File drop zone */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-medium text-gray-700 mb-3">3. Upload files</h2>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <div className="text-3xl mb-2">📂</div>
          <p className="text-sm text-gray-600">Drop CSV or XLSX files here, or click to browse</p>
          <p className="text-xs text-gray-400 mt-1">You can drop multiple files at once for portfolio analysis</p>
          <input
            id="file-input" type="file" multiple accept=".csv,.xlsx" className="hidden"
            onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)) }}
          />
        </div>

        {/* File list */}
        {fileEntries.length > 0 && (
          <div className="mt-4 space-y-3">
            {fileEntries.map((entry, i) => (
              <div key={i} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 truncate mb-2">{entry.file.name}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Campaign name <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        className={`w-full border rounded px-2 py-1 text-xs ${entry.error ? 'border-red-400' : 'border-gray-300'}`}
                        value={entry.campaignName}
                        onChange={e => updateEntry(i, 'campaignName', e.target.value)}
                        placeholder="e.g. coir_basic_auto"
                      />
                      {entry.error && <p className="text-xs text-red-500 mt-0.5">{entry.error}</p>}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Campaign type</label>
                      <select
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                        value={entry.campaignType}
                        onChange={e => updateEntry(i, 'campaignType', e.target.value)}
                      >
                        {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <button onClick={() => removeEntry(i)} className="text-gray-400 hover:text-red-500 text-sm mt-1">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-between items-center">
        <button onClick={() => router.push('/ppc')} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to PPC
        </button>
        <button
          onClick={handleUpload}
          disabled={uploading || !fileEntries.length}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : `Upload ${fileEntries.length > 0 ? `${fileEntries.length} file${fileEntries.length > 1 ? 's' : ''} & run analysis` : 'files'}`}
        </button>
      </div>
    </div>
  )
}
