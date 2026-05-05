import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function DropdownMenu({ label, icon, items, isActive }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => { setOpen(false) }, [location])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive ? 'text-emerald-400 bg-gray-800' : 'text-gray-300 hover:text-white hover:bg-gray-800'
        }`}
      >
        <span>{icon}</span>
        <span>{label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-10 left-0 bg-white rounded-lg shadow-xl border border-gray-200 w-56 py-1.5 z-50">
          {items.map((item, i) => (
            item === 'divider' ? (
              <div key={i} className="border-t border-gray-100 my-1" />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                <div>
                  <p className="font-medium">{item.label}</p>
                  {item.desc && <p className="text-xs text-gray-400">{item.desc}</p>}
                </div>
              </Link>
            )
          ))}
        </div>
      )}
    </div>
  )
}

function NavLink({ to, icon, label }) {
  const location = useLocation()
  const isActive = location.pathname === to
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive ? 'text-emerald-400 bg-gray-800' : 'text-gray-300 hover:text-white hover:bg-gray-800'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => { logout(); navigate('/login') }

  const isToolsActive = ['/import', '/etfmaster', '/calculator', '/comparison'].some(p => location.pathname === p)
  const isReportsActive = location.pathname.startsWith('/reports')

  const toolsItems = [
    { to: '/import', icon: '📥', label: 'Import', desc: 'Import Wealthsimple CSV' },
    { to: '/etfmaster', icon: '🗂', label: 'ETF Master', desc: 'Manage ETF symbols & details' },
    'divider',
    { to: '/calculator', icon: '🧮', label: 'Calculator', desc: 'Compare ETF returns' },
    { to: '/comparison', icon: '⚖️', label: 'Compare', desc: 'Compare portfolios' },
  ]

  const reportsItems = [
    { to: '/reports/cashflow', icon: '💵', label: 'Cash Flow', desc: 'Returns vs invested capital' },
    { to: '/reports/dividends', icon: '📊', label: 'Dividend Income', desc: 'Monthly & yearly breakdown' },
    { to: '/reports/calendar', icon: '📅', label: 'Dividend Calendar', desc: 'Upcoming payment dates' },
    { to: '/reports/performance', icon: '📈', label: 'Performance', desc: 'Returns vs S&P 500 & TSX' },
  ]

  return (
    <nav className="bg-gray-900 text-white shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">📊</span>
            <span className="text-base font-bold text-emerald-400 hidden sm:block">Portfolio Manager</span>
          </Link>

          {/* Nav items */}
          {user && (
            <div className="flex items-center gap-1">
              <NavLink to="/" icon="🏠" label="Dashboard" />
              <NavLink to="/prices" icon="📈" label="Prices" />
              <DropdownMenu
                label="Tools"
                icon="🛠"
                items={toolsItems}
                isActive={isToolsActive}
              />
              <DropdownMenu
                label="Reports"
                icon="📋"
                items={reportsItems}
                isActive={isReportsActive}
              />
              <NavLink to="/settings" icon="⚙️" label="Settings" />
            </div>
          )}

          {/* User info + logout */}
          {user && (
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-gray-400 text-xs hidden md:block">{user.email}</span>
              <button
                onClick={handleLogout}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white px-3 py-1.5 rounded-md text-sm transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
