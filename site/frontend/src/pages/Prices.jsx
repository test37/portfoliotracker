import { useState, useEffect, useRef } from 'react'
import api from '../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

function fmtPct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

function fmtDate(val) {
  if (!val) return '—'
  const d = new Date(val)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2,'0')}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function YieldBar({ yieldPct }) {
  const w = Math.min(yieldPct / 20 * 100, 100)
  const color = yieldPct > 15 ? 'bg-red-400' : yieldPct > 10 ? 'bg-orange-400' : yieldPct > 6 ? 'bg-emerald-500' : 'bg-blue-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-gray-200 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs font-medium ${yieldPct > 15 ? 'text-red-600' : yieldPct > 10 ? 'text-orange-600' : 'text-emerald-600'}`}>
        {yieldPct.toFixed(2)}%
      </span>
    </div>
  )
}

function PriceChange({ change, changePct }) {
  const pos = change >= 0
  return (
    <span className={`text-xs font-medium ${pos ? 'text-emerald-600' : 'text-red-600'}`}>
      {pos ? '▲' : '▼'} {Math.abs(change).toFixed(3)} ({fmtPct(changePct)})
    </span>
  )
}

function SymbolSearchBox({ onSelect }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const ref = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleInput = (val) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length < 1) { setSuggestions([]); setShowDropdown(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await api.get(`/prices/search/${val.trim()}`)
        setSuggestions(data.slice(0, 8))
        setShowDropdown(true)
      } catch { setSuggestions([]) }
      finally { setLoading(false) }
    }, 400)
  }

  const handleSelect = (sym) => {
    setQuery(sym)
    setShowDropdown(false)
    setSuggestions([])
    onSelect(sym)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) {
      setShowDropdown(false)
      onSelect(query.trim().toUpperCase())
    }
  }

  return (
    <div className="relative" ref={ref}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            placeholder="Search any symbol... e.g. HYLD.TO"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 w-72"
          />
          {loading && (
            <div className="absolute right-3 top-2.5 text-gray-400 text-xs">⟳</div>
          )}
          {showDropdown && suggestions.length > 0 && (
            <div className="absolute top-10 left-0 bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-full max-h-72 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => handleSelect(s.symbol)}
                  className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-sm text-gray-900">{s.symbol}</span>
                      <span className="text-xs text-gray-500 ml-2 truncate max-w-[180px] inline-block align-middle">
                        {s.name}
                      </span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {s.exchange && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s.exchange}</span>
                      )}
                      {s.type && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">{s.type}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 whitespace-nowrap"
        >
          {searching ? '...' : 'Look up'}
        </button>
      </form>
    </div>
  )
}

function HoldingPriceCard({ symbol, avgCost = 0, portfolioLabel = null }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    api.get(`/prices/detail/${symbol}`)
      .then(({ data }) => setData(data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <div className="bg-white rounded-lg shadow p-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
      <div className="h-6 bg-gray-200 rounded w-32 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-full" />
    </div>
  )

  if (error) return (
    <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-300">
      <p className="font-bold text-gray-800">{symbol}</p>
      <p className="text-xs text-red-500 mt-1">{error}</p>
    </div>
  )

  if (!data) return null

  const price = data.price || 0
  const returnVsAvg = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : null
  const yieldOnCost = avgCost > 0 && data.annualDividend ? (data.annualDividend / avgCost * 100) : null
  const totalReturnPct = returnVsAvg !== null && yieldOnCost !== null ? returnVsAvg + yieldOnCost : null

  const w52range = data.fiftyTwoWeekHigh && data.fiftyTwoWeekLow && data.fiftyTwoWeekHigh !== data.fiftyTwoWeekLow
    ? Math.min(Math.max(((price - data.fiftyTwoWeekLow) / (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow) * 100), 0), 100)
    : null

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>

        {/* Portfolio label */}
        {portfolioLabel && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs text-gray-400">{portfolioLabel.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              portfolioLabel.type === 'TFSA' ? 'bg-emerald-100 text-emerald-700' :
              portfolioLabel.type === 'RRSP' ? 'bg-blue-100 text-blue-700' :
              portfolioLabel.type === 'LIRA' ? 'bg-purple-100 text-purple-700' :
              'bg-orange-100 text-orange-700'
            }`}>{portfolioLabel.type}</span>
          </div>
        )}

        {/* Symbol + Price */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 text-lg">{data.symbol || symbol}</h3>
              {data.marketState === 'REGULAR'
                ? <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">● Live</span>
                : <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Closed</span>
              }
            </div>
            <p className="text-xs text-gray-400 truncate max-w-[200px] mt-0.5">{data.name || data.exchange || '—'}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{fmt(price)}</p>
            <PriceChange change={data.change || 0} changePct={data.changePercent || 0} />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
          <div>
            <p className="text-gray-400">Current Yield</p>
            <YieldBar yieldPct={data.yieldPct || 0} />
          </div>
          <div>
            <p className="text-gray-400">Annual Dividend</p>
            <p className="font-semibold text-teal-600">{fmt(data.annualDividend || 0)}/share</p>
          </div>
          <div>
            <p className="text-gray-400">Per Payment</p>
            <p className="font-semibold text-teal-600">{fmt(data.avgMonthlyDiv || 0)}/share</p>
          </div>
          <div>
            <p className="text-gray-400">Frequency</p>
            <p className="font-semibold text-gray-700">
              {data.frequency === 52 ? 'Weekly' : data.frequency === 26 ? 'Fortnightly' : data.frequency === 24 ? 'Bi-Monthly' : data.frequency === 12 ? 'Monthly' : data.frequency === 6 ? 'Every 2 Months' : data.frequency === 4 ? 'Quarterly' : data.frequency === 2 ? 'Semi-Annual' : 'Annual'}
            </p>
          </div>
          {returnVsAvg !== null && (
            <div>
              <p className="text-gray-400">Price Return vs Cost</p>
              <p className={`font-semibold ${returnVsAvg >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmtPct(returnVsAvg)}
              </p>
            </div>
          )}
          {yieldOnCost !== null && (
            <div>
              <p className="text-gray-400">Yield on Cost</p>
              <p className="font-semibold text-teal-600">{yieldOnCost.toFixed(2)}%/yr</p>
            </div>
          )}
        </div>

        {/* Total Return banner */}
        {totalReturnPct !== null && (
          <div className={`rounded px-3 py-1.5 text-xs flex justify-between items-center mb-3 ${totalReturnPct >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <span className="text-gray-600 font-medium">Total Return (price + yield)</span>
            <span className={`font-bold ${totalReturnPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {fmtPct(totalReturnPct)}
            </span>
          </div>
        )}

        {/* 52W range */}
        {w52range !== null && (
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>52W Low {fmt(data.fiftyTwoWeekLow)}</span>
              <span>52W High {fmt(data.fiftyTwoWeekHigh)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 relative">
              <div className="bg-blue-400 h-1.5 rounded-l-full" style={{ width: `${w52range}%` }} />
              <div
                className="absolute top-1/2 w-2.5 h-2.5 bg-blue-600 rounded-full border-2 border-white shadow"
                style={{ left: `${w52range}%`, transform: 'translate(-50%, -50%)' }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end mt-2">
          <span className="text-xs text-gray-400">{expanded ? '▲ hide details' : '▼ show details'}</span>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50 rounded-b-lg">

          {/* Monthly Prices */}
          {data.monthlyPrices && data.monthlyPrices.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">📈 Last 3 Months — Price</h4>
              <div className="grid grid-cols-3 gap-2">
                {data.monthlyPrices.map((mp, i) => {
                  const prev = data.monthlyPrices[i - 1]
                  const chg = prev ? ((mp.price - prev.price) / prev.price * 100) : null
                  return (
                    <div key={mp.date} className="bg-white rounded p-2 text-center border border-gray-100">
                      <p className="text-xs text-gray-400">{mp.date}</p>
                      <p className="text-sm font-bold text-gray-800">{fmt(mp.price)}</p>
                      {chg !== null && (
                        <p className={`text-xs ${chg >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {fmtPct(chg)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Past Dividends */}
          {data.past3MonthsDividends && data.past3MonthsDividends.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">💰 Last 3 Months — Dividends</h4>
              <div className="space-y-1.5">
                {data.past3MonthsDividends.map((d) => (
                  <div key={d.date} className="flex justify-between items-center bg-white rounded px-3 py-2 border border-teal-100">
                    <span className="text-xs text-gray-600 font-medium">{fmtDate(d.date)}</span>
                    <span className="text-sm font-bold text-teal-700">{fmt(d.amount)}/share</span>
                    <span className="text-xs text-gray-400">
                      Annualized: {price > 0 ? ((d.amount * (data.frequency || 12) / price) * 100).toFixed(2) : '—'}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Future Dividends */}
          {data.future2MonthsDividends && data.future2MonthsDividends.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">📅 Upcoming Dividends (estimated)</h4>
              <div className="space-y-1.5">
                {data.future2MonthsDividends.map((d) => (
                  <div key={d.date} className="flex justify-between items-center bg-blue-50 rounded px-3 py-2 border border-blue-200">
                    <span className="text-xs text-blue-700 font-semibold">{fmtDate(d.date)}</span>
                    <span className="text-sm font-bold text-blue-700">{fmt(d.amount)}/share</span>
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">estimated</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Return Summary */}
          <div>
            <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">📊 Return Summary</h4>
            <div className="grid grid-cols-2 gap-2">
              {avgCost > 0 && (
                <>
                  <div className="bg-white rounded p-2 border border-gray-100">
                    <p className="text-xs text-gray-400">Your Avg Cost</p>
                    <p className="text-sm font-bold text-gray-700">{fmt(avgCost)}</p>
                  </div>
                  <div className="bg-white rounded p-2 border border-gray-100">
                    <p className="text-xs text-gray-400">Current Price</p>
                    <p className="text-sm font-bold text-gray-700">{fmt(price)}</p>
                  </div>
                  <div className={`rounded p-2 border ${returnVsAvg >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                    <p className="text-xs text-gray-400">Price Return</p>
                    <p className={`text-sm font-bold ${returnVsAvg >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {fmtPct(returnVsAvg)}
                    </p>
                  </div>
                  <div className="bg-teal-50 rounded p-2 border border-teal-100">
                    <p className="text-xs text-gray-400">Yield on Your Cost</p>
                    <p className="text-sm font-bold text-teal-700">
                      {avgCost > 0 ? ((data.annualDividend / avgCost) * 100).toFixed(2) : '—'}%/yr
                    </p>
                  </div>
                  {totalReturnPct !== null && (
                    <div className={`col-span-2 rounded p-2 border ${totalReturnPct >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                      <p className="text-xs text-gray-400">Total Return (Price + Yield on Cost)</p>
                      <p className={`text-base font-bold ${totalReturnPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {fmtPct(totalReturnPct)}
                      </p>
                    </div>
                  )}
                </>
              )}
              <div className="bg-white rounded p-2 border border-gray-100">
                <p className="text-xs text-gray-400">Previous Close</p>
                <p className="text-sm font-bold text-gray-700">{fmt(data.previousClose)}</p>
              </div>
              <div className="bg-white rounded p-2 border border-gray-100">
                <p className="text-xs text-gray-400">Exchange</p>
                <p className="text-sm font-bold text-gray-700">{data.exchange || '—'}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Prices() {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchedSymbols, setSearchedSymbols] = useState([])

  useEffect(() => {
    const fetchHoldings = async () => {
      try {
        const { data: portfolios } = await api.get('/portfolios')
        const allHoldings = []
        for (const p of portfolios) {
          const { data } = await api.get(`/portfolios/${p.id}`)
          for (const h of (data.holdings || [])) {
            allHoldings.push({
              symbol: h.symbol,
              name: h.name,
              avgCost: Number(h.average_cost || 0),
              portfolio: { name: p.name, type: p.type },
            })
          }
        }
        setHoldings(allHoldings)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchHoldings()
  }, [])

  const handleSearch = (symbol) => {
    const sym = symbol.toUpperCase()
    // Don't add if already in holdings or already searched
    if (!searchedSymbols.find(s => s === sym) && !holdings.find(h => h.symbol === sym)) {
      setSearchedSymbols(prev => [sym, ...prev])
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64 text-gray-500">Loading holdings...</div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prices & Dividends</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live prices · 3 month history · upcoming dividends · yield analysis
          </p>
        </div>
        <SymbolSearchBox onSelect={handleSearch} />
      </div>

      {/* Searched Symbols */}
      {searchedSymbols.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">🔍 Looked Up</h2>
            <button
              onClick={() => setSearchedSymbols([])}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {searchedSymbols.map(sym => (
              <div key={sym} className="relative">
                <button
                  onClick={() => setSearchedSymbols(prev => prev.filter(s => s !== sym))}
                  className="absolute top-2 right-2 z-10 text-gray-300 hover:text-gray-500 text-xs bg-white rounded-full w-5 h-5 flex items-center justify-center shadow"
                >
                  ✕
                </button>
                <HoldingPriceCard symbol={sym} avgCost={0} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio Holdings */}
      {holdings.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          No holdings found. Add holdings to your portfolio first.
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">📁 Your Holdings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {holdings.map((h) => (
              <HoldingPriceCard
                key={h.symbol}
                symbol={h.symbol}
                avgCost={h.avgCost}
                portfolioLabel={h.portfolio}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
