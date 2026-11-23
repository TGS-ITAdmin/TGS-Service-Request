// End-to-end API check for the access rules against a REAL Postgres. Not part of `npm test` (which needs no database).
//   DATABASE_URL=postgres://user:pass@localhost:5432/scratch_db node scripts/api-access.mjs
// Use an empty scratch database: it starts the server on a spare port, seeds it, and exercises accounts, Admin access switches and project access.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const PORT = process.env.TEST_PORT || '3912'
const BASE = `http://localhost:${PORT}/api`
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'inherit'] })
let pass = 0
const ok = (name) => { pass++; console.log('  ok  ', name) }

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, body: json }
}
async function login(email, password) {
  const r = await call(null, 'POST', '/auth/login', { email, password })
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`)
  const t = r.body.token
  if (r.body.user.must_change_password) {
    const np = 'Changed#12345'
    const c = await call(t, 'POST', '/auth/change-password', { current_password: password, new_password: np, currentPassword: password, newPassword: np })
    assert.equal(c.status, 200, JSON.stringify(c.body))
    return login(email, np)
  }
  return { token: t, user: r.body.user }
}

async function waitUp() { for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/health')).ok) return } catch { /* not yet */ } await new Promise(r => setTimeout(r, 250)) } throw new Error('server did not start') }

async function main() {
  await waitUp()
  const S = (r, n, msg) => assert.equal(r.status, n, `${msg}: got ${r.status} ${JSON.stringify(r.body)}`)
  const owner = await login('admin@company.com', 'Admin@123')
  let alice = await login('alice@company.com', 'Staff@123')     // manager (IT)
  const bob = await login('bob@company.com', 'Staff@123')         // manager (IT)
  const mkUser = async (tok, name, email, role, dept) => call(tok, 'POST', '/users', { name, email, role, dept, password: 'Temp#12345' })
  S(await mkUser(owner.token, 'Ivy IT', 'ivy@company.com', 'admin', 'dept-it'), 201, 'owner creates IT admin')
  S(await mkUser(owner.token, 'Hal HR', 'hal@company.com', 'admin', 'dept-hr'), 201, 'owner creates HR admin')
  S(await mkUser(owner.token, 'Rita Requestor', 'rita@company.com', 'requestor', null), 201, 'owner creates requestor')
  const ivy = await login('ivy@company.com', 'Temp#12345'), hal = await login('hal@company.com', 'Temp#12345')
  const users = (await call(owner.token, 'GET', '/users')).body
  const idOf = (e) => users.find(u => u.email === e).id
  ok('setup: owner, IT admin, HR admin, managers, requestor')

  // ---- accounts: only the Owner and Admins in IT Support
  S(await mkUser(hal.token, 'No Way', 'noway@company.com', 'manager', null), 403, 'non-IT admin cannot add accounts')
  S(await call(hal.token, 'PATCH', `/users/${alice.user.id}`, { dept: 'dept-hr' }), 403, 'non-IT admin cannot change accounts')
  S(await call(hal.token, 'POST', `/users/${alice.user.id}/reset-password`, {}), 403, 'non-IT admin cannot reset passwords')
  S(await call(hal.token, 'DELETE', `/users/${idOf('rita@company.com')}`), 403, 'non-IT admin cannot remove accounts')
  S(await mkUser(alice.token, 'No Way', 'noway@company.com', 'requestor', null), 403, 'manager cannot add accounts')
  ok('non-IT admins and managers cannot add or change accounts')
  S(await mkUser(ivy.token, 'Mia Manager', 'mia@company.com', 'manager', 'dept-it'), 201, 'IT admin adds a manager')
  S(await mkUser(ivy.token, 'Rex Requestor', 'rex@company.com', 'requestor', null), 201, 'IT admin adds a requestor')
  S(await mkUser(ivy.token, 'Ann Admin', 'ann@company.com', 'admin', null), 403, 'IT admin cannot create an Admin')
  S(await call(ivy.token, 'PATCH', `/users/${alice.user.id}`, { dept: 'dept-hr' }), 200, 'IT admin changes a manager')
  S(await call(ivy.token, 'PATCH', `/users/${hal.user.id}`, { role: 'manager' }), 403, 'IT admin cannot change an Admin role')
  S(await call(ivy.token, 'POST', `/users/${hal.user.id}/reset-password`, {}), 403, 'IT admin cannot reset an Admin')
  S(await call(ivy.token, 'POST', `/users/${alice.user.id}/reset-password`, { password: 'Reset#12345', requireChange: false }), 200, 'IT admin resets a manager')
  alice = await login('alice@company.com', 'Reset#12345')   // a reset signs the person out everywhere
  S(await call(ivy.token, 'DELETE', `/users/${idOf('rita@company.com')}`), 200, 'IT admin removes a requestor')
  ok('IT admin manages Managers and Requestors only')
  S(await mkUser(owner.token, 'Ann Admin', 'ann@company.com', 'admin', null), 201, 'owner creates an Admin')
  users.splice(0, users.length, ...(await call(owner.token, 'GET', '/users')).body)
  S(await call(owner.token, 'PATCH', `/users/${hal.user.id}`, { dept: 'dept-fin' }), 200, 'owner changes an Admin dept')
  S(await call(owner.token, 'PATCH', `/users/${hal.user.id}`, { dept: 'dept-hr' }), 200, 'owner restores it')
  ok('Owner manages everyone')

  // ---- Admin access switches: granted only by IT or the Owner
  S(await call(hal.token, 'GET', '/users/ratings'), 403, 'ratings off by default')
  S(await call(hal.token, 'POST', '/departments', { name: 'Legal' }), 403, 'departments off by default')
  S(await call(hal.token, 'PUT', '/departments/routing', { deptId: 'dept-hr', category: '_default', userId: null }), 403, 'routing off by default')
  assert.deepEqual((await call(hal.token, 'GET', '/auth/me')).body.user?.perms ?? (await call(hal.token, 'GET', '/auth/me')).body.perms, [])
  ok('a new Admin has no extra access')
  S(await call(ivy.token, 'GET', '/users/ratings'), 200, 'IT admin sees ratings')
  S(await call(ivy.token, 'POST', '/departments', { name: 'Legal' }), 201, 'IT admin manages departments')
  S(await call(hal.token, 'PATCH', `/users/${hal.user.id}`, { perms: ['ratings'] }), 403, 'an Admin cannot grant themselves access')
  S(await call(hal.token, 'PATCH', `/users/${idOf('ann@company.com')}`, { perms: ['ratings'] }), 403, 'a non-IT admin cannot grant access')
  S(await call(ivy.token, 'PATCH', `/users/${alice.user.id}`, { perms: ['ratings'] }), 403, 'switches apply to Admins only')
  S(await call(ivy.token, 'PATCH', `/users/${ivy.user.id}`, { perms: [] }), 403, 'nobody changes their own access')
  ok('only IT or the Owner can grant access, never to oneself')
  S(await call(ivy.token, 'PATCH', `/users/${hal.user.id}`, { perms: ['departments', 'bogus', 'departments'] }), 200, 'IT grants departments')
  S(await call(hal.token, 'POST', '/departments', { name: 'Procurement' }), 201, 'Hal can now manage departments')
  S(await call(hal.token, 'GET', '/users/ratings'), 403, 'ratings still off')
  S(await call(owner.token, 'PATCH', `/users/${hal.user.id}`, { perms: ['ratings'] }), 200, 'owner switches to ratings only')
  S(await call(hal.token, 'GET', '/users/ratings'), 200, 'Hal now sees ratings')
  S(await call(hal.token, 'POST', '/departments', { name: 'Marketing' }), 403, 'departments off again')
  const row = (await call(owner.token, 'GET', '/users')).body.find(u => u.id === hal.user.id)
  assert.deepEqual(row.perms, ['ratings']); ok('switches are saved, cleaned, and take effect immediately')
  S(await call(owner.token, 'PATCH', `/users/${hal.user.id}`, { role: 'manager' }), 200, 'owner demotes Hal')
  assert.deepEqual((await call(owner.token, 'GET', '/users')).body.find(u => u.id === hal.user.id).perms, []); ok('leaving the Admin role clears the switches')
  S(await call(owner.token, 'PATCH', `/users/${hal.user.id}`, { role: 'admin' }), 200, 'owner restores Hal as Admin')
  S(await call(ivy.token, 'DELETE', '/departments/dept-it'), 400, 'IT Support cannot be deleted')
  S(await call(owner.token, 'DELETE', '/departments/dept-it'), 400, 'not even by the Owner'); ok('IT Support is protected')
  S(await call(ivy.token, 'GET', '/emails'), 200, 'IT can read the email log')
  S(await call(hal.token, 'GET', '/emails'), 403, 'other admins cannot'); ok('email log limited to Owner and IT')

  // ---- ticket scope: non-IT Admins see only their department's tickets unless granted the switch
  const mk = async (dept, title) => (await call(owner.token, 'POST', '/tickets', { title, dept })).body
  const tHr = await mk('dept-hr', 'Scope HR'), tFin = await mk('dept-fin', 'Scope Fin')
  const ids = async (u) => (await call(u.token, 'GET', '/tickets')).body.map(x => x.id)
  let seen = await ids(hal)
  assert.ok(seen.includes(tHr.id) && !seen.includes(tFin.id)); ok('Admin sees only own-department tickets')
  S(await call(hal.token, 'PATCH', `/tickets/${tFin.id}`, { status: 'in_progress' }), 403, 'cannot change another department ticket')
  S(await call(hal.token, 'POST', `/tickets/${tFin.id}/subtasks`, { title: 'x' }), 403, 'cannot add subtasks outside scope')
  assert.ok((await ids(ivy)).includes(tFin.id) && (await ids(owner)).includes(tFin.id)); ok('IT and Owner see every ticket')
  S(await call(owner.token, 'PATCH', `/tickets/${tFin.id}`, { assignee: hal.user.id }), 200, 'owner hands the Finance ticket to Hal')
  assert.ok((await ids(hal)).includes(tFin.id)); ok('a ticket assigned to the Admin becomes visible')
  S(await call(owner.token, 'PATCH', `/tickets/${tFin.id}`, { assignee: ivy.user.id }), 200, 'owner reassigns it away')
  assert.ok(!(await ids(hal)).includes(tFin.id))
  S(await call(ivy.token, 'PATCH', `/users/${hal.user.id}`, { perms: ['tickets'] }), 200, 'IT grants other departments')
  assert.ok((await ids(hal)).includes(tFin.id)); ok('the switch shows other departments tickets')
  S(await call(ivy.token, 'PATCH', `/users/${hal.user.id}`, { perms: [] }), 200, 'IT turns it off')

  // ---- projects: an Admin has full access only where they created it or were added
  const halP = (await call(hal.token, 'POST', '/projects', { name: 'HR onboarding', privacy: 'members' })).body
  assert.equal(halP.my_role ?? (await call(hal.token, 'GET', `/projects/${halP.id}`)).body.my_role, 'owner')
  S(await call(hal.token, 'PATCH', `/projects/${halP.id}`, { description: 'mine' }), 200, 'creator manages it')
  S(await call(ivy.token, 'GET', `/projects/${halP.id}`), 404, 'another Admin cannot see a private project')
  assert.equal((await call(ivy.token, 'GET', '/projects')).body.some(x => x.id === halP.id), false)
  S(await call(owner.token, 'GET', `/projects/${halP.id}`), 200, 'Owner still sees every project')
  assert.equal((await call(owner.token, 'GET', '/projects')).body.some(x => x.id === halP.id), true); ok('Admin sees only own projects; Owner sees all')
  const aliceP = (await call(alice.token, 'POST', '/projects', { name: 'Alice private', privacy: 'members' })).body
  S(await call(hal.token, 'GET', `/projects/${aliceP.id}`), 404, 'Admin no longer sees everyone private project')
  S(await call(alice.token, 'POST', `/projects/${aliceP.id}/members`, { user_id: hal.user.id }), 201, 'manager adds the Admin')
  S(await call(hal.token, 'GET', `/projects/${aliceP.id}`), 200, 'added Admin can open it')
  S(await call(hal.token, 'PATCH', `/projects/${aliceP.id}`, { description: 'edited by admin' }), 200, 'added Admin has full access')
  S(await call(hal.token, 'POST', `/projects/${aliceP.id}/members`, { user_id: bob.user.id }), 201, 'added Admin can manage members')
  S(await call(bob.token, 'PATCH', `/projects/${aliceP.id}`, { description: 'x' }), 403, 'an added Manager still cannot manage')
  ok('added Admin gets full access; added Manager does not')
  const open = (await call(alice.token, 'POST', '/projects', { name: 'Open to staff', privacy: 'staff' })).body
  S(await call(ivy.token, 'GET', `/projects/${open.id}`), 200, 'staff-visible project can be opened')
  S(await call(ivy.token, 'PATCH', `/projects/${open.id}`, { description: 'x' }), 403, 'but an Admin not in it cannot manage it'); ok('staff-visible projects: view, not manage')
  console.log(`\n${pass} groups of checks passed`)
}

main().then(() => { server.kill(); process.exit(0) }).catch(e => { console.error('\nFAILED:', e.message); server.kill(); process.exit(1) })
