import { useState, useEffect } from 'react'
import api from '../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}
function fmtPct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

const COLORS = [
  { bg: 'bg-emerald-50', border: 'border-emerald-400', header: 'bg-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-500', light: 'bg-emerald-100' },
  { bg: 'bg-blue-50', border: 'border-blue-400', header: 'bg-blue-600', text: 'text-blue-700', bar: 'bg-blue-500', light: 'bg-blue-100' },
  { bg: 'bg-purple-50', border: 'border-purple-400', header: 'bg-purple-600', text: 'text-purple-700', bar: 'bg-purple-500', light: 'bg-purple-100' },
  { bg: 'bg-amber-50', border: 'border-amber-400', header: 'bg-amber-600', text: 'text-amber-700', bar: 'bg-amber-500', light: 'bg-amber-100' },
]

const CATEGORY_COLORS = {
  'Anchor': '#3b82f6', 'Booster': '#f97316',
  'Juicer': '#10b981', 'Growth Stock': '#8b5cf6', 'Uncategorized': '#9ca3af',
}

function MiniPie({ data, size = 60 }) {
  if (!data || !data.length) return null
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return null
  const cx = size / 2, cy = size / 2, r = size / 2 - 3
  let angle = -Math.PI / 2
  const slices = data.map(d => {
    const a = (d.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
    angle += a
    return { ...d, x1, y1, x2: cx + r * Math.cos(angle), y2: cy + r * Math.sin(angle), largeArc: a > Math.PI ? 1 : 0 }
  })
  return (
    <svg width={size} height={size}>
      {slices.map((s, i) => (
        <path key={i} d={`M${cx} ${cy} L${s.x1} ${s.y1} A${r} ${r} 0 ${s.largeArc} 1 ${s.x2} ${s.y2}Z`}
          fill={s.color} stroke="white" strokeWidth="1.5" />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.35} fill="white" />
    </svg>
  )
}

function CompareBar({ values, max, colors, fmt: fmtFn }) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-24 text-xs text-gray-500 truncate">{v.label}</div>
          <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
            <div className={`h-5 rounded-full ${colors[i]?.bar} flex items-center justify-end pr-2`}
              style={{ width: `${max > 0 ? Math.min((Math.abs(v.value) / max) * 100, 100) : 0}%`, minWidth: v.value > 0 ? '40px' : '0' }}>
              <span className="text-white text-xs font-medium">{fmtFn ? fmtFn(v.value) : v.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Comparison() {
  const [portfolios, setPortfolios] = useState([])
  const [selected, setSelected] = useState([])
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [combined, setCombined] = useState(null)
  const [showCombined, setShowCombined] = useState(false)

  useEffect(() => {
    api.get('/portfolios').then(({ data }) => {
      setPortfolios(data)
      setLoading(false)
    })
  }, [])

  const toggleSelect = (id) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleCompare = async () => {
    if (selected.length < 1) return
    setComparing(true)
    try {
      const results = await Promise.all(selected.map(async (pid) => {
        const p = portfolios.find(x => x.id === pid)
        const { data: portData } = await api.get(`/portfolios/${pid}`)
        const holdings = portData.holdings || []

        // Contributions
        const { data: contData } = await api.get(`/imports/contributions/${pid}`)
        const totalContributions = Number(contData.by_year?.reduce((s, y) => s + Number(y.total || 0), 0) || 0)

        // Dividends per holding
        let totalDividends = 0
        const divByHolding = {}
        for (const h of holdings) {
          const { data: divs } = await api.get(`/dividends/${h.id}`)
          const amt = divs.reduce((s, d) => s + Number(d.amount || 0), 0)
          totalDividends += amt
          divByHolding[h.symbol] = amt
        }

        const bookValue = holdings.reduce((s, h) => s + Number(h.book_value || 0), 0)
        const marketValue = holdings.reduce((s, h) => s + Number(h.market_value || 0), 0)
        const realized = holdings.reduce((s, h) => s + Number(h.realized_pnl || 0), 0)
        const unrealized = marketValue - bookValue
        const totalReturn = marketValue - totalContributions
        const returnPct = totalContributions > 0 ? (totalReturn / totalContributions * 100) : 0
        const gainPct = bookValue > 0 ? (unrealized / bookValue * 100) : 0

        // Category breakdown
        const cats = {}
        for (const h of holdings) {
          if (Number(h.quantity || 0) <= 0) continue
          const cat = h.category || 'Uncategorized'
          cats[cat] = (cats[cat] || 0) + Number(h.market_value || 0)
        }
        const pieData = Object.entries(cats).map(([name, value]) => ({
          name, value, color: CATEGORY_COLORS[name] || '#9ca3af'
        })).sort((a, b) => b.value - a.value)

        // Top holdings
        const topHoldings = holdings
          .filter(h => Number(h.quantity || 0) > 0)
          .sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0))
          .slice(0, 5)
          .map(h => ({
            symbol: h.symbol,
            marketValue: Number(h.market_value || 0),
            pct: marketValue > 0 ? (Number(h.market_value || 0) / marketValue * 100) : 0,
            category: h.category,
            dividends: divByHolding[h.symbol] || 0,
          }))

        return {
          id: pid,
          name: p.name,
          owner: p.owner_name || '',
          type: p.type,
          totalContributions,
          bookValue,
          marketValue,
          unrealized,
          realized,
          totalDividends,
          totalReturn,
          returnPct,
          gainPct,
          holdingCount: holdings.filter(h => Number(h.quantity || 0) > 0).length,
          pieData,
          topHoldings,
          contByYear: contData.by_year || [],
        }
      }))

      setData(results)

      // Combined stats
      const comb = {
        totalContributions: results.reduce((s, r) => s + r.totalContributions, 0),
        bookValue: results.reduce((s, r) => s + r.bookValue, 0),
        marketValue: results.reduce((s, r) => s + r.marketValue, 0),
        unrealized: results.reduce((s, r) => s + r.unrealized, 0),
        totalDividends: results.reduce((s, r) => s + r.totalDividends, 0),
        totalReturn: results.reduce((s, r) => s + r.totalReturn, 0),
      }
      comb.returnPct = comb.totalContributions > 0 ? (comb.totalReturn / comb.totalContributions * 100) : 0
      comb.gainPct = comb.bookValue > 0 ? (comb.unrealized / comb.bookValue * 100) : 0
      setCombined(comb)
    } catch (err) {
      console.error(err)
    } finally {
      setComparing(false)
    }
  }

  if (loading) return <div className="flex justify-center items-center h-64 text-gray-500">Loading...</div>

  const maxMarket = Math.max(...data.map(d => d.marketValue), 1)
  const maxDiv = Math.max(...data.map(d => d.totalDividends), 1)
  const maxReturn = Math.max(...data.map(d => Math.abs(d.totalReturn)), 1)
  const maxContrib = Math.max(...data.map(d => d.totalContributions), 1)

  // Group portfolios by owner for selection
  const owners = [...new Set(portfolios.map(p => p.owner_name || 'Unknown'))].sort()

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">Select portfolios to compare side by side or see combined results</p>
      </div>

      {/* Portfolio Selection */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Select Portfolios to Compare</h2>
        {owners.map(owner => (
          <div key={owner} className="mb-4">
            <p className="text-sm font-medium text-gray-600 mb-2">👤 {owner}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {portfolios.filter(p => (p.owner_name || 'Unknown') === owner).map(p => {
                const isSelected = selected.includes(p.id)
                const colorIdx = selected.indexOf(p.id)
                const c = COLORS[colorIdx] || COLORS[0]
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleSelect(p.id)}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      isSelected ? `${c.border} ${c.bg}` : 'border-gray-200 hover:border-gray-300 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        p.type === 'TFSA' ? 'bg-emerald-100 text-emerald-700' :
                        p.type === 'RRSP' ? 'bg-blue-100 text-blue-700' :
                        p.type === 'LIRA' ? 'bg-purple-100 text-purple-700' :
                        'bg-orange-100 text-orange-700'}`}>{p.type}</span>
                      {isSelected && (
                        <span className={`w-5 h-5 rounded-full ${c.header} flex items-center justify-center text-white text-xs font-bold`}>
                          {colorIdx + 1}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">{fmt(Number(p.total_market_value || 0))}</p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleCompare}
            disabled={selected.length === 0 || comparing}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md font-medium text-sm disabled:opacity-50"
          >
            {comparing ? '⟳ Comparing...' : `📊 Compare${selected.length > 0 ? ` (${selected.length} selected)` : ''}`}
          </button>
          {selected.length > 0 && (
            <button onClick={() => { setSelected([]); setData([]); setCombined(null) }}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md text-sm hover:bg-gray-50">
              Clear
            </button>
          )}
          {data.length > 1 && (
            <button
              onClick={() => setShowCombined(!showCombined)}
              className={`px-4 py-2 rounded-md text-sm font-medium ${showCombined ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {showCombined ? '✓ Combined View' : '⊕ Combined View'}
            </button>
          )}
        </div>
      </div>

      {/* Combined Results */}
      {showCombined && combined && data.length > 1 && (
        <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg shadow p-5 mb-6 text-white">
          <h3 className="text-base font-semibold mb-4">⊕ Combined Result — {data.map(d => d.name).join(' + ')}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Contributed', value: fmt(combined.totalContributions), sub: 'Cash invested' },
              { label: 'Combined Market Value', value: fmt(combined.marketValue), sub: 'Current worth' },
              { label: 'Total Return', value: fmt(combined.totalReturn), sub: fmtPct(combined.returnPct) + ' on capital', color: combined.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Total Dividends', value: fmt(combined.totalDividends), sub: 'All time received', color: 'text-teal-400' },
            ].map((item, i) => (
              <div key={i} className="bg-white/10 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                <p className={`text-lg font-bold ${item.color || 'text-white'}`}>{item.value}</p>
                <p className={`text-xs mt-0.5 ${item.color || 'text-gray-400'}`}>{item.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Unrealized Gain/Loss</p>
              <p className={`text-lg font-bold ${combined.unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(combined.unrealized)}</p>
              <p className={`text-xs ${combined.unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(combined.gainPct)}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Book Value</p>
              <p className="text-lg font-bold text-white">{fmt(combined.bookValue)}</p>
              <p className="text-xs text-gray-400">Total cost of shares</p>
            </div>
          </div>
        </div>
      )}

      {/* Side by Side Comparison */}
      {data.length > 0 && (
        <>
          {/* Header Cards */}
          <div className={`grid grid-cols-1 md:grid-cols-${data.length} gap-4 mb-6`}>
            {data.map((d, i) => {
              const c = COLORS[i]
              return (
                <div key={d.id} className={`rounded-lg border-2 ${c.border} ${c.bg} p-4`}>
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-white text-xs font-bold mb-2 ${c.header}`}>
                    <span>#{i + 1}</span>
                    <span>{d.type}</span>
                  </div>
                  {d.owner && <p className="text-xs text-gray-500 mb-0.5">👤 {d.owner}</p>}
                  <h3 className="font-bold text-gray-900 mb-3">{d.name}</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Contributed</span>
                      <span className="font-semibold">{fmt(d.totalContributions)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Market Value</span>
                      <span className="font-bold text-gray-900">{fmt(d.marketValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Book Value</span>
                      <span className="font-semibold">{fmt(d.bookValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Unrealized</span>
                      <span className={`font-semibold ${d.unrealized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(d.unrealized)} ({fmtPct(d.gainPct)})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dividends</span>
                      <span className="font-semibold text-teal-600">{fmt(d.totalDividends)}</span>
                    </div>
                    <div className={`flex justify-between pt-2 border-t border-gray-200`}>
                      <span className="text-gray-600 font-medium">Total Return</span>
                      <div className="text-right">
                        <span className={`font-bold ${d.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmt(d.totalReturn)}
                        </span>
                        <span className={`text-xs ml-1 ${d.totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          ({fmtPct(d.returnPct)})
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Holdings</span>
                      <span className="font-semibold">{d.holdingCount} active</span>
                    </div>
                  </div>

                  {/* Mini pie */}
                  {d.pieData.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 flex items-center gap-3">
                      <MiniPie data={d.pieData} size={56} />
                      <div className="flex-1 space-y-0.5">
                        {d.pieData.slice(0, 3).map(cat => (
                          <div key={cat.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                              <span className="text-xs text-gray-600">{cat.name}</span>
                            </div>
                            <span className="text-xs font-medium text-gray-700">
                              {d.marketValue > 0 ? ((cat.value / d.marketValue) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Visual Bar Comparisons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Market Value</h3>
              <CompareBar
                values={data.map(d => ({ label: d.name, value: d.marketValue }))}
                max={maxMarket} colors={COLORS} fmt={fmt}
              />
            </div>
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Total Contributions</h3>
              <CompareBar
                values={data.map(d => ({ label: d.name, value: d.totalContributions }))}
                max={maxContrib} colors={COLORS} fmt={fmt}
              />
            </div>
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Total Dividends</h3>
              <CompareBar
                values={data.map(d => ({ label: d.name, value: d.totalDividends }))}
                max={maxDiv} colors={COLORS} fmt={fmt}
              />
            </div>
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Total Return</h3>
              <CompareBar
                values={data.map(d => ({ label: d.name, value: d.totalReturn }))}
                max={maxReturn} colors={COLORS} fmt={fmt}
              />
            </div>
          </div>

          {/* Return % comparison */}
          <div className="bg-white rounded-lg shadow p-5 mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Return % on Invested Capital</h3>
            <div className="space-y-3">
              {data.sort((a, b) => b.returnPct - a.returnPct).map((d, i) => {
                const origIdx = data.indexOf(d)
                const c = COLORS[selected.indexOf(d.id)] || COLORS[i]
                const maxPct = Math.max(...data.map(x => Math.abs(x.returnPct)), 1)
                return (
                  <div key={d.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">{d.name}</span>
                      <span className={`font-bold ${d.returnPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtPct(d.returnPct)}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-4">
                      <div
                        className={`h-4 rounded-full ${c.bar} transition-all`}
                        style={{ width: `${(Math.abs(d.returnPct) / maxPct) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top Holdings Comparison */}
          <div className={`grid grid-cols-1 md:grid-cols-${data.length} gap-4 mb-6`}>
            {data.map((d, i) => {
              const c = COLORS[i]
              return (
                <div key={d.id} className="bg-white rounded-lg shadow p-5">
                  <h3 className={`text-sm font-semibold mb-3 ${c.text}`}>
                    Top Holdings — {d.name}
                  </h3>
                  <div className="space-y-2">
                    {d.topHoldings.map(h => (
                      <div key={h.symbol} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-gray-700">{h.symbol}</span>
                          {h.category && (
                            <span className="text-xs text-gray-400">{h.category}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-semibold text-gray-800">{fmt(h.marketValue)}</span>
                          <span className="text-xs text-gray-400 ml-1">({h.pct.toFixed(0)}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Contribution History Comparison */}
          {data.some(d => d.contByYear.length > 0) && (
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Contribution History by Year</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Year</th>
                      {data.map((d, i) => (
                        <th key={d.id} className={`text-right py-2 px-3 font-semibold ${COLORS[i].text}`}>
                          {d.name}
                        </th>
                      ))}
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...new Set(data.flatMap(d => d.contByYear.map(y => y.year)))].sort().reverse().map(year => {
                      const rowTotal = data.reduce((s, d) => {
                        const y = d.contByYear.find(y => y.year === year)
                        return s + Number(y?.total || 0)
                      }, 0)
                      return (
                        <tr key={year} className="hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium text-gray-700">{year}</td>
                          {data.map((d, i) => {
                            const y = d.contByYear.find(y => y.year === year)
                            return (
                              <td key={d.id} className={`py-2 px-3 text-right ${COLORS[i].text} font-medium`}>
                                {y ? fmt(Number(y.total)) : '—'}
                              </td>
                            )
                          })}
                          <td className="py-2 px-3 text-right font-bold text-gray-800">{fmt(rowTotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="py-2 px-3 font-bold text-gray-800">Total</td>
                      {data.map((d, i) => (
                        <td key={d.id} className={`py-2 px-3 text-right font-bold ${COLORS[i].text}`}>
                          {fmt(d.totalContributions)}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-right font-bold text-gray-900">
                        {fmt(data.reduce((s, d) => s + d.totalContributions, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
