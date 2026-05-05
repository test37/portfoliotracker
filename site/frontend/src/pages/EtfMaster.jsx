import { useState, useEffect, useRef } from 'react'
import api from '../lib/api'
import Modal from '../components/Modal'

const CATEGORY_COLORS = {
  'Anchor':       'bg-blue-100 text-blue-800',
  'Booster':      'bg-orange-100 text-orange-800',
  'Juicer':       'bg-green-100 text-green-800',
  'Growth Stock': 'bg-purple-100 text-purple-800',
}

const EMPTY_FORM = {
  symbol: '', description: '', sector: '', region: '', manager: '',
  fund_page: '', dividend_payout: '', consistent_dividends: '',
  category: '', notes: '',
}

export default function EtfMaster() {
  const [etfs, setEtfs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ sector: '', region: '', manager: '', dividend_payout: '', consistent_dividends: '', category: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [editEtf, setEditEtf] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef(null)

  const handleExport = async () => {
    setExporting(true)
    try {
      const { data } = await api.get('/etfmaster/export')
      // Build CSV content
      const headers = ['Symbol','Description','Sector','Region','Manager','Fund Page','Dividend Payout','Consistent Dividends?','Category','Note']
      const rows = data.map(e => [
        e.symbol, e.description, e.sector || '', e.region || '', e.manager || '',
        e.fund_page || '', e.dividend_payout || '',
        e.consistent_dividends === null ? '' : e.consistent_dividends ? 'Y' : 'N',
        e.category || '', e.notes || ''
      ])
      const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ETF-Master-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      showMsg(`Exported ${data.length} ETFs successfully`)
    } catch (err) {
      showMsg('Export failed', 'error')
    } finally { setExporting(false) }
  }

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      // Use SheetJS loaded from CDN
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
          script.onload = resolve
          script.onerror = reject
          document.head.appendChild(script)
        })
      }
      const reader = new FileReader()
      reader.onload = async (evt) => {
        try {
          const wb = window.XLSX.read(evt.target.result, { type: 'binary' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const raw = window.XLSX.utils.sheet_to_json(ws, { defval: '' })

          // Map columns from Excel format
          const rows = raw.map(r => {
            const sym = (r['Symbol'] || r[' Symbol'] || '').toString().trim()
            const desc = (r['ETF / Stock Name'] || r['Description'] || r['ETF Name'] || '').toString().trim()
            const pillar = (r['Pillar'] || r['Category'] || '').toString().trim()
            const consistent = (r['Consistent Dividends?'] || r['Consistent'] || '').toString().trim()
            return {
              symbol: sym,
              description: desc || sym,
              sector: (r['Sector or Index'] || r['Sector'] || '').toString().trim(),
              region: (r['Region'] || '').toString().trim(),
              manager: (r['Manager'] || '').toString().trim(),
              fund_page: (r['Fund Page'] || '').toString().trim(),
              dividend_payout: (r['Dividend Payout'] || '').toString().trim(),
              consistent_dividends: consistent,
              category: pillar,
              notes: (r['Note'] || r['Notes'] || '').toString().trim(),
            }
          }).filter(r => r.symbol)

          const { data } = await api.post('/etfmaster/import', { rows })
          showMsg(`✅ ${data.message}: ${data.inserted} added, ${data.updated} updated, ${data.skipped} skipped`)
          fetchEtfs()
        } catch (err) {
          showMsg('Failed to parse file: ' + err.message, 'error')
        } finally { setImporting(false) }
      }
      reader.readAsBinaryString(file)
    } catch (err) {
      showMsg('Import failed: ' + err.message, 'error')
      setImporting(false)
    }
    e.target.value = ''
  }

  const fetchEtfs = async () => {
    try {
      const { data } = await api.get('/etfmaster')
      setEtfs(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchEtfs() }, [])

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleAdd = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/etfmaster', {
        ...form,
        consistent_dividends: form.consistent_dividends === 'true' ? true
          : form.consistent_dividends === 'false' ? false : null,
      })
      setForm(EMPTY_FORM); setShowAdd(false); fetchEtfs()
      showMsg('ETF added successfully')
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to add ETF', 'error')
    } finally { setSaving(false) }
  }

  const handleEdit = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await api.put(`/etfmaster/${editEtf.id}`, {
        ...form,
        consistent_dividends: form.consistent_dividends === 'true' ? true
          : form.consistent_dividends === 'false' ? false : null,
      })
      setEditEtf(null); setForm(EMPTY_FORM); fetchEtfs()
      showMsg('ETF updated successfully')
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to update', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (etf) => {
    if (!confirm(`Remove ${etf.symbol} from master list?`)) return
    try {
      await api.delete(`/etfmaster/${etf.id}`)
      fetchEtfs(); showMsg(`${etf.symbol} removed`)
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to delete', 'error')
    }
  }

  const openEdit = (etf) => {
    setEditEtf(etf)
    setForm({
      symbol: etf.symbol || '',
      description: etf.description || '',
      sector: etf.sector || '',
      region: etf.region || '',
      manager: etf.manager || '',
      fund_page: etf.fund_page || '',
      dividend_payout: etf.dividend_payout || '',
      consistent_dividends: etf.consistent_dividends === null ? ''
        : etf.consistent_dividends ? 'true' : 'false',
      category: etf.category || '',
      notes: etf.notes || '',
    })
  }

  const filteredEtfs = etfs.filter(e => {
    const matchSearch = !search ||
      e.symbol.toLowerCase().includes(search.toLowerCase()) ||
      e.base_symbol.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      (e.sector || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.manager || '').toLowerCase().includes(search.toLowerCase())
    const matchSector = !filters.sector || (e.sector || '') === filters.sector
    const matchRegion = !filters.region || (e.region || '') === filters.region
    const matchManager = !filters.manager || (e.manager || '') === filters.manager
    const matchPayout = !filters.dividend_payout || (e.dividend_payout || '') === filters.dividend_payout
    const matchConsistent = filters.consistent_dividends === '' ||
      (filters.consistent_dividends === 'Y' && e.consistent_dividends === 1) ||
      (filters.consistent_dividends === 'N' && e.consistent_dividends === 0) ||
      (filters.consistent_dividends === 'unknown' && e.consistent_dividends === null)
    const matchCategory = !filters.category || (e.category || '') === filters.category
    return matchSearch && matchSector && matchRegion && matchManager && matchPayout && matchConsistent && matchCategory
  })

  // Unique values for dropdowns
  const unique = (key) => [...new Set(etfs.map(e => e[key]).filter(Boolean))].sort()
  const hasFilters = Object.values(filters).some(v => v !== '')

  if (loading) return <div className="flex justify-center items-center h-64 text-gray-500">Loading...</div>

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">ETF Master List</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage ETF symbols, details, and categories. Used for price fetching and CSV import matching.
        </p>
      </div>

      <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6 flex gap-3">
        <span className="text-2xl shrink-0">⚠️</span>
        <div>
          <p className="font-bold text-amber-800">Add new ETFs here before importing statements</p>
          <p className="text-sm text-amber-700 mt-0.5">
            If an ETF is missing, it will be imported without the exchange extension and prices will not update correctly.
          </p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol, description, sector, manager..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">✕</button>}
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleImportFile} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50"
          >
            {importing ? '⟳ Importing...' : '📥 Import Excel'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50"
          >
            {exporting ? '⟳...' : '📤 Export CSV'}
          </button>
          <button onClick={() => { setForm(EMPTY_FORM); setShowAdd(true) }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            + Add ETF
          </button>
        </div>
      </div>

      {/* ETF Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Symbol</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Sector</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Region</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Manager</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Div Payout</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Consistent</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Category</th>
                <th className="px-4 py-3 text-right">
                  {hasFilters && (
                    <button onClick={() => setFilters({ sector: '', region: '', manager: '', dividend_payout: '', consistent_dividends: '', category: '' })}
                      className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap">
                      ✕ Clear
                    </button>
                  )}
                </th>
              </tr>
              {/* Filter row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-4 py-1.5">
                  <span className="text-xs text-gray-400 italic">—</span>
                </td>
                <td className="px-4 py-1.5">
                  <span className="text-xs text-gray-400 italic">—</span>
                </td>
                <td className="px-4 py-1.5">
                  <select value={filters.sector}
                    onChange={(e) => setFilters(prev => ({ ...prev, sector: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.sector ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    {unique('sector').map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-4 py-1.5">
                  <select value={filters.region}
                    onChange={(e) => setFilters(prev => ({ ...prev, region: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.region ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    {unique('region').map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-4 py-1.5">
                  <select value={filters.manager}
                    onChange={(e) => setFilters(prev => ({ ...prev, manager: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.manager ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    {unique('manager').map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-4 py-1.5">
                  <select value={filters.dividend_payout}
                    onChange={(e) => setFilters(prev => ({ ...prev, dividend_payout: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.dividend_payout ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    {unique('dividend_payout').map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-4 py-1.5 text-center">
                  <select value={filters.consistent_dividends}
                    onChange={(e) => setFilters(prev => ({ ...prev, consistent_dividends: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.consistent_dividends !== '' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    <option value="Y">✅ Yes</option>
                    <option value="N">❌ No</option>
                    <option value="unknown">— Unknown</option>
                  </select>
                </td>
                <td className="px-4 py-1.5">
                  <select value={filters.category}
                    onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
                    className={`w-full px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 ${filters.category ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                    <option value="">All</option>
                    <option value="Anchor">Anchor</option>
                    <option value="Booster">Booster</option>
                    <option value="Juicer">Juicer</option>
                    <option value="Growth Stock">Growth Stock</option>
                  </select>
                </td>
                <td className="px-4 py-1.5"></td>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredEtfs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  {search ? `No ETFs matching "${search}"` : 'No ETFs yet'}
                </td></tr>
              ) : filteredEtfs.map((etf) => (
                <EtfRow key={etf.id} etf={etf}
                  onEdit={() => openEdit(etf)}
                  onDelete={() => handleDelete(etf)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-gray-400 border-t">
          {search ? `${filteredEtfs.length} of ${etfs.length} ETFs` : `${etfs.length} ETFs`}
        </div>
      </div>

      {/* Add Modal */}
      <EtfFormModal
        open={showAdd}
        title="Add New ETF"
        form={form}
        setForm={setForm}
        onSubmit={handleAdd}
        onClose={() => setShowAdd(false)}
        saving={saving}
      />

      {/* Edit Modal */}
      <EtfFormModal
        open={!!editEtf}
        title={`Edit — ${editEtf?.symbol}`}
        form={form}
        setForm={setForm}
        onSubmit={handleEdit}
        onClose={() => { setEditEtf(null); setForm(EMPTY_FORM) }}
        saving={saving}
      />
    </div>
  )
}

function EtfRow({ etf, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const exchange = etf.symbol.includes('.NE') ? 'NEO' : etf.symbol.includes('.TO') ? 'TSX' : 'Other'
  const exchangeColor = exchange === 'NEO' ? 'bg-purple-100 text-purple-700' : exchange === 'TSX' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'

  return (
    <tr className="hover:bg-gray-50 group">
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {etf.fund_page ? (
            <a href={etf.fund_page} target="_blank" rel="noreferrer"
              className="font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline"
              title="Open fund page">
              {etf.symbol} 🔗
            </a>
          ) : (
            <span className="font-mono font-bold text-emerald-700">{etf.symbol}</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${exchangeColor}`}>{exchange}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate text-xs" title={etf.description}>
        {etf.description}
      </td>
      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{etf.sector || '—'}</td>
      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{etf.region || '—'}</td>
      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{etf.manager || '—'}</td>
      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{etf.dividend_payout || '—'}</td>
      <td className="px-4 py-3 text-center">
        {etf.consistent_dividends === null || etf.consistent_dividends === undefined ? '—'
          : etf.consistent_dividends ? '✅' : '❌'}
      </td>
      <td className="px-4 py-3">
        {etf.category ? (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            etf.category === 'Anchor' ? 'bg-blue-100 text-blue-800' :
            etf.category === 'Booster' ? 'bg-orange-100 text-orange-800' :
            etf.category === 'Growth Stock' ? 'bg-purple-100 text-purple-800' :
            'bg-green-100 text-green-800'}`}>
            {etf.category}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="relative" ref={ref}>
          <button onClick={() => setOpen(!open)}
            className="text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 font-bold text-lg leading-none opacity-0 group-hover:opacity-100 transition-opacity">
            ···
          </button>
          {open && (
            <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-32 py-1">
              <button onClick={() => { onEdit(); setOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50">✏️ Edit</button>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={() => { onDelete(); setOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">🗑️ Delete</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

function EtfFormModal({ open, title, form, setForm, onSubmit, onClose, saving }) {
  const f = (field) => ({
    value: form[field] || '',
    onChange: (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  })

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Symbol <span className="text-red-500">*</span></label>
            <input type="text" {...f('symbol')} required placeholder="e.g. GLCL.TO"
              onChange={(e) => setForm(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm" />
            <p className="text-xs text-gray-400 mt-0.5">.TO = TSX · .NE = NEO</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select {...f('category')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm">
              <option value="">— None —</option>
              <option value="Anchor">Anchor</option>
              <option value="Booster">Booster</option>
              <option value="Juicer">Juicer</option>
              <option value="Growth Stock">Growth Stock</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description <span className="text-red-500">*</span></label>
          <input type="text" {...f('description')} required
            placeholder="e.g. GLCL - Global X Enhanced Gold Producer Equity Covered Call ETF"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sector</label>
            <input type="text" {...f('sector')} placeholder="e.g. Financials"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Region</label>
            <input type="text" {...f('region')} placeholder="e.g. Canada"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fund Manager</label>
            <input type="text" {...f('manager')} placeholder="e.g. Evolve ETFs"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Dividend Payout</label>
            <input type="text" {...f('dividend_payout')} placeholder="e.g. Monthly, Quarterly"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fund Page URL</label>
            <input type="url" {...f('fund_page')} placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Consistent Dividends?</label>
            <select {...f('consistent_dividends')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm">
              <option value="">— Unknown —</option>
              <option value="true">✅ Yes</option>
              <option value="false">❌ No</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea {...f('notes')} rows={3}
            placeholder="Strategy, target price, reminders..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 text-sm">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
