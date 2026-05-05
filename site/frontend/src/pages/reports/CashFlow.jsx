import { useState, useEffect } from 'react'
import api from '../../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

function fmtPct(val) {
  const n = Number(val || 0)
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

export default function CashFlow() {
  const [portfolios, setPortfolios] = useState([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/portfolios').then(({ data }) => setPortfolios(data))
  }, [])

  useEffect(() => {
    if (portfolios.length > 0) buildReport()
  }, [portfolios, selectedPortfolio])

  const buildReport = async () => {
    setLoading(true)
    try {
      const filtered = selectedPortfolio === 'all'
        ? portfolios
        : portfolios.filter(p => String(p.id) === selectedPortfolio)

      let totalCashContributed = 0
      let totalDividends = 0
      let totalReinvested = 0
      let totalCashDividends = 0
      let totalBookValue = 0
      let totalMarketValue = 0
      let totalRealized = 0
      const byYear = {}
      const byPortfolio = []

      for (const p of filtered) {
        // Contributions
        const contRes = await api.get(`/imports/contributions/${p.id}`)
        const contTotal = Number(contRes.data.by_year?.reduce((s, y) => s + Number(y.total || 0), 0) || 0)
        const contByYear = contRes.data.by_year || []

        // Holdings
        const holdRes = await api.get(`/portfolios/${p.id}`)
        const holdings = holdRes.data.holdings || []
        const bookValue = holdings.reduce((s, h) => s + Number(h.book_value || 0), 0)
        const marketValue = holdings.reduce((s, h) => s + Number(h.market_value || 0), 0)
        const realized = holdings.reduce((s, h) => s + Number(h.realized_pnl || 0), 0)

        // Dividends — split by action
        let portDividends = 0
        let portReinvested = 0
        let portCash = 0
        const divByYear = {}

        for (const h of holdings) {
          const divRes = await api.get(`/dividends/${h.id}`)
          for (const d of divRes.data) {
            const amt = Number(d.amount || 0)
            portDividends += amt
            if (d.action === 'REINVESTED') portReinvested += amt
            else portCash += amt

            const yr = new Date(d.date).getFullYear()
            if (!divByYear[yr]) divByYear[yr] = { total: 0, reinvested: 0, cash: 0 }
            divByYear[yr].total += amt
            if (d.action === 'REINVESTED') divByYear[yr].reinvested += amt
            else divByYear[yr].cash += amt
          }
        }

        totalCashContributed += contTotal
        totalDividends += portDividends
        totalReinvested += portReinvested
        totalCashDividends += portCash
        totalBookValue += bookValue
        totalMarketValue += marketValue
        totalRealized += realized

        for (const y of contByYear) {
          const yr = String(y.year)
          if (!byYear[yr]) byYear[yr] = { year: yr, contributions: 0, dividends: 0, reinvested: 0, cash: 0 }
          byYear[yr].contributions += Number(y.total || 0)
        }
        for (const [yr, d] of Object.entries(divByYear)) {
          if (!byYear[yr]) byYear[yr] = { year: yr, contributions: 0, dividends: 0, reinvested: 0, cash: 0 }
          byYear[yr].dividends += d.total
          byYear[yr].reinvested += d.reinvested
          byYear[yr].cash += d.cash
        }

        // Per portfolio total return = market value - cash contributions
        // Dividends reinvested via manual BUY transactions are already in market value
        const portTotalReturn = marketValue - contTotal
        const portTotalReturnPct = contTotal > 0 ? (portTotalReturn / contTotal * 100) : 0

        byPortfolio.push({
          id: p.id, name: p.name, type: p.type,
          cashContributed: contTotal, bookValue, marketValue,
          dividends: portDividends, reinvested: portReinvested, cashDividends: portCash,
          realized, unrealized: marketValue - bookValue,
          totalReturn: portTotalReturn,
          totalReturnPct: portTotalReturnPct,
        })
      }

      const totalUnrealized = totalMarketValue - totalBookValue
      // CORRECT formula: Total Return = Market Value - Cash Contributions
      // Dividends are NOT added because they were reinvested into BUY transactions
      // which are already reflected in current market value
      const totalReturn = totalMarketValue - totalCashContributed
      const totalReturnPct = totalCashContributed > 0 ? (totalReturn / totalCashContributed * 100) : 0
      const hasExplicitTracking = (totalReinvested + totalCashDividends) > 0

      setData({
        totalCashContributed,
        totalDividends,
        totalReinvested,
        totalCashDividends,
        totalBookValue,
        totalMarketValue,
        totalUnrealized,
        totalRealized,
        totalReturn,
        totalReturnPct,
        hasExplicitTracking,
        byYear: Object.values(byYear).sort((a, b) => b.year - a.year),
        byPortfolio,
      })
    } catch (err) {
      console.error('Failed to build report:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Flow Report</h1>
          <p className="text-sm text-gray-500 mt-1">Track your actual cash invested vs total returns</p>
        </div>
        <select
          value={selectedPortfolio}
          onChange={(e) => setSelectedPortfolio(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">All Portfolios</option>
          {portfolios.map(p => (
            <option key={p.id} value={String(p.id)}>{p.name} ({p.type})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64 text-gray-500">Building report...</div>
      ) : !data ? (
        <div className="text-center text-gray-500 py-12">No data available</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <p className="text-xs text-gray-500 mb-1">Cash Contributed</p>
              <p className="text-xl font-bold text-gray-900">{fmt(data.totalCashContributed)}</p>
              <p className="text-xs text-gray-400 mt-1">Your actual deposits</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
              <p className="text-xs text-gray-500 mb-1">Current Market Value</p>
              <p className="text-xl font-bold text-gray-900">{fmt(data.totalMarketValue)}</p>
              <p className="text-xs text-gray-400 mt-1">What it's worth today</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-teal-500">
              <p className="text-xs text-gray-500 mb-1">Total Dividends Received</p>
              <p className="text-xl font-bold text-teal-700">{fmt(data.totalDividends)}</p>
              <div className="text-xs mt-1">
                <span className="text-blue-500">↺ Reinvested: {fmt(data.totalReinvested)}</span>
                <br />
                <span className="text-teal-500">💵 Cash: {fmt(data.totalCashDividends)}</span>
              </div>
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
          </div>

          {/* Formula */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 mb-6">
            <h3 className="text-sm font-semibold text-blue-800 mb-3">How Total Return is Calculated</h3>
            <div className="flex flex-wrap items-center gap-3 text-sm mb-3">
              <div className="bg-white rounded px-3 py-2 border border-blue-200 text-center">
                <p className="text-xs text-gray-400">Market Value</p>
                <p className="font-bold text-gray-800">{fmt(data.totalMarketValue)}</p>
              </div>
              <span className="text-gray-500 font-bold">−</span>
              <div className="bg-white rounded px-3 py-2 border border-blue-200 text-center">
                <p className="text-xs text-gray-400">Cash Contributed</p>
                <p className="font-bold text-gray-800">{fmt(data.totalCashContributed)}</p>
              </div>
              <span className="text-gray-500 font-bold">+</span>
              <div className="bg-white rounded px-3 py-2 border border-teal-200 text-center">
                <p className="text-xs text-gray-400">Cash Dividends Only</p>
                <p className="font-bold text-teal-700">{fmt(data.totalCashDividends)}</p>
              </div>
              <span className="text-gray-500 font-bold">=</span>
              <div className={'rounded px-3 py-2 border text-center ' + (data.totalReturn >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300')}>
                <p className="text-xs text-gray-400">Total Return</p>
                <p className={'font-bold ' + (data.totalReturn >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {fmt(data.totalReturn)} ({fmtPct(data.totalReturnPct)})
                </p>
              </div>
            </div>
            <p className="text-xs text-blue-700">
              Reinvested dividends ({fmt(data.totalReinvested)}) are NOT counted here because they are
              already reflected in your current market value. Only cash dividends you actually received
              are added to your return.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Breakdown */}
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Full Breakdown</h3>
              <div className="space-y-1">
                {[
                  { label: 'Cash Contributed', value: data.totalCashContributed, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Book Value (total cost of shares)', value: data.totalBookValue, color: 'text-gray-700', bg: 'bg-gray-50' },
                  { label: 'Market Value (today)', value: data.totalMarketValue, color: 'text-gray-900', bg: '' },
                  { label: 'Unrealized Gain/Loss', value: data.totalUnrealized, color: data.totalUnrealized >= 0 ? 'text-emerald-600' : 'text-red-600', bg: '' },
                  { label: 'Realized Gain/Loss (from sells)', value: data.totalRealized, color: data.totalRealized >= 0 ? 'text-emerald-600' : 'text-red-600', bg: '' },
                  { label: 'Total Dividends Received', value: data.totalDividends, color: 'text-teal-600', bg: '' },
                  { label: '  ↺ Reinvested (already in market value)', value: data.totalReinvested, color: 'text-blue-400', bg: '' },
                  { label: '  💵 Taken as Cash (added to return)', value: data.totalCashDividends, color: 'text-teal-500', bg: 'bg-teal-50' },
].map((row) => (
                  <div key={row.label} className={'flex justify-between items-center py-2 px-2 rounded ' + row.bg}>
                    <span className="text-sm text-gray-600">{row.label}</span>
                    <span className={'font-semibold ' + row.color}>{fmt(row.value)}</span>
                  </div>
                ))}
                {/* Dividends - informational only */}
                <div className="flex justify-between items-center py-2 px-2 rounded bg-teal-50 border border-teal-100">
                  <div>
                    <span className="text-sm text-gray-600">Total Dividends Received</span>
                    <p className="text-xs text-teal-600 mt-0.5">
                      ℹ️ Used to buy more ETFs — already included in Book Value & Market Value above
                    </p>
                  </div>
                  <span className="font-semibold text-teal-600">{fmt(data.totalDividends)}</span>
                </div>
                <div className="flex justify-between items-center py-3 px-3 bg-emerald-50 rounded mt-2 border border-emerald-200">
                  <span className="text-sm font-bold text-gray-800">Total Return</span>
                  <div className="text-right">
                    <span className={'font-bold text-lg ' + (data.totalReturn >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                      {fmt(data.totalReturn)}
                    </span>
                    <span className={'ml-2 text-sm ' + (data.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      ({fmtPct(data.totalReturnPct)})
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* By Year */}
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-4">By Year</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-gray-500 font-medium">Year</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Contributions</th>
                    <th className="text-right py-2 text-gray-500 font-medium">Dividends</th>
                    <th className="text-right py-2 text-gray-500 font-medium">↺ Reinvested</th>
                    <th className="text-right py-2 text-gray-500 font-medium">💵 Cash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.byYear.map(y => (
                    <tr key={y.year} className="hover:bg-gray-50">
                      <td className="py-2 font-medium text-gray-700">{y.year}</td>
                      <td className="py-2 text-right text-blue-600">{fmt(y.contributions)}</td>
                      <td className="py-2 text-right text-teal-600">{fmt(y.dividends)}</td>
                      <td className="py-2 text-right text-blue-400">{fmt(y.reinvested)}</td>
                      <td className="py-2 text-right text-teal-500">{fmt(y.cash)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td className="py-2 font-bold text-gray-800">Total</td>
                    <td className="py-2 text-right font-bold text-blue-600">{fmt(data.totalCashContributed)}</td>
                    <td className="py-2 text-right font-bold text-teal-600">{fmt(data.totalDividends)}</td>
                    <td className="py-2 text-right font-bold text-blue-400">{fmt(data.totalReinvested)}</td>
                    <td className="py-2 text-right font-bold text-teal-500">{fmt(data.totalCashDividends)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* By Portfolio */}
          {data.byPortfolio.length > 1 && (
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="text-base font-semibold text-gray-900 mb-4">By Portfolio</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Portfolio</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Cash In</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Market Value</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Dividends</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Unrealized</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Total Return</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Return %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.byPortfolio.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-3 px-3">
                          <p className="font-medium text-gray-900">{p.name}</p>
                          <p className="text-xs text-gray-400">{p.type}</p>
                        </td>
                        <td className="py-3 px-3 text-right text-blue-600">{fmt(p.cashContributed)}</td>
                        <td className="py-3 px-3 text-right">{fmt(p.marketValue)}</td>
                        <td className="py-3 px-3 text-right text-teal-600">{fmt(p.dividends)}</td>
                        <td className={'py-3 px-3 text-right ' + (p.unrealized >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmt(p.unrealized)}</td>
                        <td className={'py-3 px-3 text-right font-medium ' + (p.totalReturn >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmt(p.totalReturn)}</td>
                        <td className="py-3 px-3 text-right">
                          <span className={'text-xs px-2 py-1 rounded-full font-medium ' + (p.totalReturn >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                            {fmtPct(p.totalReturnPct)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
