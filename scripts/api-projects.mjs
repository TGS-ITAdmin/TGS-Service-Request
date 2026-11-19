// End-to-end API check for Projects against a REAL Postgres. Not part of `npm test` (which needs no database).
//   DATABASE_URL=postgres://user:pass@localhost:5432/scratch_db node scripts/api-projects.mjs
// Use an empty scratch database: it starts the server on a spare port, seeds it, and exercises every Projects route.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const PORT = process.env.TEST_PORT || '3911'
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
  const owner = await login('admin@company.com', 'Admin@123')
  const alice = await login('alice@company.com', 'Staff@123')     // manager
  const bob = await login('bob@company.com', 'Staff@123')         // manager
  // requestor
  const reg = await call(null, 'POST', '/users', {}, null)        // (unauthenticated -> rejected)
  assert.ok(reg.status === 401)
  const mk = await call(owner.token, 'POST', '/users', { name: 'Rita Requestor', email: 'rita@company.com', role: 'requestor', password: 'Temp#12345' })
  assert.ok([200, 201].includes(mk.status), JSON.stringify(mk.body))
  const rita = await login('rita@company.com', 'Temp#12345')

  // ---- access
  assert.equal((await call(rita.token, 'GET', '/projects')).status, 403); ok('requestor cannot reach projects')
  assert.equal((await call(rita.token, 'POST', '/projects', { name: 'x' })).status, 403); ok('requestor cannot create')

  // ---- create + privacy
  const p = (await call(alice.token, 'POST', '/projects', { name: 'Office Move', privacy: 'members' })).body
  assert.ok(p.id); ok('manager creates a project')
  let d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.deepEqual(d.sections.map(s => s.name), ['To do', 'Doing', 'Done']); assert.equal(d.my_role, 'owner'); ok('default sections, creator is owner')
  assert.equal((await call(bob.token, 'GET', `/projects/${p.id}`)).status, 404); ok('private project is invisible to non-members (404)')
  assert.equal((await call(bob.token, 'GET', '/projects')).body.some(x => x.id === p.id), false); ok('private project not in non-member list')
  assert.equal((await call(owner.token, 'GET', `/projects/${p.id}`)).status, 200); ok('owner/admin can see every project')
  assert.equal((await call(alice.token, 'POST', `/projects/${p.id}/members`, { user_id: rita.user.id })).status, 400); ok('requestors cannot be members')
  assert.equal((await call(alice.token, 'POST', `/projects/${p.id}/members`, { user_id: bob.user.id })).status, 201)
  assert.equal((await call(bob.token, 'GET', `/projects/${p.id}`)).status, 200); ok('added member can open it')
  assert.equal((await call(bob.token, 'PATCH', `/projects/${p.id}`, { name: 'Hack' })).status, 403); ok('plain member cannot edit settings')
  assert.equal((await call(alice.token, 'DELETE', `/projects/${p.id}/members/${alice.user.id}`)).status, 409); ok('last owner cannot leave')
  assert.equal((await call(alice.token, 'PATCH', `/projects/${p.id}`, { privacy: 'staff' })).status, 200)

  // ---- favorites (per user)
  assert.equal((await call(bob.token, 'PUT', `/projects/${p.id}/favorite`)).status, 200)
  assert.equal((await call(bob.token, 'GET', '/projects')).body.find(x => x.id === p.id).is_favorite, true)
  assert.equal((await call(alice.token, 'GET', '/projects')).body.find(x => x.id === p.id).is_favorite, false); ok('starring is per user')
  assert.equal((await call(bob.token, 'GET', `/projects/${p.id}`)).body.is_favorite, true)
  assert.equal((await call(bob.token, 'DELETE', `/projects/${p.id}/favorite`)).status, 200)
  assert.equal((await call(bob.token, 'GET', '/projects')).body.find(x => x.id === p.id).is_favorite, false); ok('un-star')
  assert.equal((await call(alice.token, 'GET', '/projects')).body.find(x => x.id === p.id).my_role, 'owner')

  // ---- sections + tasks
  const [todo, doing, done] = d.sections
  const t1 = (await call(alice.token, 'POST', `/projects/${p.id}/tasks`, { title: 'Pack boxes', assignee: bob.user.id, due_date: '2026-12-01', priority: 'high' })).body
  assert.ok(t1.task_id); ok('create task (lands in first section)')
  assert.equal((await call(alice.token, 'POST', `/projects/${p.id}/tasks`, { title: 'x', assignee: rita.user.id })).status, 400); ok('task cannot be assigned to a requestor')
  const t2 = (await call(alice.token, 'POST', `/projects/${p.id}/tasks`, { title: 'Book movers', section_id: doing.id })).body
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.equal(d.items.find(i => i.id === t1.task_id).section_id, todo.id); assert.equal(d.items.find(i => i.id === t2.task_id).section_id, doing.id); ok('items placed in the right sections')
  assert.equal((await call(alice.token, 'PATCH', `/projects/${p.id}/items/${t1.item_id}`, { section_id: doing.id, position: 0.5 })).status, 200)
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.equal(d.items.find(i => i.id === t1.task_id).section_id, doing.id); ok('move between sections (board drag)')
  assert.equal((await call(alice.token, 'PATCH', `/projects/${p.id}/items/${t1.item_id}`, { section_id: 'nope' })).status, 400); ok('foreign section rejected')

  // ---- task detail / edit / subtasks / comments / attachments
  let td = (await call(alice.token, 'GET', `/tasks/${t1.task_id}`)).body
  assert.equal(td.task.title, 'Pack boxes'); assert.ok(td.audit.some(a => a.action === 'moved' && a.to === 'Doing')); ok('task detail includes activity (move logged)')
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t1.task_id}`, { title: 'Pack all boxes', priority: 'urgent' })).status, 200)
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t1.task_id}`, { priority: 'bogus' })).status, 400); ok('edit + validation')
  const sub = (await call(alice.token, 'POST', `/tasks/${t1.task_id}/subtasks`, { title: 'Get tape' })).body
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t1.task_id}/subtasks/${sub.id}`, { done: true })).body.done, true); ok('subtasks')
  assert.equal((await call(alice.token, 'POST', `/tasks/${t1.task_id}/messages`, { body: 'Started' })).status, 201); ok('comments')
  const up = await fetch(`${BASE}/tasks/${t1.task_id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/octet-stream', 'X-Filename': 'a.txt', 'X-Mime': 'text/plain' }, body: 'hello' })
  assert.equal(up.status, 201); const att = await up.json()
  const dl = await fetch(`${BASE}/tasks/${t1.task_id}/attachments/${att.id}`, { headers: { Authorization: `Bearer ${alice.token}` } })
  assert.equal(await dl.text(), 'hello'); assert.match(dl.headers.get('content-disposition'), /^attachment/); ok('attachment upload/download')
  assert.equal((await call(rita.token, 'GET', `/tasks/${t1.task_id}`)).status, 403); ok('requestor cannot read tasks')

  // ---- dependencies
  assert.equal((await call(alice.token, 'POST', `/tasks/${t2.task_id}/dependencies`, { blocked_by: t1.task_id })).status, 201)
  assert.equal((await call(alice.token, 'POST', `/tasks/${t1.task_id}/dependencies`, { blocked_by: t2.task_id })).status, 409); ok('dependency loop rejected')
  const blocked = await call(alice.token, 'PATCH', `/tasks/${t2.task_id}`, { completed: true })
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'blocked'); ok('cannot complete a task that is waiting on another')
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t1.task_id}`, { completed: true })).status, 200)
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t2.task_id}`, { completed: true })).status, 200); ok('completes once the blocker is done')
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${t1.task_id}`, { completed: false })).status, 200); ok('reopen')

  // ---- recurrence
  const rt = (await call(alice.token, 'POST', `/projects/${p.id}/tasks`, { title: 'Weekly backup check', due_date: '2026-11-20' })).body
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${rt.task_id}`, { recurrence: { unit: 'year' } })).status, 400)
  assert.equal((await call(alice.token, 'PATCH', `/tasks/${rt.task_id}`, { recurrence: { unit: 'week', interval: 1 } })).status, 200)
  await call(alice.token, 'POST', `/tasks/${rt.task_id}/subtasks`, { title: 'Check logs' })
  const comp = (await call(alice.token, 'PATCH', `/tasks/${rt.task_id}`, { completed: true })).body
  assert.ok(comp.spawned?.id, 'a next occurrence is created'); assert.ok(comp.spawned.due >= '2026-11-20')
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  const next = d.items.find(i => i.id === comp.spawned.id)
  assert.ok(next && !next.done && next.subtask_total === 1 && next.subtask_done === 0); ok('recurring task spawns next copy (reset subtasks, same section)')
  await call(alice.token, 'PATCH', `/tasks/${rt.task_id}`, { completed: false }); await call(alice.token, 'PATCH', `/tasks/${rt.task_id}`, { completed: true })
  assert.equal((await call(alice.token, 'GET', `/projects/${p.id}`)).body.items.filter(i => i.title === 'Weekly backup check').length, 3); ok('reopen then complete again spawns again (documented)')

  // ---- custom fields
  const f = (await call(alice.token, 'POST', `/projects/${p.id}/fields`, { name: 'Cost', type: 'number' })).body
  const fs = (await call(alice.token, 'POST', `/projects/${p.id}/fields`, { name: 'Vendor', type: 'select', options: ['Acme', 'Globex'] })).body
  assert.equal(fs.options.length, 2)
  assert.equal((await call(alice.token, 'PUT', `/projects/${p.id}/items/${t1.item_id}/fields/${f.id}`, { value: 'abc' })).status, 400)
  assert.equal((await call(alice.token, 'PUT', `/projects/${p.id}/items/${t1.item_id}/fields/${f.id}`, { value: '250.5' })).status, 200)
  assert.equal((await call(alice.token, 'PUT', `/projects/${p.id}/items/${t1.item_id}/fields/${fs.id}`, { value: fs.options[0].id })).status, 200)
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.equal(d.items.find(i => i.id === t1.task_id).values[f.id], '250.5'); ok('custom field values')
  await call(alice.token, 'PATCH', `/projects/${p.id}/fields/${fs.id}`, { options: [{ id: fs.options[1].id, label: 'Globex' }] })
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.equal(d.items.find(i => i.id === t1.task_id).values[fs.id], undefined); ok('removing an option clears its values')
  assert.equal((await call(bob.token, 'POST', `/projects/${p.id}/fields`, { name: 'x', type: 'text' })).status, 403); ok('only owners manage fields')

  // ---- tickets in projects (multi-homing)
  const tk = (await call(rita.token, 'POST', '/tickets', { title: 'Printer broken', description: 'jam', dept: 'dept-it', category: 'Hardware Issue' })).body
  const addT = await call(alice.token, 'POST', `/projects/${p.id}/tickets`, { ticket_id: tk.id })
  assert.equal(addT.status, 201)
  assert.equal((await call(alice.token, 'POST', `/projects/${p.id}/tickets`, { ticket_id: tk.id })).status, 409); ok('ticket added once')
  const p2 = (await call(alice.token, 'POST', '/projects', { name: 'IT Backlog', privacy: 'staff' })).body
  assert.equal((await call(alice.token, 'POST', `/projects/${p2.id}/tickets`, { ticket_id: tk.id })).status, 201); ok('same ticket in two projects')
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  const ti = d.items.find(i => i.kind === 'ticket'); assert.equal(ti.num, tk.num)
  await call(alice.token, 'PATCH', `/tickets/${tk.id}`, { status: 'resolved' })
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.equal(d.items.find(i => i.kind === 'ticket').done, true); ok('ticket status flows through to the project')
  assert.equal((await call(alice.token, 'GET', `/tickets/${tk.id}`)).body.audit.some(a => a.action === 'project-added'), true); ok('ticket activity records project adds')

  // ---- multi-home a task, remove, delete
  assert.equal((await call(alice.token, 'POST', `/tasks/${t1.task_id}/projects`, { project_id: p2.id })).status, 201)
  assert.equal((await call(alice.token, 'POST', `/tasks/${t1.task_id}/projects`, { project_id: p2.id })).status, 409); ok('task in several projects')
  td = (await call(alice.token, 'GET', `/tasks/${t1.task_id}`)).body; assert.equal(td.projects.length, 2)
  const bobPriv = (await call(bob.token, 'POST', '/projects', { name: 'Bob private', privacy: 'members' })).body
  assert.equal((await call(alice.token, 'POST', `/tasks/${t1.task_id}/projects`, { project_id: bobPriv.id })).status, 404); ok('cannot add to a project you cannot see')
  const dd = (await call(alice.token, 'DELETE', `/projects/${p2.id}/items/${(await call(alice.token, 'GET', `/projects/${p2.id}`)).body.items.find(i => i.id === t1.task_id).item_id}`)).body
  assert.equal(dd.taskDeleted, false); ok('removing from one project keeps the task')
  const only = (await call(alice.token, 'POST', `/projects/${p2.id}/tasks`, { title: 'Only here' })).body
  const oi = (await call(alice.token, 'GET', `/projects/${p2.id}`)).body.items.find(i => i.id === only.task_id)
  assert.equal((await call(alice.token, 'DELETE', `/projects/${p2.id}/items/${oi.item_id}`)).body.taskDeleted, true); ok('removing from the last project deletes the task')

  // section delete moves items
  assert.equal((await call(alice.token, 'DELETE', `/projects/${p.id}/sections/${doing.id}`)).status, 200)
  d = (await call(alice.token, 'GET', `/projects/${p.id}`)).body
  assert.ok(d.items.every(i => d.sections.some(s => s.id === i.section_id))); ok('deleting a section moves its items')

  await call(alice.token, 'POST', `/tasks/${t1.task_id}/projects`, { project_id: p2.id })   // t1 lives in two projects again
  // ---- my tasks
  await call(alice.token, 'PATCH', `/tasks/${t1.task_id}`, { assignee: bob.user.id })
  await call(alice.token, 'PATCH', `/tickets/${tk.id}`, { assignee: bob.user.id, status: 'open' })
  const mine = (await call(bob.token, 'GET', '/tasks/mine')).body
  assert.ok(mine.some(i => i.kind === 'task' && i.id === t1.task_id && i.projects.length === 2)); ok('my tasks lists assigned tasks with their projects')
  const mt = mine.find(i => i.kind === 'ticket' && i.id === tk.id)
  assert.ok(mt && mt.num === tk.num && mt.projects.length === 2); ok('my tasks lists assigned tickets with their projects')
  assert.equal((await call(alice.token, 'GET', '/tasks/mine')).body.some(i => i.id === t1.task_id), false); ok('my tasks only shows my own')
  assert.equal((await call(rita.token, 'GET', '/tasks/mine')).status, 403); ok('requestors cannot use my tasks')
  const hidden = (await call(bob.token, 'POST', '/projects', { name: 'Bob only', privacy: 'members' })).body
  const ht = (await call(bob.token, 'POST', `/projects/${hidden.id}/tasks`, { title: 'Secret', assignee: bob.user.id })).body
  assert.ok((await call(bob.token, 'GET', '/tasks/mine')).body.some(i => i.id === ht.task_id))
  await call(bob.token, 'PATCH', `/projects/${hidden.id}`, { archived: true })
  assert.equal((await call(bob.token, 'GET', '/tasks/mine')).body.some(i => i.id === ht.task_id), false); ok('tasks only in an archived project are hidden')

  // delete project: ticket survives, project-only tasks go
  assert.equal((await call(alice.token, 'DELETE', `/projects/${p.id}`)).status, 200)
  assert.equal((await call(alice.token, 'GET', `/tasks/${t2.task_id}`)).status, 404)
  assert.equal((await call(alice.token, 'GET', `/tasks/${t1.task_id}`)).status, 200, 'task also in another project survives')
  assert.equal((await call(alice.token, 'GET', `/tickets/${tk.id}`)).status, 200); ok('deleting a project keeps tickets and multi-homed tasks')

  console.log(`\n${pass} API checks passed`)
}

main().then(() => { server.kill(); process.exit(0) }).catch(e => { console.error('\nFAILED:', e.message); server.kill(); process.exit(1) })
