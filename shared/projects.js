// Rules for Projects, shared by the server (enforcement) and the browser (what to show). Pure functions only.
import { isStaffRole, isOwnerRole } from './roles.js'

export const PRIVACY = ['members', 'staff']                   // private to members | visible to all staff
export const PRIVACY_LABEL = { members: 'Private to members', staff: 'Visible to all staff' }
export const MEMBER_ROLES = ['owner', 'member']               // project owner can edit settings and members
export const DEFAULT_SECTIONS = ['To do', 'Doing', 'Done']
export const FIELD_TYPES = ['text', 'number', 'date', 'select']
export const MAX_SELECT_OPTIONS = 30

// ---- Who can do what ------------------------------------------------------------------------------------------
// `member` is the user's project_members.role ('owner' | 'member') or null/undefined when they are not a member.
// The Owner can see and manage every project (so a project never gets orphaned). Everyone else on staff sees a project
// when it is visible to all staff or they are a member. An Admin has full access (manage) only in projects they
// created or were added to; a Manager manages only projects they own.
export const canCreateProject = (user) => isStaffRole(user?.role)
export const canViewProject = (user, project, member) =>
  isStaffRole(user?.role) && (isOwnerRole(user.role) || project.privacy === 'staff' || !!member)
export const canWorkInProject = canViewProject        // add / edit / complete tasks and move them between sections
export const canManageProject = (user, member) =>
  isStaffRole(user?.role) && (isOwnerRole(user.role) || member === 'owner' || (user.role === 'admin' && !!member))   // settings, members, sections, fields, delete

// ---- Dependencies ---------------------------------------------------------------------------------------------
// edges: [{ task_id, blocked_by }]  — "task_id cannot be completed until blocked_by is".
// Would adding `task -> blockedBy` create a loop (or depend on itself)?
export function createsCycle(edges, taskId, blockedBy) {
  if (taskId === blockedBy) return true
  const next = new Map()
  for (const e of edges) { if (!next.has(e.task_id)) next.set(e.task_id, []); next.get(e.task_id).push(e.blocked_by) }
  const seen = new Set()
  const stack = [blockedBy]
  while (stack.length) {                      // can we walk from blockedBy back to taskId?
    const cur = stack.pop()
    if (cur === taskId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const n of next.get(cur) || []) stack.push(n)
  }
  return false
}

// ---- Recurrence -----------------------------------------------------------------------------------------------
export const RECUR_UNITS = ['day', 'week', 'month']
export const RECUR_LABEL = { day: 'day', week: 'week', month: 'month' }

// Accepts { unit, interval } (or null/undefined to clear). Returns a clean object, null, or throws a plain Error.
export function normalizeRecurrence(r) {
  if (r === null || r === undefined || r === '') return null
  if (typeof r !== 'object' || !RECUR_UNITS.includes(r.unit)) throw new Error('Repeat must be day, week or month')
  const interval = Number(r.interval ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('Repeat interval must be a whole number from 1 to 365')
  return { unit: r.unit, interval }
}

export const describeRecurrence = (r) => !r ? 'Does not repeat'
  : r.interval === 1 ? `Every ${r.unit}` : `Every ${r.interval} ${r.unit}s`

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

// Next due date ('YYYY-MM-DD') after completing a recurring task. Based on the old due date when there is one,
// otherwise on `today`. Months clamp to the last day (Jan 31 + 1 month = Feb 28/29). Never returns a date in the
// past: a task that is weeks overdue jumps forward to its next upcoming slot instead of spawning stale copies.
export function nextDueDate(due, recurrence, today) {
  const r = normalizeRecurrence(recurrence)
  if (!r) return null
  const [ty, tm, td] = String(today).slice(0, 10).split('-').map(Number)
  const todayUtc = Date.UTC(ty, tm - 1, td)
  const base = due ? String(due).slice(0, 10) : String(today).slice(0, 10)
  const [y, m, d] = base.split('-').map(Number)
  let step = 0
  const at = (k) => {
    if (r.unit === 'month') {
      const total = (m - 1) + k * r.interval
      const yy = y + Math.floor(total / 12), mm = ((total % 12) + 12) % 12
      const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
      return new Date(Date.UTC(yy, mm, Math.min(d, last)))
    }
    const days = r.unit === 'week' ? 7 : 1
    return new Date(Date.UTC(y, m - 1, d + k * r.interval * days))
  }
  do { step++ } while (at(step).getTime() < todayUtc && step < 5000)
  return fmt(at(step))
}

// ---- Custom field values --------------------------------------------------------------------------------------
// Checks a value against its field. Returns the cleaned string to store, '' to clear, or throws Error with a message.
export function cleanFieldValue(field, value) {
  if (value === null || value === undefined || value === '') return ''
  const v = String(value).trim()
  if (!v) return ''
  switch (field.type) {
    case 'text': return v.slice(0, 500)
    case 'number': if (!Number.isFinite(Number(v))) throw new Error(`${field.name} must be a number`); return String(Number(v))
    case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`${field.name} must be a date`); return v
    case 'select': if (!(field.options || []).some(o => o.id === v)) throw new Error(`${field.name}: choose one of the listed options`); return v
    default: throw new Error('Unknown field type')
  }
}
