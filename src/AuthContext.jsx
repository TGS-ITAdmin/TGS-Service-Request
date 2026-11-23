import { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react'
import { api, authToken, setUnauthorizedHandler } from './api.js'
import { sessionReducer, initialSession } from './lib/session.js'
import { ROLES, ROLE_RANK, STAFF_ROLES, ADMIN_ROLES, isStaffRole, isAdminRole, canManageRole, assignableRoles, IT_DEPT, PERMS, PERM_LABEL, isIT, canManageAccounts, hasPerm, canSetPerms } from '../shared/roles.js'

// Roles are defined once in shared/roles.js (the server enforces the same rules). Re-exported for the pages.
export { ROLES, ROLE_RANK, STAFF_ROLES, ADMIN_ROLES, canManageRole, assignableRoles, IT_DEPT, PERMS, PERM_LABEL, isIT, canManageAccounts, hasPerm, canSetPerms }

const AuthContext = createContext(null)

// Sign-in session: checking → anonymous | authenticated | unreachable. See shared/session.js for every legal move.
export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, initialSession)
  const statusRef = useRef(state.status)
  statusRef.current = state.status

  const boot = useCallback(() => {
    if (!authToken.get()) { dispatch({ type: 'boot_no_session' }); return }
    api.auth.me()
      .then(({ user }) => dispatch({ type: 'boot_ok', user }))
      .catch((e) => {
        if (e.status === 401) { authToken.set(null); dispatch({ type: 'boot_rejected' }) }
        else dispatch({ type: 'boot_unreachable' })      // network blip / server restarting: keep the token, offer Retry
      })
  }, [])
  useEffect(() => { boot() }, [boot])

  // Any API call the server rejects with 401 (while we hold a token) ends the session cleanly.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (statusRef.current === 'authenticated') { authToken.set(null); dispatch({ type: 'expired' }) }
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const setSession = useCallback((token, user) => {
    authToken.set(token)
    dispatch({ type: 'session_set', user })
  }, [])

  const login = useCallback(async (email, password) => {
    const { token, user } = await api.auth.login({ email, password })
    setSession(token, user)
  }, [setSession])

  const logout = useCallback(() => {
    authToken.set(null)
    dispatch({ type: 'logout' })
  }, [])

  const retry = useCallback(() => { dispatch({ type: 'retry' }); boot() }, [boot])

  return (
    <AuthContext.Provider value={{
      user: state.user, status: state.status, notice: state.notice,
      checking: state.status === 'checking', unreachable: state.status === 'unreachable',
      login, logout, setSession, retry,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export const isStaff = (user) => !!user && isStaffRole(user.role)
export const canEditTicket = isStaff                       // every staff role can work any ticket
export const isAdmin = (user) => !!user && isAdminRole(user.role)   // Admin-level role (Owner or Admin); what they may manage is canManageAccounts / hasPerm
export const isOwner = (user) => !!user && user.role === 'owner'
