import { ticketStatus } from './ticketStatus.js'
import { account } from './account.js'
import { session } from './session.js'
import { taskState } from './taskState.js'
import { ROLES, ROLE_RANK, STAFF_ROLES, ADMIN_ROLES, canManageRole, assignableRoles } from './roles.js'

export const machines = { ticketStatus, taskState, account, session }

// Role policy as data (who may manage / assign what) — generated from the functions so docs can never drift.
export const rolePolicy = () => ({
  roles: ROLES, rank: ROLE_RANK, staff: STAFF_ROLES, adminLevel: ADMIN_ROLES,
  byActor: Object.fromEntries(ROLES.map(a => [a, {
    manages: ROLES.filter(t => canManageRole(a, t)),
    assigns: assignableRoles(a),
  }])),
})

// Everything an API client or agent needs to know about the app's lifecycles.
export const describeAll = () => ({
  machines: Object.fromEntries(Object.entries(machines).map(([k, m]) => [k, m.describe()])),
  roles: rolePolicy(),
})
