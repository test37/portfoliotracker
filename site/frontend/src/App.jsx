import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import Holding from './pages/Holding'
import Prices from './pages/Prices'
import Settings from './pages/Settings'
import ForgotPassword from './pages/ForgotPassword'
import Import from './pages/Import'
import EtfMaster from './pages/EtfMaster'
import Calculator from './pages/Calculator'
import CashFlow from './pages/reports/CashFlow'
import DividendIncome from './pages/reports/DividendIncome'
import Performance from './pages/reports/Performance'
import DividendCalendar from './pages/reports/DividendCalendar'
import Comparison from './pages/Comparison'

export default function App() {
  const { user } = useAuth()
  return (
    <div className="min-h-screen bg-gray-50">
      {user && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" /> : <Register />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" /> : <ForgotPassword />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/portfolio/:id" element={<ProtectedRoute><Portfolio /></ProtectedRoute>} />
        <Route path="/holding/:id" element={<ProtectedRoute><Holding /></ProtectedRoute>} />
        <Route path="/prices" element={<ProtectedRoute><Prices /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/import" element={<ProtectedRoute><Import /></ProtectedRoute>} />
        <Route path="/etfmaster" element={<ProtectedRoute><EtfMaster /></ProtectedRoute>} />
        <Route path="/calculator" element={<ProtectedRoute><Calculator /></ProtectedRoute>} />
        <Route path="/comparison" element={<ProtectedRoute><Comparison /></ProtectedRoute>} />
        <Route path="/reports/cashflow" element={<ProtectedRoute><CashFlow /></ProtectedRoute>} />
        <Route path="/reports/dividends" element={<ProtectedRoute><DividendIncome /></ProtectedRoute>} />
        <Route path="/reports/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
        <Route path="/reports/calendar" element={<ProtectedRoute><DividendCalendar /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </div>
  )
}
