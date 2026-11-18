import { Router } from 'express'
import { randomUUID } from 'crypto'
import pool from '../db.js'
import { requireAuth, requireStaff } from '../auth.js'
import { PRIORITIES } from '../sla.js'
import { sendMail, taskNotificationEmail } from '../email.js'
import { isStaffRole, isAdminRole } from '../../shared/roles.js'
import { isDone } from '../../shared/ticketStatus.js'
import {
  PRIVACY, MEMBER_ROLES, DEFAULT_SECTIONS, FIELD_TYPES, MAX_SELECT_OPTIONS, canCreateProject, cleanFieldValue,
} from '../../shared/projects.js'
import { loadProject, now } from '../projectAccess.js'

const r = Router()
r.use(requireAuth, requireStaff)   // Projects are a staff feature

const COLOR = /^#[0-9a-fA-F]{6}$/
const bad = (res, error, code) => res.status(400).json({ error, ...(code ? { code } : {}) })

async function logTask(taskId, actor, a, db = pool) {
  await db.query('INSERT INTO task_audit (id,task_id,actor,action,field,"from","to",ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), taskId, actor, a.action, a.field ?? null, a.from ?? null, a.to ?? null, now()])
}

async function staffIds(ids) {
  if (!ids.length) return []
  const { rows } = await pool.query('SELECT id,role FROM users WHERE id = ANY($1::text[])', [ids])
  return rows.filter(u => isStaffRole(u.role)).map(u => u.id)
}

// ---------- Projects ----------

// GET /api/projects — projects the caller may see, with progress counts
r.get('/', async (req, res) => {
  const admin = isAdminRole(req.user.role)
  const { rows } = await pool.query(
    `SELECT p.*, pm.role AS my_role,
       (SELECT COUNT(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count,
       (SELECT COUNT(*)::int FROM project_items i WHERE i.project_id = p.id) AS item_total,
       (SELECT COUNT(*)::int FROM project_items i
          LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN tickets k ON k.id = i.ticket_id
         WHERE i.project_id = p.id AND (t.completed OR k.status IN ('resolved','closed'))) AS item_done
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     WHERE $2::boolean OR p.privacy = 'staff' OR pm.user_id IS NOT NULL
     ORDER BY p.archived, lower(p.name)`, [req.user.id, admin])
  res.json(rows)
})

// POST /api/projects — { name, description?, color?, privacy?, members?: [userId] }
r.post('/', async (req, res) => {
  if (!canCreateProject(req.user)) return res.status(403).json({ error: 'Staff only' })
  const b = req.body || {}
  const name = String(b.name || '').trim().slice(0, 120)
  if (!name) return bad(res, 'Project name is required')
  const privacy = b.privacy ?? 'members'
  if (!PRIVACY.includes(privacy)) return bad(res, 'Invalid privacy setting')
  if (b.color !== undefined && !COLOR.test(b.color)) return bad(res, 'Invalid colour')
  const members = [...new Set(await staffIds(Array.isArray(b.members) ? b.members : []))].filter(id => id !== req.user.id)
  const id = randomUUID(), t = now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('INSERT INTO projects (id,name,description,color,privacy,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',
      [id, name, String(b.description || '').slice(0, 5000), b.color || '#3b82f6', privacy, req.user.id, t])
    await client.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'owner')", [id, req.user.id])
    for (const uid of members) await client.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,'member')", [id, uid])
    for (const [i, s] of DEFAULT_SECTIONS.entries()) await client.query('INSERT INTO sections (id,project_id,name,position) VALUES ($1,$2,$3,$4)', [randomUUID(), id, s, i + 1])
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }
  const { rows: [p] } = await pool.query('SELECT * FROM projects WHERE id = $1', [id])
  res.status(201).json(p)
})

// GET /api/projects/:id — everything the project screen needs in one call
r.get('/:id', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const { project, member } = ctx
  const pid = project.id
  const [members, sections, fields, taskRows, ticketRows, values] = await Promise.all([
    pool.query(`SELECT u.id,u.name,u.email,u.color,u.role AS user_role,pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id = $1 ORDER BY (pm.role = 'owner') DESC, lower(u.name)`, [pid]),
    pool.query('SELECT id,name,position FROM sections WHERE project_id = $1 ORDER BY position, name', [pid]),
    pool.query('SELECT id,name,type,options,position FROM custom_fields WHERE project_id = $1 ORDER BY position, name', [pid]),
    pool.query(`SELECT i.id AS item_id, i.section_id, i.position, t.id, t.title, t.assignee, t.due_date, t.priority, t.completed, t.recurrence,
        (SELECT COUNT(*)::int FROM task_subtasks s WHERE s.task_id = t.id) AS subtask_total,
        (SELECT COUNT(*)::int FROM task_subtasks s WHERE s.task_id = t.id AND s.done) AS subtask_done,
        (SELECT COUNT(*)::int FROM task_messages m WHERE m.task_id = t.id) AS comment_count,
        (SELECT COUNT(*)::int FROM task_attachments a WHERE a.task_id = t.id) AS attachment_count,
        (SELECT COUNT(*)::int FROM task_deps d JOIN tasks b ON b.id = d.blocked_by WHERE d.task_id = t.id AND NOT b.completed) AS blocked_by_open
      FROM project_items i JOIN tasks t ON t.id = i.task_id WHERE i.project_id = $1`, [pid]),
    pool.query(`SELECT i.id AS item_id, i.section_id, i.position, k.id, k.num, k.title, k.assignee, k.due_date, k.priority, k.status
      FROM project_items i JOIN tickets k ON k.id = i.ticket_id WHERE i.project_id = $1`, [pid]),
    pool.query('SELECT v.field_id, v.item_id, v.value FROM custom_values v JOIN project_items i ON i.id = v.item_id WHERE i.project_id = $1', [pid]),
  ])
  const byItem = {}
  for (const v of values.rows) (byItem[v.item_id] ||= {})[v.field_id] = v.value
  const items = [
    ...taskRows.rows.map(t => ({ kind: 'task', ...t, done: t.completed, blocked: t.blocked_by_open > 0, values: byItem[t.item_id] || {} })),
    ...ticketRows.rows.map(k => ({ kind: 'ticket', ...k, done: isDone(k.status), values: byItem[k.item_id] || {} })),
  ].sort((a, b) => a.position - b.position)
  res.json({ project, my_role: member, members: members.rows, sections: sections.rows, fields: fields.rows, items })
})

// PATCH /api/projects/:id — { name?, description?, color?, privacy?, archived? }
r.patch('/:id', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const b = req.body || {}, p = ctx.project
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 120) : p.name
  if (!name) return bad(res, 'Project name is required')
  const privacy = b.privacy ?? p.privacy
  if (!PRIVACY.includes(privacy)) return bad(res, 'Invalid privacy setting')
  const color = b.color ?? p.color
  if (!COLOR.test(color)) return bad(res, 'Invalid colour')
  const { rows: [u] } = await pool.query(
    'UPDATE projects SET name=$1, description=$2, color=$3, privacy=$4, archived=$5, updated_at=$6 WHERE id=$7 RETURNING *',
    [name, b.description !== undefined ? String(b.description).slice(0, 5000) : p.description, color, privacy,
     b.archived !== undefined ? !!b.archived : p.archived, now(), p.id])
  res.json(u)
})

// DELETE /api/projects/:id — tasks that live ONLY in this project are deleted with it; tickets are never deleted
r.delete('/:id', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM tasks WHERE id IN (
      SELECT i.task_id FROM project_items i WHERE i.project_id = $1 AND i.task_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM project_items o WHERE o.task_id = i.task_id AND o.project_id <> $1))`, [ctx.project.id])
    await client.query('DELETE FROM projects WHERE id = $1', [ctx.project.id])
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }
  res.json({ ok: true })
})

// ---------- Members ----------

async function ownerCount(projectId) {
  const { rows: [{ c }] } = await pool.query("SELECT COUNT(*)::int c FROM project_members WHERE project_id = $1 AND role = 'owner'", [projectId])
  return c
}

// POST /api/projects/:id/members — { user_id, role? }
r.post('/:id/members', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const role = req.body?.role ?? 'member'
  if (!MEMBER_ROLES.includes(role)) return bad(res, 'Invalid member role')
  const [uid] = await staffIds([req.body?.user_id])
  if (!uid) return bad(res, 'Only staff (Owner, Admin, Manager) can be project members', 'not_staff')
  await pool.query(`INSERT INTO project_members (project_id,user_id,role) VALUES ($1,$2,$3)
                    ON CONFLICT (project_id,user_id) DO UPDATE SET role = EXCLUDED.role`, [ctx.project.id, uid, role])
  res.status(201).json({ ok: true })
})

// PATCH /api/projects/:id/members/:uid — { role }
r.patch('/:id/members/:uid', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const role = req.body?.role
  if (!MEMBER_ROLES.includes(role)) return bad(res, 'Invalid member role')
  const { rows: [m] } = await pool.query('SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2', [ctx.project.id, req.params.uid])
  if (!m) return res.status(404).json({ error: 'Not a member' })
  if (m.role === 'owner' && role !== 'owner' && await ownerCount(ctx.project.id) <= 1)
    return res.status(409).json({ error: 'A project needs at least one owner', code: 'last_owner' })
  await pool.query('UPDATE project_members SET role=$1 WHERE project_id=$2 AND user_id=$3', [role, ctx.project.id, req.params.uid])
  res.json({ ok: true })
})

// DELETE /api/projects/:id/members/:uid — owners/admins remove anyone; any member may leave
r.delete('/:id/members/:uid', async (req, res) => {
  const leaving = req.params.uid === req.user.id
  const ctx = await loadProject(req, res, req.params.id, leaving ? 'view' : 'manage'); if (!ctx) return
  const { rows: [m] } = await pool.query('SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2', [ctx.project.id, req.params.uid])
  if (!m) return res.status(404).json({ error: 'Not a member' })
  if (m.role === 'owner' && await ownerCount(ctx.project.id) <= 1)
    return res.status(409).json({ error: 'A project needs at least one owner. Make someone else an owner first.', code: 'last_owner' })
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [ctx.project.id, req.params.uid])
  res.json({ ok: true })
})

// ---------- Sections ----------

r.post('/:id/sections', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const name = String(req.body?.name || '').trim().slice(0, 80)
  if (!name) return bad(res, 'Section name is required')
  const { rows: [{ m }] } = await pool.query('SELECT COALESCE(MAX(position),0) m FROM sections WHERE project_id = $1', [ctx.project.id])
  const { rows: [s] } = await pool.query('INSERT INTO sections (id,project_id,name,position) VALUES ($1,$2,$3,$4) RETURNING id,name,position',
    [randomUUID(), ctx.project.id, name, m + 1])
  res.status(201).json(s)
})

// PATCH — { name?, position? }
r.patch('/:id/sections/:sid', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const { rows: [s] } = await pool.query('SELECT * FROM sections WHERE id=$1 AND project_id=$2', [req.params.sid, ctx.project.id])
  if (!s) return res.status(404).json({ error: 'Section not found' })
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) : s.name
  if (!name) return bad(res, 'Section name is required')
  const position = Number.isFinite(Number(req.body?.position)) && req.body?.position !== undefined ? Number(req.body.position) : s.position
  const { rows: [u] } = await pool.query('UPDATE sections SET name=$1, position=$2 WHERE id=$3 RETURNING id,name,position', [name, position, s.id])
  res.json(u)
})

// DELETE — its items move to the first remaining section (or to "no section" when it was the last one)
r.delete('/:id/sections/:sid', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const { rows: [s] } = await pool.query('SELECT id FROM sections WHERE id=$1 AND project_id=$2', [req.params.sid, ctx.project.id])
  if (!s) return res.status(404).json({ error: 'Section not found' })
  const { rows: [dest] } = await pool.query('SELECT id FROM sections WHERE project_id=$1 AND id<>$2 ORDER BY position LIMIT 1', [ctx.project.id, s.id])
  await pool.query('UPDATE project_items SET section_id=$1 WHERE section_id=$2', [dest?.id ?? null, s.id])
  await pool.query('DELETE FROM sections WHERE id=$1', [s.id])
  res.json({ ok: true, moved_to: dest?.id ?? null })
})

// ---------- Items: create tasks, add tickets, move, remove ----------

async function nextPosition(projectId, sectionId, db = pool) {
  const { rows: [{ m }] } = await db.query(
    'SELECT COALESCE(MAX(position),0) m FROM project_items WHERE project_id=$1 AND section_id IS NOT DISTINCT FROM $2', [projectId, sectionId])
  return m + 1
}

async function resolveSection(projectId, sectionId, res) {
  if (sectionId === undefined || sectionId === null || sectionId === '') return { ok: true, id: null }
  const { rows: [s] } = await pool.query('SELECT id FROM sections WHERE id=$1 AND project_id=$2', [sectionId, projectId])
  if (!s) { bad(res, 'That section is not in this project', 'bad_section'); return { ok: false } }
  return { ok: true, id: s.id }
}

// POST /api/projects/:id/tasks — { title, section_id?, assignee?, due_date?, priority?, description? }
r.post('/:id/tasks', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const b = req.body || {}
  const title = String(b.title || '').trim().slice(0, 300)
  if (!title) return bad(res, 'Task name is required')
  if (b.priority && !PRIORITIES.includes(b.priority)) return bad(res, 'Invalid priority')
  if (b.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) return bad(res, 'Invalid due date')
  const sec = await resolveSection(ctx.project.id, b.section_id ?? (await pool.query('SELECT id FROM sections WHERE project_id=$1 ORDER BY position LIMIT 1', [ctx.project.id])).rows[0]?.id, res)
  if (!sec.ok) return
  let assignee = null
  if (b.assignee) { [assignee] = await staffIds([b.assignee]); if (!assignee) return bad(res, 'Tasks can only be assigned to staff', 'not_staff') }
  const taskId = randomUUID(), itemId = randomUUID(), t = now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO tasks (id,title,description,assignee,due_date,priority,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [taskId, title, String(b.description || '').slice(0, 20000), assignee, b.due_date || null, b.priority || null, req.user.id, t])
    await client.query('INSERT INTO project_items (id,project_id,section_id,task_id,position) VALUES ($1,$2,$3,$4,$5)',
      [itemId, ctx.project.id, sec.id, taskId, await nextPosition(ctx.project.id, sec.id, client)])
    await logTask(taskId, req.user.name, { action: 'created', to: `Task created in ${ctx.project.name}` }, client)
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }
  if (assignee && assignee !== req.user.id) {
    const { rows: [a] } = await pool.query('SELECT email FROM users WHERE id=$1', [assignee])
    if (a?.email) sendMail({ to: a.email, subject: `${req.user.name} assigned you a task: ${title}`, html: taskNotificationEmail(title, `${req.user.name} assigned you this task in ${ctx.project.name}.`, ctx.project.name) }).catch(() => {})
  }
  res.status(201).json({ task_id: taskId, item_id: itemId })
})

// POST /api/projects/:id/tickets — { ticket_id, section_id? } adds an existing form ticket to the project
r.post('/:id/tickets', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const { rows: [k] } = await pool.query('SELECT id,num FROM tickets WHERE id=$1', [req.body?.ticket_id])
  if (!k) return res.status(404).json({ error: 'Ticket not found' })
  const sec = await resolveSection(ctx.project.id, req.body?.section_id ?? (await pool.query('SELECT id FROM sections WHERE project_id=$1 ORDER BY position LIMIT 1', [ctx.project.id])).rows[0]?.id, res)
  if (!sec.ok) return
  const itemId = randomUUID()
  try {
    await pool.query('INSERT INTO project_items (id,project_id,section_id,ticket_id,position) VALUES ($1,$2,$3,$4,$5)',
      [itemId, ctx.project.id, sec.id, k.id, await nextPosition(ctx.project.id, sec.id)])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That ticket is already in this project', code: 'already_in_project' })
    throw e
  }
  await pool.query('INSERT INTO audit (id,ticket_id,actor,action,field,"from","to",ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), k.id, req.user.name, 'project-added', 'Project', null, ctx.project.name, now()])
  res.status(201).json({ item_id: itemId })
})

// PATCH /api/projects/:id/items/:itemId — move: { section_id?, position? }
r.patch('/:id/items/:itemId', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const { rows: [it] } = await pool.query('SELECT * FROM project_items WHERE id=$1 AND project_id=$2', [req.params.itemId, ctx.project.id])
  if (!it) return res.status(404).json({ error: 'Item not found' })
  const b = req.body || {}
  let sectionId = it.section_id
  if (b.section_id !== undefined) { const s = await resolveSection(ctx.project.id, b.section_id, res); if (!s.ok) return; sectionId = s.id }
  const position = b.position !== undefined && Number.isFinite(Number(b.position)) ? Number(b.position) : (sectionId !== it.section_id ? await nextPosition(ctx.project.id, sectionId) : it.position)
  await pool.query('UPDATE project_items SET section_id=$1, position=$2 WHERE id=$3', [sectionId, position, it.id])
  if (sectionId !== it.section_id && it.task_id) {
    const { rows: secs } = await pool.query('SELECT id,name FROM sections WHERE id = ANY($1::text[])', [[it.section_id, sectionId].filter(Boolean)])
    const nm = id => secs.find(s => s.id === id)?.name || 'No section'
    await logTask(it.task_id, req.user.name, { action: 'moved', field: 'Section', from: nm(it.section_id), to: nm(sectionId) })
  }
  res.json({ ok: true, section_id: sectionId, position })
})

// DELETE /api/projects/:id/items/:itemId — remove from this project. A task removed from its LAST project is deleted.
r.delete('/:id/items/:itemId', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const { rows: [it] } = await pool.query('SELECT * FROM project_items WHERE id=$1 AND project_id=$2', [req.params.itemId, ctx.project.id])
  if (!it) return res.status(404).json({ error: 'Item not found' })
  let taskDeleted = false
  await pool.query('DELETE FROM project_items WHERE id=$1', [it.id])
  if (it.task_id) {
    const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int c FROM project_items WHERE task_id=$1', [it.task_id])
    if (c === 0) { await pool.query('DELETE FROM tasks WHERE id=$1', [it.task_id]); taskDeleted = true }
    else await logTask(it.task_id, req.user.name, { action: 'project-removed', field: 'Project', from: ctx.project.name })
  } else {
    await pool.query('INSERT INTO audit (id,ticket_id,actor,action,field,"from","to",ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), it.ticket_id, req.user.name, 'project-removed', 'Project', ctx.project.name, null, now()])
  }
  res.json({ ok: true, taskDeleted })
})

// ---------- Custom fields ----------

function cleanOptions(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  for (const o of list) {
    const label = String(typeof o === 'string' ? o : o?.label || '').trim().slice(0, 60)
    if (label && !out.some(x => x.label.toLowerCase() === label.toLowerCase())) out.push({ id: (typeof o === 'object' && o?.id) || randomUUID(), label })
  }
  return out.slice(0, MAX_SELECT_OPTIONS)
}

// POST /api/projects/:id/fields — { name, type, options? }
r.post('/:id/fields', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const name = String(req.body?.name || '').trim().slice(0, 60)
  if (!name) return bad(res, 'Field name is required')
  const type = req.body?.type
  if (!FIELD_TYPES.includes(type)) return bad(res, 'Field type must be text, number, date or select')
  const options = type === 'select' ? cleanOptions(req.body?.options) : []
  if (type === 'select' && !options.length) return bad(res, 'A dropdown field needs at least one option')
  const { rows: [{ m }] } = await pool.query('SELECT COALESCE(MAX(position),0) m FROM custom_fields WHERE project_id=$1', [ctx.project.id])
  const { rows: [f] } = await pool.query('INSERT INTO custom_fields (id,project_id,name,type,options,position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,type,options,position',
    [randomUUID(), ctx.project.id, name, type, JSON.stringify(options), m + 1])
  res.status(201).json(f)
})

// PATCH — { name?, options? }  (the type cannot change). Removing an option clears it from every item.
r.patch('/:id/fields/:fid', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const { rows: [f] } = await pool.query('SELECT * FROM custom_fields WHERE id=$1 AND project_id=$2', [req.params.fid, ctx.project.id])
  if (!f) return res.status(404).json({ error: 'Field not found' })
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) : f.name
  if (!name) return bad(res, 'Field name is required')
  let options = f.options
  if (f.type === 'select' && req.body?.options !== undefined) {
    options = cleanOptions(req.body.options)
    if (!options.length) return bad(res, 'A dropdown field needs at least one option')
    await pool.query('DELETE FROM custom_values WHERE field_id=$1 AND NOT (value = ANY($2::text[]))', [f.id, options.map(o => o.id)])
  }
  const { rows: [u] } = await pool.query('UPDATE custom_fields SET name=$1, options=$2 WHERE id=$3 RETURNING id,name,type,options,position', [name, JSON.stringify(options), f.id])
  res.json(u)
})

r.delete('/:id/fields/:fid', async (req, res) => {
  const ctx = await loadProject(req, res, req.params.id, 'manage'); if (!ctx) return
  const { rowCount } = await pool.query('DELETE FROM custom_fields WHERE id=$1 AND project_id=$2', [req.params.fid, ctx.project.id])
  if (!rowCount) return res.status(404).json({ error: 'Field not found' })
  res.json({ ok: true })
})

// PUT /api/projects/:id/items/:itemId/fields/:fid — { value }   ('' clears)
r.put('/:id/items/:itemId/fields/:fid', async (req, res) => {
  const ctx = await loadProject(req, res); if (!ctx) return
  const { rows: [it] } = await pool.query('SELECT id FROM project_items WHERE id=$1 AND project_id=$2', [req.params.itemId, ctx.project.id])
  if (!it) return res.status(404).json({ error: 'Item not found' })
  const { rows: [f] } = await pool.query('SELECT * FROM custom_fields WHERE id=$1 AND project_id=$2', [req.params.fid, ctx.project.id])
  if (!f) return res.status(404).json({ error: 'Field not found' })
  let value
  try { value = cleanFieldValue(f, req.body?.value) } catch (e) { return bad(res, e.message, 'bad_field_value') }
  if (value === '') await pool.query('DELETE FROM custom_values WHERE field_id=$1 AND item_id=$2', [f.id, it.id])
  else await pool.query(`INSERT INTO custom_values (field_id,item_id,value) VALUES ($1,$2,$3)
                         ON CONFLICT (field_id,item_id) DO UPDATE SET value = EXCLUDED.value`, [f.id, it.id, value])
  res.json({ ok: true, value })
})

export default r
