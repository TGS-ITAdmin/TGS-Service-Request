import { Router } from 'express'
import express from 'express'
import { randomUUID } from 'crypto'
import pool, { nextTicketNum } from '../db.js'
import { requireAuth, requireStaff, STAFF_ROLES, ADMIN_ROLES } from '../auth.js'
import { sendMail, notificationEmail } from '../email.js'
import { dueDateFor, PRIORITIES } from '../sla.js'

const r = Router()
r.use(requireAuth)

const now = () => new Date().toISOString()
// Every new ticket gets these subtasks (mirrors the "acknowledge the requestor" step in the Asana workflow)
const DEFAULT_SUBTASKS = ['Send acknowledgement response to requestor']
const MAX_FILE_BYTES = 10 * 1024 * 1024
const isStaff = u => STAFF_ROLES.includes(u.role)

async function autoAssign(deptId, category) {
  if (!deptId) return null
  const { rows } = await pool.query('SELECT category, user_id FROM routing WHERE dept_id = $1', [deptId])
  const map = Object.fromEntries(rows.map(x => [x.category, x.user_id]))
  if (category && map[category] !== undefined) return map[category]
  return map._default ?? null
}

async function addAudit(ticketId, { actor, action, field, from, to }) {
  await pool.query(
    'INSERT INTO audit (id,ticket_id,actor,action,field,"from","to",ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), ticketId, actor, action, field, from, to, now()]
  )
}

function ticketVisible(user, t) {
  return isStaff(user) || t.requestor_id === user.id
}

// GET /api/tickets — staff see all; requestors see their own. Includes counts for list badges.
r.get('/', async (req, res) => {
  const staff = isStaff(req.user)
  const { rows } = await pool.query(
    `SELECT t.*,
       (SELECT COUNT(*)::int FROM subtasks s WHERE s.ticket_id = t.id) subtask_total,
       (SELECT COUNT(*)::int FROM subtasks s WHERE s.ticket_id = t.id AND s.done) subtask_done,
       (SELECT COUNT(*)::int FROM messages m WHERE m.ticket_id = t.id AND ($1::boolean OR NOT m.internal)) comment_count,
       (SELECT COUNT(*)::int FROM attachments a WHERE a.ticket_id = t.id) attachment_count
     FROM tickets t
     ${staff ? '' : 'WHERE t.requestor_id = $2'}
     ORDER BY t.created_at DESC`,
    staff ? [staff] : [staff, req.user.id]
  )
  const { rows: ratingRows } = await pool.query('SELECT ticket_id FROM ratings')
  const rated = new Set(ratingRows.map(x => x.ticket_id))
  res.json(rows.map(t => staff
    ? { ...t, rated: rated.has(t.id) }
    : { ...t, subtask_total: 0, subtask_done: 0, rated: rated.has(t.id) }))
})

// GET /api/tickets/:id — full detail with messages + audit + rating
r.get('/:id', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (!ticketVisible(req.user, t)) return res.status(403).json({ error: 'Forbidden' })
  const msgQ = isStaff(req.user)
    ? 'SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at'
    : 'SELECT * FROM messages WHERE ticket_id = $1 AND internal = false ORDER BY created_at'
  const { rows: messages } = await pool.query(msgQ, [t.id])
  const { rows: audit } = await pool.query('SELECT * FROM audit WHERE ticket_id = $1 ORDER BY ts', [t.id])
  const { rows: [rating] } = await pool.query('SELECT * FROM ratings WHERE ticket_id = $1', [t.id])
  // internal workflow steps are staff-only
  const { rows: subtasks } = isStaff(req.user)
    ? await pool.query('SELECT * FROM subtasks WHERE ticket_id = $1 ORDER BY created_at', [t.id])
    : { rows: [] }
  const { rows: attachments } = await pool.query(
    'SELECT id,ticket_id,filename,mime,size,uploaded_by,uploaded_by_name,created_at FROM attachments WHERE ticket_id = $1 ORDER BY created_at', [t.id])
  // ratings visible to admin + the requestor who left it
  const showRating = ADMIN_ROLES.includes(req.user.role) || (rating && rating.requestor_id === req.user.id)
  res.json({ ticket: t, messages, audit, subtasks, attachments, rating: showRating ? (rating || null) : (rating ? { exists: true } : null) })
})

// POST /api/tickets — any authenticated user creates; requestor fields auto-filled
r.post('/', async (req, res) => {
  const { title, description, priority, dept, category, due_date, reqName, reqEmail } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Subject is required' })
  if (priority !== undefined && priority !== '' && !PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' })
  const requestorSelf = !isStaff(req.user)
  const rName = requestorSelf ? req.user.name : (reqName?.trim() || req.user.name)
  const rEmail = requestorSelf ? req.user.email : (reqEmail?.trim() || req.user.email)
  const assignee = await autoAssign(dept || null, category || null)
  const t = {
    id: randomUUID(), num: await nextTicketNum(), title: title.trim(),
    description: description || '', status: 'open', priority: priority || 'medium',
    dept: dept || null, category: category || null, assignee,
    requestor_id: requestorSelf ? req.user.id : null,
    req_name: rName, req_email: rEmail,
    // due date follows the priority; staff may enter their own, requestors cannot
    due_date: requestorSelf ? dueDateFor(priority || 'medium') : (due_date || dueDateFor(priority || 'medium')),
    created_at: now(), updated_at: now(), resolved_at: null,
  }
  await pool.query(
    `INSERT INTO tickets (id,num,title,description,status,priority,dept,category,assignee,requestor_id,req_name,req_email,due_date,created_at,updated_at,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [t.id, t.num, t.title, t.description, t.status, t.priority, t.dept, t.category, t.assignee,
     t.requestor_id, t.req_name, t.req_email, t.due_date, t.created_at, t.updated_at, t.resolved_at]
  )
  await addAudit(t.id, { actor: req.user.name, action: 'created', field: null, from: null, to: `Ticket #${t.num} created` })
  for (const title of DEFAULT_SUBTASKS) {
    await pool.query('INSERT INTO subtasks (id,ticket_id,title,done,assignee,created_at) VALUES ($1,$2,$3,false,$4,$5)', [randomUUID(), t.id, title, assignee, now()])
  }
  if (assignee) {
    const { rows: [a] } = await pool.query('SELECT name,email FROM users WHERE id = $1', [assignee])
    await addAudit(t.id, { actor: 'System', action: 'auto-assigned', field: 'Assignee', from: 'Unassigned', to: `${a?.name || '?'} (auto-routed)` })
    if (a?.email) sendMail({ to: a.email, subject: `New ticket #${t.num} assigned to you: ${t.title}`, html: notificationEmail(t.title, t.description || '(no description)', t.num) })
  }
  res.status(201).json(t)
})

// PATCH /api/tickets/:id — staff edit fields; requestor may only reopen own resolved ticket
r.patch('/:id', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  const patch = req.body || {}

  // Requestor reopen path
  if (!isStaff(req.user)) {
    if (t.requestor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
    if (patch.status !== 'open' || t.status !== 'resolved') return res.status(403).json({ error: 'You can only reopen a resolved ticket' })
    await pool.query("UPDATE tickets SET status='open', resolved_at=NULL, updated_at=$1 WHERE id=$2", [now(), t.id])
    await addAudit(t.id, { actor: req.user.name, action: 'changed', field: 'Status', from: 'Resolved', to: 'Open (reopened by requestor)' })
    const a = t.assignee ? (await pool.query('SELECT name,email FROM users WHERE id = $1', [t.assignee])).rows[0] : null
    if (a?.email) sendMail({ to: a.email, subject: `Ticket #${t.num} was reopened by ${req.user.name}`, html: notificationEmail(t.title, patch.reason || 'The requestor reopened this ticket.', t.num) })
    const { rows: [updated] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [t.id])
    return res.json(updated)
  }

  if (patch.priority !== undefined && patch.priority !== t.priority) {
    if (!PRIORITIES.includes(patch.priority)) return res.status(400).json({ error: 'Invalid priority' })
    if (patch.due_date === undefined) patch.due_date = dueDateFor(patch.priority)   // new priority => new due date
  }

  const { rows: users } = await pool.query('SELECT id,name FROM users')
  const { rows: depts } = await pool.query('SELECT id,name FROM departments')
  const disp = (f, v) => {
    if (!v) return 'None'
    if (f === 'dept') return depts.find(d => d.id === v)?.name || v
    if (f === 'assignee') return users.find(u => u.id === v)?.name || v
    return String(v)
  }
  const LABELS = { status: 'Status', priority: 'Priority', dept: 'Department', assignee: 'Assignee', category: 'Category', due_date: 'Due Date', title: 'Subject' }
  const updates = {}
  for (const f of Object.keys(LABELS)) {
    if (patch[f] !== undefined && patch[f] !== t[f]) {
      updates[f] = patch[f] || null
      await addAudit(t.id, { actor: req.user.name, action: 'changed', field: LABELS[f], from: disp(f, t[f]), to: disp(f, patch[f]) })
    }
  }
  if (updates.status === 'resolved' && t.status !== 'resolved') updates.resolved_at = now()
  if (updates.status && !['resolved', 'closed'].includes(updates.status)) updates.resolved_at = null
  if (Object.keys(updates).length) {
    updates.updated_at = now()
    const keys = Object.keys(updates)
    const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')
    const values = keys.map(k => updates[k])
    await pool.query(`UPDATE tickets SET ${setSql} WHERE id = $${keys.length + 1}`, [...values, t.id])
    // notify requestor on resolution
    if (updates.status === 'resolved' && t.req_email) {
      sendMail({ to: t.req_email, subject: `Your ticket #${t.num} has been resolved`, html: notificationEmail(t.title, 'Your ticket was marked resolved. Log in to review it, reopen it if the issue persists, or rate your experience.', t.num) })
    }
  }
  const { rows: [updated] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [t.id])
  res.json(updated)
})

// POST /api/tickets/:id/messages
r.post('/:id/messages', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (!ticketVisible(req.user, t)) return res.status(403).json({ error: 'Forbidden' })
  const { body, internal } = req.body || {}
  if (!body?.trim()) return res.status(400).json({ error: 'Message body required' })
  const staff = isStaff(req.user)
  const msg = {
    id: randomUUID(), ticket_id: t.id, sender_id: req.user.id, sender_name: req.user.name,
    sender_type: staff ? 'staff' : 'requestor', body: body.trim(),
    internal: !!(staff && internal), created_at: now(),
  }
  await pool.query(
    'INSERT INTO messages (id,ticket_id,sender_id,sender_name,sender_type,body,internal,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [msg.id, msg.ticket_id, msg.sender_id, msg.sender_name, msg.sender_type, msg.body, msg.internal, msg.created_at]
  )
  await pool.query('UPDATE tickets SET updated_at = $1 WHERE id = $2', [now(), t.id])
  // email the other party (not for internal notes)
  if (!msg.internal) {
    if (staff && t.req_email) {
      sendMail({ to: t.req_email, subject: `New reply on ticket #${t.num}: ${t.title}`, html: notificationEmail(t.title, msg.body, t.num) })
    } else if (!staff && t.assignee) {
      const { rows: [a] } = await pool.query('SELECT email FROM users WHERE id = $1', [t.assignee])
      if (a?.email) sendMail({ to: a.email, subject: `New reply from ${req.user.name} on ticket #${t.num}`, html: notificationEmail(t.title, msg.body, t.num) })
    }
  }
  res.status(201).json(msg)
})

// POST /api/tickets/:id/rating — requestor rates after resolution
r.post('/:id/rating', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (t.requestor_id !== req.user.id) return res.status(403).json({ error: 'Only the ticket creator can rate' })
  if (!['resolved', 'closed'].includes(t.status)) return res.status(400).json({ error: 'Ticket must be resolved before rating' })
  const stars = Number(req.body?.stars)
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'Rating must be 1-5 stars' })
  const { rows: [existing] } = await pool.query('SELECT 1 FROM ratings WHERE ticket_id = $1', [t.id])
  if (existing) return res.status(409).json({ error: 'Already rated' })
  await pool.query(
    'INSERT INTO ratings (ticket_id,agent_id,requestor_id,stars,comment,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [t.id, t.assignee, req.user.id, stars, (req.body?.comment || '').trim() || null, now()]
  )
  await addAudit(t.id, { actor: req.user.name, action: 'rated', field: 'Rating', from: null, to: `${stars}★` })
  res.status(201).json({ ok: true })
})

// ---------- Subtasks (staff only) ----------

// POST /api/tickets/:id/subtasks — { title, assignee? }
r.post('/:id/subtasks', requireStaff, async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT id FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  const title = (req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'Subtask title required' })
  const sub = { id: randomUUID(), ticket_id: t.id, title: title.slice(0, 300), done: false, assignee: req.body?.assignee || null, created_at: now(), done_at: null }
  await pool.query('INSERT INTO subtasks (id,ticket_id,title,done,assignee,created_at) VALUES ($1,$2,$3,false,$4,$5)', [sub.id, sub.ticket_id, sub.title, sub.assignee, sub.created_at])
  await pool.query('UPDATE tickets SET updated_at = $1 WHERE id = $2', [now(), t.id])
  await addAudit(t.id, { actor: req.user.name, action: 'subtask-added', field: 'Subtask', from: null, to: sub.title })
  res.status(201).json(sub)
})

// PATCH /api/tickets/:id/subtasks/:sid — { title?, done?, assignee? }
r.patch('/:id/subtasks/:sid', requireStaff, async (req, res) => {
  const { rows: [sub] } = await pool.query('SELECT * FROM subtasks WHERE id = $1 AND ticket_id = $2', [req.params.sid, req.params.id])
  if (!sub) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  const title = b.title !== undefined ? String(b.title).trim().slice(0, 300) : sub.title
  if (!title) return res.status(400).json({ error: 'Subtask title required' })
  const done = b.done !== undefined ? !!b.done : sub.done
  const assignee = b.assignee !== undefined ? (b.assignee || null) : sub.assignee
  await pool.query('UPDATE subtasks SET title=$1, done=$2, assignee=$3, done_at=$4 WHERE id=$5',
    [title, done, assignee, done ? (sub.done ? sub.done_at : now()) : null, sub.id])
  if (done !== sub.done) {
    await pool.query('UPDATE tickets SET updated_at = $1 WHERE id = $2', [now(), sub.ticket_id])
    await addAudit(sub.ticket_id, { actor: req.user.name, action: done ? 'subtask-done' : 'subtask-reopened', field: 'Subtask', from: null, to: title })
  }
  const { rows: [updated] } = await pool.query('SELECT * FROM subtasks WHERE id = $1', [sub.id])
  res.json(updated)
})

// DELETE /api/tickets/:id/subtasks/:sid — staff
r.delete('/:id/subtasks/:sid', requireStaff, async (req, res) => {
  const { rows: [sub] } = await pool.query('DELETE FROM subtasks WHERE id = $1 AND ticket_id = $2 RETURNING title', [req.params.sid, req.params.id])
  if (!sub) return res.status(404).json({ error: 'Not found' })
  await addAudit(req.params.id, { actor: req.user.name, action: 'subtask-removed', field: 'Subtask', from: sub.title, to: null })
  res.json({ ok: true })
})

// ---------- Attachments (stored in Postgres, 10 MB each) ----------

// POST /api/tickets/:id/attachments — raw file body; name in X-Filename (URI-encoded), type in X-Mime
r.post('/:id/attachments', express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (!ticketVisible(req.user, t)) return res.status(403).json({ error: 'Forbidden' })
  const body = req.body
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'No file received' })
  let filename = 'file'
  try { filename = decodeURIComponent(req.headers['x-filename'] || 'file') } catch { /* keep default */ }
  filename = filename.replace(/[\\/\r\n"]/g, '_').slice(0, 200) || 'file'
  const mime = String(req.headers['x-mime'] || 'application/octet-stream').slice(0, 100)
  const a = { id: randomUUID(), ticket_id: t.id, filename, mime, size: body.length, uploaded_by: req.user.id, uploaded_by_name: req.user.name, created_at: now() }
  await pool.query(
    'INSERT INTO attachments (id,ticket_id,filename,mime,size,data,uploaded_by,uploaded_by_name,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.id, a.ticket_id, a.filename, a.mime, a.size, body, a.uploaded_by, a.uploaded_by_name, a.created_at]
  )
  await pool.query('UPDATE tickets SET updated_at = $1 WHERE id = $2', [now(), t.id])
  await addAudit(t.id, { actor: req.user.name, action: 'attached', field: 'Attachment', from: null, to: filename })
  res.status(201).json(a)
})

// GET /api/tickets/:id/attachments/:aid — download (always as attachment, never rendered by the browser)
r.get('/:id/attachments/:aid', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (!ticketVisible(req.user, t)) return res.status(403).json({ error: 'Forbidden' })
  const { rows: [a] } = await pool.query('SELECT * FROM attachments WHERE id = $1 AND ticket_id = $2', [req.params.aid, t.id])
  if (!a) return res.status(404).json({ error: 'Not found' })
  res.set({
    'Content-Type': a.mime,
    'Content-Length': a.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    'X-Content-Type-Options': 'nosniff',
  })
  res.send(a.data)
})

// DELETE /api/tickets/:id/attachments/:aid — staff, or whoever uploaded it
r.delete('/:id/attachments/:aid', async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tickets WHERE id = $1', [req.params.id])
  if (!t) return res.status(404).json({ error: 'Not found' })
  if (!ticketVisible(req.user, t)) return res.status(403).json({ error: 'Forbidden' })
  const { rows: [a] } = await pool.query('SELECT id,filename,uploaded_by FROM attachments WHERE id = $1 AND ticket_id = $2', [req.params.aid, t.id])
  if (!a) return res.status(404).json({ error: 'Not found' })
  if (!isStaff(req.user) && a.uploaded_by !== req.user.id) return res.status(403).json({ error: 'You can only remove your own attachments' })
  await pool.query('DELETE FROM attachments WHERE id = $1', [a.id])
  await addAudit(t.id, { actor: req.user.name, action: 'attachment-removed', field: 'Attachment', from: a.filename, to: null })
  res.json({ ok: true })
})

export default r
