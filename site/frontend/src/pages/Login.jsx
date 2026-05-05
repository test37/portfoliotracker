import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  // 2FA state
  const [pendingToken, setPendingToken] = useState(null)
  const [methods, setMethods] = useState([])
  const [method, setMethod] = useState(null)
  const [code, setCode] = useState('')

  const { login, verify2fa, sendEmailOtp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result?.requires2fa) {
        setPendingToken(result.pendingToken)
        setMethods(result.methods)
        setMethod(result.methods[0])
      } else {
        navigate('/')
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSendEmailCode = async () => {
    setError('')
    setInfo('')
    try {
      await sendEmailOtp(pendingToken)
      setInfo('A verification code has been sent to your email.')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send code')
    }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verify2fa({ pendingToken, method, code })
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const cancel2fa = () => {
    setPendingToken(null)
    setMethods([])
    setMethod(null)
    setCode('')
    setError('')
    setInfo('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-6">
          Portfolio Manager
        </h1>
        <h2 className="text-lg text-center text-gray-600 mb-6">
          {pendingToken ? 'Two-factor verification' : 'Sign in to your account'}
        </h2>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>
        )}
        {info && (
          <div className="bg-emerald-50 text-emerald-700 p-3 rounded mb-4 text-sm">{info}</div>
        )}

        {!pendingToken && (
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-emerald-600 hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
        )}

        {pendingToken && (
          <form onSubmit={handleVerify} className="space-y-4">
            {methods.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Verification method
                </label>
                <div className="flex gap-2">
                  {methods.includes('totp') && (
                    <button
                      type="button"
                      onClick={() => { setMethod('totp'); setCode(''); setInfo('') }}
                      className={`flex-1 py-2 rounded-md text-sm font-medium border ${
                        method === 'totp'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-gray-700 border-gray-300'
                      }`}
                    >
                      Authenticator app
                    </button>
                  )}
                  {methods.includes('email') && (
                    <button
                      type="button"
                      onClick={() => { setMethod('email'); setCode(''); setInfo('') }}
                      className={`flex-1 py-2 rounded-md text-sm font-medium border ${
                        method === 'email'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-gray-700 border-gray-300'
                      }`}
                    >
                      Email code
                    </button>
                  )}
                </div>
              </div>
            )}

            {method === 'email' && (
              <button
                type="button"
                onClick={handleSendEmailCode}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 rounded-md text-sm"
              >
                Send code to my email
              </button>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {method === 'totp'
                  ? 'Enter the 6-digit code from your authenticator app'
                  : 'Enter the code sent to your email'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 tracking-widest text-center text-lg"
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={cancel2fa}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </form>
        )}

        {!pendingToken && (
          <p className="mt-4 text-center text-sm text-gray-600">
            Don't have an account?{' '}
            <Link to="/register" className="text-emerald-600 hover:underline">
              Register
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
