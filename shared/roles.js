// Role model and who-may-manage-whom policy. Used by the server (enforcement) and the browser (what to show).
// Owner > Admin > Manager > Requestor
export const ROLES = ['owner', 'admin', 'manager', 'requestor']
export const ROLE_RANK = { owner: 4, admin: 3, manager: 2, requestor: 1 }
export const STAFF_ROLES = ['owner', 'admin', 'manager']   // work tickets
export const ADMIN_ROLES = ['owner', 'admin']              // also manage people, departments, routing

export const rank = (role) => ROLE_RANK[role] || 0
export const isStaffRole = (role) => STAFF_ROLES.includes(role)
export const isAdminRole = (role) => ADMIN_ROLES.includes(role)

// An Owner manages everyone. An Admin manages only people ranked below Admin. Nobody else manages anyone.
export const canManageRole = (actorRole, targetRole) => actorRole === 'owner' || rank(targetRole) < rank(actorRole)

// Roles `actorRole` may hand out when creating or changing an account.
export const assignableRoles = (actorRole) => actorRole === 'owner' ? [...ROLES] : ROLES.filter(r => rank(r) < rank(actorRole))
