import { Router } from 'express'
import pool from '../db.js'
import { requireAuth, requireAdmin } from '../auth.js'

const r = Router()
r.use(requireAuth)

// GET /api/departments — everyone (needed for new-ticket form); includes categories
r.get('/', async (req, res) => {
  const { rows: depts } = await pool.query('SELECT * FROM departments')
  const { rows: cats } = await pool.query('SELECT * FROM categories')
  res.json(depts.map(d => ({ ...d, categories: cats.filter(c => c.dept_id === d.id).map(c => c.name) })))
})

// GET /api/departments/routing — staff view; only admin can edit
r.get('/routing', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM routing')
  const map = {}
  for (const x of rows) { (map[x.dept_id] ||= {})[x.category] = x.user_id }
  res.json(map)
})

// PUT /api/departments/routing — admin: { deptId, category, userId|null }
r.put('/routing', requireAdmin, async (req, res) => {
  const { deptId, category, userId } = req.body || {}
  if (!deptId || !category) return res.status(400).json({ error: 'deptId and category required' })
  await pool.query(
    'INSERT INTO routing (dept_id,category,user_id) VALUES ($1,$2,$3) ON CONFLICT(dept_id,category) DO UPDATE SET user_id = excluded.user_id',
    [deptId, category, userId || null]
  )
  res.json({ ok: true })
})

// POST /api/departments — admin
r.post('/', requireAdmin, async (req, res) => {
  const { name, color } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
  const { rows: [existing] } = await pool.query('SELECT 1 FROM departments WHERE lower(name) = lower($1)', [name.trim()])
  if (existing) return res.status(409).json({ error: 'Department already exists' })
  const id = 'dept-' + Date.now().toString(36)
  await pool.query('INSERT INTO departments (id,name,color) VALUES ($1,$2,$3)', [id, name.trim(), color || '#3b82f6'])
  await pool.query('INSERT INTO routing (dept_id,category,user_id) VALUES ($1,$2,NULL)', [id, '_default'])
  res.status(201).json({ id, name: name.trim(), color: color || '#3b82f6', categories: [] })
})

// DELETE /api/departments/:id — admin
r.delete('/:id', requireAdmin, async (req, res) => {
  await pool.query('UPDATE tickets SET dept = NULL, category = NULL WHERE dept = $1', [req.params.id])
  await pool.query('UPDATE users SET dept = NULL WHERE dept = $1', [req.params.id])
  await pool.query('DELETE FROM routing WHERE dept_id = $1', [req.params.id])
  await pool.query('DELETE FROM departments WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// POST /api/departments/:id/categories — admin
r.post('/:id/categories', requireAdmin, async (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Category name required' })
  const { rows: [existing] } = await pool.query('SELECT 1 FROM categories WHERE dept_id = $1 AND name = $2', [req.params.id, name])
  if (existing) return res.status(409).json({ error: 'Category already exists' })
  await pool.query('INSERT INTO categories (dept_id,name) VALUES ($1,$2)', [req.params.id, name])
  res.status(201).json({ ok: true })
})

// DELETE /api/departments/:id/categories/:name — admin
r.delete('/:id/categories/:name', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM categories WHERE dept_id = $1 AND name = $2', [req.params.id, req.params.name])
  await pool.query('DELETE FROM routing WHERE dept_id = $1 AND category = $2', [req.params.id, req.params.name])
  res.json({ ok: true })
})

export default r
