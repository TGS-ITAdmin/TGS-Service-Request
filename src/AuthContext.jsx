import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api, authToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!authToken.get()) { setChecking(false); return }
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => authToken.set(null))
      .finally(() => setChecking(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const { token, user } = await api.auth.login({ email, password })
    authToken.set(token)
    setUser(user)
  }, [])

  const logout = useCallback(() => {
    authToken.set(null)
    setUser(null)
  }, [])

  const setSession = useCallback((token, user) => {
    authToken.set(token)
    setUser(user)
  }, [])

  return (
    <AuthContext.Provider value={{ user, checking, login, logout, setSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export const isStaff = (user) => !!user && ['admin', 'manager', 'agent'].includes(user.role)
export const canEditTicket = (user) => !!user && ['admin', 'manager'].includes(user.role)
export const isAdmin = (user) => !!user && user.role === 'admin'
