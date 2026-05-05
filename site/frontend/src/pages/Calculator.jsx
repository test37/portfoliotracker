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
  { bg: 'bg-emerald-50', border: 'border-emerald-400', header: 'bg-emerald-600', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500' },
  { bg: 'bg-blue-50', border: 'border-blue-400', header: 'bg-blue-600', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', bar: 'bg-blue-500' },
  { bg: 'bg-purple-50', border: 'border-purple-400', header: 'bg-purple-600', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-800', bar: 'bg-purple-500' },
]

export default function Calculator() {
  const [etfList, setEtfList] = useState([])
  const [priceMap, setPriceMap] = useState({})
  const [selected, setSelected] = useState([null, null, null])
  const [investment, setInvestment] = useState(10000)
  const [years, setYears] = useState(5)
  const [priceGrowth, setPriceGrowth] = useState(0)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: etfs } = await api.get('/etfmaster')
        setEtfList(etfs)
        // Fetch price details for all ETFs
        const map = {}
        await Promise.all(etfs.map(async (e) => {
          try {
            const { data: pd } = await api.get(`/prices/detail/${e.symbol}`)
            map[e.symbol] = pd
          } catch { map[e.symbol] = null }
        }))
        setPriceMap(map)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleSelect = (idx, symbol) => {
    const newSelected = [...selected]
    newSelected[idx] = symbol || null
    setSelected(newSelected)
  }

  const calculate = () => {
    setCalculating(true)
    const activeSelected = selected.filter(Boolean)
    if (activeSelected.length === 0) { setCalculating(false); return }

    const res = activeSelected.map((symbol, i) => {
      const etf = etfList.find(e => e.symbol === symbol)
      const pd = priceMap[symbol]
      const price = pd?.price || 0
      const annualDiv = pd?.annualDividend || 0
      const frequency = pd?.frequency || 12
      const yieldPct = price > 0 ? (annualDiv / price * 100) : 0

      // Shares purchasable
      const shares = price > 0 ? Math.floor(investment / price) : 0
      const spent = shares * price
      const leftover = investment - spent

      // Per period calculations
      const monthlyDivPerShare = annualDiv / 12
      const paymentPerShare = annualDiv / frequency
      const monthlyIncome = monthlyDivPerShare * shares
      const annualIncome = annualDiv * shares

      // Projected over years (with dividend reinvestment option)
      const yearlyData = []
      let totalShares = shares
      let totalDivReceived = 0
      let currentPrice = price

      for (let y = 1; y <= years; y++) {
        currentPrice = price * Math.pow(1 + priceGrowth / 100, y)
        const yearDiv = annualDiv * totalShares
        totalDivReceived += yearDiv
        // Reinvest dividends to buy more shares
        const newShares = currentPrice > 0 ? Math.floor(yearDiv / currentPrice) : 0
        totalShares += newShares

        yearlyData.push({
          year: y,
          shares: totalShares,
          price: currentPrice,
          marketValue: totalShares * currentPrice,
          yearDividend: yearDiv,
          totalDividends: totalDivReceived,
          totalValue: totalShares * currentPrice + leftover,
        })
      }

      const finalYear = yearlyData[yearlyData.length - 1] || {}
      const totalReturn = (finalYear.totalValue || 0) - investment
      const totalReturnPct = investment > 0 ? (totalReturn / investment * 100) : 0

      return {
        symbol,
        name: etf?.description?.split(' - ').slice(1).join(' - ') || symbol,
        shortName: etf?.description?.split(' - ')[1]?.split(':')[0] || symbol,
        price,
        annualDiv,
        frequency,
        yieldPct,
        shares,
        spent,
        leftover,
        monthlyIncome,
        annualIncome,
        paymentPerShare,
        yearlyData,
        totalReturn,
        totalReturnPct,
        finalValue: finalYear.totalValue || investment,
        totalDividends: finalYear.totalDividends || 0,
        color: COLORS[i % COLORS.length],
      }
    })

    setResults(res)
    setCalculating(false)
  }

  const activeCount = selected.filter(Boolean).length
  const maxFinalValue = Math.max(...results.map(r => r.finalValue), 1)

  if (loading) return (
    <div className="flex justify-center items-center h-64 text-gray-500">Loading ETF data...</div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">ETF Calculator & Comparison</h1>
        <p className="text-sm text-gray-500 mt-1">
          Compare up to 3 ETFs — see which gives the best return on your investment
        </p>
      </div>

      {/* Input Panel */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Investment Settings</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Investment Amount (CAD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500 font-medium">$</span>
              <input
                type="number"
                value={investment}
                onChange={(e) => setInvestment(Number(e.target.value))}
                min={100} step={100}
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex gap-1 mt-1 flex-wrap">
              {[5000, 10000, 25000, 50000].map(v => (
                <button key={v} onClick={() => setInvestment(v)}
                  className={`text-xs px-2 py-0.5 rounded border ${investment === v ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {fmt(v).replace('CA$', '$').replace('.00', '')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Investment Period (Years)
            </label>
            <input
              type="number"
              value={years}
              onChange={(e) => setYears(Math.max(1, Math.min(30, Number(e.target.value))))}
              min={1} max={30}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex gap-1 mt-1 flex-wrap">
              {[1, 3, 5, 10, 20].map(v => (
                <button key={v} onClick={() => setYears(v)}
                  className={`text-xs px-2 py-0.5 rounded border ${years === v ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {v}yr
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Price Growth (%/yr)
            </label>
            <input
              type="number"
              value={priceGrowth}
              onChange={(e) => setPriceGrowth(Number(e.target.value))}
              min={-20} max={50} step={0.5}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="flex gap-1 mt-1 flex-wrap">
              {[0, 2, 5, 10].map(v => (
                <button key={v} onClick={() => setPriceGrowth(v)}
                  className={`text-xs px-2 py-0.5 rounded border ${priceGrowth === v ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {v}%
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">0% = dividends only, no price change assumed</p>
          </div>
        </div>

        {/* ETF Selectors */}
        <h2 className="text-base font-semibold text-gray-900 mb-3">Select ETFs to Compare (1-3)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {[0, 1, 2].map((idx) => (
            <EtfSelector
              key={idx}
              idx={idx}
              symbol={selected[idx]}
              priceData={selected[idx] ? priceMap[selected[idx]] : null}
              etfList={etfList}
              selected={selected}
              color={COLORS[idx]}
              onSelect={handleSelect}
              onPriceLoaded={(sym, pd) => setPriceMap(prev => ({ ...prev, [sym]: pd }))}
            />
          ))}
        </div>

        <button
          onClick={calculate}
          disabled={activeCount === 0 || calculating}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-lg font-semibold text-base disabled:opacity-50 transition-colors"
        >
          {calculating ? '⟳ Calculating...' : `📊 Calculate & Compare${activeCount > 1 ? ` ${activeCount} ETFs` : ''}`}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <>
          {/* Winner Banner */}
          {results.length > 1 && (() => {
            const winner = results.reduce((best, r) => r.finalValue > best.finalValue ? r : best, results[0])
            return (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 mb-6 flex items-center gap-3">
                <span className="text-3xl">🏆</span>
                <div>
                  <p className="font-bold text-amber-800 text-lg">
                    {winner.symbol} wins with {fmt(winner.finalValue)} after {years} year{years > 1 ? 's' : ''}
                  </p>
                  <p className="text-sm text-amber-700">
                    Total return: {fmtPct(winner.totalReturnPct)} · Dividends: {fmt(winner.totalDividends)} · Final value: {fmt(winner.finalValue)}
                  </p>
                </div>
              </div>
            )
          })()}

          {/* Summary Cards */}
          <div className={`grid grid-cols-1 md:grid-cols-${results.length} gap-4 mb-6`}>
            {results.map((r) => (
              <div key={r.symbol} className={`rounded-lg border-2 ${r.color.border} ${r.color.bg} p-5`}>
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-white text-sm font-bold mb-3 ${r.color.header}`}>
                  {r.symbol}
                </div>
                <p className="text-xs text-gray-500 mb-3 leading-tight">{r.shortName}</p>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Investment</span>
                    <span className="text-sm font-semibold">{fmt(investment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Shares Purchased</span>
                    <span className="text-sm font-semibold">{r.shares} shares</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Price per Share</span>
                    <span className="text-sm font-semibold">{fmt(r.price)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Amount Spent</span>
                    <span className="text-sm font-semibold">{fmt(r.spent)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Leftover Cash</span>
                    <span className="text-sm font-semibold text-gray-400">{fmt(r.leftover)}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Monthly Income (Yr 1)</span>
                      <span className={`text-sm font-bold ${r.color.text}`}>{fmt(r.monthlyIncome)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Annual Income (Yr 1)</span>
                      <span className={`text-sm font-bold ${r.color.text}`}>{fmt(r.annualIncome)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Current Yield</span>
                      <span className={`text-sm font-bold ${r.color.text}`}>{r.yieldPct.toFixed(2)}%</span>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Total Dividends ({years}yr)</span>
                      <span className={`text-sm font-bold ${r.color.text}`}>{fmt(r.totalDividends)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Final Value ({years}yr)</span>
                      <span className="text-base font-bold text-gray-900">{fmt(r.finalValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">Total Return</span>
                      <span className={`text-sm font-bold ${r.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmt(r.totalReturn)} ({fmtPct(r.totalReturnPct)})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Final value vs max</span>
                    <span>{((r.finalValue / maxFinalValue) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className={`h-2 rounded-full ${r.color.bar}`}
                      style={{ width: `${(r.finalValue / maxFinalValue) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Year by Year Table */}
          <div className="bg-white rounded-lg shadow p-5 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Year-by-Year Projection (with dividend reinvestment)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Year</th>
                    {results.map(r => (
                      <th key={r.symbol} colSpan={3} className={`text-center py-2 px-3 font-semibold ${r.color.text}`}>
                        {r.symbol}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-1.5 px-3 text-xs text-gray-400">—</th>
                    {results.map(r => (
                      <>
                        <th key={`${r.symbol}-shares`} className="text-right py-1.5 px-2 text-xs text-gray-400">Shares</th>
                        <th key={`${r.symbol}-div`} className="text-right py-1.5 px-2 text-xs text-gray-400">Yr Dividends</th>
                        <th key={`${r.symbol}-val`} className="text-right py-1.5 px-2 text-xs text-gray-400">Total Value</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {Array.from({ length: years }, (_, i) => i).map(yi => (
                    <tr key={yi} className="hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-700">Year {yi + 1}</td>
                      {results.map(r => {
                        const yd = r.yearlyData[yi] || {}
                        return (
                          <>
                            <td key={`${r.symbol}-s`} className="py-2 px-2 text-right text-gray-600 text-xs">{yd.shares}</td>
                            <td key={`${r.symbol}-d`} className={`py-2 px-2 text-right text-xs font-medium ${r.color.text}`}>{fmt(yd.yearDividend)}</td>
                            <td key={`${r.symbol}-v`} className="py-2 px-2 text-right font-semibold text-gray-800">{fmt(yd.totalValue)}</td>
                          </>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                    <td className="py-2 px-3 text-gray-800">Final</td>
                    {results.map(r => (
                      <>
                        <td key={`${r.symbol}-fs`} className="py-2 px-2 text-right text-gray-700">{r.yearlyData[years-1]?.shares}</td>
                        <td key={`${r.symbol}-fd`} className={`py-2 px-2 text-right ${r.color.text}`}>{fmt(r.totalDividends)}</td>
                        <td key={`${r.symbol}-fv`} className="py-2 px-2 text-right text-gray-900">{fmt(r.finalValue)}</td>
                      </>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Comparison Bar Chart */}
          {results.length > 1 && (
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Final Value Comparison after {years} Year{years > 1 ? 's' : ''}</h3>
              <div className="space-y-4">
                {[
                  { label: 'Final Portfolio Value', key: 'finalValue' },
                  { label: 'Total Dividends Received', key: 'totalDividends' },
                  { label: 'Total Return', key: 'totalReturn' },
                ].map(({ label, key }) => {
                  const maxVal = Math.max(...results.map(r => Math.abs(r[key])), 1)
                  return (
                    <div key={key}>
                      <p className="text-xs font-medium text-gray-600 mb-2">{label}</p>
                      <div className="space-y-1.5">
                        {results.map(r => (
                          <div key={r.symbol} className="flex items-center gap-3">
                            <span className={`text-xs font-bold w-20 ${r.color.text}`}>{r.symbol}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                              <div
                                className={`h-6 rounded-full ${r.color.bar} flex items-center justify-end pr-2`}
                                style={{ width: `${(Math.abs(r[key]) / maxVal) * 100}%`, minWidth: '60px' }}
                              >
                                <span className="text-white text-xs font-semibold">{fmt(r[key])}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-4">
                * Assumes dividends are reinvested to buy more shares at current price.
                Price growth of {priceGrowth}%/yr applied. Leftover cash ({fmt(results[0]?.leftover)}) not included.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}


function EtfSelector({ idx, symbol, priceData, etfList, selected, color: c, onSelect, onPriceLoaded }) {
  const [mode, setMode] = useState('master') // master | custom
  const [customInput, setCustomInput] = useState('')
  const [loadingCustom, setLoadingCustom] = useState(false)
  const [customError, setCustomError] = useState(null)

  const handleMasterSelect = (sym) => {
    setCustomError(null)
    onSelect(idx, sym)
  }

  const handleCustomLookup = async () => {
    const sym = customInput.trim().toUpperCase()
    if (!sym) return
    // Check if symbol has exchange extension
    if (!sym.includes('.')) {
      setCustomError('Please include the exchange extension (e.g. HYLD.TO for TSX, HBTE.NE for NEO). Without it we cannot fetch the correct Canadian price.')
      return
    }
    setLoadingCustom(true)
    setCustomError(null)
    try {
      const { data: pd } = await api.get(`/prices/detail/${sym}`)
      if (!pd || !pd.price) throw new Error('No price data found')
      onPriceLoaded(sym, pd)
      onSelect(idx, sym)
      setCustomError(null)
    } catch (err) {
      setCustomError(`Could not find price data for "${sym}". Make sure the symbol and exchange extension are correct.`)
    } finally {
      setLoadingCustom(false)
    }
  }

  const handleClear = () => {
    onSelect(idx, null)
    setCustomInput('')
    setCustomError(null)
  }

  return (
    <div className={`rounded-lg border-2 p-3 transition-all ${symbol ? `${c.border} ${c.bg}` : 'border-dashed border-gray-300 bg-gray-50'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white ${symbol ? c.header : 'bg-gray-300'}`}>
            {idx + 1}
          </div>
          <label className="text-sm font-medium text-gray-700">
            ETF {idx + 1} {idx === 0 && <span className="text-red-500">*</span>}
          </label>
        </div>
        {symbol && (
          <button onClick={handleClear} className="text-xs text-gray-400 hover:text-red-500">✕ Clear</button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex rounded border border-gray-300 overflow-hidden mb-2 text-xs">
        <button
          onClick={() => { setMode('master'); handleClear() }}
          className={`flex-1 py-1 font-medium transition-colors ${mode === 'master' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          📋 My ETFs
        </button>
        <button
          onClick={() => { setMode('custom'); handleClear() }}
          className={`flex-1 py-1 font-medium border-l border-gray-300 transition-colors ${mode === 'custom' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          🔍 Any ETF
        </button>
      </div>

      {/* Master Select */}
      {mode === 'master' && (
        <select
          value={symbol || ''}
          onChange={(e) => handleMasterSelect(e.target.value)}
          className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          <option value="">— Select from your ETFs —</option>
          {etfList.map(e => (
            <option key={e.symbol} value={e.symbol}
              disabled={selected.includes(e.symbol) && selected[idx] !== e.symbol}>
              {e.symbol} — {e.description.split(' - ')[1]?.split(':')[0] || e.base_symbol}
            </option>
          ))}
        </select>
      )}

      {/* Custom Input */}
      {mode === 'custom' && !symbol && (
        <div className="space-y-2">
          <div className="flex gap-1">
            <input
              type="text"
              value={customInput}
              onChange={(e) => { setCustomInput(e.target.value.toUpperCase()); setCustomError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomLookup()}
              placeholder="e.g. VFV.TO"
              className="flex-1 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={handleCustomLookup}
              disabled={loadingCustom || !customInput.trim()}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium disabled:opacity-50"
            >
              {loadingCustom ? '⟳' : 'Find'}
            </button>
          </div>
          {customError ? (
            <div className="bg-red-50 border border-red-200 rounded p-2">
              <p className="text-xs text-red-700">{customError}</p>
              {!customInput.includes('.') && (
                <div className="mt-1.5 text-xs text-red-600 font-medium">
                  <p>Common extensions:</p>
                  <p>· <strong>.TO</strong> — Toronto Stock Exchange (TSX)</p>
                  <p>· <strong>.NE</strong> — NEO Exchange</p>
                  <p>· No extension — US stocks (NYSE/NASDAQ)</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-blue-50 rounded p-2 text-xs text-blue-700">
              <p className="font-medium mb-0.5">💡 Include exchange extension:</p>
              <p>· TSX stocks: <strong>SYMBOL.TO</strong> (e.g. VFV.TO)</p>
              <p>· NEO stocks: <strong>SYMBOL.NE</strong> (e.g. HBTE.NE)</p>
              <p>· US stocks: <strong>SYMBOL</strong> (e.g. SCHD)</p>
            </div>
          )}
        </div>
      )}

      {/* Price Data Display */}
      {symbol && priceData && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Symbol:</span>
            <span className={`font-bold ${c.text}`}>{symbol}</span>
          </div>
          {priceData.name && (
            <p className="text-xs text-gray-400 truncate" title={priceData.name}>{priceData.name}</p>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Price:</span>
            <span className="font-semibold text-gray-800">{fmt(priceData.price)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Annual Div:</span>
            <span className={`font-semibold ${c.text}`}>{fmt(priceData.annualDividend || 0)}/share</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Yield:</span>
            <span className={`font-semibold ${c.text}`}>{(priceData.yieldPct || 0).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Frequency:</span>
            <span className="font-semibold text-gray-700">
              {priceData.frequency === 52 ? 'Weekly' :
               priceData.frequency === 26 ? 'Fortnightly' :
               priceData.frequency === 24 ? 'Bi-Monthly' :
               priceData.frequency === 12 ? 'Monthly' :
               priceData.frequency === 4  ? 'Quarterly' :
               priceData.frequency === 2  ? 'Semi-Annual' : 'Annual'}
            </span>
          </div>
          {mode === 'custom' && (
            <div className="mt-1 bg-emerald-50 rounded px-2 py-1 text-xs text-emerald-700 font-medium">
              ✓ Found! Data loaded successfully.
            </div>
          )}
        </div>
      )}

      {symbol && !priceData && (
        <p className="text-xs text-gray-400 mt-2 animate-pulse">Loading price data...</p>
      )}
    </div>
  )
}
