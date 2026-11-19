import { Router } from 'express'
import express from 'express'
import { randomUUID } from 'crypto'
import pool from '../db.js'
import { requireAuth, requireStaff } from '../auth.js'
import { PRIORITIES, todayInTz } from '../sla.js'
import { sendMail, taskNotificationEmail } from '../email.js'
import { isStaffRole, isAdminRole } from '../../shared/roles.js'
import { isDone } from '../../shared/ticketStatus.js'
import { taskState, taskStateOf } from '../../shared/taskState.js'
import { createsCycle, normalizeRecurrence, nextDueDate, canViewProject } from '../../shared/projects.js'
import { accessibleProjectIdsForTask, memberRole, now } from '../projectAccess.js'

const r = Router()
r.use(requireAuth, requireStaff)

const MAX_FILE_BYTES = 10 * 1024 * 1024
const bad = (res, error, code) => res.status(400).json({ error, ...(code ? { code } : {}) })

async function log(taskId, actor, a, db = pool) {
  await db.query('INSERT INTO task_audit (id,task_id,actor,action,field,"from","to",ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), taskId, actor, a.action, a.field ?? null, a.from ?? null, a.to ?? null, now()])
}
const touch = (taskId, db = pool) => db.query('UPDATE tasks SET updated_at=$1 WHERE id=$2', [now(), taskId])

// Loads the task and proves the caller may work in at least one project that contains it.
async function loadTask(req, res, id = req.params.id) {
  const { rows: [task] } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id])
  const projectIds = task ? await accessibleProjectIdsForTask(req.user, id) : []
  if (!task || !projectIds.length) { res.status(404).json({ error: 'Task not found' }); return null }   // hidden == missing
  return { task, projectIds }
}

async function staffOnly(id) {
  if (!id) return null
  const { rows: [u] } = await pool.query('SELECT id,role FROM users WHERE id=$1', [id])
  return u && isStaffRole(u.role) ? u.id : undefined      // null = none given, undefined = invalid
}

const unfinishedBlockers = async (taskId, db = pool) =>
  (await db.query(`SELECT t.id,t.title FROM task_deps d JOIN tasks t ON t.id = d.blocked_by WHERE d.task_id=$1 AND NOT t.completed ORDER BY t.title`, [taskId])).rows

// GET /api/tasks/mine — everything assigned to the caller: project tasks AND tickets, with the projects each one is in.
// Only projects the caller may see are listed (archived ones are hidden; a task living only there is hidden too).
// Finished items are limited to the last 60 days so the list stays useful.
r.get('/mine', async (req, res) => {
  const admin = isAdminRole(req.user.role)
  const visible = `NOT p.archived AND ($2::boolean OR p.privacy = 'staff' OR pm.user_id IS NOT NULL)`
  const projectsOf = (col) => `(SELECT COALESCE(json_agg(json_build_object('id',p.id,'name',p.name,'color',p.color,'item_id',i.id) ORDER BY lower(p.name)), '[]'::json)
      FROM project_items i JOIN projects p ON p.id = i.project_id LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     WHERE i.${col} = %ID% AND ${visible})`
  const tasks = await pool.query(
    `SELECT t.id, t.title, t.due_date, t.priority, t.completed, t.completed_at, t.recurrence,
        (SELECT COUNT(*)::int FROM task_subtasks s WHERE s.task_id = t.id) AS subtask_total,
        (SELECT COUNT(*)::int FROM task_subtasks s WHERE s.task_id = t.id AND s.done) AS subtask_done,
        (SELECT COUNT(*)::int FROM task_deps d JOIN tasks b ON b.id = d.blocked_by WHERE d.task_id = t.id AND NOT b.completed) AS blocked_by_open,
        ${projectsOf('task_id').replace('%ID%', 't.id')} AS projects
       FROM tasks t
      WHERE t.assignee = $1 AND (NOT t.completed OR t.completed_at > now() - interval '60 days')`, [req.user.id, admin])
  const tickets = await pool.query(
    `SELECT k.id, k.num, k.title, k.due_date, k.priority, k.status,
        ${projectsOf('ticket_id').replace('%ID%', 'k.id')} AS projects
       FROM tickets k
      WHERE k.assignee = $1 AND (k.status IN ('open','in_progress') OR k.resolved_at > now() - interval '60 days')`, [req.user.id, admin])
  const items = [
    ...tasks.rows.filter(t => t.projects.length).map(t => ({ kind: 'task', ...t, done: t.completed, blocked: t.blocked_by_open > 0 })),
    ...tickets.rows.map(k => ({ kind: 'ticket', ...k, done: isDone(k.status) })),
  ]
  res.json(items)
})

// GET /api/tasks/:id
r.get('/:id', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const id = ctx.task.id
  const [projects, subtasks, messages, audit, attachments, blockedBy, blocking] = await Promise.all([
    pool.query(`SELECT p.id,p.name,p.color,i.id AS item_id,i.section_id,s.name AS section_name
                  FROM project_items i JOIN projects p ON p.id=i.project_id LEFT JOIN sections s ON s.id=i.section_id
                 WHERE i.task_id=$1 AND p.id = ANY($2::text[]) ORDER BY lower(p.name)`, [id, ctx.projectIds]),
    pool.query('SELECT * FROM task_subtasks WHERE task_id=$1 ORDER BY created_at', [id]),
    pool.query('SELECT * FROM task_messages WHERE task_id=$1 ORDER BY created_at', [id]),
    pool.query('SELECT * FROM task_audit WHERE task_id=$1 ORDER BY ts', [id]),
    pool.query('SELECT id,task_id,filename,mime,size,uploaded_by,uploaded_by_name,created_at FROM task_attachments WHERE task_id=$1 ORDER BY created_at', [id]),
    pool.query('SELECT t.id,t.title,t.completed FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=$1 ORDER BY t.title', [id]),
    pool.query('SELECT t.id,t.title,t.completed FROM task_deps d JOIN tasks t ON t.id=d.task_id WHERE d.blocked_by=$1 ORDER BY t.title', [id]),
  ])
  res.json({
    task: ctx.task, projects: projects.rows, subtasks: subtasks.rows, messages: messages.rows, audit: audit.rows,
    attachments: attachments.rows, blocked_by: blockedBy.rows, blocking: blocking.rows,
  })
})

// Creates the next occurrence of a recurring task inside the caller's transaction. Returns the new task id.
async function spawnNext(client, task, actor) {
  const rec = normalizeRecurrence(task.recurrence)
  const due = nextDueDate(task.due_date, rec, todayInTz())
  const id = randomUUID(), t = now()
  await client.query(`INSERT INTO tasks (id,title,description,assignee,due_date,priority,recurrence,created_by,created_at,updated_at)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [id, task.title, task.description, task.assignee, due, task.priority, JSON.stringify(rec), task.created_by, t])
  const { rows: items } = await client.query('SELECT * FROM project_items WHERE task_id=$1', [task.id])
  for (const it of items) {
    const newItem = randomUUID()
    const { rows: [{ m }] } = await client.query('SELECT COALESCE(MAX(position),0) m FROM project_items WHERE project_id=$1 AND section_id IS NOT DISTINCT FROM $2', [it.project_id, it.section_id])
    await client.query('INSERT INTO project_items (id,project_id,section_id,task_id,position) VALUES ($1,$2,$3,$4,$5)', [newItem, it.project_id, it.section_id, id, m + 1])
    await client.query('INSERT INTO custom_values (field_id,item_id,value) SELECT field_id,$1,value FROM custom_values WHERE item_id=$2', [newItem, it.id])
  }
  await client.query(`INSERT INTO task_subtasks (id,task_id,title,done,assignee,created_at)
                      SELECT gen_random_uuid()::text,$1,title,false,assignee,$2 FROM task_subtasks WHERE task_id=$3 ORDER BY created_at`, [id, t, task.id])
  await log(id, actor, { action: 'created', to: 'Created automatically — repeating task' }, client)
  return { id, due }
}

const LABELS = { title: 'Name', description: 'Description', assignee: 'Assignee', due_date: 'Due Date', priority: 'Priority' }

// PATCH /api/tasks/:id — { title?, description?, assignee?, due_date?, priority?, completed?, recurrence? }
r.patch('/:id', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const t = ctx.task, b = req.body || {}
  const updates = {}, audits = []

  if (b.title !== undefined) { const v = String(b.title).trim().slice(0, 300); if (!v) return bad(res, 'Task name is required'); if (v !== t.title) { updates.title = v; audits.push({ field: 'Name', from: t.title, to: v }) } }
  if (b.description !== undefined) { const v = String(b.description).slice(0, 20000); if (v !== t.description) { updates.description = v; audits.push({ field: 'Description', from: null, to: 'updated' }) } }
  if (b.priority !== undefined) {
    const v = b.priority || null
    if (v && !PRIORITIES.includes(v)) return bad(res, 'Invalid priority')
    if (v !== t.priority) { updates.priority = v; audits.push({ field: 'Priority', from: t.priority || 'None', to: v || 'None' }) }
  }
  if (b.due_date !== undefined) {
    const v = b.due_date || null
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad(res, 'Invalid due date')
    if (v !== t.due_date) { updates.due_date = v; audits.push({ field: 'Due Date', from: t.due_date || 'None', to: v || 'None' }) }
  }
  let assigneeName = null
  if (b.assignee !== undefined) {
    const v = await staffOnly(b.assignee || null)
    if (v === undefined) return bad(res, 'Tasks can only be assigned to staff', 'not_staff')
    if (v !== t.assignee) {
      const { rows: us } = await pool.query('SELECT id,name,email FROM users WHERE id = ANY($1::text[])', [[v, t.assignee].filter(Boolean)])
      const nm = id => us.find(u => u.id === id)?.name || 'None'
      updates.assignee = v; assigneeName = v ? us.find(u => u.id === v) : null
      audits.push({ field: 'Assignee', from: nm(t.assignee), to: nm(v) })
    }
  }
  if (b.recurrence !== undefined) {
    let rec
    try { rec = normalizeRecurrence(b.recurrence) } catch (e) { return bad(res, e.message, 'bad_recurrence') }
    if (JSON.stringify(rec) !== JSON.stringify(t.recurrence ?? null)) {
      updates.recurrence = rec === null ? null : JSON.stringify(rec)
      audits.push({ field: 'Repeat', from: t.recurrence ? `Every ${t.recurrence.interval} ${t.recurrence.unit}` : 'None', to: rec ? `Every ${rec.interval} ${rec.unit}` : 'None' })
    }
  }

  // ---- completion goes through the task machine
  let move = null
  if (b.completed !== undefined) {
    const to = b.completed ? 'complete' : 'incomplete'
    const m = taskState.transition(taskStateOf(t), to)
    if (m.ok) {
      if (m.event === 'complete') {
        const blockers = await unfinishedBlockers(t.id)
        if (blockers.length) return res.status(409).json({ error: `Finish ${blockers.map(x => `“${x.title}”`).join(', ')} first`, code: 'blocked', blockers })
      }
      move = m
    }   // same_state is a harmless no-op
  }
  if (!Object.keys(updates).length && !move) return res.json(t)

  let spawned = null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const set = { ...updates, updated_at: now() }
    if (move?.effects.includes('stamp_completed_at')) { set.completed = true; set.completed_at = now() }
    if (move?.effects.includes('clear_completed_at')) { set.completed = false; set.completed_at = null }
    const keys = Object.keys(set)
    await client.query(`UPDATE tasks SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE id=$${keys.length + 1}`, [...keys.map(k => set[k]), t.id])
    for (const a of audits) await log(t.id, req.user.name, { action: 'changed', ...a }, client)
    if (move) await log(t.id, req.user.name, { action: move.event === 'complete' ? 'completed' : 'reopened', field: 'Status', from: move.event === 'complete' ? 'Incomplete' : 'Complete', to: move.event === 'complete' ? 'Complete' : 'Incomplete' }, client)
    if (move?.effects.includes('spawn_next_occurrence') && (updates.recurrence !== undefined ? updates.recurrence : t.recurrence)) {
      spawned = await spawnNext(client, { ...t, ...updates, recurrence: updates.recurrence !== undefined ? (updates.recurrence && JSON.parse(updates.recurrence)) : t.recurrence }, req.user.name)
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }

  if (assigneeName?.email && assigneeName.id !== req.user.id) {
    sendMail({ to: assigneeName.email, subject: `${req.user.name} assigned you a task: ${t.title}`, html: taskNotificationEmail(t.title, `${req.user.name} assigned you this task.`, 'Project task') }).catch(() => {})
  }
  const { rows: [updated] } = await pool.query('SELECT * FROM tasks WHERE id=$1', [t.id])
  res.json({ ...updated, spawned })
})

// DELETE /api/tasks/:id — removes the task from every project
r.delete('/:id', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  await pool.query('DELETE FROM tasks WHERE id=$1', [ctx.task.id])
  res.json({ ok: true })
})

// POST /api/tasks/:id/projects — { project_id, section_id? } also show this task in another project
r.post('/:id/projects', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [p] } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.body?.project_id])
  if (!p || !canViewProject(req.user, p, await memberRole(req.user.id, p.id))) return res.status(404).json({ error: 'Project not found' })
  let sectionId = req.body?.section_id ?? (await pool.query('SELECT id FROM sections WHERE project_id=$1 ORDER BY position LIMIT 1', [p.id])).rows[0]?.id ?? null
  if (sectionId) { const { rows: [s] } = await pool.query('SELECT id FROM sections WHERE id=$1 AND project_id=$2', [sectionId, p.id]); if (!s) return bad(res, 'That section is not in this project', 'bad_section') }
  try {
    const { rows: [{ m }] } = await pool.query('SELECT COALESCE(MAX(position),0) m FROM project_items WHERE project_id=$1 AND section_id IS NOT DISTINCT FROM $2', [p.id, sectionId])
    await pool.query('INSERT INTO project_items (id,project_id,section_id,task_id,position) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), p.id, sectionId, ctx.task.id, m + 1])
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This task is already in that project', code: 'already_in_project' })
    throw e
  }
  await log(ctx.task.id, req.user.name, { action: 'project-added', field: 'Project', to: p.name })
  res.status(201).json({ ok: true })
})

// ---------- Dependencies ----------

// POST /api/tasks/:id/dependencies — { blocked_by } this task cannot be completed until `blocked_by` is
r.post('/:id/dependencies', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const other = await loadTask(req, { status: () => ({ json: () => {} }) }, req.body?.blocked_by)   // must be a task the caller can also work on
  if (!other) return bad(res, 'Choose a task you have access to', 'bad_dependency')
  const { rows: edges } = await pool.query('SELECT task_id, blocked_by FROM task_deps')
  if (createsCycle(edges, ctx.task.id, other.task.id)) return res.status(409).json({ error: 'That would create a loop — those tasks would wait on each other', code: 'dependency_cycle' })
  await pool.query('INSERT INTO task_deps (task_id,blocked_by) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ctx.task.id, other.task.id])
  await log(ctx.task.id, req.user.name, { action: 'dependency-added', field: 'Waiting on', to: other.task.title })
  await touch(ctx.task.id)
  res.status(201).json({ ok: true })
})

r.delete('/:id/dependencies/:otherId', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [o] } = await pool.query('SELECT title FROM tasks WHERE id=$1', [req.params.otherId])
  const { rowCount } = await pool.query('DELETE FROM task_deps WHERE task_id=$1 AND blocked_by=$2', [ctx.task.id, req.params.otherId])
  if (!rowCount) return res.status(404).json({ error: 'Dependency not found' })
  await log(ctx.task.id, req.user.name, { action: 'dependency-removed', field: 'Waiting on', from: o?.title })
  res.json({ ok: true })
})

// GET /api/tasks/:id/dependency-candidates?q= — tasks (in projects the caller can see) this one could wait on
r.get('/:id/dependency-candidates', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const q = `%${String(req.query.q || '').trim().replace(/[%_]/g, '')}%`
  const { rows } = await pool.query(
    `SELECT DISTINCT t.id, t.title, t.completed FROM tasks t
       JOIN project_items i ON i.task_id = t.id JOIN projects p ON p.id = i.project_id
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
      WHERE t.id <> $1 AND t.title ILIKE $3 AND ($4::boolean OR p.privacy = 'staff' OR pm.user_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM task_deps d WHERE d.task_id = $1 AND d.blocked_by = t.id)
      ORDER BY t.title LIMIT 20`, [ctx.task.id, req.user.id, q, ['owner', 'admin'].includes(req.user.role)])
  const { rows: edges } = await pool.query('SELECT task_id, blocked_by FROM task_deps')
  res.json(rows.filter(c => !createsCycle(edges, ctx.task.id, c.id)))
})

// ---------- Subtasks ----------

r.post('/:id/subtasks', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const title = String(req.body?.title || '').trim().slice(0, 300)
  if (!title) return bad(res, 'Subtask title required')
  const assignee = await staffOnly(req.body?.assignee || null)
  if (assignee === undefined) return bad(res, 'Subtasks can only be assigned to staff', 'not_staff')
  const sub = { id: randomUUID(), task_id: ctx.task.id, title, done: false, assignee, created_at: now(), done_at: null }
  await pool.query('INSERT INTO task_subtasks (id,task_id,title,done,assignee,created_at) VALUES ($1,$2,$3,false,$4,$5)', [sub.id, sub.task_id, title, assignee, sub.created_at])
  await touch(sub.task_id); await log(sub.task_id, req.user.name, { action: 'subtask-added', field: 'Subtask', to: title })
  res.status(201).json(sub)
})

r.patch('/:id/subtasks/:sid', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [s] } = await pool.query('SELECT * FROM task_subtasks WHERE id=$1 AND task_id=$2', [req.params.sid, ctx.task.id])
  if (!s) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  const title = b.title !== undefined ? String(b.title).trim().slice(0, 300) : s.title
  if (!title) return bad(res, 'Subtask title required')
  const done = b.done !== undefined ? !!b.done : s.done
  let assignee = s.assignee
  if (b.assignee !== undefined) { assignee = await staffOnly(b.assignee || null); if (assignee === undefined) return bad(res, 'Subtasks can only be assigned to staff', 'not_staff') }
  await pool.query('UPDATE task_subtasks SET title=$1, done=$2, assignee=$3, done_at=$4 WHERE id=$5', [title, done, assignee, done ? (s.done ? s.done_at : now()) : null, s.id])
  if (done !== s.done) { await touch(s.task_id); await log(s.task_id, req.user.name, { action: done ? 'subtask-done' : 'subtask-reopened', field: 'Subtask', to: title }) }
  res.json((await pool.query('SELECT * FROM task_subtasks WHERE id=$1', [s.id])).rows[0])
})

r.delete('/:id/subtasks/:sid', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [s] } = await pool.query('DELETE FROM task_subtasks WHERE id=$1 AND task_id=$2 RETURNING title', [req.params.sid, ctx.task.id])
  if (!s) return res.status(404).json({ error: 'Not found' })
  await log(ctx.task.id, req.user.name, { action: 'subtask-removed', field: 'Subtask', from: s.title })
  res.json({ ok: true })
})

// ---------- Comments ----------

r.post('/:id/messages', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const body = String(req.body?.body || '').trim().slice(0, 10000)
  if (!body) return bad(res, 'Comment cannot be empty')
  const m = { id: randomUUID(), task_id: ctx.task.id, sender_id: req.user.id, sender_name: req.user.name, body, created_at: now() }
  await pool.query('INSERT INTO task_messages (id,task_id,sender_id,sender_name,body,created_at) VALUES ($1,$2,$3,$4,$5,$6)', Object.values(m))
  await touch(m.task_id)
  res.status(201).json(m)
})

// ---------- Attachments (Postgres, 10 MB each) ----------

r.post('/:id/attachments', express.raw({ type: () => true, limit: MAX_FILE_BYTES }), async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const body = req.body
  if (!Buffer.isBuffer(body) || !body.length) return bad(res, 'No file received')
  let filename = 'file'
  try { filename = decodeURIComponent(req.headers['x-filename'] || 'file') } catch { /* keep default */ }
  filename = filename.replace(/[\\/\r\n"]/g, '_').slice(0, 200) || 'file'
  const mime = String(req.headers['x-mime'] || 'application/octet-stream').slice(0, 100)
  const a = { id: randomUUID(), task_id: ctx.task.id, filename, mime, size: body.length, uploaded_by: req.user.id, uploaded_by_name: req.user.name, created_at: now() }
  await pool.query('INSERT INTO task_attachments (id,task_id,filename,mime,size,data,uploaded_by,uploaded_by_name,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [a.id, a.task_id, a.filename, a.mime, a.size, body, a.uploaded_by, a.uploaded_by_name, a.created_at])
  await touch(a.task_id); await log(a.task_id, req.user.name, { action: 'attached', field: 'Attachment', to: filename })
  res.status(201).json(a)
})

r.get('/:id/attachments/:aid', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [a] } = await pool.query('SELECT * FROM task_attachments WHERE id=$1 AND task_id=$2', [req.params.aid, ctx.task.id])
  if (!a) return res.status(404).json({ error: 'Not found' })
  res.set({ 'Content-Type': a.mime, 'Content-Length': a.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'X-Content-Type-Options': 'nosniff' })
  res.send(a.data)
})

r.delete('/:id/attachments/:aid', async (req, res) => {
  const ctx = await loadTask(req, res); if (!ctx) return
  const { rows: [a] } = await pool.query('DELETE FROM task_attachments WHERE id=$1 AND task_id=$2 RETURNING filename', [req.params.aid, ctx.task.id])
  if (!a) return res.status(404).json({ error: 'Not found' })
  await log(ctx.task.id, req.user.name, { action: 'attachment-removed', field: 'Attachment', from: a.filename })
  res.json({ ok: true })
})

export default r
