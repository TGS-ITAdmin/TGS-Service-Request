import jwt from 'jsonwebtoken'
import pool from './db.js'

export const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'helpdesk-dev-secret')

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production. Set it in your Railway service variables.')
}

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const { rows: [user] } = await pool.query(
      'SELECT id,name,email,role,dept,color,verified FROM users WHERE id = $1', [payload.id]
    )
    if (!user) return res.status(401).json({ error: 'User not found' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireStaff(req, res, next) {
  if (!['admin', 'manager', 'agent'].includes(req.user.role)) return res.status(403).json({ error: 'Staff only' })
  next()
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
  next()
}

export function requireManager(req, res, next) {
  if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Manager or admin only' })
  next()
}
