// Pure reducer for the browser sign-in session. The legal transitions live in shared/session.js; this file only
// decides what data goes with each one. No React in here, so it is unit-tested with `npm test`.
import { session } from '../../shared/session.js'

export const initialSession = () => ({ status: session.initial, user: null, notice: null })

export function sessionReducer(state, action) {
  // Login screens and the password-change screen both call setSession(); which event that is depends on where we are.
  const event = action.type === 'session_set' ? (state.status === 'authenticated' ? 'user_updated' : 'login_ok') : action.type
  const to = session.next(state.status, event)
  if (!to) return state                    // not legal from here (e.g. a late 401 after sign-out): ignore it
  switch (event) {
    case 'boot_ok':
    case 'login_ok':
    case 'user_updated':
      return { status: to, user: action.user, notice: null }
    case 'boot_rejected':
    case 'expired':
      return { status: to, user: null, notice: 'expired' }
    case 'retry':
      return { ...state, status: to }
    default:                                // boot_no_session, boot_unreachable, logout
      return { status: to, user: null, notice: null }
  }
}
