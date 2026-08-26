import { Router } from 'express'
import { randomUUID } from 'crypto'
import pool, { nextTicketNum } from '../db.js'
import { requireAuth } from '../auth.js'
import { sendMail, notificationEmail } from '../email.js'

const r = Router()
r.use(requireAuth)

const now = () => new Date().toISOString()
const isStaff = u => ['admin', 'manager', 'agent'].includes(u.role)
const canEditTicket = u => ['admin', 'manager'].includes(u.role)

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

// GET /api/tickets — staff see all; requestors see their own
r.get('/', async (req, res) => {
  const { rows } = isStaff(req.user)
    ? await pool.query('SELECT * FROM tickets ORDER BY created_at DESC')
    : await pool.query('SELECT * FROM tickets WHERE requestor_id = $1 ORDER BY created_at DESC', [req.user.id])
  const { rows: ratingRows } = await pool.query('SELECT ticket_id FROM ratings')
  const rated = new Set(ratingRows.map(x => x.ticket_id))
  res.json(rows.map(t => ({ ...t, rated: rated.has(t.id) })))
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
  // ratings visible to admin + the requestor who left it
  const showRating = req.user.role === 'admin' || (rating && rating.requestor_id === req.user.id)
  res.json({ ticket: t, messages, audit, rating: showRating ? (rating || null) : (rating ? { exists: true } : null) })
})

// POST /api/tickets — any authenticated user creates; requestor fields auto-filled
r.post('/', async (req, res) => {
  const { title, description, priority, dept, category, due_date, reqName, reqEmail } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Subject is required' })
  const requestorSelf = !isStaff(req.user)
  const rName = requestorSelf ? req.user.name : (reqName?.trim() || req.user.name)
  const rEmail = requestorSelf ? req.user.email : (reqEmail?.trim() || req.user.email)
  const assignee = await autoAssign(dept || null, category || null)
  const t = {
    id: randomUUID(), num: await nextTicketNum(), title: title.trim(),
    description: description || '', status: 'open', priority: priority || 'medium',
    dept: dept || null, category: category || null, assignee,
    requestor_id: requestorSelf ? req.user.id : null,
    req_name: rName, req_email: rEmail, due_date: due_date || null,
    created_at: now(), updated_at: now(), resolved_at: null,
  }
  await pool.query(
    `INSERT INTO tickets (id,num,title,description,status,priority,dept,category,assignee,requestor_id,req_name,req_email,due_date,created_at,updated_at,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [t.id, t.num, t.title, t.description, t.status, t.priority, t.dept, t.category, t.assignee,
     t.requestor_id, t.req_name, t.req_email, t.due_date, t.created_at, t.updated_at, t.resolved_at]
  )
  await addAudit(t.id, { actor: req.user.name, action: 'created', field: null, from: null, to: `Ticket #${t.num} created` })
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

  if (!canEditTicket(req.user)) return res.status(403).json({ error: 'Agents cannot edit ticket fields' })

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
    sender_type: staff ? 'agent' : 'requestor', body: body.trim(),
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

export default r
