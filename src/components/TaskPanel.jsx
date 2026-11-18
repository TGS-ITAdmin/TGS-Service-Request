import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { api } from '../api.js'
import { notifyError } from '../lib/errors.js'
import { Avatar } from './Badge.jsx'
import { useAuth } from '../AuthContext.jsx'
import { PRIORITIES, PRIORITY_META, fmtDateTime, formatDue, DUE_TONE } from '../lib/meta.js'
import { describeRecurrence, RECUR_UNITS } from '../../shared/projects.js'
import { taskStateOf } from '../../shared/taskState.js'
import AttachmentPreview from './AttachmentPreview.jsx'
import { Field, SectionHeader, FIELD_CTRL, AttachmentItem } from './PanelParts.jsx'
import { CircleIcon, CompleteCircle, IconPlus, IconClose, IconClip } from './Icons.jsx'

function eventText(a) {
  switch (a.action) {
    case 'created': return a.to || 'created this task'
    case 'changed': return a.field === 'Description' ? 'updated the description' : `changed ${a.field} from “${a.from}” to “${a.to}”`
    case 'completed': return 'marked this task complete'
    case 'reopened': return 'marked this task incomplete'
    case 'moved': return `moved this task from “${a.from}” to “${a.to}”`
    case 'project-added': return `added this task to “${a.to}”`
    case 'project-removed': return `removed this task from “${a.from}”`
    case 'dependency-added': return `made this task wait on “${a.to}”`
    case 'dependency-removed': return `removed the dependency on “${a.from}”`
    case 'subtask-added': return `added subtask “${a.to}”`
    case 'subtask-done': return `completed subtask “${a.to}”`
    case 'subtask-reopened': return `reopened subtask “${a.to}”`
    case 'subtask-removed': return `removed subtask “${a.from}”`
    case 'attached': return `attached ${a.to}`
    case 'attachment-removed': return `removed attachment ${a.from}`
    default: return a.action
  }
}

// A custom-field control. Saves when the value is committed (blur / change), not on every keystroke.
function FieldInput({ field, value, onSave }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  const commit = (v) => { if ((v ?? '') !== (value ?? '')) onSave(v) }
  if (field.type === 'select') {
    return (
      <select aria-label={field.name} className={FIELD_CTRL} value={value ?? ''} onChange={e => onSave(e.target.value)}>
        <option value="">—</option>
        {field.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    )
  }
  return (
    <input aria-label={field.name} className={FIELD_CTRL + ' cursor-text'} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => commit(draft)}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} />
  )
}

function DependencyPicker({ taskId, onPick, onCancel }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => api.tasks.dependencyCandidates(taskId, q).then(r => live && setRows(r)).catch(() => {}), 150)
    return () => { live = false; clearTimeout(t) }
  }, [taskId, q])
  return (
    <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm">
      <input autoFocus aria-label="Find a task to wait on" className="w-full px-3 py-2 text-sm border-b border-gray-100 focus:outline-none" placeholder="Search tasks…"
        value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onCancel() }} />
      <div className="max-h-40 overflow-y-auto">
        {rows.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No matching tasks</div>}
        {rows.map(c => (
          <button key={c.id} onClick={() => onPick(c.id)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex items-center gap-2">
            <CircleIcon done={c.completed} size={14} /><span className="truncate">{c.title}</span>
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="w-full text-xs text-gray-500 py-1.5 border-t border-gray-100 hover:bg-gray-50">Cancel</button>
    </div>
  )
}

export default function TaskPanel({ taskId, version, users, projects, context, canManage, onClose, onChanged, onDeleted }) {
  const { user } = useAuth()
  const staffUsers = useMemo(() => users.filter(u => u.role !== 'requestor'), [users])
  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [descDraft, setDescDraft] = useState('')
  const [tab, setTab] = useState('all')
  const [newestFirst, setNewestFirst] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [subDraft, setSubDraft] = useState('')
  const [addingDep, setAddingDep] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewId, setPreviewId] = useState(null)
  const fileRef = useRef(null)
  const currentId = useRef(taskId)
  currentId.current = taskId

  const load = useCallback(async () => {
    try {
      const d = await api.tasks.get(taskId)
      if (currentId.current !== taskId) return
      setData(d); setTitleDraft(d.task.title); setDescDraft(d.task.description || ''); setError('')
    } catch (e) { if (currentId.current === taskId) setError(e.message) }
  }, [taskId])

  useEffect(() => { setData(null); setError(''); setAddingSub(false); setAddingDep(false); setReply(''); setPreviewId(null) }, [taskId])
  useEffect(() => { load() }, [load, version])

  const run = async (fn) => { try { await fn(); await load(); onChanged?.() } catch (e) { notifyError(e) } }
  const patch = (fields) => run(() => api.tasks.update(taskId, fields))

  const feed = useMemo(() => {
    if (!data) return []
    const items = data.messages.map(m => ({ kind: 'comment', at: m.created_at, m }))
    if (tab === 'all') data.audit.forEach(a => items.push({ kind: 'event', at: a.ts, a }))
    items.sort((x, y) => new Date(x.at) - new Date(y.at))
    return newestFirst ? items.reverse() : items
  }, [data, tab, newestFirst])

  const shell = (body) => <aside className="w-[520px] max-w-[55vw] border-l border-gray-200 bg-white flex flex-col flex-shrink-0 min-h-0" data-testid="task-panel">{body}</aside>
  if (error) return shell(<div className="p-4 flex justify-between items-center border-b border-gray-100"><span className="text-sm text-red-600">{error}</span><button onClick={onClose} className="text-gray-400 hover:text-gray-700"><IconClose /></button></div>)
  if (!data) return shell(<div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>)

  const { task: t, subtasks, attachments, blocked_by: blockedBy, blocking, projects: homes } = data
  const done = taskStateOf(t) === 'complete'
  const openBlockers = blockedBy.filter(b => !b.completed)
  const openSubtasks = subtasks.filter(s => !s.done).length
  const assignee = userById[t.assignee]
  const due = formatDue(t.due_date, done)
  const rec = t.recurrence

  const toggleComplete = () => {
    if (!done && openSubtasks > 0 && !confirm(`This task still has ${openSubtasks} incomplete subtask${openSubtasks > 1 ? 's' : ''}. Mark it complete anyway?`)) return
    patch({ completed: !done })
  }
  const sendReply = async () => {
    if (!reply.trim() || sending) return
    setSending(true)
    try { await api.tasks.addMessage(taskId, { body: reply }); setReply(''); await load(); onChanged?.() } catch (e) { notifyError(e) } finally { setSending(false) }
  }
  const addSubtask = async () => {
    const title = subDraft.trim()
    if (!title) { setAddingSub(false); return }
    setSubDraft(''); await run(() => api.tasks.addSubtask(taskId, { title }))
  }
  const handleFiles = async (list) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) { alert(`${f.name} is larger than 10 MB and was skipped.`); continue }
        await api.tasks.uploadAttachment(taskId, f)
      }
      await load(); onChanged?.()
    } catch (e) { notifyError(e) } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const otherProjects = projects.filter(p => !p.archived && !homes.some(h => h.id === p.id))

  return shell(<>
    <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-shrink-0">
      <button onClick={toggleComplete} title={!done && openBlockers.length ? `Waiting on ${openBlockers.length} task${openBlockers.length > 1 ? 's' : ''}` : undefined}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${done ? 'border-green-500 text-green-700 bg-green-50 hover:bg-green-100' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
        <CircleIcon done={done} size={16} />{done ? 'Completed' : 'Mark complete'}
      </button>
      {!done && openBlockers.length > 0 && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">Waiting on {openBlockers.length}</span>}
      <button onClick={() => { if (confirm('Delete this task from every project? This cannot be undone.')) run(() => api.tasks.delete(taskId).then(() => onDeleted?.())) }}
        className="ml-auto text-xs text-gray-400 hover:text-red-600">Delete task</button>
      <button onClick={onClose} title="Close panel" className="text-gray-400 hover:text-gray-700 p-1"><IconClose width={18} height={18} /></button>
    </div>

    <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5">
      <input aria-label="Task name" value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
        onBlur={() => { const v = titleDraft.trim(); if (!v) setTitleDraft(t.title); else if (v !== t.title) patch({ title: v }) }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
        className="w-full text-2xl font-semibold text-gray-900 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 -mx-1 py-0.5 focus:outline-none" />

      <div className="mt-4">
        <Field label="Assignee">
          <div className="flex items-center gap-2">
            {assignee && <Avatar name={assignee.name} color={assignee.color} />}
            <select aria-label="Assignee" className={FIELD_CTRL} value={t.assignee || ''} onChange={e => patch({ assignee: e.target.value || null })}>
              <option value="">Unassigned</option>
              {staffUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Due date">
          <div className="flex items-center gap-1">
            <input aria-label="Due date" type="date" className={FIELD_CTRL + ' w-auto'} value={t.due_date || ''} onChange={e => patch({ due_date: e.target.value || null })} />
            {t.due_date && <button title="Clear due date" className="text-gray-300 hover:text-gray-600" onClick={() => patch({ due_date: null })}><IconClose /></button>}
            {t.due_date && <span className={`text-xs ml-1 ${DUE_TONE[due.tone]}`}>{due.text}</span>}
          </div>
        </Field>
        <Field label="Repeats">
          <div className="flex items-center gap-2">
            <select aria-label="Repeat" className={FIELD_CTRL + ' w-auto'} value={rec?.unit || ''}
              onChange={e => patch({ recurrence: e.target.value ? { unit: e.target.value, interval: rec?.interval || 1 } : null })}>
              <option value="">Does not repeat</option>
              {RECUR_UNITS.map(u => <option key={u} value={u}>Every {u}</option>)}
            </select>
            {rec && (
              <label className="flex items-center gap-1 text-xs text-gray-500">every
                <input aria-label="Repeat interval" type="number" min="1" max="365" defaultValue={rec.interval} key={rec.interval + rec.unit}
                  className="w-14 border border-gray-300 rounded px-1 py-0.5 text-sm"
                  onBlur={e => { const n = Number(e.target.value); if (n >= 1 && n !== rec.interval) patch({ recurrence: { unit: rec.unit, interval: n } }) }} />
                {rec.unit}(s)
              </label>
            )}
          </div>
          {rec && <div className="px-2 text-[11px] text-gray-400">{describeRecurrence(rec)} — completing this task creates the next one.</div>}
        </Field>
        <Field label="Priority">
          <select aria-label="Priority" className={`rounded px-2 py-1 text-sm font-medium cursor-pointer focus:outline-none ${t.priority ? PRIORITY_META[t.priority].pill : 'bg-gray-100 text-gray-600'}`}
            value={t.priority || ''} onChange={e => patch({ priority: e.target.value || null })}>
            <option value="">None</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </Field>
        {context?.fields.map(f => (
          <Field key={f.id} label={f.name}>
            <FieldInput field={f} value={context.item?.values?.[f.id]}
              onSave={(v) => run(() => api.projects.setFieldValue(context.project.id, context.item.item_id, f.id, v))} />
          </Field>
        ))}
        <Field label="Projects">
          <div className="space-y-1">
            {homes.map(h => (
              <div key={h.id} className="flex items-center gap-2 text-sm px-2">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: h.color }} />
                <span className="truncate">{h.name}</span>
                <span className="text-xs text-gray-400">{h.section_name || 'No section'}</span>
              </div>
            ))}
            {otherProjects.length > 0 && (
              <select aria-label="Add to project" className={FIELD_CTRL + ' text-gray-500'} value="" onChange={e => e.target.value && run(() => api.tasks.addToProject(taskId, { project_id: e.target.value }))}>
                <option value="">Add to another project…</option>
                {otherProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </Field>
        <Field label="Created"><span className="px-2 text-sm text-gray-600">{fmtDateTime(t.created_at)}</span></Field>
        {t.completed_at && done && <Field label="Completed"><span className="px-2 text-sm text-gray-600">{fmtDateTime(t.completed_at)}</span></Field>}
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Description</h3>
        <textarea aria-label="Description" rows={4} value={descDraft} placeholder="What is this task about?"
          onChange={e => setDescDraft(e.target.value)} onBlur={() => { if (descDraft !== (t.description || '')) patch({ description: descDraft }) }}
          className="w-full text-sm text-gray-800 rounded-lg border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none px-2 py-1.5 resize-y" />
      </section>

      <section className="mt-6" data-testid="dependencies">
        <SectionHeader title="Dependencies" count={blockedBy.length + blocking.length}
          action={<button title="Add dependency" aria-label="Add dependency" onClick={() => setAddingDep(true)} className="text-gray-500 hover:text-gray-900"><IconPlus width={16} height={16} /></button>} />
        {blockedBy.length === 0 && blocking.length === 0 && !addingDep && <div className="text-sm text-gray-400">This task does not wait on, or block, any other task.</div>}
        {blockedBy.map(b => (
          <div key={b.id} className="group flex items-center gap-2 py-1.5 border-b border-gray-100 text-sm">
            <CircleIcon done={b.completed} size={16} />
            <span className="text-xs text-gray-400 w-20 flex-shrink-0">Waiting on</span>
            <span className={`flex-1 truncate ${b.completed ? 'text-gray-400 line-through' : ''}`}>{b.title}</span>
            <button aria-label={`Remove dependency on ${b.title}`} title="Remove" className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500" onClick={() => run(() => api.tasks.removeDependency(taskId, b.id))}><IconClose /></button>
          </div>
        ))}
        {blocking.map(b => (
          <div key={b.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 text-sm">
            <CircleIcon done={b.completed} size={16} />
            <span className="text-xs text-gray-400 w-20 flex-shrink-0">Blocking</span>
            <span className={`flex-1 truncate ${b.completed ? 'text-gray-400 line-through' : ''}`}>{b.title}</span>
          </div>
        ))}
        {addingDep && <DependencyPicker taskId={taskId} onCancel={() => setAddingDep(false)} onPick={(id) => { setAddingDep(false); run(() => api.tasks.addDependency(taskId, id)) }} />}
      </section>

      <section className="mt-7" data-testid="subtasks">
        <SectionHeader title="Subtasks" count={`${subtasks.length - openSubtasks}/${subtasks.length}`}
          action={<button title="Add subtask" aria-label="Add subtask" onClick={() => setAddingSub(true)} className="text-gray-500 hover:text-gray-900"><IconPlus width={16} height={16} /></button>} />
        {subtasks.map(s => (
          <div key={s.id} className="group flex items-center gap-2 py-1.5 border-b border-gray-100">
            <CompleteCircle done={s.done} onClick={() => run(() => api.tasks.updateSubtask(taskId, s.id, { done: !s.done }))} />
            <span className={`flex-1 text-sm ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.title}</span>
            {userById[s.assignee] && <Avatar name={userById[s.assignee].name} color={userById[s.assignee].color} />}
            <button title="Delete subtask" aria-label={`Delete subtask ${s.title}`} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500"
              onClick={() => { if (confirm('Delete this subtask?')) run(() => api.tasks.deleteSubtask(taskId, s.id)) }}><IconClose /></button>
          </div>
        ))}
        {addingSub ? (
          <input autoFocus className="mt-2 w-full text-sm border-b border-blue-400 focus:outline-none py-1" placeholder="Write a subtask name, press Enter"
            value={subDraft} onChange={e => setSubDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addSubtask(); if (e.key === 'Escape') { setAddingSub(false); setSubDraft('') } }}
            onBlur={() => { if (!subDraft.trim()) setAddingSub(false) }} />
        ) : <button className="mt-1.5 text-sm text-gray-500 hover:text-gray-800" onClick={() => setAddingSub(true)}>Add subtask</button>}
      </section>

      <section className="mt-7" data-testid="attachments">
        <SectionHeader title="Attachments" count={attachments.length} action={<>
          <input ref={fileRef} type="file" multiple className="hidden" data-testid="file-input" onChange={e => handleFiles(e.target.files)} />
          <button title="Attach files" aria-label="Attach files" disabled={uploading} onClick={() => fileRef.current?.click()} className="text-gray-500 hover:text-gray-900 disabled:opacity-40 flex items-center gap-1">
            {uploading ? <span className="text-xs">Uploading…</span> : <IconClip width={16} height={16} />}
          </button>
        </>} />
        {attachments.length === 0 && <div className="text-sm text-gray-400">No attachments. Files can be up to 10 MB.</div>}
        {attachments.map(a => (
          <AttachmentItem key={a.id} scope="tasks" ticketId={taskId} a={a} onOpen={() => setPreviewId(a.id)} canDelete
            onDelete={() => { if (confirm(`Remove ${a.filename}?`)) run(() => api.tasks.deleteAttachment(taskId, a.id)) }} />
        ))}
      </section>

      <section className="mt-8 pb-4" data-testid="activity">
        <div className="flex items-center border-b border-gray-200 mb-3">
          {[['comments', 'Comments'], ['all', 'All activity']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{label}</button>
          ))}
          <button onClick={() => setNewestFirst(n => !n)} className="ml-auto text-xs text-gray-500 hover:text-gray-800">⇅ {newestFirst ? 'Newest' : 'Oldest'}</button>
        </div>
        <div className="space-y-3">
          {feed.length === 0 && <div className="text-sm text-gray-400">No {tab === 'comments' ? 'comments' : 'activity'} yet.</div>}
          {feed.map(item => item.kind === 'event' ? (
            <div key={'a' + item.a.id} className="text-xs text-gray-500 pl-1"><strong className="text-gray-700">{item.a.actor}</strong> {eventText(item.a)} · {fmtDateTime(item.at)}</div>
          ) : (
            <div key={'m' + item.m.id} className="flex gap-3">
              <Avatar name={item.m.sender_name} color={userById[item.m.sender_id]?.color || '#2563eb'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2"><span className="text-sm font-semibold text-gray-900">{item.m.sender_name}</span><span className="text-xs text-gray-400">{fmtDateTime(item.m.created_at)}</span></div>
                <div className="mt-1 text-sm whitespace-pre-wrap rounded-lg px-3 py-2 bg-gray-50 text-gray-800">{item.m.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>

    <div className="border-t border-gray-200 px-5 py-3 flex-shrink-0 bg-white">
      <textarea aria-label="Add a comment" rows={2} placeholder="Add a comment…" value={reply} onChange={e => setReply(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply() }}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      <div className="flex justify-end mt-2"><button className="btn-primary py-1.5" disabled={sending || !reply.trim()} onClick={sendReply}>{sending ? 'Sending…' : 'Comment'}</button></div>
    </div>
    {previewId && <AttachmentPreview scope="tasks" ticketId={taskId} items={attachments} startId={previewId} onClose={() => setPreviewId(null)} />}
  </>)
}
