import { useState, useEffect } from 'react'
import api from '../../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

function fmtPct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS = [
  '#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#6366f1','#e11d48'
]

export default function DividendIncome() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('monthly') // monthly | yearly
  const [selectedYear, setSelectedYear] = useState('all')

  useEffect(() => { buildReport() }, [])

  const buildReport = async () => {
    setLoading(true)
    try {
      const { data: portfolios } = await api.get('/portfolios')
      
      const allDividends = []
      const holdingSummary = {}
      
      for (const p of portfolios) {
        const { data: portData } = await api.get(`/portfolios/${p.id}`)
        for (const h of (portData.holdings || [])) {
          const { data: divs } = await api.get(`/dividends/${h.id}`)
          for (const d of divs) {
            allDividends.push({
              ...d,
              symbol: h.symbol,
              portfolio: p.name,
            })
          }
          if (!holdingSummary[h.symbol]) {
            holdingSummary[h.symbol] = {
              symbol: h.symbol,
              total: 0,
              payments: 0,
              byMonth: {},
              byYear: {},
              avgCost: Number(h.average_cost || 0),
              currentPrice: Number(h.current_price || 0),
              quantity: Number(h.quantity || 0),
            }
          }
          for (const d of divs) {
            const amt = Number(d.amount || 0)
            const yr = new Date(d.date).getUTCFullYear()
            const mo = new Date(d.date).getUTCMonth()
            holdingSummary[h.symbol].total += amt
            holdingSummary[h.symbol].payments += 1
            holdingSummary[h.symbol].byYear[yr] = (holdingSummary[h.symbol].byYear[yr] || 0) + amt
            const key = `${yr}-${mo}`
            holdingSummary[h.symbol].byMonth[key] = (holdingSummary[h.symbol].byMonth[key] || 0) + amt
          }
        }
      }

      // Monthly totals
      const monthlyMap = {}
      const yearlyMap = {}
      for (const d of allDividends) {
        const dt = new Date(d.date)
        const yr = dt.getUTCFullYear()
        const mo = dt.getUTCMonth()
        const key = `${yr}-${String(mo + 1).padStart(2, '0')}`
        monthlyMap[key] = (monthlyMap[key] || 0) + Number(d.amount || 0)
        yearlyMap[yr] = (yearlyMap[yr] || 0) + Number(d.amount || 0)
      }

      // Sort monthly data
      const monthlyData = Object.entries(monthlyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, total]) => {
          const [yr, mo] = key.split('-')
          return { key, label: `${MONTHS[parseInt(mo) - 1]} ${yr}`, total, year: parseInt(yr), month: parseInt(mo) - 1 }
        })

      // Yearly data with growth
      const yearlyData = Object.entries(yearlyMap)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([yr, total], i, arr) => {
          const prev = i > 0 ? arr[i - 1][1] : null
          const growth = prev ? ((total - prev) / prev * 100) : null
          return { year: parseInt(yr), total, growth }
        })

      // Available years
      const years = [...new Set(allDividends.map(d => new Date(d.date).getUTCFullYear()))].sort()

      // Holdings sorted by total
      const holdings = Object.values(holdingSummary).sort((a, b) => b.total - a.total)
      const grandTotal = holdings.reduce((s, h) => s + h.total, 0)

      // Projected annual income from current holdings
      // Use last 3 months annualized
      const now = new Date()
      const threeMonthsAgo = new Date(now)
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
      
      const recentDivs = allDividends.filter(d => new Date(d.date) >= threeMonthsAgo)
      const recentTotal = recentDivs.reduce((s, d) => s + Number(d.amount || 0), 0)
      const projectedAnnual = recentTotal * 4 // annualize 3 months

      // Monthly average last 12 months
      const last12 = monthlyData.slice(-12)
      const avgMonthly = last12.length > 0
        ? last12.reduce((s, m) => s + m.total, 0) / last12.length
        : 0

      // Best month ever
      const bestMonth = monthlyData.reduce((best, m) => m.total > (best?.total || 0) ? m : best, null)

      setData({
        monthlyData,
        yearlyData,
        holdings,
        grandTotal,
        projectedAnnual,
        avgMonthly,
        bestMonth,
        years,
        totalPayments: allDividends.length,
      })
    } catch (err) {
      console.error('Failed to build dividend report:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64 text-gray-500">Building report...</div>
  )
  if (!data) return null

  const filteredMonthly = selectedYear === 'all'
    ? data.monthlyData
    : data.monthlyData.filter(m => m.year === parseInt(selectedYear))

  const maxMonthly = Math.max(...filteredMonthly.map(m => m.total), 1)
  const maxYearly = Math.max(...data.yearlyData.map(y => y.total), 1)

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dividend Income Report</h1>
          <p className="text-sm text-gray-500 mt-1">Track your dividend income over time</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-teal-500">
          <p className="text-xs text-gray-500 mb-1">Total Dividends Received</p>
          <p className="text-xl font-bold text-teal-700">{fmt(data.grandTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.totalPayments} payments</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
          <p className="text-xs text-gray-500 mb-1">Projected Annual Income</p>
          <p className="text-xl font-bold text-emerald-700">{fmt(data.projectedAnnual)}</p>
          <p className="text-xs text-gray-400 mt-1">Based on last 3 months</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 mb-1">Avg Monthly Income</p>
          <p className="text-xl font-bold text-blue-700">{fmt(data.avgMonthly)}</p>
          <p className="text-xs text-gray-400 mt-1">Last 12 months average</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <p className="text-xs text-gray-500 mb-1">Best Month Ever</p>
          <p className="text-xl font-bold text-purple-700">{fmt(data.bestMonth?.total)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.bestMonth?.label}</p>
        </div>
      </div>

      {/* Chart Toggle + Year Filter */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setView('monthly')}
            className={`px-4 py-2 text-sm font-medium ${view === 'monthly' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setView('yearly')}
            className={`px-4 py-2 text-sm font-medium border-l border-gray-300 ${view === 'yearly' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Yearly
          </button>
        </div>
        {view === 'monthly' && (
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Years</option>
            {data.years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {/* Monthly Bar Chart */}
      {view === 'monthly' && (
        <div className="bg-white rounded-lg shadow p-5 mb-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Monthly Dividend Income</h3>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 min-w-max pb-2" style={{ height: '200px' }}>
              {filteredMonthly.map((m) => {
                const heightPct = (m.total / maxMonthly) * 100
                const isCurrentMonth = m.year === new Date().getFullYear() && m.month === new Date().getMonth()
                return (
                  <div key={m.key} className="flex flex-col items-center group" style={{ minWidth: '44px' }}>
                    <div className="relative w-full flex justify-center mb-1">
                      <div className="absolute -top-6 bg-gray-900 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        {fmt(m.total)}
                      </div>
                    </div>
                    <div
                      className={`w-8 rounded-t transition-all ${isCurrentMonth ? 'bg-emerald-400' : 'bg-emerald-500 hover:bg-emerald-400'}`}
                      style={{ height: `${Math.max(heightPct * 1.6, 4)}px` }}
                    />
                    <div className="text-xs text-gray-500 mt-1 text-center leading-tight">
                      <div>{MONTHS[m.month]}</div>
                      <div className="text-gray-400">{String(m.year).slice(2)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Monthly table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 text-gray-500 font-medium">Month</th>
                  <th className="text-right py-2 text-gray-500 font-medium">Income</th>
                  <th className="text-right py-2 text-gray-500 font-medium">vs Prev Month</th>
                  <th className="text-left py-2 text-gray-500 font-medium pl-4">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredMonthly.slice().reverse().map((m, i, arr) => {
                  const prev = arr[i + 1]
                  const change = prev ? ((m.total - prev.total) / prev.total * 100) : null
                  return (
                    <tr key={m.key} className="hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-700">{m.label}</td>
                      <td className="py-2 text-right font-semibold text-teal-700">{fmt(m.total)}</td>
                      <td className={`py-2 text-right text-xs ${change === null ? 'text-gray-400' : change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {change === null ? '—' : fmtPct(change)}
                      </td>
                      <td className="py-2 pl-4">
                        <div className="w-32 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${(m.total / maxMonthly) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Yearly Chart */}
      {view === 'yearly' && (
        <div className="bg-white rounded-lg shadow p-5 mb-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Yearly Dividend Income & Growth</h3>
          <div className="flex items-end gap-6 mb-6" style={{ height: '200px' }}>
            {data.yearlyData.map((y) => {
              const heightPct = (y.total / maxYearly) * 100
              return (
                <div key={y.year} className="flex flex-col items-center flex-1 group">
                  <div className="relative w-full flex justify-center mb-1">
                    <div className="absolute -top-6 bg-gray-900 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {fmt(y.total)}
                      {y.growth !== null && <span className={y.growth >= 0 ? ' text-emerald-400' : ' text-red-400'}> ({fmtPct(y.growth)})</span>}
                    </div>
                  </div>
                  <div className="w-full max-w-24 relative">
                    <div
                      className="w-full bg-blue-500 hover:bg-blue-400 rounded-t transition-all"
                      style={{ height: `${Math.max(heightPct * 1.6, 4)}px` }}
                    />
                  </div>
                  <div className="text-sm font-medium text-gray-700 mt-1">{y.year}</div>
                  <div className="text-xs text-teal-600 font-medium">{fmt(y.total)}</div>
                  {y.growth !== null && (
                    <div className={`text-xs font-medium ${y.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fmtPct(y.growth)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-500 font-medium">Year</th>
                <th className="text-right py-2 text-gray-500 font-medium">Total Income</th>
                <th className="text-right py-2 text-gray-500 font-medium">YoY Growth</th>
                <th className="text-right py-2 text-gray-500 font-medium">Monthly Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.yearlyData.slice().reverse().map(y => (
                <tr key={y.year} className="hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-700">{y.year}</td>
                  <td className="py-2 text-right font-semibold text-teal-700">{fmt(y.total)}</td>
                  <td className={`py-2 text-right font-medium ${y.growth === null ? 'text-gray-400' : y.growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {y.growth === null ? 'First year' : fmtPct(y.growth)}
                  </td>
                  <td className="py-2 text-right text-gray-600">{fmt(y.total / 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Holdings Breakdown */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">By Holding</h3>
          <div className="space-y-3">
            {data.holdings.map((h, i) => {
              const pct = data.grandTotal > 0 ? (h.total / data.grandTotal) * 100 : 0
              return (
                <div key={h.symbol}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-sm font-medium text-gray-800">{h.symbol}</span>
                      <span className="text-xs text-gray-400">{h.payments} payments</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400 mr-2">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-teal-700 whitespace-nowrap">{fmt(h.total)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Projected Annual Income */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Projected Annual Income</h3>
          <p className="text-xs text-gray-500 mb-4">Based on current holdings and recent dividend rates</p>
          <div className="space-y-2">
            {data.holdings.filter(h => h.quantity > 0).map((h, i) => {
              // Use last 3 months average annualized
              const now = new Date()
              const threeMonthsAgo = new Date(now)
              threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
              const recentMonths = Object.entries(h.byMonth)
                .filter(([key]) => {
                  const [yr, mo] = key.split('-').map(Number)
                  return new Date(yr, mo) >= threeMonthsAgo
                })
              const recentTotal = recentMonths.reduce((s, [, v]) => s + v, 0)
              const projected = recentTotal * 4

              return (
                <div key={h.symbol} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-sm text-gray-700">{h.symbol}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-emerald-600">{fmt(projected)}</span>
                    <span className="text-xs text-gray-400 ml-1">/yr</span>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-between items-center py-2 bg-emerald-50 rounded px-2 mt-2">
              <span className="text-sm font-bold text-gray-800">Total Projected</span>
              <div>
                <span className="text-base font-bold text-emerald-700">{fmt(data.projectedAnnual)}</span>
                <span className="text-xs text-gray-500 ml-1">/ {fmt(data.projectedAnnual / 12)} per month</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dividend Growth Year over Year by Holding */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Dividend Growth by Holding (Year over Year)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Symbol</th>
                {data.years.map(y => (
                  <th key={y} className="text-right py-2 px-3 text-gray-500 font-medium">{y}</th>
                ))}
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Growth</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.holdings.map((h, i) => {
                const years = data.years
                const firstYearWithData = years.find(y => h.byYear[y] > 0)
                const lastYearWithData = [...years].reverse().find(y => h.byYear[y] > 0)
                const growth = firstYearWithData && lastYearWithData && firstYearWithData !== lastYearWithData
                  ? ((h.byYear[lastYearWithData] - h.byYear[firstYearWithData]) / h.byYear[firstYearWithData] * 100)
                  : null

                return (
                  <tr key={h.symbol} className="hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="font-medium text-gray-800">{h.symbol}</span>
                      </div>
                    </td>
                    {data.years.map(y => (
                      <td key={y} className="py-2 px-3 text-right">
                        {h.byYear[y] ? (
                          <span className="text-teal-700 font-medium">{fmt(h.byYear[y])}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-right font-bold text-teal-700">{fmt(h.total)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${growth === null ? 'text-gray-400' : growth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {growth === null ? '—' : fmtPct(growth)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td className="py-2 px-3 font-bold text-gray-800">Total</td>
                {data.years.map(y => (
                  <td key={y} className="py-2 px-3 text-right font-bold text-teal-700">
                    {fmt(data.holdings.reduce((s, h) => s + (h.byYear[y] || 0), 0))}
                  </td>
                ))}
                <td className="py-2 px-3 text-right font-bold text-teal-700">{fmt(data.grandTotal)}</td>
                <td className="py-2 px-3 text-right font-bold text-emerald-600">
                  {data.yearlyData.length >= 2 ? fmtPct(data.yearlyData[data.yearlyData.length - 1].growth) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
