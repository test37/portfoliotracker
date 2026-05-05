import { useState, useEffect } from 'react'
import { fmtDate } from '../lib/dateFormat'
import { useParams, Link } from 'react-router-dom'
import api from '../lib/api'
import Modal from '../components/Modal'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

export default function Holding() {
  const { id } = useParams()
  const [holding, setHolding] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [dividends, setDividends] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDividend, setShowDividend] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [divForm, setDivForm] = useState({ amount: '', amount_per_share: '', date: '', frequency: 'quarterly', tax_withheld: '0', notes: '' })
  const [editForm, setEditForm] = useState({ symbol: '', name: '', type: 'ETF', sector: '', region: '', management_fee: '' })
  const [saving, setSaving] = useState(false)

  const fetchData = async () => {
    try {
      const [h, t, d] = await Promise.all([
        api.get(`/holdings/detail/${id}`),
        api.get(`/transactions/${id}`),
        api.get(`/dividends/${id}`),
      ])
      setHolding(h.data)
      setTransactions(t.data)
      setDividends(d.data)
    } catch (err) {
      console.error('Failed to load holding:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [id])

  const openEdit = () => {
    setEditForm({
      symbol: holding.symbol || '',
      name: holding.name || '',
      type: holding.type || 'ETF',
      sector: holding.etf_sector || '',
      region: holding.etf_region || '',
      management_fee: holding.management_fee || '',
    })
    setShowEdit(true)
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put(`/holdings/${id}`, {
        symbol: editForm.symbol,
        name: editForm.name,
        type: editForm.type,
        sector: editForm.sector || null,
        region: editForm.region || null,
        management_fee: editForm.management_fee !== '' ? Number(editForm.management_fee) : null,
      })
      setShowEdit(false)
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update holding')
    } finally {
      setSaving(false)
    }
  }

  const handleAddDividend = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/dividends', {
        holding_id: Number(id),
        amount: Number(divForm.amount),
        amount_per_share: Number(divForm.amount_per_share) || null,
        shares_held: Number(holding.quantity) || null,
        date: divForm.date,
        frequency: divForm.frequency,
        tax_withheld: Number(divForm.tax_withheld) || 0,
        notes: divForm.notes || null,
      })
      setShowDividend(false)
      setDivForm({ amount: '', amount_per_share: '', date: '', frequency: 'quarterly', tax_withheld: '0', notes: '' })
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add dividend')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTx = async (txId) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await api.delete(`/transactions/${txId}`)
      fetchData()
    } catch (err) {
      alert('Failed to delete transaction')
    }
  }

  const handleDeleteDiv = async (divId) => {
    if (!confirm('Delete this dividend?')) return
    try {
      await api.delete(`/dividends/${divId}`)
      fetchData()
    } catch (err) {
      alert('Failed to delete dividend')
    }
  }

  if (loading) return <div className="flex justify-center items-center h-64 text-gray-500">Loading...</div>
  if (!holding) return <div className="max-w-7xl mx-auto px-4 py-8 text-red-600">Holding not found</div>

  const totalDividends = dividends.reduce((s, d) => s + Number(d.amount || 0), 0)
  const totalRealized = Number(holding.realized_pnl || 0)

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link to={`/portfolio/${holding.portfolio_id}`} className="text-emerald-600 hover:underline text-sm">
          &larr; Back to Portfolio
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{holding.symbol}</h1>
          <p className="text-gray-500">
            {holding.name || 'Unknown'} &middot; {holding.type}
            {holding.etf_sector && <span> &middot; {holding.etf_sector}</span>}
            {holding.etf_region && <span> &middot; {holding.etf_region}</span>}
            {holding.management_fee && <span> &middot; MER: {holding.management_fee}%</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openEdit}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-md text-sm transition-colors border border-gray-300"
          >
            ✏️ Edit Holding
          </button>
          <button
            onClick={() => setShowDividend(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm transition-colors"
          >
            + Add Dividend
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Shares</p>
          <p className="text-lg font-bold text-gray-900">{Number(holding.quantity).toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Avg Cost (ACB)</p>
          <p className="text-lg font-bold text-gray-900">{fmt(holding.average_cost)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Current Price</p>
          <p className="text-lg font-bold text-gray-900">
            {holding.current_price ? fmt(holding.current_price) : '--'}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Market Value</p>
          <p className="text-lg font-bold text-gray-900">{fmt(holding.market_value)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Realized P&L</p>
          <p className={`text-lg font-bold ${totalRealized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {totalRealized === 0 ? '—' : fmt(totalRealized)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Dividends</p>
          <p className="text-lg font-bold text-emerald-600">{fmt(totalDividends)}</p>
        </div>
      </div>

      {/* Transactions */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Transactions</h2>
      {transactions.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500 mb-8">No transactions</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Quantity</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Price</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Commission</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Realized P&L</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transactions.map((t) => {
                const isSell = t.type === 'SELL'
                const realized = Number(t.realized_pnl || 0)
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{fmtDate(t.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${isSell ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(t.quantity).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{fmt(t.price)}</td>
                    <td className="px-4 py-3 text-right">{fmt(t.commission)}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(t.total)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${isSell ? (realized >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-300'}`}>
                      {isSell ? fmt(realized) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDeleteTx(t.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dividends */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Dividends</h2>
      {dividends.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">No dividends recorded</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Per Share</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Frequency</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Tax Withheld</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dividends.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{fmtDate(d.date)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-600">{fmt(d.amount)}</td>
                  <td className="px-4 py-3 text-right">{d.amount_per_share ? fmt(d.amount_per_share) : '-'}</td>
                  <td className="px-4 py-3">{d.frequency}</td>
                  <td className="px-4 py-3 text-right">{fmt(d.tax_withheld)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDeleteDiv(d.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Holding Modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Holding">
        <form onSubmit={handleEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Symbol</label>
              <input
                type="text"
                value={editForm.symbol}
                onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value.toUpperCase() })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={editForm.type}
                onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="ETF">ETF</option>
                <option value="SHARE">Share</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fund Name</label>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="e.g. Hamilton Enhanced U.S. Covered Call ETF"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sector</label>
              <input
                type="text"
                value={editForm.sector}
                onChange={(e) => setEditForm({ ...editForm, sector: e.target.value })}
                placeholder="e.g. Financials, Technology"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
              <input
                type="text"
                value={editForm.region}
                onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                placeholder="e.g. Canada, USA, Global"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Management Fee / MER (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="10"
              value={editForm.management_fee}
              onChange={(e) => setEditForm({ ...editForm, management_fee: e.target.value })}
              placeholder="e.g. 0.65"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Dividend Modal */}
      <Modal open={showDividend} onClose={() => setShowDividend(false)} title="Record Dividend">
        <form onSubmit={handleAddDividend} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
              <input
                type="number" step="0.01" value={divForm.amount}
                onChange={(e) => setDivForm({ ...divForm, amount: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Per Share</label>
              <input
                type="number" step="0.0001" value={divForm.amount_per_share}
                onChange={(e) => setDivForm({ ...divForm, amount_per_share: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date" value={divForm.date}
                onChange={(e) => setDivForm({ ...divForm, date: e.target.value })}
                required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select
                value={divForm.frequency}
                onChange={(e) => setDivForm({ ...divForm, frequency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi-annual">Semi-Annual</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Withheld</label>
            <input
              type="number" step="0.01" value={divForm.tax_withheld}
              onChange={(e) => setDivForm({ ...divForm, tax_withheld: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowDividend(false)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50">
              {saving ? 'Saving...' : 'Record'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
