import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'

export default function Register() {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mfaChoice, setMfaChoice] = useState(null)
  const [totpQR, setTotpQR] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [registeredToken, setRegisteredToken] = useState('')
  const { register } = useAuth()
  const navigate = useNavigate()

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      const res = await register(email, password, name)
      setRegisteredToken(res.token)
      setStep(2)
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleMFAChoice = async (choice) => {
    setMfaChoice(choice)
    if (choice === 'totp') {
      try {
        const res = await api.post('/auth/totp/setup', {}, {
          headers: { Authorization: `Bearer ${registeredToken}` }
        })
        setTotpQR(res.data.qrCode)
        setTotpSecret(res.data.secret)
        setStep(3)
      } catch (err) {
        setError('Failed to setup authenticator')
      }
    } else if (choice === 'email') {
      try {
        await api.post('/auth/email-otp/enable', {}, {
          headers: { Authorization: `Bearer ${registeredToken}` }
        })
        navigate('/')
      } catch (err) {
        setError('Failed to enable email OTP')
      }
    } else {
      navigate('/')
    }
  }

  const handleTOTPVerify = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/auth/totp/verify', { token: totpCode }, {
        headers: { Authorization: `Bearer ${registeredToken}` }
      })
      navigate('/')
    } catch (err) {
      setError('Invalid code, please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">
          Portfolio Manager
        </h1>

        {/* Step 1 - Register */}
        {step === 1 && (
          <>
            <h2 className="text-lg text-center text-gray-600 mb-6">Create your account</h2>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>
            )}
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-md font-medium transition-colors disabled:opacity-50"
              >
                {loading ? 'Creating account...' : 'Register'}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-600">
              Already have an account?{' '}
              <Link to="/login" className="text-emerald-600 hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}

        {/* Step 2 - MFA Choice */}
        {step === 2 && (
          <>
            <h2 className="text-lg text-center text-gray-600 mb-2">Secure your account</h2>
            <p className="text-sm text-center text-gray-500 mb-6">
              Choose a two-factor authentication method
            </p>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>
            )}
            <div className="space-y-3">
              <button
                onClick={() => handleMFAChoice('totp')}
                className="w-full border-2 border-emerald-500 text-emerald-700 py-3 rounded-md font-medium hover:bg-emerald-50 transition-colors text-left px-4"
              >
                <div className="font-semibold">Authenticator App</div>
                <div className="text-xs text-gray-500 mt-1">Use Google Authenticator, Authy, or similar</div>
              </button>
              <button
                onClick={() => handleMFAChoice('email')}
                className="w-full border-2 border-blue-500 text-blue-700 py-3 rounded-md font-medium hover:bg-blue-50 transition-colors text-left px-4"
              >
                <div className="font-semibold">Email OTP</div>
                <div className="text-xs text-gray-500 mt-1">Receive a one-time code via email</div>
              </button>
              <button
                onClick={() => handleMFAChoice('skip')}
                className="w-full border border-gray-300 text-gray-500 py-3 rounded-md font-medium hover:bg-gray-50 transition-colors"
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {/* Step 3 - TOTP QR Code */}
        {step === 3 && (
          <>
            <h2 className="text-lg text-center text-gray-600 mb-2">Scan QR Code</h2>
            <p className="text-sm text-center text-gray-500 mb-4">
              Scan this QR code with your authenticator app
            </p>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>
            )}
            {totpQR && (
              <div className="flex justify-center mb-4">
                <img src={totpQR} alt="QR Code" className="w-48 h-48" />
              </div>
            )}
            <div className="bg-gray-50 p-3 rounded mb-4">
              <p className="text-xs text-gray-500 text-center mb-1">Manual entry key</p>
              <p className="text-sm font-mono text-center text-gray-700 break-all">{totpSecret}</p>
            </div>
            <form onSubmit={handleTOTPVerify} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enter 6-digit code to verify
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  maxLength={6}
                  required
                  placeholder="000000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center text-lg tracking-widest"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-md font-medium transition-colors disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Complete Setup'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
