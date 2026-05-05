import { useState, useEffect } from 'react'
import api from '../../lib/api'

function fmt(val) {
  return Number(val || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const COLORS = [
  { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500', border: 'border-emerald-300' },
  { bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500', border: 'border-blue-300' },
  { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500', border: 'border-amber-300' },
  { bg: 'bg-purple-100', text: 'text-purple-800', dot: 'bg-purple-500', border: 'border-purple-300' },
  { bg: 'bg-rose-100', text: 'text-rose-800', dot: 'bg-rose-500', border: 'border-rose-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800', dot: 'bg-cyan-500', border: 'border-cyan-300' },
  { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500', border: 'border-orange-300' },
  { bg: 'bg-teal-100', text: 'text-teal-800', dot: 'bg-teal-500', border: 'border-teal-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800', dot: 'bg-indigo-500', border: 'border-indigo-300' },
  { bg: 'bg-pink-100', text: 'text-pink-800', dot: 'bg-pink-500', border: 'border-pink-300' },
  { bg: 'bg-lime-100', text: 'text-lime-800', dot: 'bg-lime-500', border: 'border-lime-300' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', dot: 'bg-fuchsia-500', border: 'border-fuchsia-300' },
]

// Project next 12 months of dividends based on frequency and last known date
function projectDividends(symbol, quantity, avgAmount, frequency, lastKnownDate, confirmedFuture) {
  const now = new Date()
  const end = new Date(now)
  end.setMonth(end.getMonth() + 12)

  const events = []

  // Add confirmed future dates first
  for (const cf of confirmedFuture) {
    const dt = new Date(cf.date)
    if (dt > now && dt <= end) {
      events.push({
        date: cf.date,
        amount: Number(cf.amount) * quantity,
        perShare: Number(cf.amount),
        symbol,
        confirmed: true,
      })
    }
  }

  // Project remaining dates based on frequency
  const daysInterval = Math.round(365 / frequency)
  let lastDate = lastKnownDate ? new Date(lastKnownDate) : new Date()

  // Find latest confirmed date to project from
  if (confirmedFuture.length > 0) {
    const latestConfirmed = confirmedFuture.reduce((latest, cf) =>
      new Date(cf.date) > new Date(latest.date) ? cf : latest
    )
    lastDate = new Date(latestConfirmed.date)
  }

  // Project forward
  let projDate = new Date(lastDate)
  projDate.setDate(projDate.getDate() + daysInterval)

  let safety = 0
  while (projDate <= end && safety < 50) {
    safety++
    const dateStr = projDate.toISOString().slice(0, 10)
    // Don't duplicate confirmed dates
    const alreadyExists = events.find(e => e.date === dateStr)
    if (!alreadyExists && projDate > now) {
      events.push({
        date: dateStr,
        amount: avgAmount * quantity,
        perShare: avgAmount,
        symbol,
        confirmed: false,
      })
    }
    projDate = new Date(projDate)
    projDate.setDate(projDate.getDate() + daysInterval)
  }

  return events
}

export default function DividendCalendar() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('calendar') // calendar | list | monthly
  const [selectedMonth, setSelectedMonth] = useState(null)

  useEffect(() => { buildCalendar() }, [])

  const buildCalendar = async () => {
    setLoading(true)
    try {
      const { data: portfolios } = await api.get('/portfolios')
      const holdingMap = {}
      const allPastDividends = []

      for (const p of portfolios) {
        const { data: portData } = await api.get(`/portfolios/${p.id}`)
        for (const h of (portData.holdings || [])) {
          if (Number(h.quantity || 0) <= 0) continue // skip sold holdings

          // Get past dividends to find last payment date
          const { data: divs } = await api.get(`/dividends/${h.id}`)
          allPastDividends.push(...divs.map(d => ({ ...d, symbol: h.symbol })))

          const lastDiv = divs.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
          holdingMap[h.symbol] = {
            symbol: h.symbol,
            name: h.name,
            quantity: Number(h.quantity || 0),
            avgCost: Number(h.average_cost || 0),
            currentPrice: Number(h.current_price || 0),
            lastDivDate: lastDiv?.date || null,
            lastDivAmount: lastDiv ? Number(lastDiv.amount || 0) : 0,
          }
        }
      }

      // Fetch price detail for each holding to get frequency + future dates
      const symbols = Object.keys(holdingMap)
      const priceDetails = {}
      await Promise.all(symbols.map(async (sym) => {
        try {
          const { data: pd } = await api.get(`/prices/detail/${sym}`)
          priceDetails[sym] = pd
        } catch { priceDetails[sym] = null }
      }))

      // Build all projected events for next 12 months
      const allEvents = []
      const colorMap = {}
      symbols.forEach((sym, i) => { colorMap[sym] = COLORS[i % COLORS.length] })

      for (const sym of symbols) {
        const h = holdingMap[sym]
        const pd = priceDetails[sym]
        if (!pd) continue

        const frequency = pd.frequency || 12
        const avgDiv = pd.avgMonthlyDiv || 0
        const confirmedFuture = pd.future2MonthsDividends || []

        const events = projectDividends(
          sym,
          h.quantity,
          avgDiv,
          frequency,
          h.lastDivDate,
          confirmedFuture
        )

        allEvents.push(...events.map(e => ({ ...e, color: colorMap[sym], name: h.name })))
      }

      // Sort all events by date
      allEvents.sort((a, b) => new Date(a.date) - new Date(b.date))

      // Group by month
      const byMonth = {}
      const now = new Date()
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        byMonth[key] = {
          key,
          year: d.getFullYear(),
          month: d.getMonth(),
          label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          shortLabel: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          events: [],
          total: 0,
          daysInMonth: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
          firstDay: d.getDay(),
        }
      }

      for (const e of allEvents) {
        const key = e.date.slice(0, 7)
        if (byMonth[key]) {
          byMonth[key].events.push(e)
          byMonth[key].total += e.amount
        }
      }

      // Monthly summary for chart
      const monthlyTotals = Object.values(byMonth).map(m => ({
        label: m.shortLabel,
        total: m.total,
        key: m.key,
        eventCount: m.events.length,
      }))

      const totalProjected = monthlyTotals.reduce((s, m) => s + m.total, 0)
      const avgMonthly = totalProjected / 12
      const bestMonth = monthlyTotals.reduce((best, m) => m.total > best.total ? m : best, monthlyTotals[0])

      // Past dividend summary
      const pastTotal = allPastDividends.reduce((s, d) => s + Number(d.amount || 0), 0)

      setData({
        byMonth: Object.values(byMonth),
        allEvents,
        colorMap,
        holdingMap,
        symbols,
        monthlyTotals,
        totalProjected,
        avgMonthly,
        bestMonth,
        pastTotal,
      })
    } catch (err) {
      console.error('Calendar error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64 text-gray-500">Building calendar...</div>
  )
  if (!data) return null

  const maxMonthly = Math.max(...data.monthlyTotals.map(m => m.total), 1)
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dividend Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">Projected dividend payments for the next 12 months</p>
        </div>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {[['calendar','📅 Calendar'],['monthly','📊 Monthly'],['list','📋 List']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-2 text-sm font-medium ${view === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} border-r border-gray-300 last:border-0`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-teal-500">
          <p className="text-xs text-gray-500 mb-1">Projected 12-Month Income</p>
          <p className="text-xl font-bold text-teal-700">{fmt(data.totalProjected)}</p>
          <p className="text-xs text-gray-400 mt-1">Next 12 months</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-500">
          <p className="text-xs text-gray-500 mb-1">Monthly Average</p>
          <p className="text-xl font-bold text-emerald-700">{fmt(data.avgMonthly)}</p>
          <p className="text-xs text-gray-400 mt-1">Expected per month</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <p className="text-xs text-gray-500 mb-1">Best Projected Month</p>
          <p className="text-xl font-bold text-blue-700">{fmt(data.bestMonth?.total)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.bestMonth?.label}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <p className="text-xs text-gray-500 mb-1">Total Received (Historical)</p>
          <p className="text-xl font-bold text-purple-700">{fmt(data.pastTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">All time dividends</p>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-lg shadow p-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {data.symbols.map(sym => {
            const c = data.colorMap[sym]
            return (
              <div key={sym} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
                <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                {sym}
              </div>
            )
          })}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 ml-auto">
            <span>✓ Confirmed</span>
            <span className="text-gray-400">· ~ Projected</span>
          </div>
        </div>
      </div>

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.byMonth.map(month => {
            const isCurrentMonth = month.key === currentMonthKey
            const days = Array.from({ length: month.daysInMonth }, (_, i) => i + 1)
            const eventsByDay = {}
            for (const e of month.events) {
              const day = parseInt(e.date.slice(8, 10))
              if (!eventsByDay[day]) eventsByDay[day] = []
              eventsByDay[day].push(e)
            }

            return (
              <div key={month.key} className={`bg-white rounded-lg shadow overflow-hidden ${isCurrentMonth ? 'ring-2 ring-emerald-500' : ''}`}>
                {/* Month header */}
                <div className={`px-4 py-3 flex justify-between items-center ${isCurrentMonth ? 'bg-emerald-600 text-white' : 'bg-gray-50 border-b border-gray-100'}`}>
                  <h3 className={`font-semibold ${isCurrentMonth ? 'text-white' : 'text-gray-800'}`}>
                    {month.label}
                    {isCurrentMonth && <span className="ml-2 text-xs bg-white text-emerald-700 px-1.5 py-0.5 rounded">Current</span>}
                  </h3>
                  <span className={`text-sm font-bold ${isCurrentMonth ? 'text-emerald-100' : 'text-teal-600'}`}>
                    {fmt(month.total)}
                  </span>
                </div>

                {/* Calendar grid */}
                <div className="p-2">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 mb-1">
                    {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                      <div key={d} className="text-center text-xs text-gray-400 py-1 font-medium">{d}</div>
                    ))}
                  </div>
                  {/* Days */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {/* Empty cells for first day offset */}
                    {Array.from({ length: month.firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} className="h-8" />
                    ))}
                    {days.map(day => {
                      const dayEvents = eventsByDay[day] || []
                      const isToday = isCurrentMonth && day === now.getDate()
                      const hasEvent = dayEvents.length > 0
                      return (
                        <div
                          key={day}
                          className={`h-8 flex flex-col items-center justify-start pt-0.5 rounded text-xs relative
                            ${isToday ? 'bg-emerald-600 text-white font-bold' : ''}
                            ${hasEvent && !isToday ? 'font-semibold' : ''}
                          `}
                          title={hasEvent ? dayEvents.map(e => `${e.symbol}: ${fmt(e.amount)}`).join('\n') : ''}
                        >
                          <span className={isToday ? 'text-white' : 'text-gray-700'}>{day}</span>
                          {hasEvent && (
                            <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                              {dayEvents.slice(0, 3).map((e, i) => (
                                <div
                                  key={i}
                                  className={`w-1.5 h-1.5 rounded-full ${e.color.dot} ${!e.confirmed ? 'opacity-50' : ''}`}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Events list for this month */}
                {month.events.length > 0 && (
                  <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                    {month.events.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${e.color.dot} ${!e.confirmed ? 'opacity-50' : ''}`} />
                          <span className={`font-medium ${e.color.text}`}>{e.symbol}</span>
                          <span className="text-gray-400">{e.date.slice(8)} {SHORT_MONTHS[parseInt(e.date.slice(5,7))-1]}</span>
                          {!e.confirmed && <span className="text-gray-300 italic text-xs">~est</span>}
                        </div>
                        <span className="font-semibold text-teal-700">{fmt(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {month.events.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">No dividends projected</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* MONTHLY BAR VIEW */}
      {view === 'monthly' && (
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-6">Expected Income by Month</h3>
          <div className="space-y-3">
            {data.monthlyTotals.map(m => {
              const isCurrentMonth = m.key === currentMonthKey
              const widthPct = maxMonthly > 0 ? (m.total / maxMonthly * 100) : 0
              const monthData = data.byMonth.find(b => b.key === m.key)
              return (
                <div key={m.key}>
                  <div className="flex justify-between items-center mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium w-24 ${isCurrentMonth ? 'text-emerald-600 font-bold' : 'text-gray-700'}`}>
                        {m.label} {isCurrentMonth && '←'}
                      </span>
                      <span className="text-xs text-gray-400">{m.eventCount} payments</span>
                    </div>
                    <span className="text-sm font-bold text-teal-700">{fmt(m.total)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-5 relative overflow-hidden">
                    <div
                      className={`h-5 rounded-full transition-all ${isCurrentMonth ? 'bg-emerald-500' : 'bg-teal-400'}`}
                      style={{ width: `${widthPct}%` }}
                    />
                    {/* Show symbols in bar */}
                    {monthData && monthData.events.length > 0 && (
                      <div className="absolute inset-0 flex items-center px-2 gap-1 overflow-hidden">
                        {[...new Set(monthData.events.map(e => e.symbol))].slice(0, 6).map(sym => (
                          <span key={sym} className={`text-xs font-medium px-1 rounded ${data.colorMap[sym]?.bg} ${data.colorMap[sym]?.text}`}>
                            {sym.replace('.TO','').replace('.NE','')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Monthly breakdown table */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-gray-500 font-medium">Month</th>
                  {data.symbols.map(sym => (
                    <th key={sym} className="text-right py-2 px-1 text-gray-500 font-medium text-xs">{sym.replace('.TO','').replace('.NE','')}</th>
                  ))}
                  <th className="text-right py-2 text-gray-500 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.byMonth.map(month => {
                  const isCurrentMonth = month.key === currentMonthKey
                  return (
                    <tr key={month.key} className={`hover:bg-gray-50 ${isCurrentMonth ? 'bg-emerald-50' : ''}`}>
                      <td className={`py-2 font-medium ${isCurrentMonth ? 'text-emerald-700' : 'text-gray-700'}`}>
                        {month.shortLabel}
                      </td>
                      {data.symbols.map(sym => {
                        const symEvents = month.events.filter(e => e.symbol === sym)
                        const symTotal = symEvents.reduce((s, e) => s + e.amount, 0)
                        const hasUnconfirmed = symEvents.some(e => !e.confirmed)
                        return (
                          <td key={sym} className={`py-2 px-1 text-right text-xs ${symTotal > 0 ? 'text-teal-700 font-medium' : 'text-gray-300'}`}>
                            {symTotal > 0 ? (
                              <span title={hasUnconfirmed ? 'Estimated' : 'Confirmed'}>
                                {hasUnconfirmed ? '~' : ''}{fmt(symTotal).replace('CA$','')}
                              </span>
                            ) : '—'}
                          </td>
                        )
                      })}
                      <td className={`py-2 text-right font-bold ${isCurrentMonth ? 'text-emerald-700' : 'text-teal-700'}`}>
                        {fmt(month.total)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="py-2 font-bold text-gray-800">12-Month Total</td>
                  {data.symbols.map(sym => {
                    const symTotal = data.allEvents.filter(e => e.symbol === sym).reduce((s, e) => s + e.amount, 0)
                    return (
                      <td key={sym} className="py-2 px-1 text-right text-xs font-bold text-teal-700">
                        {symTotal > 0 ? fmt(symTotal).replace('CA$','') : '—'}
                      </td>
                    )
                  })}
                  <td className="py-2 text-right font-bold text-teal-700">{fmt(data.totalProjected)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Symbol</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Per Share</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Expected Income</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.allEvents.map((e, i) => {
                const dt = new Date(e.date)
                const isPast = dt < now
                return (
                  <tr key={i} className={`hover:bg-gray-50 ${isPast ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-800">
                        {dt.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${e.color.bg} ${e.color.text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${e.color.dot}`} />
                        {e.symbol}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{fmt(e.perShare)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-teal-700">{fmt(e.amount)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {e.confirmed
                        ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✓ Confirmed</span>
                        : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">~ Projected</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400 text-center">
        ✓ Confirmed dates from Yahoo Finance / dividendhistory.org · ~ Projected dates based on historical frequency
      </div>
    </div>
  )
}
