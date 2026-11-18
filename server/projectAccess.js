import pool from './db.js'
import { canViewProject, canManageProject } from '../shared/projects.js'

export const now = () => new Date().toISOString()

// The user's membership role in a project ('owner' | 'member') or null.
export async function memberRole(userId, projectId, db = pool) {
  const { rows: [m] } = await db.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId])
  return m?.role ?? null
}

// Loads a project and the caller's relationship to it. Sends the 404/403 itself and returns null when not allowed.
//   need: 'view' (default) | 'manage'
export async function loadProject(req, res, projectId = req.params.id, need = 'view') {
  const { rows: [project] } = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId])
  // A project the caller may not see looks exactly like one that does not exist.
  if (!project) { res.status(404).json({ error: 'Project not found' }); return null }
  const member = await memberRole(req.user.id, project.id)
  if (!canViewProject(req.user, project, member)) { res.status(404).json({ error: 'Project not found' }); return null }
  if (need === 'manage' && !canManageProject(req.user, member)) {
    res.status(403).json({ error: 'Only the project owner or an admin can do that', code: 'not_project_owner' }); return null
  }
  return { project, member }
}

// Projects (ids) containing this task that the user may work in.
export async function accessibleProjectIdsForTask(user, taskId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.privacy, pm.role AS member
       FROM project_items i JOIN projects p ON p.id = i.project_id
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
      WHERE i.task_id = $1`, [taskId, user.id])
  return rows.filter(p => canViewProject(user, p, p.member)).map(p => p.id)
}
