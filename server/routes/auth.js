import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import pool from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { sendMail, verificationEmail } from '../email.js'

const r = Router()
const COLORS = ['#3b82f6','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ef4444','#ec4899','#64748b']

// POST /api/auth/register — open self-signup, always creates a requestor
r.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {}
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ error: 'Name, email, and password are required' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' })

  const { rows: [existing] } = await pool.query('SELECT id, verified FROM users WHERE email = $1', [email.toLowerCase()])
  if (existing?.verified) return res.status(409).json({ error: 'An account with this email already exists' })

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const hash = bcrypt.hashSync(password, 10)
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]
  if (existing) {
    await pool.query('UPDATE users SET name=$1, password_hash=$2, verify_code=$3 WHERE id=$4', [name.trim(), hash, code, existing.id])
  } else {
    await pool.query(
      `INSERT INTO users (id,name,email,password_hash,role,color,verified,verify_code) VALUES ($1,$2,$3,$4,'requestor',$5,false,$6)`,
      [randomUUID(), name.trim(), email.toLowerCase(), hash, color, code]
    )
  }
  const { ok, previewUrl } = await sendMail({ to: email, subject: 'Verify your HelpDesk account', html: verificationEmail(name, code) })
  if (!ok) return res.status(502).json({ error: 'Could not send the verification email. Please try again or contact an administrator.' })
  res.json({ ok: true, message: 'Verification code sent', emailPreviewUrl: previewUrl })
})

// POST /api/auth/verify — { email, code }
r.post('/verify', async (req, res) => {
  const { email, code } = req.body || {}
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()])
  if (!user) return res.status(404).json({ error: 'No account found for this email' })
  if (user.verified) return res.status(400).json({ error: 'Account already verified — just log in' })
  if (!code || user.verify_code !== String(code).trim()) return res.status(400).json({ error: 'Incorrect verification code' })
  await pool.query('UPDATE users SET verified = true, verify_code = NULL WHERE id = $1', [user.id])
  const token = signToken(user)
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, dept: user.dept, color: user.color } })
})

// POST /api/auth/resend — { email }
r.post('/resend', async (req, res) => {
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email = $1', [(req.body?.email || '').toLowerCase()])
  if (!user || user.verified) return res.status(400).json({ error: 'Cannot resend for this account' })
  const code = String(Math.floor(100000 + Math.random() * 900000))
  await pool.query('UPDATE users SET verify_code = $1 WHERE id = $2', [code, user.id])
  const { ok, previewUrl } = await sendMail({ to: user.email, subject: 'Your new HelpDesk verification code', html: verificationEmail(user.name, code) })
  if (!ok) return res.status(502).json({ error: 'Could not send the verification email. Please try again later.' })
  res.json({ ok: true, emailPreviewUrl: previewUrl })
})

// POST /api/auth/login — { email, password }
r.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()])
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' })
  if (!user.verified) return res.status(403).json({ error: 'unverified', message: 'Please verify your email first' })
  const token = signToken(user)
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, dept: user.dept, color: user.color } })
})

// GET /api/auth/me
r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }))

export default r
