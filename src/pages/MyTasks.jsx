import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../api.js'
import { notifyError } from '../lib/errors.js'
import TaskPanel from '../components/TaskPanel.jsx'
import TicketPanel from '../components/TicketPanel.jsx'
import { CompleteCircle, CircleIcon } from '../components/Icons.jsx'
import { PRIORITY_META, formatDue, DUE_TONE, STATUS_META } from '../lib/meta.js'
import { groupMyTasks, todayLocal, itemKey } from '../lib/myTasks.js'

export default function MyTasks({ onProjectsChanged }) {
  const [items, setItems] = useState(null)
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)       // itemKey
  const [version, setVersion] = useState(0)
  const [collapsed, setCollapsed] = useState({ done: true })

  const load = useCallback(() => api.tasks.mine().then(setItems).catch(e => { notifyError(e); setItems(p => p ?? []) }), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.users.list().then(setUsers).catch(() => {})
    api.departments.list().then(setDepartments).catch(() => {})
    api.projects.list().then(setProjects).catch(() => {})
  }, [])

  const changed = () => { setVersion(v => v + 1); load(); onProjectsChanged?.() }
  const today = todayLocal()
  const groups = useMemo(() => groupMyTasks(items || [], today, { kind, q }), [items, today, kind, q])
  const sel = (items || []).find(i => itemKey(i) === selected) || null

  const toggle = async (it) => {
    setItems(list => list.map(x => x === it ? { ...x, done: !x.done } : x))
    try { await api.tasks.update(it.id, { completed: !it.done }) } catch (e) { notifyError(e) }
    changed()
  }

  return (
    <div className="flex h-full" data-testid="my-tasks">
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="px-8 pt-6 pb-3 bg-white border-b border-gray-200 flex-shrink-0">
          <h1 className="text-2xl font-bold text-gray-900">My tasks</h1>
          <p className="text-sm text-gray-500">Everything assigned to you across all projects, including service requests.</p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <div role="tablist" className="flex gap-1">
              {[['all', 'All'], ['task', 'Tasks'], ['ticket', 'Tickets']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                  className={`px-3 py-1 text-sm rounded-full border ${kind === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
            <input aria-label="Search my tasks" className="ml-auto text-sm border border-gray-300 rounded-lg px-2.5 py-1 w-56" placeholder="Search tasks, #number, project…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-white">
          {items === null && <div className="p-8 text-gray-400">Loading…</div>}
          {items && groups.length === 0 && (
            <div className="p-12 text-center text-gray-500"><div className="text-3xl mb-2">✅</div>
              <div className="font-medium text-gray-800">{items.length ? 'Nothing matches' : 'Nothing is assigned to you'}</div>
              <p className="text-sm mt-1">{items.length ? 'Try a different search or filter.' : 'Tasks and tickets assigned to you will show up here.'}</p></div>
          )}
          {groups.map(g => {
            const closed = collapsed[g.id]
            return (
              <section key={g.id} aria-label={g.label}>
                <button className="w-full flex items-center gap-2 px-6 py-2 border-b border-gray-100 bg-gray-50 text-left" aria-expanded={!closed}
                  onClick={() => setCollapsed(c => ({ ...c, [g.id]: !closed }))}>
                  <span className="text-gray-400 w-4">{closed ? '▸' : '▾'}</span>
                  <span className={`font-semibold text-sm ${g.id === 'overdue' ? 'text-red-600' : 'text-gray-800'}`}>{g.label}</span>
                  <span className="text-xs text-gray-400">{g.items.length}</span>
                </button>
                {!closed && g.items.map(it => {
                  const due = formatDue(it.due_date, it.done)
                  return (
                    <div key={itemKey(it)} role="row" tabIndex={0} onClick={() => setSelected(itemKey(it))} onKeyDown={e => e.key === 'Enter' && setSelected(itemKey(it))}
                      className={`flex items-center gap-3 px-6 py-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selected === itemKey(it) ? 'bg-blue-50' : ''}`}>
                      {it.kind === 'task'
                        ? <CompleteCircle done={it.done} onClick={(e) => { e.stopPropagation(); toggle(it) }} />
                        : <span title="Tickets are completed from their status in the ticket panel" className="flex-shrink-0"><CircleIcon done={it.done} /></span>}
                      {it.kind === 'ticket' && <span className="text-[11px] font-mono text-blue-700 bg-blue-50 rounded px-1.5 flex-shrink-0">🎫 #{it.num}</span>}
                      <span className={`text-sm truncate ${it.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.title}</span>
                      {it.blocked && !it.done && <span className="text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 flex-shrink-0">Blocked</span>}
                      {it.subtask_total > 0 && <span className="text-xs text-gray-400 flex-shrink-0">{it.subtask_done}/{it.subtask_total}</span>}
                      <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                        {it.projects.slice(0, 2).map(p => (
                          <span key={p.id} className="inline-flex items-center gap-1 text-xs text-gray-600 bg-gray-100 rounded px-1.5 py-0.5 max-w-[140px]">
                            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: p.color }} /><span className="truncate">{p.name}</span></span>
                        ))}
                        {it.projects.length > 2 && <span className="text-xs text-gray-400">+{it.projects.length - 2}</span>}
                        {it.kind === 'ticket' && <span className={`text-xs rounded px-1.5 py-0.5 ${STATUS_META[it.status].pill}`}>{STATUS_META[it.status].label}</span>}
                        {it.priority && <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${PRIORITY_META[it.priority].pill}`}>{PRIORITY_META[it.priority].label}</span>}
                        <span className={`text-sm w-20 text-right ${DUE_TONE[due.tone]}`}>{due.text}</span>
                      </span>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>

      {sel?.kind === 'task' && <TaskPanel key={sel.id} taskId={sel.id} version={version} users={users} projects={projects} onClose={() => setSelected(null)} onChanged={changed} onDeleted={() => { setSelected(null); changed() }} />}
      {sel?.kind === 'ticket' && <TicketPanel ticketId={sel.id} version={version} users={users} departments={departments} onClose={() => setSelected(null)} onChanged={changed} />}
    </div>
  )
}
