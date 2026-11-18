import { defineMachine } from './machine.js'

// Browser sign-in session (src/AuthContext.jsx drives it through src/lib/session.js).
// Notes:
//  - boot_unreachable KEEPS the saved token: a network blip or server restart must not sign everyone out.
//  - `expired` fires when the server rejects a token we were using (password reset, 7-day expiry).
//  - Events that make no sense in the current state are ignored (e.g. a late 401 after the user already signed out).
export const session = defineMachine({
  id: 'session',
  description: 'Whether this browser is signed in, and what happens when the server says otherwise.',
  initial: 'checking',
  states: {
    checking:      { label: 'Checking saved sign-in' },
    anonymous:     { label: 'Signed out' },
    authenticated: { label: 'Signed in' },
    unreachable:   { label: 'Server unreachable' },
  },
  transitions: [
    { event: 'boot_ok',          from: ['checking'],      to: 'authenticated' },
    { event: 'boot_no_session',  from: ['checking'],      to: 'anonymous',     note: 'No saved token.' },
    { event: 'boot_rejected',    from: ['checking'],      to: 'anonymous',     effects: ['clear_token', 'show_expired_notice'], note: 'Saved token refused (401).' },
    { event: 'boot_unreachable', from: ['checking'],      to: 'unreachable',   note: 'Network error or 5xx. Token is kept.' },
    { event: 'retry',            from: ['unreachable'],   to: 'checking' },
    { event: 'login_ok',         from: ['anonymous'],     to: 'authenticated', effects: ['store_token'] },
    { event: 'user_updated',     from: ['authenticated'], to: 'authenticated', effects: ['store_token'], note: 'e.g. fresh token after a password change.' },
    { event: 'expired',          from: ['authenticated'], to: 'anonymous',     effects: ['clear_token', 'show_expired_notice'], note: 'Server rejected our token mid-session.' },
    { event: 'logout',           from: ['authenticated'], to: 'anonymous',     effects: ['clear_token'] },
  ],
})
