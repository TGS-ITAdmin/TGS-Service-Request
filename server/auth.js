import jwt from 'jsonwebtoken'
import pool from './db.js'

export const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'helpdesk-dev-secret')

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production. Set it in your Railway service variables.')
}

export function signToken(user) {
  // pv = "password version": changes whenever the password is changed/reset, which voids older tokens
  const pv = user.password_changed_at ? new Date(user.password_changed_at).getTime() : 0
  return jwt.sign({ id: user.id, role: user.role, pv }, JWT_SECRET, { expiresIn: '7d' })
}

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const { rows: [row] } = await pool.query(
      'SELECT id,name,email,role,dept,color,verified,must_change_password,password_changed_at FROM users WHERE id = $1', [payload.id]
    )
    if (!row) return res.status(401).json({ error: 'User not found' })
    const { password_changed_at, ...user } = row
    // Tokens issued before the last password change/reset are no longer valid
    const currentPv = password_changed_at ? new Date(password_changed_at).getTime() : 0
    if ((payload.pv || 0) !== currentPv) {
      return res.status(401).json({ error: 'Session expired — please sign in again' })
    }
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Roles, highest first. "Staff" works tickets; "admin level" (owner + admin) also manages people and settings.
export const ROLES = ['owner', 'admin', 'manager', 'requestor']
export const ROLE_RANK = { owner: 4, admin: 3, manager: 2, requestor: 1 }
export const STAFF_ROLES = ['owner', 'admin', 'manager']
export const ADMIN_ROLES = ['owner', 'admin']

export function requireStaff(req, res, next) {
  if (!STAFF_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Staff only' })
  next()
}

export function requireAdmin(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Admin only' })
  next()
}
