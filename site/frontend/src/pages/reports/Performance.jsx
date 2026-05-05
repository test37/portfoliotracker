import { useState, useEffect } from 'react'
import api from '../../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

function fmtPct(val, decimals = 2) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%'
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MiniSparkline({ data, color = '#10b981', height = 40 }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 120
  const h = height
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

export default function Performance() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [chartView, setChartView] = useState('value') // value | return

  useEffect(() => { buildReport() }, [])

  const buildReport = async () => {
    setLoading(true)
    try {
      // Fetch portfolio data
      const { data: portfolios } = await api.get('/portfolios')
      let allTransactions = []
      let allDividends = []
      let currentHoldings = []
      let totalContributions = 0

      for (const p of portfolios) {
        const { data: portData } = await api.get(`/portfolios/${p.id}`)
        const holdings = portData.holdings || []

        // Contributions
        const contRes = await api.get(`/imports/contributions/${p.id}`)
        totalContributions += Number(contRes.data.by_year?.reduce((s, y) => s + Number(y.total || 0), 0) || 0)

        for (const h of holdings) {
          currentHoldings.push(h)
          const { data: txs } = await api.get(`/transactions/${h.id}`)
          const { data: divs } = await api.get(`/dividends/${h.id}`)
          allTransactions.push(...txs.map(t => ({ ...t, symbol: h.symbol })))
          allDividends.push(...divs.map(d => ({ ...d, symbol: h.symbol })))
        }
      }

      // Sort transactions by date
      allTransactions.sort((a, b) => new Date(a.date) - new Date(b.date))

      // Current portfolio values
      const totalBookValue = currentHoldings.reduce((s, h) => s + Number(h.book_value || 0), 0)
      const totalMarketValue = currentHoldings.reduce((s, h) => s + Number(h.market_value || 0), 0)
      const totalDividends = allDividends.reduce((s, d) => s + Number(d.amount || 0), 0)
      const totalRealized = currentHoldings.reduce((s, h) => s + Number(h.realized_pnl || 0), 0)
      const unrealized = totalMarketValue - totalBookValue

      // Total return
      const totalReturn = totalMarketValue - totalContributions
      const totalReturnPct = totalContributions > 0 ? (totalReturn / totalContributions * 100) : 0

      // CAGR calculation
      const firstTxDate = new Date(allTransactions[0]?.date || new Date())
      const now = new Date()
      const yearsHeld = (now - firstTxDate) / (365.25 * 24 * 3600 * 1000)
      const cagr = yearsHeld > 0 && totalContributions > 0
        ? (Math.pow(totalMarketValue / totalContributions, 1 / yearsHeld) - 1) * 100
        : 0

      // Best and worst holdings
      const holdingPerformance = currentHoldings.map(h => {
        const divs = allDividends.filter(d => d.symbol === h.symbol)
        const divTotal = divs.reduce((s, d) => s + Number(d.amount || 0), 0)
        const gainAmt = Number(h.market_value || 0) - Number(h.book_value || 0)
        const totalProfit = gainAmt + Number(h.realized_pnl || 0) + divTotal
        const bookValue = Number(h.book_value || 0)
        const returnPct = bookValue > 0 ? (totalProfit / bookValue * 100) : 0
        const pricePct = Number(h.gain_loss_pct || 0)
        return {
          symbol: h.symbol,
          name: h.name,
          bookValue,
          marketValue: Number(h.market_value || 0),
          gainAmt,
          divTotal,
          totalProfit,
          returnPct,
          pricePct,
          quantity: Number(h.quantity || 0),
        }
      }).filter(h => h.bookValue > 0).sort((a, b) => b.returnPct - a.returnPct)

      // Fetch S&P 500 and TSX index data
      const [spRes, tsxRes] = await Promise.all([
        api.get('/prices/detail/%5EGSPC').catch(() => null),
        api.get('/prices/detail/%5EGSPTSE').catch(() => null),
      ])

      // Build monthly portfolio value timeline
      // Starting from first transaction, calculate running portfolio value
      const monthlyTimeline = buildMonthlyTimeline(allTransactions, allDividends, currentHoldings, firstTxDate)

      // Fetch index monthly data for comparison
      const [spMonthly, tsxMonthly] = await Promise.all([
        fetchIndexMonthly('%5EGSPC'),
        fetchIndexMonthly('%5EGSPTSE'),
      ])

      // Align index data with portfolio start date
      const portfolioStartKey = `${firstTxDate.getFullYear()}-${String(firstTxDate.getMonth() + 1).padStart(2, '0')}`
      const spAligned = alignIndexToPortfolio(spMonthly, portfolioStartKey, totalContributions)
      const tsxAligned = alignIndexToPortfolio(tsxMonthly, portfolioStartKey, totalContributions)

      setData({
        totalContributions,
        totalBookValue,
        totalMarketValue,
        totalDividends,
        totalRealized,
        unrealized,
        totalReturn,
        totalReturnPct,
        cagr,
        yearsHeld,
        holdingPerformance,
        monthlyTimeline,
        spAligned,
        tsxAligned,
        firstTxDate,
      })
    } catch (err) {
      console.error('Performance report error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64 text-gray-500">Building report...</div>
  )
  if (!data) return null

  const maxVal = Math.max(
    ...data.monthlyTimeline.map(m => m.portfolioValue),
    ...data.spAligned.map(m => m.value),
    ...data.tsxAligned.map(m => m.value),
    1
  )
  const minVal = Math.min(
    ...data.monthlyTimeline.map(m => m.portfolioValue),
    ...data.spAligned.map(m => m.value),
    ...data.tsxAligned.map(m => m.value),
  ) * 0.95

  const chartData = data.monthlyTimeline
  const chartH = 200
  const chartW = Math.max(chartData.length * 40, 400)

  function toY(val) {
    return chartH - ((val - minVal) / (maxVal - minVal)) * (chartH - 20) - 10
  }

  function toPoints(arr, valKey) {
    return arr.map((m, i) => {
      const x = (i / (arr.length - 1)) * chartW
      const y = toY(m[valKey])
      return `${x},${y}`
    }).join(' ')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Performance Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Since {data.firstTxDate.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })} · {data.yearsHeld.toFixed(1)} years
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 mb-1">Total Invested</p>
          <p className="text-xl font-bold text-gray-900">{fmt(data.totalContributions)}</p>
          <p className="text-xs text-gray-400 mt-1">Cash contributed</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
          <p className="text-xs text-gray-500 mb-1">Current Value</p>
          <p className="text-xl font-bold text-gray-900">{fmt(data.totalMarketValue)}</p>
          <p className="text-xs text-gray-400 mt-1">Market value today</p>
        </div>
        <div className={'bg-white rounded-lg shadow p-4 border-l-4 ' + (data.totalReturn >= 0 ? 'border-emerald-500' : 'border-red-500')}>
          <p className="text-xs text-gray-500 mb-1">Total Return</p>
          <p className={'text-xl font-bold ' + (data.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmt(data.totalReturn)}
          </p>
          <p className={'text-xs font-medium mt-1 ' + (data.totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500')}>
            {fmtPct(data.totalReturnPct)} on invested capital
          </p>
        </div>
        <div className={'bg-white rounded-lg shadow p-4 border-l-4 ' + (data.cagr >= 0 ? 'border-purple-500' : 'border-red-500')}>
          <p className="text-xs text-gray-500 mb-1">CAGR</p>
          <p className={'text-xl font-bold ' + (data.cagr >= 0 ? 'text-purple-700' : 'text-red-600')}>
            {fmtPct(data.cagr)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Annualized return</p>
        </div>
      </div>

      {/* Second row cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 mb-1">Unrealized Gain/Loss</p>
          <p className={'text-lg font-bold ' + (data.unrealized >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmt(data.unrealized)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 mb-1">Realized Gain/Loss</p>
          <p className={'text-lg font-bold ' + (data.totalRealized >= 0 ? 'text-emerald-600' : 'text-red-600')}>
            {fmt(data.totalRealized)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 mb-1">Total Dividends</p>
          <p className="text-lg font-bold text-teal-600">{fmt(data.totalDividends)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500 mb-1">Time Invested</p>
          <p className="text-lg font-bold text-gray-800">{data.yearsHeld.toFixed(1)} years</p>
          <p className="text-xs text-gray-400 mt-1">{Math.round(data.yearsHeld * 12)} months</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-base font-semibold text-gray-900">Portfolio vs Index Comparison</h3>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-emerald-500" style={{borderTop: '2px solid #10b981'}}/>
              <span className="text-gray-600">Your Portfolio</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5" style={{borderTop: '2px dashed #3b82f6'}}/>
              <span className="text-gray-600">S&P 500</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5" style={{borderTop: '2px dashed #f59e0b'}}/>
              <span className="text-gray-600">TSX</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <svg width={chartW} height={chartH + 30} className="overflow-visible">
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map(pct => {
              const y = chartH - (pct / 100) * (chartH - 20) - 10
              const val = minVal + (maxVal - minVal) * (pct / 100)
              return (
                <g key={pct}>
                  <line x1={0} y1={y} x2={chartW} y2={y} stroke="#f3f4f6" strokeWidth="1" />
                  <text x={0} y={y - 2} fontSize="9" fill="#9ca3af">{fmt(val).replace('CA', '')}</text>
                </g>
              )
            })}

            {/* TSX line */}
            {data.tsxAligned.length > 1 && (
              <polyline
                points={toPoints(data.tsxAligned, 'value')}
                fill="none" stroke="#f59e0b" strokeWidth="1.5"
                strokeDasharray="4,3" opacity="0.8"
              />
            )}

            {/* S&P line */}
            {data.spAligned.length > 1 && (
              <polyline
                points={toPoints(data.spAligned, 'value')}
                fill="none" stroke="#3b82f6" strokeWidth="1.5"
                strokeDasharray="4,3" opacity="0.8"
              />
            )}

            {/* Portfolio line */}
            {chartData.length > 1 && (
              <>
                <polyline
                  points={toPoints(chartData, 'portfolioValue')}
                  fill="none" stroke="#10b981" strokeWidth="2.5"
                />
                {/* Dots */}
                {chartData.map((m, i) => (
                  <circle
                    key={m.label}
                    cx={(i / (chartData.length - 1)) * chartW}
                    cy={toY(m.portfolioValue)}
                    r="3" fill="#10b981"
                  />
                ))}
              </>
            )}

            {/* X axis labels */}
            {chartData.map((m, i) => {
              if (i % Math.ceil(chartData.length / 10) !== 0 && i !== chartData.length - 1) return null
              return (
                <text
                  key={m.label}
                  x={(i / (chartData.length - 1)) * chartW}
                  y={chartH + 20}
                  fontSize="9" fill="#6b7280" textAnchor="middle"
                >
                  {m.label}
                </text>
              )
            })}
          </svg>
        </div>

        {/* Index comparison table */}
        {(data.spAligned.length > 0 || data.tsxAligned.length > 0) && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded p-3 text-center border border-emerald-200">
              <p className="text-xs text-gray-500 mb-1">Your Portfolio</p>
              <p className={`text-lg font-bold ${data.totalReturnPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {fmtPct(data.totalReturnPct)}
              </p>
              <p className="text-xs text-gray-400">Total return</p>
            </div>
            {data.spAligned.length > 0 && (
              <div className="bg-blue-50 rounded p-3 text-center border border-blue-200">
                <p className="text-xs text-gray-500 mb-1">S&P 500</p>
                <p className={`text-lg font-bold ${data.spAligned[data.spAligned.length-1]?.returnPct >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                  {fmtPct(data.spAligned[data.spAligned.length-1]?.returnPct || 0)}
                </p>
                <p className="text-xs text-gray-400">Same period</p>
              </div>
            )}
            {data.tsxAligned.length > 0 && (
              <div className="bg-amber-50 rounded p-3 text-center border border-amber-200">
                <p className="text-xs text-gray-500 mb-1">TSX</p>
                <p className={`text-lg font-bold ${data.tsxAligned[data.tsxAligned.length-1]?.returnPct >= 0 ? 'text-amber-700' : 'text-red-600'}`}>
                  {fmtPct(data.tsxAligned[data.tsxAligned.length-1]?.returnPct || 0)}
                </p>
                <p className="text-xs text-gray-400">Same period</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Best and Worst Holdings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Best performers */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">🏆 Best Performers</h3>
          <div className="space-y-3">
            {data.holdingPerformance.slice(0, 5).map((h, i) => (
              <div key={h.symbol} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-400 w-4">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{h.symbol}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[140px]">{h.name || '—'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${h.returnPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmtPct(h.returnPct)}
                  </p>
                  <p className="text-xs text-gray-400">{fmt(h.totalProfit)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worst performers */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">📉 Worst Performers</h3>
          <div className="space-y-3">
            {data.holdingPerformance.slice(-5).reverse().map((h, i) => (
              <div key={h.symbol} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-400 w-4">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{h.symbol}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[140px]">{h.name || '—'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${h.returnPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmtPct(h.returnPct)}
                  </p>
                  <p className="text-xs text-gray-400">{fmt(h.totalProfit)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full Holdings Performance Table */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-4">All Holdings Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Symbol</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Book Value</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Market Value</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Price Gain</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Dividends</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Total Profit</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Return %</th>
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.holdingPerformance.map((h) => (
                <tr key={h.symbol} className="hover:bg-gray-50">
                  <td className="py-2 px-3 font-semibold text-gray-800">{h.symbol}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{fmt(h.bookValue)}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{fmt(h.marketValue)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${h.gainAmt >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(h.gainAmt)}
                  </td>
                  <td className="py-2 px-3 text-right text-teal-600">{fmt(h.divTotal)}</td>
                  <td className={`py-2 px-3 text-right font-semibold ${h.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(h.totalProfit)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${h.returnPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {fmtPct(h.returnPct)}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <MiniSparkline
                      data={[h.bookValue, h.bookValue + h.gainAmt * 0.3, h.bookValue + h.gainAmt * 0.6, h.marketValue]}
                      color={h.gainAmt >= 0 ? '#10b981' : '#ef4444'}
                      height={28}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="py-2 px-3 font-bold text-gray-800">Total</td>
                <td className="py-2 px-3 text-right font-bold">{fmt(data.totalBookValue)}</td>
                <td className="py-2 px-3 text-right font-bold">{fmt(data.totalMarketValue)}</td>
                <td className={`py-2 px-3 text-right font-bold ${data.unrealized >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmt(data.unrealized)}
                </td>
                <td className="py-2 px-3 text-right font-bold text-teal-600">{fmt(data.totalDividends)}</td>
                <td className={`py-2 px-3 text-right font-bold ${data.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmt(data.totalReturn)}
                </td>
                <td className="py-2 px-3 text-right">
                  <span className={`text-xs px-2 py-1 rounded-full font-bold ${data.totalReturnPct >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {fmtPct(data.totalReturnPct)}
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* CAGR Explanation */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">📐 How CAGR is Calculated</h3>
        <div className="text-sm text-blue-700">
          <p>CAGR (Compound Annual Growth Rate) = (Current Value / Invested) ^ (1 / Years) - 1</p>
          <p className="mt-1 font-mono text-xs bg-white rounded px-2 py-1 inline-block mt-2">
            = ({fmt(data.totalMarketValue)} / {fmt(data.totalContributions)}) ^ (1 / {data.yearsHeld.toFixed(2)}) - 1 = <strong>{fmtPct(data.cagr)}</strong>
          </p>
        </div>
      </div>
    </div>
  )
}

// Helper: build monthly portfolio value timeline
function buildMonthlyTimeline(transactions, dividends, currentHoldings, startDate) {
  const now = new Date()
  const months = []
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1)

  while (d <= now) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`

    // Sum all buys up to end of this month
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const invested = transactions
      .filter(t => new Date(t.date) <= monthEnd && t.type === 'BUY')
      .reduce((s, t) => s + Number(t.total || 0), 0)
    const sold = transactions
      .filter(t => new Date(t.date) <= monthEnd && t.type === 'SELL')
      .reduce((s, t) => s + Number(t.total || 0), 0)
    const divs = dividends
      .filter(t => new Date(t.date) <= monthEnd)
      .reduce((s, t) => s + Number(t.amount || 0), 0)

    // Estimate portfolio value (simplified: use current market value scaled by invested ratio)
    const totalCurrentBook = currentHoldings.reduce((s, h) => s + Number(h.book_value || 0), 0)
    const totalCurrentMarket = currentHoldings.reduce((s, h) => s + Number(h.market_value || 0), 0)
    const ratio = totalCurrentBook > 0 ? totalCurrentMarket / totalCurrentBook : 1
    const portfolioValue = (invested - sold) * ratio

    months.push({ key, label, invested, portfolioValue, divs })
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

// Helper: fetch monthly index data
async function fetchIndexMonthly(symbol) {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=2y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return []
    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    return timestamps.map((ts, i) => ({
      key: new Date(ts * 1000).toISOString().slice(0, 7),
      close: closes[i],
    })).filter(m => m.close != null)
  } catch { return [] }
}

// Helper: align index performance to portfolio start date
function alignIndexToPortfolio(indexData, startKey, investedAmount) {
  const startIdx = indexData.findIndex(m => m.key >= startKey)
  if (startIdx < 0) return []
  const startClose = indexData[startIdx]?.close
  if (!startClose) return []
  return indexData.slice(startIdx).map(m => ({
    key: m.key,
    value: (m.close / startClose) * investedAmount,
    returnPct: ((m.close - startClose) / startClose) * 100,
  }))
}
