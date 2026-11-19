import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api.js'
import { notifyError } from '../lib/errors.js'
import { Avatar } from '../components/Badge.jsx'
import TaskPanel from '../components/TaskPanel.jsx'
import TicketPanel from '../components/TicketPanel.jsx'
import { MembersDialog, SettingsDialog, AddTicketDialog } from '../components/ProjectDialogs.jsx'
import { CompleteCircle, CircleIcon, IconList, IconBoard, IconPlus, IconSubtask, IconClip, IconComment } from '../components/Icons.jsx'
import { useAuth } from '../AuthContext.jsx'
import { StarButton } from '../components/StarButton.jsx'
import { PRIORITY_META, formatDue, DUE_TONE } from '../lib/meta.js'
import { itemsIn, positionFor, applyMove, progress, fieldDisplay, filterItems } from '../lib/projects.js'
import { PRIVACY_LABEL, canManageProject } from '../../shared/projects.js'

const stop = (e) => e.stopPropagation()

function Chips({ it }) {
  return (
    <>
      {it.kind === 'ticket' && <span className="text-[11px] font-mono text-blue-700 bg-blue-50 rounded px-1.5 flex-shrink-0" title="Service request">🎫 #{it.num}</span>}
      {it.recurrence && <span title="Repeats" className="text-xs text-gray-400">↻</span>}
      {it.blocked && !it.done && <span title="Waiting on another task" className="text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 flex-shrink-0">Blocked</span>}
      {it.subtask_total > 0 && <span title="Subtasks" className="inline-flex items-center gap-0.5 text-xs text-gray-400 flex-shrink-0"><IconSubtask width={13} height={13} />{it.subtask_done}/{it.subtask_total}</span>}
      {it.comment_count > 0 && <span title="Comments" className="inline-flex items-center gap-0.5 text-xs text-gray-400 flex-shrink-0"><IconComment width={13} height={13} />{it.comment_count}</span>}
      {it.attachment_count > 0 && <span title="Attachments" className="inline-flex items-center gap-0.5 text-xs text-gray-400 flex-shrink-0"><IconClip width={13} height={13} />{it.attachment_count}</span>}
    </>
  )
}

function Circle({ it, onToggle }) {
  if (it.kind === 'ticket') return <span title="Tickets are completed from their status in the ticket panel" className="flex-shrink-0"><CircleIcon done={it.done} /></span>
  return <CompleteCircle done={it.done} onClick={(e) => { stop(e); onToggle(it) }} />
}

// ------------------------------------------------------------------ List view
function ListView({ data, items, userById, selectedId, onSelect, onToggle, onAddTask, onMove, canManage, onRenameSection, onDeleteSection, onAddSection }) {
  const { sections, fields } = data
  const [collapsed, setCollapsed] = useState({})
  const [drafts, setDrafts] = useState({})
  const [dragId, setDragId] = useState(null)
  const cols = `28px minmax(220px,1fr) 120px 100px 90px ${fields.map(() => '120px').join(' ')}`.trim()
  const groups = [...sections.map(s => ({ id: s.id, name: s.name })), ...(items.some(i => !i.section_id) ? [{ id: null, name: 'No section' }] : [])]

  const drop = (sectionId, beforeId) => {
    if (!dragId) return
    const list = itemsIn(data.items, sectionId).filter(i => i.item_id !== dragId)
    onMove(dragId, sectionId, positionFor(list, beforeId)); setDragId(null)
  }

  return (
    <div className="min-w-fit">
      <div className="grid text-xs font-medium text-gray-500 px-4 py-2 border-b border-gray-200 bg-gray-50 sticky top-0 z-10" style={{ gridTemplateColumns: cols }}>
        <span /><span>Name</span><span>Assignee</span><span>Due date</span><span>Priority</span>
        {fields.map(f => <span key={f.id} className="truncate">{f.name}</span>)}
      </div>
      {groups.map(g => {
        const rows = itemsIn(items, g.id)
        const isCollapsed = collapsed[g.id ?? 'none']
        return (
          <section key={g.id ?? 'none'} aria-label={g.name} onDragOver={e => dragId && e.preventDefault()} onDrop={() => drop(g.id, null)}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-white">
              <button aria-label={isCollapsed ? `Expand ${g.name}` : `Collapse ${g.name}`} className="text-gray-400 w-5" onClick={() => setCollapsed(c => ({ ...c, [g.id ?? 'none']: !isCollapsed }))}>{isCollapsed ? '▸' : '▾'}</button>
              {canManage && g.id ? (
                <input aria-label={`Section name ${g.name}`} defaultValue={g.name} className="font-semibold text-sm bg-transparent rounded px-1 border border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none"
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== g.name) onRenameSection(g.id, v); else e.target.value = g.name }} onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
              ) : <span className="font-semibold text-sm px-1">{g.name}</span>}
              <span className="text-xs text-gray-400">{rows.length}</span>
              {canManage && g.id && <button className="ml-auto text-xs text-gray-300 hover:text-red-500" aria-label={`Delete section ${g.name}`} onClick={() => { if (confirm(`Delete the section “${g.name}”? Its tasks move to another section.`)) onDeleteSection(g.id) }}>Delete section</button>}
            </div>
            {!isCollapsed && <>
              {rows.map(it => {
                const due = formatDue(it.due_date, it.done)
                const a = userById[it.assignee]
                return (
                  <div key={it.item_id} role="row" tabIndex={0} draggable onDragStart={() => setDragId(it.item_id)} onDragEnd={() => setDragId(null)}
                    onDragOver={e => dragId && dragId !== it.item_id && e.preventDefault()} onDrop={e => { e.stopPropagation(); drop(g.id, it.item_id) }}
                    onClick={() => onSelect(it.item_id)} onKeyDown={e => { if (e.key === 'Enter') onSelect(it.item_id) }}
                    className={`grid items-center gap-0 px-4 py-1.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedId === it.item_id ? 'bg-blue-50' : ''}`} style={{ gridTemplateColumns: cols }}>
                    <Circle it={it} onToggle={onToggle} />
                    <div className="flex items-center gap-2 min-w-0 pr-3">
                      <span className={`text-sm truncate ${it.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.title}</span><Chips it={it} />
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">{a ? <><Avatar name={a.name} color={a.color} /><span className="text-xs text-gray-600 truncate">{a.name.split(' ')[0]}</span></> : <span className="text-gray-300">—</span>}</div>
                    <span className={`text-sm ${DUE_TONE[due.tone]}`}>{due.text}</span>
                    <span>{it.priority ? <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${PRIORITY_META[it.priority].pill}`}>{PRIORITY_META[it.priority].label}</span> : null}</span>
                    {fields.map(f => <span key={f.id} className="text-sm text-gray-700 truncate pr-2">{fieldDisplay(f, it.values[f.id])}</span>)}
                  </div>
                )
              })}
              <div className="px-4 py-1.5 border-b border-gray-100">
                <input aria-label={`Add task to ${g.name}`} className="w-full text-sm bg-transparent focus:outline-none placeholder-gray-400 pl-9" placeholder="Add task…"
                  value={drafts[g.id ?? 'none'] || ''} onChange={e => setDrafts(d => ({ ...d, [g.id ?? 'none']: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { const v = (drafts[g.id ?? 'none'] || '').trim(); if (v) { onAddTask(v, g.id); setDrafts(d => ({ ...d, [g.id ?? 'none']: '' })) } } }} />
              </div>
            </>}
          </section>
        )
      })}
      {canManage && <div className="px-4 py-3"><button className="text-sm text-gray-500 hover:text-gray-900 inline-flex items-center gap-1" onClick={onAddSection}><IconPlus width={14} height={14} /> Add section</button></div>}
    </div>
  )
}

// ------------------------------------------------------------------ Board view
function BoardView({ data, items, userById, selectedId, onSelect, onToggle, onAddTask, onMove, canManage, onAddSection }) {
  const { sections } = data
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)
  const [drafts, setDrafts] = useState({})
  const columns = [...sections.map(s => ({ id: s.id, name: s.name })), ...(items.some(i => !i.section_id) ? [{ id: null, name: 'No section' }] : [])]

  const drop = (sectionId, beforeId) => {
    setOver(null)
    if (!dragId) return
    const list = itemsIn(data.items, sectionId).filter(i => i.item_id !== dragId)
    onMove(dragId, sectionId, positionFor(list, beforeId)); setDragId(null)
  }

  return (
    <div className="flex gap-4 p-4 h-full overflow-x-auto items-start">
      {columns.map(c => {
        const rows = itemsIn(items, c.id)
        return (
          <section key={c.id ?? 'none'} aria-label={c.name} data-testid={`column-${c.name}`}
            onDragOver={e => { if (dragId) { e.preventDefault(); setOver(c.id ?? 'none') } }} onDragLeave={() => setOver(null)} onDrop={() => drop(c.id, null)}
            className={`w-72 flex-shrink-0 rounded-xl bg-gray-100 p-2 max-h-full flex flex-col ${over === (c.id ?? 'none') ? 'ring-2 ring-blue-300' : ''}`}>
            <div className="flex items-center gap-2 px-2 py-1.5"><span className="font-semibold text-sm">{c.name}</span><span className="text-xs text-gray-500">{rows.length}</span></div>
            <div className="overflow-y-auto space-y-2 px-0.5 py-0.5">
              {rows.map(it => {
                const due = formatDue(it.due_date, it.done); const a = userById[it.assignee]
                return (
                  <div key={it.item_id} role="button" tabIndex={0} draggable onDragStart={() => setDragId(it.item_id)} onDragEnd={() => { setDragId(null); setOver(null) }}
                    onDragOver={e => dragId && dragId !== it.item_id && e.preventDefault()} onDrop={e => { e.stopPropagation(); drop(c.id, it.item_id) }}
                    onClick={() => onSelect(it.item_id)} onKeyDown={e => e.key === 'Enter' && onSelect(it.item_id)}
                    className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer hover:shadow ${selectedId === it.item_id ? 'border-blue-400' : 'border-gray-200'}`}>
                    <div className="flex items-start gap-2">
                      <Circle it={it} onToggle={onToggle} />
                      <span className={`text-sm flex-1 ${it.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap"><Chips it={it} />
                      {it.priority && <span className={`text-[11px] rounded px-1.5 font-medium ${PRIORITY_META[it.priority].pill}`}>{PRIORITY_META[it.priority].label}</span>}
                    </div>
                    <div className="flex items-center justify-between mt-2 min-h-[20px]">
                      <span className={`text-xs ${DUE_TONE[due.tone]}`}>{due.text}</span>
                      {a && <Avatar name={a.name} color={a.color} />}
                    </div>
                  </div>
                )
              })}
            </div>
            <input aria-label={`Add task to ${c.name}`} className="mt-2 mx-1 text-sm bg-transparent rounded px-2 py-1.5 hover:bg-white focus:bg-white focus:outline-none placeholder-gray-500" placeholder="+ Add task"
              value={drafts[c.id ?? 'none'] || ''} onChange={e => setDrafts(d => ({ ...d, [c.id ?? 'none']: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { const v = (drafts[c.id ?? 'none'] || '').trim(); if (v) { onAddTask(v, c.id); setDrafts(d => ({ ...d, [c.id ?? 'none']: '' })) } } }} />
          </section>
        )
      })}
      {canManage && <button onClick={onAddSection} className="w-56 flex-shrink-0 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:text-gray-800 hover:border-gray-400 py-3">+ Add section</button>}
    </div>
  )
}

// ------------------------------------------------------------------ Project screen
export default function ProjectView({ projectId, onBack, onDeleted, onProjectsChanged }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [view, setView] = useState(() => { try { return localStorage.getItem('hd_project_view') || 'list' } catch { return 'list' } })
  const [selectedId, setSelectedId] = useState(null)       // project item id
  const [version, setVersion] = useState(0)
  const [dialog, setDialog] = useState(null)               // 'members' | 'settings' | 'ticket'
  const [filter, setFilter] = useState({ q: '', assignee: '', hideDone: false })

  const load = useCallback(async () => {
    try { const d = await api.projects.get(projectId); setData(d); setError('') } catch (e) { setError(e.message) }
  }, [projectId])
  useEffect(() => { setData(null); setSelectedId(null); load() }, [load])
  useEffect(() => {
    api.users.list().then(setUsers).catch(() => {})
    api.departments.list().then(setDepartments).catch(() => {})
    api.projects.list().then(setProjects).catch(() => {})
  }, [])
  useEffect(() => { try { localStorage.setItem('hd_project_view', view) } catch { /* private mode */ } }, [view])

  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const changed = useCallback(() => { setVersion(v => v + 1); load(); onProjectsChanged?.() }, [load, onProjectsChanged])

  if (error) return <div className="p-8"><button className="text-sm text-blue-600 mb-3" onClick={onBack}>← Projects</button><div className="card p-6 text-sm text-red-600">{error}</div></div>
  if (!data) return <div className="p-8 text-gray-400">Loading…</div>

  const { project, items: allItems } = data
  const canManage = canManageProject(user, data.my_role)
  const items = filterItems(allItems, filter)
  const selected = allItems.find(i => i.item_id === selectedId) || null
  const prog = progress(allItems)
  const ticketIds = new Set(allItems.filter(i => i.kind === 'ticket').map(i => i.id))

  const toggle = async (it) => {
    setData(d => ({ ...d, items: d.items.map(x => x.item_id === it.item_id ? { ...x, done: !it.done } : x) }))     // instant feedback
    try { await api.tasks.update(it.id, { completed: !it.done }) } catch (e) { notifyError(e) }
    changed()
  }
  const addTask = async (title, sectionId) => { try { await api.projects.addTask(project.id, { title, section_id: sectionId }); changed() } catch (e) { notifyError(e) } }
  const move = async (itemId, sectionId, position) => {
    setData(d => ({ ...d, items: applyMove(d.items, itemId, sectionId, position) }))
    try { await api.projects.moveItem(project.id, itemId, { section_id: sectionId, position }) } catch (e) { notifyError(e) }
    load()
  }
  const run = (fn) => async (...a) => { try { await fn(...a); changed() } catch (e) { notifyError(e) } }
  const addSection = () => { const name = prompt('Section name'); if (name?.trim()) run(() => api.projects.addSection(project.id, name.trim()))() }

  const common = { data, items, userById, selectedId, onSelect: setSelectedId, onToggle: toggle, onAddTask: addTask, onMove: move, canManage, onAddSection: addSection }

  return (
    <div className="flex h-full" data-testid="project-view">
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="px-6 pt-4 pb-0 bg-white border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-900" aria-label="Back to projects">← Projects</button>
            <span className="w-3 h-3 rounded-sm" style={{ background: project.color }} />
            <h1 className="text-xl font-semibold truncate">{project.name}</h1>
            <StarButton on={data.is_favorite} name={project.name} onToggle={async () => { try { await api.projects.setFavorite(project.id, !data.is_favorite); changed() } catch (e) { notifyError(e) } }} />
            {project.archived && <span className="text-xs bg-gray-200 text-gray-600 rounded px-2 py-0.5">Archived</span>}
            <span className="text-xs text-gray-400 hidden md:inline">{PRIVACY_LABEL[project.privacy]}</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setDialog('members')} className="flex -space-x-2" aria-label="Members" title="Members">
                {data.members.slice(0, 4).map(m => <span key={m.id} className="ring-2 ring-white rounded-full"><Avatar name={m.name} color={m.color} /></span>)}
                {data.members.length > 4 && <span className="w-7 h-7 rounded-full bg-gray-200 text-xs flex items-center justify-center ring-2 ring-white">+{data.members.length - 4}</span>}
              </button>
              <button className="btn-secondary py-1.5" onClick={() => setDialog('members')}>Members</button>
              <button className="btn-secondary py-1.5" onClick={() => setDialog('ticket')}>Add service request</button>
              {canManage && <button className="btn-secondary py-1.5" onClick={() => setDialog('settings')}>Settings</button>}
            </div>
          </div>
          {project.description && <p className="text-sm text-gray-500 mt-1 ml-14 max-w-3xl truncate">{project.description}</p>}
          <div className="flex items-center gap-4 mt-3">
            <div role="tablist" className="flex">
              {[['list', 'List', IconList], ['board', 'Board', IconBoard]].map(([k, label, Icon]) => (
                <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${view === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}><Icon />{label}</button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 pb-1.5">
              <span className="text-xs text-gray-500 mr-2">{prog.done} of {prog.total} complete</span>
              <input aria-label="Search this project" className="text-sm border border-gray-300 rounded-lg px-2.5 py-1 w-44" placeholder="Search…" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
              <select aria-label="Filter by assignee" className="text-sm border border-gray-300 rounded-lg px-2 py-1" value={filter.assignee} onChange={e => setFilter(f => ({ ...f, assignee: e.target.value }))}>
                <option value="">Everyone</option><option value="none">Unassigned</option>
                {data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <label className="text-sm text-gray-600 flex items-center gap-1"><input type="checkbox" checked={filter.hideDone} onChange={e => setFilter(f => ({ ...f, hideDone: e.target.checked }))} /> Hide completed</label>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-white">
          {view === 'list'
            ? <ListView {...common} onRenameSection={(id, name) => run(() => api.projects.updateSection(project.id, id, { name }))()} onDeleteSection={(id) => run(() => api.projects.deleteSection(project.id, id))()} />
            : <BoardView {...common} />}
          {allItems.length === 0 && <div className="text-center text-gray-400 text-sm py-10">No tasks yet. Type a name under “Add task…” to create the first one.</div>}
        </div>
      </div>

      {selected?.kind === 'task' && (
        <TaskPanel key={selected.id} taskId={selected.id} version={version} users={users} projects={projects}
          context={{ project, fields: data.fields, item: selected }} canManage={canManage}
          onClose={() => setSelectedId(null)} onChanged={changed} onDeleted={() => { setSelectedId(null); changed() }} />
      )}
      {selected?.kind === 'ticket' && (
        <TicketPanel ticketId={selected.id} version={version} users={users} departments={departments} onClose={() => setSelectedId(null)} onChanged={changed} />
      )}

      {dialog === 'members' && <MembersDialog project={project} members={data.members} users={users} me={user} canManage={canManage} onClose={() => setDialog(null)}
        onChanged={() => { changed() }} />}
      {dialog === 'settings' && <SettingsDialog project={project} fields={data.fields} onClose={() => setDialog(null)} onChanged={changed} onDeleted={() => { setDialog(null); onDeleted() }} />}
      {dialog === 'ticket' && <AddTicketDialog project={project} existingTicketIds={ticketIds} sections={data.sections} onClose={() => setDialog(null)} onAdded={() => { setDialog(null); changed() }} />}
    </div>
  )
}
