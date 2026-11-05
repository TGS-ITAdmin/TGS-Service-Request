import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID, randomInt } from 'crypto'
import pool from '../db.js'
import { requireAuth, requireStaff, requireAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth)

const ROLES = ['admin', 'manager', 'agent', 'requestor']
const COLORS = ['#3b82f6','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ef4444','#ec4899','#64748b']

// Readable temp password (no look-alike characters like 0/O or 1/l/I)
function generatePassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length: len }, () => chars[randomInt(chars.length)]).join('')
}

async function adminCount() {
  const { rows: [{ c }] } = await pool.query("SELECT COUNT(*)::int c FROM users WHERE role = 'admin'")
  return c
}

// GET /api/users — staff only (requestors don't need the directory)
r.get('/', requireStaff, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id,name,email,role,dept,color,verified,must_change_password FROM users
    ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END, name`)
  res.json(rows)
})

// GET /api/users/ratings — admin only: per-agent rating summary
r.get('/ratings', requireAdmin, async (req, res) => {
  const { rows: summary } = await pool.query(`
    SELECT r.agent_id, u.name agent_name, COUNT(*) count, ROUND(AVG(r.stars)::numeric,2) avg_stars
    FROM ratings r LEFT JOIN users u ON u.id = r.agent_id
    GROUP BY r.agent_id, u.name ORDER BY avg_stars DESC`)
  const { rows: detail } = await pool.query(`
    SELECT r.*, t.num ticket_num, t.title, u.name agent_name, ru.name requestor_name
    FROM ratings r
    JOIN tickets t ON t.id = r.ticket_id
    LEFT JOIN users u ON u.id = r.agent_id
    LEFT JOIN users ru ON ru.id = r.requestor_id
    ORDER BY r.created_at DESC`)
  res.json({ summary, ratings: detail })
})

// POST /api/users — admin creates an account with a temporary password (must be changed at first login)
r.post('/', requireAdmin, async (req, res) => {
  const { name, email, role, dept, password } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email, and temp password required' })
  if (password.length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' })
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' })
  const { rows: [existing] } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()])
  if (existing) return res.status(409).json({ error: 'Email already exists' })
  const u = {
    id: randomUUID(), name: name.trim(), email: email.toLowerCase(),
    password_hash: bcrypt.hashSync(password, 10),
    role: role || 'agent', dept: dept || null, color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
  await pool.query(
    'INSERT INTO users (id,name,email,password_hash,role,dept,color,verified,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,true,true)',
    [u.id, u.name, u.email, u.password_hash, u.role, u.dept, u.color]
  )
  res.status(201).json({ id: u.id, name: u.name, email: u.email, role: u.role, dept: u.dept, color: u.color })
})

// PATCH /api/users/:id — admin changes role/dept
r.patch('/:id', requireAdmin, async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id])
  if (!u) return res.status(404).json({ error: 'Not found' })
  const role = req.body?.role !== undefined ? req.body.role : u.role
  const dept = req.body?.dept !== undefined ? (req.body.dept || null) : u.dept
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' })
  if (role !== u.role) {
    if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role. Ask another admin.' })
    if (u.role === 'admin' && (await adminCount()) <= 1) return res.status(400).json({ error: 'At least one admin is required' })
  }
  await pool.query('UPDATE users SET role = $1, dept = $2 WHERE id = $3', [role, dept, u.id])
  res.json({ ok: true })
})

// POST /api/users/:id/reset-password — admin: { password?, requireChange? }
// Omit password to have one generated. All of the user's existing sessions are signed out.
r.post('/:id/reset-password', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Use "Change password" for your own account' })
  const { rows: [u] } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.id])
  if (!u) return res.status(404).json({ error: 'Not found' })
  const custom = req.body?.password
  if (custom !== undefined && custom !== null && custom !== '' && String(custom).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }
  const generated = !custom
  const password = generated ? generatePassword() : String(custom)
  const requireChange = req.body?.requireChange !== false
  await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = $2, password_changed_at = now(),
       verified = true, verify_code = NULL WHERE id = $3`,
    [bcrypt.hashSync(password, 10), requireChange, u.id]
  )
  res.json({ ok: true, ...(generated ? { temporaryPassword: password } : {}) })
})

// DELETE /api/users/:id — admin
r.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' })
  const { rows: [u] } = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id])
  if (!u) return res.status(404).json({ error: 'Not found' })
  if (u.role === 'admin' && (await adminCount()) <= 1) return res.status(400).json({ error: 'At least one admin is required' })
  await pool.query('UPDATE routing SET user_id = NULL WHERE user_id = $1', [req.params.id])
  await pool.query('UPDATE tickets SET assignee = NULL WHERE assignee = $1', [req.params.id])
  await pool.query('UPDATE tickets SET requestor_id = NULL WHERE requestor_id = $1', [req.params.id])
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default r
