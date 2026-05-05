import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import Modal from '../components/Modal'

const TYPE_COLORS = {
  RRSP: 'bg-blue-100 text-blue-800',
  LIRA: 'bg-purple-100 text-purple-800',
  TFSA: 'bg-emerald-100 text-emerald-800',
  'Non-Registered': 'bg-orange-100 text-orange-800',
}
const PORTFOLIO_TYPES = ['RRSP', 'LIRA', 'TFSA', 'Non-Registered']
const TFSA_LIMITS_BY_YEAR = {
  2009: 5000, 2010: 5000, 2011: 5000, 2012: 5000,
  2013: 5500, 2014: 5500, 2015: 10000, 2016: 5500,
  2017: 5500, 2018: 5500, 2019: 6000, 2020: 6000,
  2021: 6000, 2022: 6000, 2023: 6500, 2024: 7000,
  2025: 7000, 2026: 7000,
}
const CURRENT_YEAR = new Date().getFullYear()
const TFSA_ANNUAL_LIMIT = TFSA_LIMITS_BY_YEAR[CURRENT_YEAR] || 7000
const TFSA_LIFETIME_LIMIT = Object.values(TFSA_LIMITS_BY_YEAR).reduce((a, b) => a + b, 0)

const CATEGORY_COLORS = {
  'Anchor':       '#3b82f6',
  'Booster':      '#f97316',
  'Juicer':       '#10b981',
  'Growth Stock': '#8b5cf6',
  'Uncategorized':'#9ca3af',
}

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}
function pct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function PieChart({ data, size = 120 }) {
  if (!data || data.length === 0) return null
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null
  const cx = size / 2, cy = size / 2, r = size / 2 - 8
  let currentAngle = -Math.PI / 2
  const slices = data.map(d => {
    const angle = (d.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(currentAngle)
    const y1 = cy + r * Math.sin(currentAngle)
    currentAngle += angle
    const x2 = cx + r * Math.cos(currentAngle)
    const y2 = cy + r * Math.sin(currentAngle)
    const largeArc = angle > Math.PI ? 1 : 0
    const midAngle = currentAngle - angle / 2
    const lx = cx + r * 0.65 * Math.cos(midAngle)
    const ly = cy + r * 0.65 * Math.sin(midAngle)
    return { ...d, x1, y1, x2, y2, largeArc, lx, ly, pct: (d.value / total * 100) }
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s, i) => (
        <g key={i}>
          <path d={`M ${cx} ${cy} L ${s.x1} ${s.y1} A ${r} ${r} 0 ${s.largeArc} 1 ${s.x2} ${s.y2} Z`}
            fill={s.color} stroke="white" strokeWidth="2" />
          {s.pct > 10 && (
            <text x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle"
              fontSize="9" fontWeight="bold" fill="white">{s.pct.toFixed(0)}%</text>
          )}
        </g>
      ))}
      <circle cx={cx} cy={cy} r={r * 0.38} fill="white" />
    </svg>
  )
}

function ProgressBar({ value, max, colorClass }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={'h-2 rounded-full ' + colorClass} style={{ width: Math.min((value / max) * 100, 100) + '%' }} />
    </div>
  )
}

function TFSAContributionBar({ current, limit }) {
  const used = Number(current || 0)
  const isOver = used > limit
  const remaining = limit - used
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">{CURRENT_YEAR} TFSA Contribution Room</span>
        <span className={isOver ? 'text-red-600 font-medium' : 'text-gray-600'}>
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <ProgressBar value={used} max={limit} colorClass={isOver ? 'bg-red-500' : 'bg-emerald-500'} />
      <p className="text-xs mt-1 text-right">
        {isOver
          ? <span className="text-red-600 font-medium">Over by {fmt(used - limit)}</span>
          : <span className="text-gray-500">{fmt(remaining)} remaining</span>
        }
      </p>
    </div>
  )
}

export default function Dashboard() {
  const [portfolios, setPortfolios] = useState([])
  const [categoryData, setCategoryData] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ owner_name: '', name: '', type: 'TFSA', description: '' })
  const [activeTab, setActiveTab] = useState('all') // 'all' or owner name

  const fetchPortfolios = async () => {
    try {
      const { data } = await api.get('/portfolios')
      setPortfolios(data)
      const catMap = {}
      await Promise.all(data.map(async (p) => {
        try {
          const { data: portData } = await api.get(`/portfolios/${p.id}`)
          const holdings = portData.holdings || []
          const cats = {}
          for (const h of holdings) {
            if (Number(h.quantity || 0) <= 0) continue
            const cat = h.category || 'Uncategorized'
            const mv = Number(h.market_value || 0)
            if (!cats[cat]) cats[cat] = 0
            cats[cat] += mv
          }
          catMap[p.id] = cats
        } catch { catMap[p.id] = {} }
      }))
      setCategoryData(catMap)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPortfolios() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await api.post('/portfolios', form)
      setShowModal(false)
      setForm({ owner_name: '', name: '', type: 'TFSA', description: '' })
      fetchPortfolios()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create portfolio')
    }
  }

  if (loading) return <div className="flex justify-center items-center h-64 text-gray-500">Loading...</div>

  // Group portfolios by owner
  const owners = [...new Set(portfolios.map(p => p.owner_name || 'Unknown'))].sort()
  const filteredPortfolios = activeTab === 'all' ? portfolios : portfolios.filter(p => (p.owner_name || 'Unknown') === activeTab)

  const totalBook = filteredPortfolios.reduce((s, p) => s + Number(p.total_book_value || 0), 0)
  const totalMarket = filteredPortfolios.reduce((s, p) => s + Number(p.total_market_value || 0), 0)
  const totalGain = totalBook > 0 ? ((totalMarket - totalBook) / totalBook * 100) : 0

  // Owner summary stats
  const ownerStats = owners.map(owner => {
    const ownerPortfolios = portfolios.filter(p => (p.owner_name || 'Unknown') === owner)
    const book = ownerPortfolios.reduce((s, p) => s + Number(p.total_book_value || 0), 0)
    const market = ownerPortfolios.reduce((s, p) => s + Number(p.total_market_value || 0), 0)
    const divs = ownerPortfolios.reduce((s, p) => s + Number(p.total_dividends || 0), 0)
    return { owner, book, market, divs, gain: book > 0 ? ((market - book) / book * 100) : 0, count: ownerPortfolios.length }
  })

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                await api.post('/prices/refresh')
                fetchPortfolios()
              } catch (err) { console.error(err) }
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            ⟳ Refresh Prices
          </button>
          <button onClick={() => setShowModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm font-medium">
            + New Portfolio
          </button>
        </div>
      </div>

      {/* Owner tabs */}
      {owners.length > 1 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'all' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
          >
            👨‍👩‍👧 All Family ({portfolios.length})
          </button>
          {owners.map(owner => (
            <button
              key={owner}
              onClick={() => setActiveTab(owner)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === owner ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
            >
              👤 {owner} ({portfolios.filter(p => (p.owner_name || 'Unknown') === owner).length})
            </button>
          ))}
        </div>
      )}

      {/* Family comparison cards - show when All is selected */}
      {activeTab === 'all' && owners.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {ownerStats.map(o => (
            <div key={o.owner} className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">👤 {o.owner}</h3>
                <span className="text-xs text-gray-400">{o.count} portfolio{o.count > 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-500">Market Value</p>
                  <p className="font-bold text-gray-900">{fmt(o.market)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Gain/Loss</p>
                  <p className={`font-bold ${o.gain >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pct(o.gain)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Dividends</p>
                  <p className="font-bold text-teal-600">{fmt(o.divs)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Book Value</p>
                  <p className="font-bold text-gray-700">{fmt(o.book)}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveTab(o.owner)}
                className="mt-3 w-full text-xs text-emerald-600 hover:text-emerald-800 text-center"
              >
                View portfolios →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Book Value</p>
          <p className="text-2xl font-bold text-gray-900">{fmt(totalBook)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Market Value</p>
          <p className="text-2xl font-bold text-gray-900">{fmt(totalMarket)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Gain / Loss</p>
          <p className={`text-2xl font-bold ${totalMarket - totalBook >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmt(totalMarket - totalBook)} ({pct(totalGain)})
          </p>
        </div>
      </div>

      {/* Portfolio Cards grouped by owner */}
      {filteredPortfolios.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          <p className="text-lg mb-2">No portfolios yet</p>
          <p className="text-sm">Click "+ New Portfolio" to get started.</p>
        </div>
      ) : (
        <>
          {activeTab === 'all' && owners.length > 1 ? (
            // Group by owner when showing all
            owners.map(owner => {
              const ownerPortfolios = portfolios.filter(p => (p.owner_name || 'Unknown') === owner)
              return (
                <div key={owner} className="mb-8">
                  <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <span>👤 {owner}</span>
                    <span className="text-sm text-gray-400 font-normal">
                      — {fmt(ownerPortfolios.reduce((s, p) => s + Number(p.total_market_value || 0), 0))} market value
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {ownerPortfolios.map(p => (
                      <PortfolioCard key={p.id} p={p} categoryData={categoryData} />
                    ))}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPortfolios.map(p => (
                <PortfolioCard key={p.id} p={p} categoryData={categoryData} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create Portfolio Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="New Portfolio">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner / Person Name</label>
            <input type="text" value={form.owner_name}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              placeholder="e.g. Harshad, Hapi, John..."
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio Name</label>
            <input type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Wealthsimple TFSA"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500">
              {PORTFOLIO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function PortfolioCard({ p, categoryData }) {
  const book = Number(p.total_book_value || 0)
  const market = Number(p.total_market_value || 0)
  const gain = book > 0 ? ((market - book) / book * 100) : 0
  const isTFSA = p.type === 'TFSA'
  const currentYearDividends = Number(p.current_year_dividends || 0)
  const lifetimeDividends = Number(p.total_dividends || 0)

  return (
    <Link to={'/portfolio/' + p.id}
      className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6 block">
      <div className="flex items-center justify-between mb-3">
        <div>
          {p.owner_name && (
            <p className="text-xs text-gray-400 mb-0.5">👤 {p.owner_name}</p>
          )}
          <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
        </div>
        <span className={'px-2 py-1 rounded text-xs font-medium ' + (TYPE_COLORS[p.type] || '')}>
          {p.type}
        </span>
      </div>
      {p.description && <p className="text-sm text-gray-500 mb-3">{p.description}</p>}

      <div className="grid grid-cols-4 gap-2 text-sm">
        <div>
          <p className="text-gray-500 text-xs">Book</p>
          <p className="font-medium text-gray-900">{fmt(book)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Market</p>
          <p className="font-medium text-gray-900">{fmt(market)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Unrealized</p>
          <p className={'font-medium ' + (market - book >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {pct(gain)}
          </p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Realized</p>
          <p className={'font-medium ' + (Number(p.total_realized_pnl || 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {Number(p.total_realized_pnl || 0) === 0 ? '—' : fmt(p.total_realized_pnl)}
          </p>
        </div>
      </div>

      {/* Category Pie Chart */}
      {categoryData[p.id] && Object.keys(categoryData[p.id]).length > 0 && (() => {
        const cats = categoryData[p.id]
        const total = Object.values(cats).reduce((s, v) => s + v, 0)
        const pieData = Object.entries(cats).map(([name, value]) => ({
          name, value, color: CATEGORY_COLORS[name] || '#9ca3af'
        })).sort((a, b) => b.value - a.value)
        return (
          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-4">
            <PieChart data={pieData} size={90} />
            <div className="flex-1 space-y-1">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-gray-600">{d.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-gray-800">{fmt(d.value)}</span>
                    <span className="text-xs text-gray-400 ml-1">({(d.value/total*100).toFixed(0)}%)</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                <span className="text-xs text-gray-500">Total</span>
                <span className="text-xs font-bold text-gray-900">{fmt(total)}</span>
              </div>
            </div>
          </div>
        )
      })()}

      {isTFSA && (
        <>
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
            <div className="bg-teal-50 rounded-lg px-3 py-2">
              <p className="text-xs text-teal-600">{CURRENT_YEAR} Dividends</p>
              <p className="text-base font-bold text-teal-700">{fmt(currentYearDividends)}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg px-3 py-2">
              <p className="text-xs text-emerald-600">Lifetime Dividends</p>
              <p className="text-base font-bold text-emerald-700">{fmt(lifetimeDividends)}</p>
            </div>
          </div>
          <TFSAContributionBar current={p.current_year_contributions} limit={TFSA_ANNUAL_LIMIT} />
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>Lifetime contributions</span>
            <span className="font-medium text-gray-700">{fmt(p.total_contributions)}</span>
          </div>
        </>
      )}
    </Link>
  )
}
