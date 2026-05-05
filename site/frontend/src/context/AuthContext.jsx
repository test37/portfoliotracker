import { createContext, useContext, useState } from 'react'
import api from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })

  const persistSession = (data) => {
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setUser(data.user)
  }

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    if (data.requires2fa) {
      // Caller is responsible for completing the 2FA challenge.
      return { requires2fa: true, methods: data.methods, pendingToken: data.pending_token }
    }
    persistSession(data)
    return data
  }

  const verify2fa = async ({ pendingToken, method, code }) => {
    const { data } = await api.post('/auth/2fa/verify', {
      pending_token: pendingToken,
      method,
      code,
    })
    persistSession(data)
    return data
  }

  const sendEmailOtp = async (pendingToken) => {
    await api.post('/auth/2fa/email/send', { pending_token: pendingToken })
  }

  const register = async (email, password, name) => {
    const { data } = await api.post('/auth/register', { email, password, name })
    persistSession(data)
    return data
  }

  const updateProfile = async (updates) => {
    const { data } = await api.patch('/auth/me', updates)
    localStorage.setItem('user', JSON.stringify(data))
    setUser(data)
    return data
  }

  const changePassword = async (currentPassword, newPassword) => {
    await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  }

  const deleteAccount = async (currentPassword) => {
    await api.delete('/auth/me', { data: { current_password: currentPassword } })
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const refreshUser = async () => {
    const { data } = await api.get('/auth/me')
    localStorage.setItem('user', JSON.stringify(data))
    setUser(data)
    return data
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        verify2fa,
        sendEmailOtp,
        refreshUser,
        updateProfile,
        changePassword,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
