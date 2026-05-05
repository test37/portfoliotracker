import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import Modal from '../components/Modal'

const PORTFOLIO_TYPES = ['RRSP', 'LIRA', 'TFSA', 'Non-Registered']

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

function pct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function SortIcon({ column, sortCol, sortDir }) {
  if (sortCol !== column) return <span className="text-gray-300 ml-1">⇅</span>
  return <span className="text-emerald-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

function SortTh({ label, column, sortCol, sortDir, onSort, className = '' }) {
  return (
    <th
      className={'px-3 py-3 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ' + className}
      onClick={() => onSort(column)}
    >
      {label}<SortIcon column={column} sortCol={sortCol} sortDir={sortDir} />
    </th>
  )
}

function ActionMenu({ holding, onBuy, onSell, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 font-bold text-lg leading-none">
        ···
      </button>
      {open && (
        <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-32 py-1">
          <button onClick={() => { onBuy(); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50">Buy</button>
          <button onClick={() => { onSell(); setOpen(false) }}
            disabled={Number(holding.quantity) <= 0}
            className="w-full text-left px-4 py-2 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-30 disabled:cursor-not-allowed">Sell</button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={() => { onDelete(); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
        </div>
      )}
    </div>
  )
}

function TotalProfitCell({ capitalGain, dividends }) {
  const [show, setShow] = useState(false)
  const total = capitalGain + dividends
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className={'font-medium cursor-help underline decoration-dotted ' + (total >= 0 ? 'text-emerald-600' : 'text-red-600')}>
        {fmt(total)}
      </span>
      {show && (
        <div className="absolute right-0 bottom-7 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 w-52 z-50">
          <div className="flex justify-between gap-4 mb-1">
            <span className="text-gray-300">Capital Gain:</span>
            <span className={capitalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(capitalGain)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-300">Dividends:</span>
            <span className="text-teal-400">{fmt(dividends)}</span>
          </div>
          <div className="border-t border-gray-700 mt-2 pt-1 flex justify-between gap-4">
            <span className="text-gray-300">Total:</span>
            <span className={total >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(total)}</span>
          </div>
          <div className="absolute right-4 -bottom-1.5 w-3 h-3 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  )
}

function NoteIndicator({ note }) {
  const [show, setShow] = useState(false)
  if (!note) return <span className="text-gray-300 text-xs">—</span>
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="text-amber-500 font-bold text-sm cursor-help">✱</span>
      {show && (
        <div className="absolute right-0 bottom-7 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 w-64 z-50">
          <p className="text-gray-300 font-medium mb-1">Note (from ETF Master):</p>
          <p className="text-white leading-relaxed whitespace-pre-wrap">{note}</p>
          <div className="absolute right-4 -bottom-1.5 w-3 h-3 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  )
}

export default function Portfolio() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [portfolio, setPortfolio] = useState(null)
  const [holdingDividends, setHoldingDividends] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAddHolding, setShowAddHolding] = useState(false)
  const [showAddTx, setShowAddTx] = useState(null)
  const [txType, setTxType] = useState('BUY')
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', type: 'RRSP', description: '' })
  const [refreshing, setRefreshing] = useState(false)
  const [holdingForm, setHoldingForm] = useState({ symbol: '', name: '', type: 'ETF' })
  const [txForm, setTxForm] = useState({ quantity: '', price: '', commission: '', date: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [sortCol, setSortCol] = useState('symbol')
  const [sortDir, setSortDir] = useState('asc')
  const [holdingFilter, setHoldingFilter] = useState('current')

  const fetchPortfolio = async () => {
    try {
      const { data } = await api.get(`/portfolios/${id}`)
      setPortfolio(data)
      const divMap = {}
      await Promise.all((data.holdings || []).map(async (h) => {
        try {
          const { data: divs } = await api.get(`/dividends/${h.id}`)
          divMap[h.id] = divs.reduce((s, d) => s + Number(d.amount || 0), 0)
        } catch { divMap[h.id] = 0 }
      }))
      setHoldingDividends(divMap)
    } catch (err) {
      console.error('Failed to load portfolio:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPortfolio() }, [id])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const getSortValue = (h, col) => {
    const divs = holdingDividends[h.id] || 0
    const gainAmt = Number(h.market_value || 0) - Number(h.book_value || 0)
    const capitalGain = Number(h.realized_pnl || 0) + gainAmt
    const totalProfit = capitalGain + divs
    const bookValue = Number(h.book_value || 0)
    switch (col) {
      case 'symbol': return h.symbol || ''
      case 'name': return h.name || ''
      case 'category': return h.category || ''
      case 'quantity': return Number(h.quantity || 0)
      case 'average_cost': return Number(h.average_cost || 0)
      case 'current_price': return Number(h.current_price || 0)
      case 'book_value': return Number(h.book_value || 0)
      case 'market_value': return Number(h.market_value || 0)
      case 'dividends': return holdingDividends[h.id] || 0
      case 'unrealized': return Number(h.gain_loss_pct || 0)
      case 'total_profit': return totalProfit
      case 'profit_pct': return bookValue > 0 ? (totalProfit / bookValue) * 100 : 0
      default: return ''
    }
  }

  const allHoldings = portfolio?.holdings || []

  const filteredHoldings = allHoldings.filter(h => {
    const qty = Number(h.quantity || 0)
    if (holdingFilter === 'current') return qty > 0
    if (holdingFilter === 'past') return qty <= 0
    return true // 'all'
  })

  const sortedHoldings = filteredHoldings.slice().sort((a, b) => {
    const av = getSortValue(a, sortCol)
    const bv = getSortValue(b, sortCol)
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const currentCount = allHoldings.filter(h => Number(h.quantity || 0) > 0).length
  const pastCount = allHoldings.filter(h => Number(h.quantity || 0) <= 0).length

  const handleAddHolding = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/holdings', { portfolio_id: Number(id), ...holdingForm })
      setShowAddHolding(false); setHoldingForm({ symbol: '', name: '', type: 'ETF' }); fetchPortfolio()
    } catch (err) { alert(err.response?.data?.error || 'Failed to add holding') }
    finally { setSaving(false) }
  }

  const handleTransaction = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await api.post('/transactions', {
        holding_id: showAddTx, type: txType,
        quantity: Number(txForm.quantity), price: Number(txForm.price),
        commission: Number(txForm.commission) || 0, date: txForm.date, notes: txForm.notes || null,
      })
      setShowAddTx(null); setTxForm({ quantity: '', price: '', commission: '', date: '', notes: '' }); fetchPortfolio()
    } catch (err) { alert(err.response?.data?.error || 'Failed to add transaction') }
    finally { setSaving(false) }
  }

  const openTxModal = (holdingId, type) => {
    setTxType(type)
    setTxForm({ quantity: '', price: '', commission: '', date: new Date().toISOString().slice(0, 10), notes: '' })
    setShowAddTx(holdingId)
  }

  const handleDeleteHolding = async (holdingId, symbol) => {
    if (!confirm(`Delete ${symbol} and all its transactions?`)) return
    try { await api.delete(`/holdings/${holdingId}`); fetchPortfolio() }
    catch (err) { alert(err.response?.data?.error || 'Failed to delete') }
  }

  const openEdit = () => {
    setEditForm({ name: portfolio.name || '', type: portfolio.type || 'RRSP', description: portfolio.description || '' })
    setShowEdit(true)
  }

  const handleEditPortfolio = async (e) => {
    e.preventDefault(); setSaving(true)
    try { await api.put(`/portfolios/${id}`, editForm); setShowEdit(false); fetchPortfolio() }
    catch (err) { alert(err.response?.data?.error || 'Failed to update portfolio') }
    finally { setSaving(false) }
  }

  const handleDeletePortfolio = async () => {
    if (!confirm(`Delete portfolio "${portfolio.name}" and all its holdings? This cannot be undone.`)) return
    try { await api.delete(`/portfolios/${id}`); navigate('/') }
    catch (err) { alert(err.response?.data?.error || 'Failed to delete portfolio') }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await api.post('/prices/refresh'); await fetchPortfolio() }
    catch (err) { alert('Failed to refresh prices') }
    finally { setRefreshing(false) }
  }






  if (loading) return <div className="flex justify-center items-center h-64 text-gray-500">Loading...</div>
  if (!portfolio) return <div className="max-w-screen-2xl mx-auto px-4 py-8 text-red-600">Portfolio not found</div>

  const holdings = portfolio.holdings || []
  const totalBook = holdings.reduce((s, h) => s + Number(h.book_value || 0), 0)
  const totalMarket = holdings.reduce((s, h) => s + Number(h.market_value || 0), 0)
  const totalUnrealized = totalMarket - totalBook
  const totalRealized = holdings.reduce((s, h) => s + Number(h.realized_pnl || 0), 0)
  const totalDividends = Object.values(holdingDividends).reduce((s, v) => s + v, 0)

  const categoryColors = {
    'Anchor': 'bg-blue-100 text-blue-800',
    'Booster': 'bg-orange-100 text-orange-800',
    'Juicer': 'bg-green-100 text-green-800'
  }

  const thProps = { sortCol, sortDir, onSort: handleSort }

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to="/" className="text-emerald-600 hover:underline text-sm">&larr; Back to Dashboard</Link>
      </div>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{portfolio.name}</h1>
          <span className="text-sm text-gray-500">{portfolio.type}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleRefresh} disabled={refreshing}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            {refreshing ? '⟳ Refreshing...' : '⟳ Refresh Prices'}
          </button>
          <button onClick={openEdit} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded-md text-sm border border-gray-300">Edit</button>
          <button onClick={handleDeletePortfolio} className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm border border-red-300">Delete</button>
          <button onClick={() => setShowAddHolding(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm">+ Add Holding</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Book Value</p>
          <p className="text-xl font-bold text-gray-900">{fmt(totalBook)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Market Value</p>
          <p className="text-xl font-bold text-gray-900">{fmt(totalMarket)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Unrealized Gain/Loss</p>
          <p className={'text-xl font-bold ' + (totalUnrealized >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmt(totalUnrealized)} ({pct(totalBook > 0 ? totalUnrealized / totalBook * 100 : 0)})
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Profit</p>
          <p className={'text-xl font-bold ' + (totalUnrealized + totalRealized + totalDividends >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmt(totalUnrealized + totalRealized + totalDividends)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Unreal: {fmt(totalUnrealized)} · Cap: {fmt(totalRealized)} · Div: {fmt(totalDividends)}
          </p>
        </div>
      </div>

      {/* Filter + count bar */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <select
            value={holdingFilter}
            onChange={(e) => setHoldingFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
          >
            <option value="current">Current Holdings ({currentCount})</option>
            <option value="past">Past Holdings ({pastCount})</option>
            <option value="all">All Holdings ({allHoldings.length})</option>
          </select>
          {holdingFilter === 'past' && pastCount === 0 && (
            <span className="text-sm text-gray-400 italic">No past holdings — holdings with 0 shares will appear here</span>
          )}
          {holdingFilter === 'current' && (
            <span className="text-xs text-gray-400">Holdings with shares qty &gt; 0</span>
          )}
          {holdingFilter === 'past' && pastCount > 0 && (
            <span className="text-xs text-amber-600">⚠ Sold holdings — qty = 0</span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          Showing {sortedHoldings.length} of {allHoldings.length} holdings · click column to sort
        </span>
      </div>

      {/* Holdings Table */}
      {sortedHoldings.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          {holdingFilter === 'current' && allHoldings.length === 0 && 'No holdings yet. Click "Add Holding" to get started.'}
          {holdingFilter === 'current' && allHoldings.length > 0 && 'No current holdings. All holdings have been fully sold.'}
          {holdingFilter === 'past' && 'No past holdings. Holdings with 0 shares will appear here after selling.'}
          {holdingFilter === 'all' && 'No holdings yet. Click "Add Holding" to get started.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <SortTh label="Symbol" column="symbol" {...thProps} className="text-left" />
                <SortTh label="Name" column="name" {...thProps} className="text-left" />
                <SortTh label="Category" column="category" {...thProps} className="text-left" />
                <SortTh label="Shares" column="quantity" {...thProps} className="text-right" />
                <SortTh label="Avg Cost" column="average_cost" {...thProps} className="text-right" />
                <SortTh label="Price" column="current_price" {...thProps} className="text-right" />
                <SortTh label="Book Value" column="book_value" {...thProps} className="text-right" />
                <SortTh label="Market Value" column="market_value" {...thProps} className="text-right" />
                <SortTh label="Dividends" column="dividends" {...thProps} className="text-right" />
                <SortTh label="Unrealized" column="unrealized" {...thProps} className="text-right" />
                <SortTh label="Total Profit / %" column="total_profit" {...thProps} className="text-right" />
                <th className="text-center px-3 py-3 font-medium text-gray-600">Note</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedHoldings.map((h) => {
                const isPast = Number(h.quantity || 0) <= 0
                const gainPct = Number(h.gain_loss_pct || 0)
                const gainAmt = Number(h.market_value || 0) - Number(h.book_value || 0)
                const capitalGain = Number(h.realized_pnl || 0) + gainAmt
                const dividends = holdingDividends[h.id] || 0
                const totalProfit = capitalGain + dividends
                const bookValue = Number(h.book_value || 0)
                const profitPct = bookValue > 0 ? (totalProfit / bookValue) * 100 : 0

                return (
                  <tr key={h.id} className={'hover:bg-gray-50 ' + (isPast ? 'opacity-60' : '')}>
                    <td className="px-3 py-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <Link to={`/holding/${h.id}`} className="text-emerald-600 hover:underline">{h.symbol}</Link>
                        {isPast && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">sold</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-gray-400 text-xs max-w-[80px] truncate" title={h.name || ''}>{h.name || '—'}</td>
                    <td className="px-3 py-3">
                      {h.category ? (
                        <span className={'text-xs px-2 py-1 rounded-full font-medium ' + (categoryColors[h.category] || 'bg-gray-100 text-gray-700')}>
                          {h.category}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className={'px-3 py-3 text-right whitespace-nowrap ' + (isPast ? 'text-gray-400' : '')}>
                      {Number(h.quantity).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(h.average_cost)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {h.current_price ? fmt(h.current_price) : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(h.book_value)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{fmt(h.market_value)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-teal-600 font-medium">{dividends > 0 ? fmt(dividends) : <span className="text-gray-300">—</span>}</span>
                    </td>
                    <td className={'px-3 py-3 text-right whitespace-nowrap font-medium ' + (gainAmt >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {pct(gainPct)}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <div>
                        <TotalProfitCell capitalGain={capitalGain} dividends={dividends} />
                        <div className={'text-xs mt-0.5 ' + (totalProfit >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                          {pct(profitPct)}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <NoteIndicator note={h.notes} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ActionMenu
                        holding={h}
                        onBuy={() => openTxModal(h.id, 'BUY')}
                        onSell={() => openTxModal(h.id, 'SELL')}
                        onDelete={() => handleDeleteHolding(h.id, h.symbol)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 flex justify-between">
            <span>
              {holdingFilter === 'current' && `${currentCount} current holdings`}
              {holdingFilter === 'past' && `${pastCount} past holdings (fully sold)`}
              {holdingFilter === 'all' && `${allHoldings.length} total holdings (${currentCount} current, ${pastCount} past)`}
            </span>
            <span>sorted by {sortCol} ({sortDir})</span>
          </div>
        </div>
      )}

      {/* Add Holding Modal */}
      <Modal open={showAddHolding} onClose={() => setShowAddHolding(false)} title="Add Holding">
        <form onSubmit={handleAddHolding} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Symbol</label>
            <input type="text" value={holdingForm.symbol}
              onChange={(e) => setHoldingForm({ ...holdingForm, symbol: e.target.value.toUpperCase() })}
              placeholder="e.g. VFV.TO" required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={holdingForm.name}
              onChange={(e) => setHoldingForm({ ...holdingForm, name: e.target.value })}
              placeholder="e.g. Vanguard S&P 500 ETF"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={holdingForm.type} onChange={(e) => setHoldingForm({ ...holdingForm, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="ETF">ETF</option>
              <option value="SHARE">Share</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowAddHolding(false)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50">
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Portfolio Modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Portfolio">
        <form onSubmit={handleEditPortfolio} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
              {PORTFOLIO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowEdit(false)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Buy / Sell Transaction Modal */}
      <Modal open={!!showAddTx} onClose={() => setShowAddTx(null)} title={txType === 'SELL' ? 'Sell Transaction' : 'Buy Transaction'}>
        <form onSubmit={handleTransaction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input type="number" step="0.01" value={txForm.quantity}
                onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price per share</label>
              <input type="number" step="0.01" value={txForm.price}
                onChange={(e) => setTxForm({ ...txForm, price: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Commission</label>
              <input type="number" step="0.01" value={txForm.commission}
                onChange={(e) => setTxForm({ ...txForm, commission: e.target.value })}
                placeholder="0.00" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={txForm.date}
                onChange={(e) => setTxForm({ ...txForm, date: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input type="text" value={txForm.notes}
              onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          {txForm.quantity && txForm.price && (
            <div className="bg-gray-50 p-3 rounded text-sm">
              {txType === 'SELL' ? 'Net proceeds' : 'Total cost'}:{' '}
              {fmt(txType === 'SELL'
                ? Number(txForm.quantity) * Number(txForm.price) - Number(txForm.commission || 0)
                : Number(txForm.quantity) * Number(txForm.price) + Number(txForm.commission || 0)
              )}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowAddTx(null)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className={'px-4 py-2 text-white rounded-md disabled:opacity-50 ' + (txType === 'SELL' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700')}>
              {saving ? 'Saving...' : (txType === 'SELL' ? 'Record Sell' : 'Record Buy')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
