import { useEffect, useState } from 'react'
import { fmtDate } from '../lib/dateFormat'
import api from '../lib/api'

function fmt(v) {
  return Number(v || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

const TYPE_COLORS = {
  BUY:  'bg-blue-100 text-blue-800',
  SELL: 'bg-red-100 text-red-800',
  DIV:  'bg-emerald-100 text-emerald-800',
  CONT: 'bg-purple-100 text-purple-800',
}
const TYPE_LABELS = {
  BUY: 'Buy', SELL: 'Sell', DIV: 'Dividend', CONT: 'Contribution',
}

function FileDropZone({ onFilesSelected }) {
  const [dragging, setDragging] = useState(false)
  const [addedFiles, setAddedFiles] = useState([])

  const processNewFiles = (newFiles) => {
    const all = [...addedFiles]
    for (const f of newFiles) {
      if (!all.find(e => e.name === f.name)) all.push(f)
    }
    const sorted = all.sort((a, b) => a.name.localeCompare(b.name))
    setAddedFiles(sorted)
    onFilesSelected(sorted)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith('.csv') || f.name.endsWith('.tsv')
    )
    if (dropped.length > 0) processNewFiles(dropped)
  }

  const handleInput = (e) => {
    const selected = Array.from(e.target.files || [])
    if (selected.length > 0) processNewFiles(selected)
    e.target.value = ''
  }

  const removeFile = (name) => {
    const updated = addedFiles.filter(f => f.name !== name)
    setAddedFiles(updated)
    onFilesSelected(updated)
  }

  const clearAll = () => {
    setAddedFiles([])
    onFilesSelected([])
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragging ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-emerald-400 hover:bg-emerald-50'
        }`}
      >
        <div className="text-3xl mb-2">📂</div>
        <p className="text-sm font-semibold text-gray-700 mb-1">Drag & drop CSV files here</p>
        <p className="text-xs text-gray-500 mb-3">Drop multiple files at once — imported in sorted order</p>
        <label className="cursor-pointer inline-block">
          <span className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-md font-medium">
            Browse & Add Files
          </span>
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/plain"
            multiple
            onChange={handleInput}
            className="hidden"
          />
        </label>
        <p className="text-xs text-gray-400 mt-2">
          💡 Click "Browse & Add Files" multiple times to add files one by one
        </p>
      </div>

      {addedFiles.length > 0 && (
        <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-700">
              {addedFiles.length} file{addedFiles.length > 1 ? 's' : ''} queued
              {addedFiles.length > 1 && ' — sorted alphabetically'}
            </span>
            <button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700">Clear all</button>
          </div>
          <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
            {addedFiles.map((f, i) => (
              <div key={f.name} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 w-5 text-center font-medium">{i + 1}</span>
                  <span className="text-gray-700 font-medium">📄 {f.name}</span>
                  <span className="text-gray-400">({(f.size / 1024).toFixed(1)} KB)</span>
                </div>
                <button onClick={() => removeFile(f.name)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Import() {
  const [portfolios, setPortfolios] = useState([])
  const [portfolioId, setPortfolioId] = useState('')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [files, setFiles] = useState([])
  const [currentFileIdx, setCurrentFileIdx] = useState(0)
  const [batchMode, setBatchMode] = useState(false)
  const [batchResults, setBatchResults] = useState([])
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [contributions, setContributions] = useState(null)
  const [contLoading, setContLoading] = useState(false)

  useEffect(() => {
    api.get('/portfolios').then(({ data }) => {
      setPortfolios(data)
      if (data.length > 0) {
        setPortfolioId(String(data[0].id))
        loadContributions(data[0].id)
      }
    })
  }, [])

  const loadContributions = async (pid) => {
    if (!pid) return
    setContLoading(true)
    try {
      const { data } = await api.get(`/imports/contributions/${pid}`)
      setContributions(data)
    } catch {
      setContributions(null)
    } finally {
      setContLoading(false)
    }
  }

  const handlePortfolioChange = (e) => {
    setPortfolioId(e.target.value)
    loadContributions(e.target.value)
  }

  const readFileAsText = (f) => new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsText(f)
  })

  const handleFilesSelected = async (selectedFiles) => {
    if (!selectedFiles || selectedFiles.length === 0) {
      setBatchMode(false)
      setFiles([])
      setCsvText('')
      setFileName('')
      setPreview(null)
      return
    }
    if (selectedFiles.length === 1) {
      setBatchMode(false)
      setFiles([])
      setFileName(selectedFiles[0].name)
      const text = await readFileAsText(selectedFiles[0])
      setCsvText(text)
      setPreview(null)
      setError('')
      setInfo('')
    } else {
      setBatchMode(true)
      const fileObjects = await Promise.all(selectedFiles.map(async (f) => ({
        name: f.name,
        size: f.size,
        text: await readFileAsText(f),
        status: 'pending',
        result: null,
        error: null,
      })))
      setFiles(fileObjects)
      setCurrentFileIdx(0)
      setCsvText(fileObjects[0].text)
      setFileName(fileObjects[0].name)
      setPreview(null)
      setError('')
      setInfo(`${fileObjects.length} files loaded. Click "Import All Files" to process all, or "Preview" to review one by one.`)
      setBatchResults([])
    }
  }

  const handleBatchImport = async () => {
    if (!portfolioId) { setError('Pick a portfolio first'); return }
    setError('')
    setLoading(true)
    const results = []
    const updatedFiles = [...files]

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      setCurrentFileIdx(i)
      setInfo(`Processing file ${i + 1} of ${files.length}: ${f.name}...`)
      updatedFiles[i] = { ...updatedFiles[i], status: 'processing' }
      setFiles([...updatedFiles])

      try {
        const { data: previewData } = await api.post('/imports/wealthsimple/preview', {
          portfolio_id: Number(portfolioId),
          csv: f.text,
        })
        const toImport = previewData.items.filter(it => !it.duplicate)
        const dupeCount = previewData.items.filter(it => it.duplicate).length

        if (toImport.length === 0) {
          updatedFiles[i] = { ...updatedFiles[i], status: 'done', result: { imported: 0, duplicates: dupeCount } }
          setFiles([...updatedFiles])
          results.push({ file: f.name, imported: 0, duplicates: dupeCount, status: 'done' })
          continue
        }

        const { data: commitData } = await api.post('/imports/wealthsimple/commit', {
          portfolio_id: Number(portfolioId),
          items: toImport,
        })
        const imported = commitData.imported || toImport.length
        updatedFiles[i] = { ...updatedFiles[i], status: 'done', result: { imported, duplicates: dupeCount } }
        setFiles([...updatedFiles])
        results.push({ file: f.name, imported, duplicates: dupeCount, status: 'done' })
      } catch (err) {
        const errMsg = err.response?.data?.error || 'Import failed'
        updatedFiles[i] = { ...updatedFiles[i], status: 'error', error: errMsg }
        setFiles([...updatedFiles])
        results.push({ file: f.name, status: 'error', error: errMsg })
      }
      await new Promise(r => setTimeout(r, 300))
    }

    setBatchResults(results)
    const totalImported = results.reduce((s, r) => s + (r.imported || 0), 0)
    const totalDupes = results.reduce((s, r) => s + (r.duplicates || 0), 0)
    setInfo(`✅ Batch complete! ${totalImported} records imported, ${totalDupes} duplicates skipped across ${files.length} files.`)
    setLoading(false)
    loadContributions(portfolioId)
  }

  const selectFile = async (idx) => {
    setCurrentFileIdx(idx)
    setCsvText(files[idx].text)
    setFileName(files[idx].name)
    setPreview(null)
    setError('')
  }

  const runPreview = async (e) => {
    e?.preventDefault()
    setError(''); setInfo(''); setPreview(null)
    if (!portfolioId) { setError('Pick a portfolio first'); return }
    if (!csvText.trim()) { setError('Choose a CSV file first'); return }
    setLoading(true)
    try {
      const { data } = await api.post('/imports/wealthsimple/preview', {
        portfolio_id: Number(portfolioId),
        csv: csvText,
      })
      setPreview(data)
      setSelected(new Set(
        data.items.filter((it) => !it.duplicate).map((it) => it.idx)
      ))
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const toggle = (idx) => {
    const next = new Set(selected)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelected(next)
  }

  const toggleAll = (visibleItems) => {
    const next = new Set(selected)
    const allSel = visibleItems.every((it) => next.has(it.idx))
    visibleItems.forEach((it) => allSel ? next.delete(it.idx) : next.add(it.idx))
    setSelected(next)
  }

  const commit = async () => {
    if (!preview) return
    const items = preview.items.filter((it) => selected.has(it.idx))
    if (items.length === 0) { setError('Select at least one row'); return }
    setError(''); setInfo('')
    setLoading(true)
    try {
      const { data } = await api.post('/imports/wealthsimple/commit', {
        portfolio_id: Number(portfolioId),
        items,
      })
      setInfo(`Imported ${data.imported ?? items.length} record(s) successfully.`)
      setPreview(null)
      setSelected(new Set())
      loadContributions(portfolioId)

      // Move to next file in batch mode
      if (batchMode && currentFileIdx < files.length - 1) {
        const nextIdx = currentFileIdx + 1
        selectFile(nextIdx)
        setInfo(`File ${currentFileIdx + 1} done! Now previewing: ${files[nextIdx].name}`)
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Commit failed')
    } finally {
      setLoading(false)
    }
  }

  const visibleItems = preview
    ? (filterType === 'ALL' ? preview.items : preview.items.filter((it) => it.type === filterType))
    : []

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Import Transactions</h1>

      {/* Caution Banner */}
      <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6">
        <div className="flex gap-3 items-start">
          <span className="text-2xl shrink-0">⚠️</span>
          <div>
            <p className="font-bold text-amber-800 text-base">CAUTION — Check ETF Master List First!</p>
            <p className="text-sm text-amber-700 mt-1">
              Before importing, make sure all ETFs in your statement are listed in the ETF Master List
              with their correct exchange symbol (e.g. <strong>GLCL.TO</strong>, <strong>HBTE.NE</strong>).
            </p>
            <a href="/etfmaster"
              className="inline-block mt-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-1.5 rounded-md">
              → Go to ETF Master List
            </a>
          </div>
        </div>
      </div>

      {/* Contributions Summary */}
      {contributions && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-purple-800 mb-2">TFSA Contributions Recorded</h3>
          {contLoading ? (
            <p className="text-xs text-purple-600">Loading...</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {(contributions.by_year || []).map((y) => (
                <div key={y.year} className="text-center">
                  <p className="text-xs text-purple-600">{y.year}</p>
                  <p className="text-sm font-bold text-purple-800">{fmt(y.total)}</p>
                </div>
              ))}
              <div className="text-center border-l border-purple-300 pl-4">
                <p className="text-xs text-purple-600">Total</p>
                <p className="text-sm font-bold text-purple-800">{fmt(contributions.total)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={runPreview} className="bg-white rounded-lg shadow p-6 mb-6 space-y-5">

        {/* Portfolio selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio</label>
          <select
            value={portfolioId}
            onChange={handlePortfolioChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {portfolios.length === 0 && <option value="">No portfolios — create one first</option>}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
            ))}
          </select>
        </div>

        {/* File Drop Zone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">CSV File(s)</label>
          <FileDropZone onFilesSelected={handleFilesSelected} />
        </div>

        {/* Batch file list with status */}
        {batchMode && files.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-blue-50 px-3 py-2 flex items-center justify-between border-b border-blue-200">
              <span className="text-xs font-semibold text-blue-800">
                📂 {files.length} files queued
              </span>
              <button
                type="button"
                onClick={handleBatchImport}
                disabled={loading || !portfolioId}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded font-medium disabled:opacity-50"
              >
                {loading ? `⟳ Processing ${currentFileIdx + 1}/${files.length}...` : '⚡ Import All Files Automatically'}
              </button>
            </div>
            <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  onClick={() => !loading && selectFile(i)}
                  className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors
                    ${currentFileIdx === i ? 'bg-emerald-50' : 'hover:bg-gray-50'}
                  `}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {f.status === 'pending' && '📄'}
                      {f.status === 'processing' && '⟳'}
                      {f.status === 'done' && '✅'}
                      {f.status === 'error' && '❌'}
                    </span>
                    <span className={`font-medium ${currentFileIdx === i ? 'text-emerald-700' : 'text-gray-700'}`}>
                      {f.name}
                    </span>
                  </div>
                  <div className="text-right">
                    {f.status === 'done' && f.result && (
                      <span className="text-emerald-600 font-medium">
                        {f.result.imported} imported{f.result.duplicates > 0 && `, ${f.result.duplicates} skipped`}
                      </span>
                    )}
                    {f.status === 'error' && <span className="text-red-500">{f.error}</span>}
                    {f.status === 'pending' && <span className="text-gray-400">pending</span>}
                    {f.status === 'processing' && <span className="text-blue-500">processing...</span>}
                  </div>
                </div>
              ))}
            </div>
            {batchResults.length > 0 && batchResults.length === files.length && (
              <div className="bg-emerald-50 px-3 py-2 border-t border-emerald-200">
                <p className="text-xs font-semibold text-emerald-800">
                  ✅ Batch Complete: {batchResults.reduce((s, r) => s + (r.imported || 0), 0)} records imported,{' '}
                  {batchResults.reduce((s, r) => s + (r.duplicates || 0), 0)} duplicates skipped
                </p>
              </div>
            )}
          </div>
        )}

        {/* Type legend */}
        <div className="flex gap-3 flex-wrap">
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className={`px-2 py-0.5 rounded ${TYPE_COLORS[k]}`}>{k}</span> → {v}
            </div>
          ))}
        </div>

        {/* Errors / Info */}
        {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
        {info && <div className="bg-emerald-50 text-emerald-700 p-3 rounded text-sm">{info}</div>}

        {/* Preview button */}
        {!batchMode && (
          <button
            type="submit"
            disabled={loading || !portfolioId || !csvText.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md text-sm disabled:opacity-50 font-medium"
          >
            {loading ? 'Parsing...' : '🔍 Preview'}
          </button>
        )}
      </form>

      {/* Preview Table */}
      {preview && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Preview — {fileName}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {preview.items.filter(it => !it.duplicate).length} new ·{' '}
                {preview.items.filter(it => it.duplicate).length} duplicate(s) ·{' '}
                {preview.items.filter(it => !it.holding_exists).length} unknown symbol(s)
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['ALL', 'BUY', 'SELL', 'DIV', 'CONT'].map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded text-xs font-medium ${filterType === t ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input type="checkbox"
                      checked={visibleItems.length > 0 && visibleItems.every(it => selected.has(it.idx))}
                      onChange={() => toggleAll(visibleItems)}
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">Date</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">Type</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">Symbol</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">Description</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">Amount</th>
                  <th className="px-3 py-2 text-right text-gray-600 font-medium">Shares</th>
                  <th className="px-3 py-2 text-left text-gray-600 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleItems.map((it) => {
                  const isSel = selected.has(it.idx)
                  return (
                    <tr key={it.idx}
                      className={`cursor-pointer ${it.duplicate ? 'opacity-40' : ''} ${isSel ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                      onClick={() => toggle(it.idx)}
                    >
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={isSel} onChange={() => toggle(it.idx)} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(it.date)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[it.type] || 'bg-gray-100'}`}>
                          {TYPE_LABELS[it.type] || it.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-medium text-gray-800">{it.symbol || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-xs truncate text-xs">{it.raw_description}</td>
                      <td className="px-3 py-2 text-right">{fmt(it.amount)}</td>
                      <td className="px-3 py-2 text-right">{it.shares ? Number(it.shares).toFixed(4) : '—'}</td>
                      <td className="px-3 py-2">
                        {it.duplicate && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">Duplicate</span>}
                        {!it.duplicate && !it.holding_exists && it.symbol && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Unknown ETF</span>}
                        {!it.duplicate && it.holding_exists && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">New</span>}
                        {!it.duplicate && !it.symbol && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">No symbol</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {selected.size} row(s) selected
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setPreview(null); setSelected(new Set()) }}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={loading || selected.size === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md text-sm disabled:opacity-50 font-medium"
              >
                {loading ? 'Importing...' : `✅ Import ${selected.size} Record(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
