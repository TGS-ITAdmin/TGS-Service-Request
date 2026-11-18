import { defineMachine } from './machine.js'

// Account lifecycle. Stored as TWO booleans (users.verified, users.must_change_password) — this machine is the
// one place that maps those flags to a named state and decides what each event does to them.
//   pending_verification  signed up, email not confirmed yet → cannot sign in
//   temp_password         an admin set/reset the password → can sign in but must choose their own first
//   active                normal
// Who may fire an event is enforced by the route (requireAdmin, requireAuth...); `caps` here is documentation.
export const account = defineMachine({
  id: 'account',
  description: 'Sign-up, email verification and temporary-password lifecycle of a user account.',
  states: {
    pending_verification: { label: 'Awaiting email verification', canLogin: false, verified: false, mustChangePassword: false },
    temp_password:        { label: 'Temporary password',          canLogin: true,  verified: true,  mustChangePassword: true },
    active:               { label: 'Active',                      canLogin: true,  verified: true,  mustChangePassword: false },
  },
  transitions: [
    { event: 'register',           from: [null, 'pending_verification'], to: 'pending_verification', caps: ['anyone'],
      note: 'Registering an email that is still unverified replaces the name, password and code.' },
    { event: 'resend_code',        from: ['pending_verification'], to: 'pending_verification', caps: ['anyone'] },
    { event: 'verify',             from: ['pending_verification'], to: 'active', caps: ['anyone'], note: 'Needs the 6-digit code.' },
    { event: 'admin_create',       from: [null], to: 'temp_password', caps: ['admin'], note: 'Admin-created accounts start verified, with a temporary password.' },
    { event: 'admin_reset',        from: ['pending_verification', 'temp_password', 'active'], to: 'temp_password', caps: ['admin'],
      note: 'Also marks the email verified and signs the user out everywhere.' },
    { event: 'admin_set_password', from: ['pending_verification', 'temp_password', 'active'], to: 'active', caps: ['admin'],
      note: 'Reset without forcing a change. Also verifies the email and signs the user out everywhere.' },
    { event: 'change_password',    from: ['temp_password', 'active'], to: 'active', caps: ['self'], note: 'Signs out all other sessions.' },
  ],
})

// Flags -> state name
export const accountState = (u) => !u || !u.verified ? 'pending_verification' : u.must_change_password ? 'temp_password' : 'active'
// State name -> flags to store
export const accountColumns = (state) => ({ verified: account.states[state].verified, must_change_password: account.states[state].mustChangePassword })
export const canLogin = (state) => !!account.states[state]?.canLogin
