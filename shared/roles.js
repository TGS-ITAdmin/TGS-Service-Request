// Role model and who-may-manage-whom policy. Used by the server (enforcement) and the browser (what to show).
// Owner > Admin > Manager > Requestor
export const ROLES = ['owner', 'admin', 'manager', 'requestor']
export const ROLE_RANK = { owner: 4, admin: 3, manager: 2, requestor: 1 }
export const STAFF_ROLES = ['owner', 'admin', 'manager']   // work tickets
export const ADMIN_ROLES = ['owner', 'admin']              // Admin-level roles; what an Admin may do beyond tickets is granted (see below)

export const rank = (role) => ROLE_RANK[role] || 0
export const isStaffRole = (role) => STAFF_ROLES.includes(role)
export const isAdminRole = (role) => ADMIN_ROLES.includes(role)

// An Owner manages everyone. An Admin manages only people ranked below Admin. Nobody else manages anyone.
export const canManageRole = (actorRole, targetRole) => actorRole === 'owner' || rank(targetRole) < rank(actorRole)

// Roles `actorRole` may hand out when creating or changing an account.
export const assignableRoles = (actorRole) => actorRole === 'owner' ? [...ROLES] : ROLES.filter(r => rank(r) < rank(actorRole))

// ---- Admin access ---------------------------------------------------------------------------------------------
// An Admin works tickets like a Manager. Anything more is granted, and only by IT or the Owner:
//   * managing accounts (add people, change roles, reset passwords, remove) belongs to the Owner and to Admins in IT Support;
//   * seeing tickets outside their own department, departments & routing, and customer ratings are switches (`perms`) that
//     IT or the Owner turn on per Admin.
// Admins in IT Support, and the Owner, hold every ability without needing a switch.
export const IT_DEPT = 'dept-it'                        // id of the IT Support department
export const PERMS = ['tickets', 'departments', 'ratings']
export const PERM_LABEL = { tickets: 'Tickets of other departments', departments: 'Departments & routing', ratings: 'Customer ratings' }

export const isOwnerRole = (role) => role === 'owner'
export const isIT = (user) => user?.role === 'admin' && user.dept === IT_DEPT
export const canManageAccounts = (user) => isOwnerRole(user?.role) || isIT(user)
export const hasPerm = (user, perm) =>
  isOwnerRole(user?.role) || isIT(user) || (user?.role === 'admin' && Array.isArray(user.perms) && user.perms.includes(perm))

// Who may change the access switches of `target`: IT or the Owner, for Admin accounts other than their own.
export const canSetPerms = (actor, target) => canManageAccounts(actor) && target?.role === 'admin' && actor.id !== target.id
// Keep only known switch names (no duplicates, stable order).
export const cleanPerms = (list) => PERMS.filter(p => Array.isArray(list) && list.includes(p))

// Ticket scope. Owner, IT, Managers and anyone granted "Tickets of other departments" see every ticket. Any other Admin
// sees the tickets of their own department, plus any ticket assigned to them (so a hand-off from another department
// always reaches them). Requestors are handled by their own-ticket rule, not here.
export const ticketScoped = (user) => user?.role === 'admin' && !hasPerm(user, 'tickets')
export const inTicketScope = (user, ticket) =>
  !ticketScoped(user) || (!!user.dept && ticket?.dept === user.dept) || (!!ticket?.assignee && ticket.assignee === user.id)
