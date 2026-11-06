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

// Roles: owner > admin > manager > requestor
export const STAFF_ROLES = ['owner', 'admin', 'manager']
export const ROLE_RANK = { owner: 4, admin: 3, manager: 2, requestor: 1 }
export const isStaff = (user) => !!user && STAFF_ROLES.includes(user.role)
export const canEditTicket = isStaff                       // every staff role can work any ticket
export const isAdmin = (user) => !!user && ['owner', 'admin'].includes(user.role)   // manages people & settings
export const isOwner = (user) => !!user && user.role === 'owner'
