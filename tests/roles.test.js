import test from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, STAFF_ROLES, ADMIN_ROLES, isStaffRole, isAdminRole, canManageRole, assignableRoles, IT_DEPT, PERMS, isIT, canManageAccounts, hasPerm, canSetPerms, cleanPerms, ticketScoped, inTicketScope } from '../shared/roles.js'

test('four roles, highest first; the Agent role is gone', () => {
  assert.deepEqual(ROLES, ['owner', 'admin', 'manager', 'requestor'])
  assert.equal(ROLES.includes('agent'), false)
  assert.deepEqual(STAFF_ROLES, ['owner', 'admin', 'manager'])
  assert.deepEqual(ADMIN_ROLES, ['owner', 'admin'])
  assert.deepEqual(ROLES.map(isStaffRole), [true, true, true, false])
  assert.deepEqual(ROLES.map(isAdminRole), [true, true, false, false])
  assert.equal(isStaffRole('agent'), false)
})

test('who may manage whom: Owner anyone; Admin only Manager/Requestor; others nobody', () => {
  const expected = {
    owner:     { owner: true,  admin: true,  manager: true,  requestor: true },
    admin:     { owner: false, admin: false, manager: true,  requestor: true },
    manager:   { owner: false, admin: false, manager: false, requestor: true },   // (route guards stop managers anyway)
    requestor: { owner: false, admin: false, manager: false, requestor: false },
  }
  for (const a of ROLES) for (const t of ROLES) assert.equal(canManageRole(a, t), expected[a][t], `${a} -> ${t}`)
})

test('assignable roles per actor', () => {
  assert.deepEqual(assignableRoles('owner'), ['owner', 'admin', 'manager', 'requestor'])
  assert.deepEqual(assignableRoles('admin'), ['manager', 'requestor'])
  assert.deepEqual(assignableRoles('manager'), ['requestor'])
  assert.deepEqual(assignableRoles('requestor'), [])
  assert.deepEqual(assignableRoles('nonsense'), [])
})

test('assignableRoles returns a fresh array (callers cannot corrupt the shared list)', () => {
  const a = assignableRoles('owner'); a.pop()
  assert.equal(assignableRoles('owner').length, 4)
  assert.equal(ROLES.length, 4)
})

const U = (role, extra = {}) => ({ id: role + (extra.dept || ''), role, ...extra })

test('only the Owner and Admins in IT Support manage accounts', () => {
  assert.equal(canManageAccounts(U('owner')), true)
  assert.equal(canManageAccounts(U('admin', { dept: IT_DEPT })), true)
  assert.equal(canManageAccounts(U('admin', { dept: 'dept-hr' })), false)
  assert.equal(canManageAccounts(U('admin', { dept: null })), false)
  assert.equal(canManageAccounts(U('admin', { dept: 'dept-hr', perms: PERMS })), false, 'switches never grant account management')
  assert.equal(canManageAccounts(U('manager', { dept: IT_DEPT })), false, 'IT Managers are not IT Admins')
  assert.equal(canManageAccounts(U('requestor')), false)
  assert.equal(isIT(U('owner', { dept: IT_DEPT })), false)
})

test('Admin switches: Owner and IT have everything; other Admins only what was granted', () => {
  for (const p of PERMS) {
    assert.equal(hasPerm(U('owner'), p), true)
    assert.equal(hasPerm(U('admin', { dept: IT_DEPT }), p), true)
    assert.equal(hasPerm(U('admin', { dept: 'dept-hr' }), p), false)
    assert.equal(hasPerm(U('admin', { dept: 'dept-hr', perms: [p] }), p), true)
    assert.equal(hasPerm(U('manager', { perms: [p] }), p), false, 'switches belong to Admins only')
  }
  assert.equal(hasPerm(U('admin', { dept: 'dept-hr', perms: ['ratings'] }), 'departments'), false)
})

test('who may change an Admin access switches: IT or the Owner, Admins only, never oneself', () => {
  const owner = U('owner'), it = U('admin', { dept: IT_DEPT }), hr = U('admin', { dept: 'dept-hr' })
  assert.equal(canSetPerms(owner, hr), true)
  assert.equal(canSetPerms(it, hr), true)
  assert.equal(canSetPerms(hr, it), false)
  assert.equal(canSetPerms(hr, hr), false)
  assert.equal(canSetPerms(it, it), false)
  assert.equal(canSetPerms(owner, U('manager')), false)
  assert.equal(canSetPerms(owner, owner), false)
})

test('cleanPerms keeps known switches only, once each, in a stable order', () => {
  assert.deepEqual(cleanPerms(['ratings', 'bogus', 'departments', 'ratings']), ['departments', 'ratings'])
  assert.deepEqual(cleanPerms('nope'), [])
  assert.deepEqual(cleanPerms(undefined), [])
})

test('ticket scope: non-IT Admins see their department and tickets assigned to them, unless granted the switch', () => {
  const hr = U('admin', { id: 'h', dept: 'dept-hr' })
  const T = (dept, assignee = null) => ({ dept, assignee })
  assert.equal(ticketScoped(hr), true)
  assert.equal(inTicketScope(hr, T('dept-hr')), true)
  assert.equal(inTicketScope(hr, T('dept-it')), false)
  assert.equal(inTicketScope(hr, T(null)), false)
  assert.equal(inTicketScope(hr, T('dept-it', 'h')), true, 'a ticket handed to them is always visible')
  const wide = U('admin', { id: 'h', dept: 'dept-hr', perms: ['tickets'] })
  assert.equal(ticketScoped(wide), false)
  assert.equal(inTicketScope(wide, T('dept-it')), true)
  for (const u of [U('owner'), U('admin', { dept: IT_DEPT }), U('manager', { dept: 'dept-hr' })]) assert.equal(inTicketScope(u, T('dept-fin')), true)
  assert.equal(inTicketScope(U('admin', { id: 'x', dept: null }), T('dept-hr')), false)
})

import { validateServiceRequest, concernDept, CONCERNS } from '../shared/ticketForm.js'
test('service request form: every field required, choices must be listed, concern decides the department', () => {
  const ok = { title: 'T', description: 'd', client: 'ET', site: 'Cebu', category: 'Payroll Dispute' }
  assert.equal(validateServiceRequest(ok), null)
  for (const [k, v] of [['title', ' '], ['description', ''], ['client', 'Nope'], ['site', undefined], ['category', 'Other']])
    assert.ok(validateServiceRequest({ ...ok, [k]: v }), `${k} is checked`)
  assert.equal(concernDept('Payroll Dispute'), 'dept-payroll')
  assert.equal(CONCERNS.length, 15)
})
