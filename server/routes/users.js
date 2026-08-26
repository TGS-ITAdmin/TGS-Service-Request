import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import pool from '../db.js'
import { requireAuth, requireStaff, requireAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth)

// GET /api/users — staff only (requestors don't need the directory)
r.get('/', requireStaff, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id,name,email,role,dept,color,verified FROM users
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

// POST /api/users — admin creates staff (or any) account with temp password
r.post('/', requireAdmin, async (req, res) => {
  const { name, email, role, dept, password } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email, and temp password required' })
  const { rows: [existing] } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()])
  if (existing) return res.status(409).json({ error: 'Email already exists' })
  const COLORS = ['#3b82f6','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ef4444','#ec4899','#64748b']
  const u = {
    id: randomUUID(), name: name.trim(), email: email.toLowerCase(),
    password_hash: bcrypt.hashSync(password, 10),
    role: ['admin','manager','agent','requestor'].includes(role) ? role : 'agent',
    dept: dept || null, color: COLORS[Math.floor(Math.random()*COLORS.length)],
  }
  await pool.query(
    'INSERT INTO users (id,name,email,password_hash,role,dept,color,verified) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
    [u.id, u.name, u.email, u.password_hash, u.role, u.dept, u.color]
  )
  res.status(201).json({ id: u.id, name: u.name, email: u.email, role: u.role, dept: u.dept, color: u.color })
})

// PATCH /api/users/:id — admin changes role/dept
r.patch('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === 'u-admin' && req.body?.role && req.body.role !== 'admin') return res.status(400).json({ error: 'Cannot change the primary admin role' })
  const { rows: [u] } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id])
  if (!u) return res.status(404).json({ error: 'Not found' })
  const role = req.body?.role !== undefined ? req.body.role : u.role
  const dept = req.body?.dept !== undefined ? (req.body.dept || null) : u.dept
  await pool.query('UPDATE users SET role = $1, dept = $2 WHERE id = $3', [role, dept, u.id])
  res.json({ ok: true })
})

// DELETE /api/users/:id — admin
r.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === 'u-admin') return res.status(400).json({ error: 'Cannot delete the primary admin' })
  await pool.query('UPDATE routing SET user_id = NULL WHERE user_id = $1', [req.params.id])
  await pool.query('UPDATE tickets SET assignee = NULL WHERE assignee = $1', [req.params.id])
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

export default r
