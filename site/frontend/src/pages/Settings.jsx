import { useState, useEffect } from 'react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { user, setUser } = useAuth()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  // Profile
  const [profileForm, setProfileForm] = useState({ name: '', email: '' })

  // Password
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })

  // 2FA
  const [totpQr, setTotpQr] = useState(null)
  const [totpSecret, setTotpSecret] = useState(null)
  const [totpCode, setTotpCode] = useState('')

  // SMTP
  const [smtpForm, setSmtpForm] = useState({
    smtp_host: '', smtp_port: 587, smtp_user: '',
    smtp_pass: '', smtp_from: '', smtp_secure: false,
  })
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpStatus, setSmtpStatus] = useState(null)

  // API Keys
  const [alphaKey, setAlphaKey] = useState('')
  const [alphaTesting, setAlphaTesting] = useState(false)
  const [alphaStatus, setAlphaStatus] = useState(null)

  useEffect(() => {
    if (user) {
      setProfileForm({ name: user.name || '', email: user.email || '' })
    }
    // Load user settings
    api.get('/settings').then(({ data }) => {
      setSmtpForm({
        smtp_host: data.smtp_host || '',
        smtp_port: data.smtp_port || 587,
        smtp_user: data.smtp_user || '',
        smtp_pass: data.smtp_pass || '',
        smtp_from: data.smtp_from || '',
        smtp_secure: data.smtp_secure || false,
      })
      setAlphaKey(data.alpha_vantage_key || '')
    }).catch(() => {})
  }, [user])

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  const handleProfile = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      const { data } = await api.put('/auth/profile', profileForm)
      setUser(data.user)
      showMsg('Profile updated successfully')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed to update profile', 'error') }
    finally { setLoading(false) }
  }

  const handlePassword = async (e) => {
    e.preventDefault()
    if (pwForm.new_password !== pwForm.confirm_password) {
      return showMsg('New passwords do not match', 'error')
    }
    setLoading(true)
    try {
      await api.post('/auth/change-password', pwForm)
      setPwForm({ current_password: '', new_password: '', confirm_password: '' })
      showMsg('Password changed successfully')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed to change password', 'error') }
    finally { setLoading(false) }
  }

  const startTotpSetup = async () => {
    setLoading(true)
    try {
      const { data } = await api.post('/auth/2fa/totp/setup')
      setTotpQr(data.qr)
      setTotpSecret(data.secret)
    } catch (err) { showMsg(err.response?.data?.error || 'Failed to start TOTP setup', 'error') }
    finally { setLoading(false) }
  }

  const confirmTotp = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      await api.post('/auth/2fa/totp/enable', { code: totpCode })
      setTotpQr(null); setTotpSecret(null); setTotpCode('')
      const { data } = await api.get('/auth/profile')
      setUser(data)
      showMsg('Authenticator app enabled successfully!')
    } catch (err) { showMsg(err.response?.data?.error || 'Invalid code', 'error') }
    finally { setLoading(false) }
  }

  const disableTotp = async () => {
    if (!confirm('Disable authenticator app two-factor?')) return
    setLoading(true)
    try {
      await api.post('/auth/2fa/totp/disable')
      const { data } = await api.get('/auth/profile')
      setUser(data)
      showMsg('Authenticator app disabled')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  const enableEmailOtp = async () => {
    setLoading(true)
    try {
      await api.post('/auth/2fa/email/enable')
      const { data } = await api.get('/auth/profile')
      setUser(data)
      showMsg('Email OTP enabled')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  const disableEmailOtp = async () => {
    if (!confirm('Disable email OTP two-factor?')) return
    setLoading(true)
    try {
      await api.post('/auth/2fa/email/disable')
      const { data } = await api.get('/auth/profile')
      setUser(data)
      showMsg('Email OTP disabled')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed', 'error') }
    finally { setLoading(false) }
  }

  const handleSmtpSave = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      await api.put('/settings/smtp', smtpForm)
      showMsg('SMTP settings saved successfully')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed to save SMTP', 'error') }
    finally { setLoading(false) }
  }

  const handleSmtpTest = async () => {
    setSmtpTesting(true); setSmtpStatus(null)
    try {
      const { data } = await api.post('/settings/smtp/test')
      setSmtpStatus({ ok: true, msg: data.message })
    } catch (err) {
      setSmtpStatus({ ok: false, msg: err.response?.data?.error || 'Test failed' })
    } finally { setSmtpTesting(false) }
  }

  const handleAlphaSave = async () => {
    setLoading(true)
    try {
      await api.put('/settings/apikeys', { alpha_vantage_key: alphaKey })
      showMsg('API key saved successfully')
    } catch (err) { showMsg(err.response?.data?.error || 'Failed to save API key', 'error') }
    finally { setLoading(false) }
  }

  const handleAlphaTest = async () => {
    setAlphaTesting(true); setAlphaStatus(null)
    try {
      const { data } = await api.post('/settings/apikeys/test')
      setAlphaStatus({ ok: true, msg: data.message })
    } catch (err) {
      setAlphaStatus({ ok: false, msg: err.response?.data?.error || 'Test failed' })
    } finally { setAlphaTesting(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Message */}
      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {message.text}
        </div>
      )}

      {/* Profile */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>
        <form onSubmit={handleProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input type="text" value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
              required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            Save Profile
          </button>
        </form>
      </section>

      {/* Password */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h2>
        <form onSubmit={handlePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" value={pwForm.current_password}
              onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
              required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" value={pwForm.new_password}
              onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
              required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input type="password" value={pwForm.confirm_password}
              onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
              required className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
            Change Password
          </button>
        </form>
      </section>

      {/* Two-Factor Authentication */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Two-Factor Authentication</h2>
        <p className="text-sm text-gray-500 mb-4">
          Secure your account with an authenticator app or email verification.
        </p>

        {/* TOTP */}
        <div className="border border-gray-200 rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-medium text-gray-900">🔐 Authenticator App (Recommended)</h3>
              <p className="text-xs text-gray-500">Google Authenticator, Authy, Microsoft Authenticator</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded ${user?.totp_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {user?.totp_enabled ? '✓ Enabled' : 'Disabled'}
            </span>
          </div>
          {!user?.totp_enabled && !totpQr && (
            <button onClick={startTotpSetup} disabled={loading}
              className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Set up authenticator app
            </button>
          )}
          {totpQr && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700 mb-3">
                1. Open your authenticator app<br />
                2. Scan the QR code below<br />
                3. Enter the 6-digit code to confirm
              </p>
              <img src={totpQr} alt="TOTP QR code" className="mx-auto my-3 border border-gray-200 rounded p-2 bg-white" />
              <p className="text-xs text-center text-gray-400 mb-3 break-all">
                Manual entry: <code className="bg-gray-200 px-1 rounded">{totpSecret}</code>
              </p>
              <form onSubmit={confirmTotp} className="flex gap-2">
                <input type="text" inputMode="numeric" value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" maxLength={6} required
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-center tracking-widest font-mono text-lg" />
                <button type="submit" disabled={loading || totpCode.length < 6}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
                  Confirm
                </button>
              </form>
            </div>
          )}
          {user?.totp_enabled && (
            <button onClick={disableTotp} disabled={loading}
              className="mt-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-300 px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Disable authenticator app
            </button>
          )}
        </div>

        {/* Email OTP */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="font-medium text-gray-900">📧 Email OTP</h3>
              <p className="text-xs text-gray-500">Receive a one-time code via email</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded ${user?.email_otp_enabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
              {user?.email_otp_enabled ? '✓ Enabled' : 'Disabled'}
            </span>
          </div>
          {!user?.email_otp_enabled ? (
            <button onClick={enableEmailOtp} disabled={loading}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Enable email OTP
            </button>
          ) : (
            <button onClick={disableEmailOtp} disabled={loading}
              className="mt-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-300 px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Disable email OTP
            </button>
          )}
        </div>
      </section>

      {/* SMTP Settings */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Email / SMTP Settings</h2>
        <p className="text-sm text-gray-500 mb-4">
          Used for password reset and email OTP. Get free SMTP from
          <a href="https://www.zoho.com/mail/" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline ml-1">Zoho Mail</a>,
          <a href="https://sendgrid.com" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline ml-1">SendGrid</a>, or
          <a href="https://mailtrap.io" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline ml-1">Mailtrap</a>.
        </p>
        <form onSubmit={handleSmtpSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
              <input type="text" value={smtpForm.smtp_host}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_host: e.target.value })}
                placeholder="smtp.zoho.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
              <input type="number" value={smtpForm.smtp_port}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_port: Number(e.target.value) })}
                placeholder="587"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Username</label>
              <input type="text" value={smtpForm.smtp_user}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_user: e.target.value })}
                placeholder="you@yourdomain.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Password</label>
              <input type="password" value={smtpForm.smtp_pass}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_pass: e.target.value })}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input type="email" value={smtpForm.smtp_from}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_from: e.target.value })}
                placeholder="Portfolio Manager <you@domain.com>"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input type="checkbox" id="smtp_secure" checked={smtpForm.smtp_secure}
                onChange={(e) => setSmtpForm({ ...smtpForm, smtp_secure: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded" />
              <label htmlFor="smtp_secure" className="text-sm text-gray-700">Use SSL/TLS (port 465)</label>
            </div>
          </div>

          {smtpStatus && (
            <div className={`px-3 py-2 rounded text-sm ${smtpStatus.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {smtpStatus.ok ? '✅' : '❌'} {smtpStatus.msg}
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Save SMTP Settings
            </button>
            <button type="button" onClick={handleSmtpTest} disabled={smtpTesting}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              {smtpTesting ? 'Testing...' : '📧 Send Test Email'}
            </button>
          </div>
        </form>
      </section>

      {/* API Keys */}
      <section className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">API Keys</h2>
        <p className="text-sm text-gray-500 mb-4">
          Used for fetching stock prices when Yahoo Finance is unavailable.
        </p>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">
              Alpha Vantage API Key
            </label>
            <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer"
              className="text-xs text-emerald-600 hover:underline">
              Get free key →
            </a>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Free tier: 25 requests/day. Used as fallback when Yahoo Finance fails.
          </p>
          <input type="text" value={alphaKey}
            onChange={(e) => setAlphaKey(e.target.value)}
            placeholder="Enter your Alpha Vantage API key"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono" />

          {alphaStatus && (
            <div className={`mt-2 px-3 py-2 rounded text-sm ${alphaStatus.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {alphaStatus.ok ? '✅' : '❌'} {alphaStatus.msg}
            </div>
          )}

          <div className="flex gap-3 mt-3">
            <button onClick={handleAlphaSave} disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              Save API Key
            </button>
            <button onClick={handleAlphaTest} disabled={alphaTesting}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
              {alphaTesting ? 'Testing...' : '🔑 Test Key'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
