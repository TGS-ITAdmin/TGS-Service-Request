import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '../api.js'
import { Avatar } from '../components/Badge.jsx'
import TicketPanel from '../components/TicketPanel.jsx'
import { useAuth, isStaff, canEditTicket } from '../AuthContext.jsx'
import { PRIORITIES, PRIORITY_META, STATUSES, STATUS_META, isDone, formatDue, DUE_TONE } from '../lib/meta.js'
import { CompleteCircle, IconClip, IconComment, IconSubtask, IconPlus, IconList, IconBoard, IconFilter } from '../components/Icons.jsx'

const stop = (e) => e.stopPropagation()

const SORTS = {
  newest:   { label: 'Newest first',  fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  oldest:   { label: 'Oldest first',  fn: (a, b) => new Date(a.created_at) - new Date(b.created_at) },
  due:      { label: 'Due date',      fn: (a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : 0 },
  priority: { label: 'Priority',      fn: (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) },
  updated:  { label: 'Last updated',  fn: (a, b) => new Date(b.updated_at) - new Date(a.updated_at) },
  number:   { label: 'Ticket number', fn: (a, b) => b.num - a.num },
}

// Native <select> laid invisibly over a visual cell: looks like Asana, behaves like a dropdown.
function CellSelect({ label, value, onChange, children }) {
  return (
    <select aria-label={label} value={value} onClick={stop} onChange={e => onChange(e.target.value)}
      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
      {children}
    </select>
  )
}

function DueCell({ ticket, canEdit, onChange }) {
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  const done = isDone(ticket.status)
  const { text, tone } = formatDue(ticket.due_date, done)
  useEffect(() => { if (editing) { try { ref.current?.showPicker?.() } catch { /* needs user gesture */ } } }, [editing])
  if (editing) {
    return (
      <input ref={ref} autoFocus type="date" aria-label="Due date" defaultValue={ticket.due_date || ''}
        className="text-sm border border-blue-400 rounded px-1 py-0.5 w-[110px]"
        onClick={stop} onBlur={() => setEditing(false)}
        onChange={e => { onChange(e.target.value || null); setEditing(false) }} />
    )
  }
  return (
    <button type="button" onClick={e => { stop(e); if (canEdit) setEditing(true) }}
      className={`text-sm text-left rounded px-1 -mx-1 ${canEdit ? 'hover:bg-gray-100' : 'cursor-default'} ${DUE_TONE[tone]}`}>
      {text || (canEdit ? <span className="text-gray-300">—</span> : '')}
    </button>
  )
}

function CountChip({ icon: Icon, children, title }) {
  return <span title={title} className="inline-flex items-center gap-0.5 text-xs text-gray-400 flex-shrink-0"><Icon width={13} height={13} />{children}</span>
}

function ticketCounts(t, staff) {
  return (
    <>
      {staff && t.subtask_total > 0 && <CountChip icon={IconSubtask} title="Subtasks done / total">{t.subtask_done}/{t.subtask_total}</CountChip>}
      {t.comment_count > 0 && <CountChip icon={IconComment} title="Comments">{t.comment_count}</CountChip>}
      {t.attachment_count > 0 && <CountChip icon={IconClip} title="Attachments">{t.attachment_count}</CountChip>}
    </>
  )
}

export default function TicketsWorkspace({ selectedId, onSelect, onNew, refreshKey }) {
  const { user } = useAuth()
  const staff = isStaff(user)
  const canEdit = canEditTicket(user)

  const [tickets, setTickets] = useState([])
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)       // bumps when the list edits a ticket so the open panel reloads
  const [view, setView] = useState('list')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({ status: 'all', priority: '', dept: '', assignee: '' })
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [groupBy, setGroupBy] = useState('none')
  const [collapsed, setCollapsed] = useState(new Set())
  const [dragOver, setDragOver] = useState(null)

  const loadTickets = useCallback(async () => {
    try { setTickets(await api.tickets.list()) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadTickets() }, [loadTickets, refreshKey])
  useEffect(() => {
    api.departments.list().then(setDepartments).catch(() => {})
    if (staff) api.users.list().then(setUsers).catch(() => setUsers([]))
  }, [staff])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !selectedId) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, onSelect])

  const confirmIncomplete = (t) => {
    const open = (t.subtask_total || 0) - (t.subtask_done || 0)
    return open <= 0 || confirm(`This ticket still has ${open} incomplete subtask${open > 1 ? 's' : ''}. Mark it complete anyway?`)
  }

  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const deptById = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d])), [departments])

  const update = async (t, fields) => {
    setTickets(ts => ts.map(x => x.id === t.id ? { ...x, ...fields } : x))      // optimistic
    try {
      await api.tickets.update(t.id, fields)
      await loadTickets()
      setVersion(v => v + 1)
    } catch (e) { alert(e.message); await loadTickets() }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = tickets.filter(t => {
      const done = isDone(t.status)
      if (filters.status === 'incomplete' && done) return false
      if (filters.status === 'completed' && !done) return false
      if (STATUSES.includes(filters.status) && t.status !== filters.status) return false
      if (filters.priority && t.priority !== filters.priority) return false
      if (filters.dept && t.dept !== filters.dept) return false
      if (filters.assignee === 'none' && t.assignee) return false
      if (filters.assignee && filters.assignee !== 'none' && t.assignee !== filters.assignee) return false
      if (q && !`${t.title} ${t.req_name} ${t.req_email} ${t.num} ${t.category || ''}`.toLowerCase().includes(q)) return false
      return true
    })
    return list.sort(SORTS[sortBy].fn)
  }, [tickets, filters, search, sortBy])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, items: visible }]
    const defs = {
      status:   () => STATUSES.map(s => ({ key: s, label: STATUS_META[s].label, items: visible.filter(t => t.status === s) })),
      priority: () => PRIORITIES.map(p => ({ key: p, label: PRIORITY_META[p].label, items: visible.filter(t => t.priority === p) })),
      dept:     () => [...departments.map(d => ({ key: d.id, label: d.name, items: visible.filter(t => t.dept === d.id) })),
                       { key: 'none', label: 'No department', items: visible.filter(t => !t.dept || !deptById[t.dept]) }],
      assignee: () => [...users.filter(u => u.role !== 'requestor').map(u => ({ key: u.id, label: u.name, items: visible.filter(t => t.assignee === u.id) })),
                       { key: 'none', label: 'Unassigned', items: visible.filter(t => !t.assignee || !userById[t.assignee]) }],
    }
    return defs[groupBy]().filter(g => g.items.length > 0)
  }, [visible, groupBy, departments, users, deptById, userById])

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v && v !== 'all').length
  const cols = staff
    ? 'minmax(320px,1fr) 190px 115px 160px 90px 170px 170px'
    : 'minmax(320px,1fr) 115px 160px 90px 170px 170px'

  const renderRow = (t) => {
    const done = isDone(t.status)
    const assignee = userById[t.assignee]
    const dept = deptById[t.dept]
    const pr = PRIORITY_META[t.priority] || PRIORITY_META.medium
    return (
      <div
        key={t.id}
        role="row" data-testid="ticket-row" data-ticket-id={t.id}
        onClick={() => onSelect(t.id)}
        className={`grid items-center border-b border-gray-100 cursor-pointer text-sm group ${selectedId === t.id ? 'bg-blue-50' : 'hover:bg-gray-50'} ${done ? 'text-gray-400' : 'text-gray-900'}`}
        style={{ gridTemplateColumns: cols, minHeight: 38 }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
          <span onClick={stop}>
            <CompleteCircle done={done} disabled={!canEdit} title={canEdit ? (done ? 'Mark incomplete' : 'Mark complete') : STATUS_META[t.status]?.label}
              onClick={() => { if (!done && !confirmIncomplete(t)) return; update(t, { status: done ? 'open' : 'resolved' }) }} />
          </span>
          <span className="truncate" title={t.title}>{t.title}</span>
          <span className="flex items-center gap-2 ml-1">{ticketCounts(t, staff)}</span>
        </div>

        {staff && (
          <div className="relative px-2 py-1.5 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {assignee ? <><Avatar name={assignee.name} color={assignee.color} /><span className="truncate text-sm">{assignee.name}</span></>
                : <span className="text-gray-300 text-sm">Unassigned</span>}
            </div>
            {canEdit && (
              <CellSelect label="Assignee" value={t.assignee || ''} onChange={v => update(t, { assignee: v || null })}>
                <option value="">Unassigned</option>
                {users.filter(u => u.role !== 'requestor').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </CellSelect>
            )}
          </div>
        )}

        <div className="px-2 py-1.5"><DueCell ticket={t} canEdit={canEdit} onChange={v => update(t, { due_date: v })} /></div>

        <div className="relative px-2 py-1.5 min-w-0">
          <span className={`block truncate rounded px-2 py-0.5 text-xs font-medium ${pr.pill} ${done ? 'opacity-50' : ''}`}>{pr.desc}</span>
          {canEdit && (
            <CellSelect label="Priority" value={t.priority} onChange={v => update(t, { priority: v })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].desc}</option>)}
            </CellSelect>
          )}
        </div>

        <div className="px-2 py-1.5 text-gray-500 font-mono text-xs">{t.num}</div>

        <div className="relative px-2 py-1.5 min-w-0">
          {dept
            ? <span className="inline-block max-w-full truncate rounded px-2 py-0.5 text-xs font-medium text-gray-900" style={{ backgroundColor: dept.color + '40' }}>{dept.name}</span>
            : <span className="text-gray-300">—</span>}
          {canEdit && (
            <CellSelect label="Department" value={t.dept || ''} onChange={v => update(t, { dept: v || null, category: null })}>
              <option value="">None</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </CellSelect>
          )}
        </div>

        <div className="px-2 py-1.5 min-w-0">
          <div className="truncate text-sm">{t.req_name}</div>
        </div>
      </div>
    )
  }

  const headers = staff
    ? ['Name', 'Assignee', 'Due date', 'Priority', 'Service Req. #', 'Department', 'Requestor']
    : ['Name', 'Due date', 'Priority', 'Service Req. #', 'Department', 'Requestor']

  const listView = (
    <div className="flex-1 overflow-auto min-h-0" data-testid="list-view">
      <div style={{ minWidth: staff ? 1150 : 960 }}>
        <div className="grid sticky top-0 z-10 bg-white border-b border-gray-200 text-xs text-gray-500" style={{ gridTemplateColumns: cols }}>
          {headers.map(h => <div key={h} className="px-3 py-2 border-r border-gray-100 last:border-r-0">{h}</div>)}
        </div>
        {loading && <div className="p-8 text-center text-gray-400">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="p-10 text-center text-gray-400">
            <div className="text-4xl mb-2">🎫</div>
            {tickets.length === 0 ? 'No tickets yet.' : 'No tickets match your filters.'}
          </div>
        )}
        {groups.map(g => (
          <div key={g.key}>
            {g.label && (
              <button onClick={() => setCollapsed(c => { const n = new Set(c); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
                className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-700 text-left">
                <span className="text-xs text-gray-400">{collapsed.has(g.key) ? '▸' : '▾'}</span>
                {g.label}<span className="text-xs font-normal text-gray-400">{g.items.length}</span>
              </button>
            )}
            {!collapsed.has(g.key) && g.items.map(t => renderRow(t))}
          </div>
        ))}
      </div>
    </div>
  )

  const boardView = (
    <div className="flex-1 overflow-auto min-h-0 p-4" data-testid="board-view">
      <div className="flex gap-4 h-full">
        {STATUSES.map(s => {
          const items = visible.filter(t => t.status === s)
          return (
            <div key={s}
              onDragOver={canEdit ? (e => { e.preventDefault(); setDragOver(s) }) : undefined}
              onDragLeave={() => setDragOver(d => d === s ? null : d)}
              onDrop={canEdit ? (e => {
                e.preventDefault(); setDragOver(null)
                const t = tickets.find(x => x.id === e.dataTransfer.getData('text/plain'))
                if (!t || t.status === s) return
                if (isDone(s) && !isDone(t.status) && !confirmIncomplete(t)) return
                update(t, { status: s })
              }) : undefined}
              className={`w-72 flex-shrink-0 rounded-xl flex flex-col max-h-full ${dragOver === s ? 'bg-blue-50 ring-2 ring-blue-300' : 'bg-gray-100'}`}
              data-testid={`board-col-${s}`}
            >
              <div className="px-3 py-2.5 flex items-center gap-2 text-sm font-semibold text-gray-700">
                <span className={`w-2 h-2 rounded-full ${STATUS_META[s].dot}`} />{STATUS_META[s].label}
                <span className="text-xs font-normal text-gray-400">{items.length}</span>
              </div>
              <div className="px-2 pb-2 space-y-2 overflow-y-auto">
                {items.map(t => {
                  const done = isDone(t.status)
                  const assignee = userById[t.assignee]
                  const due = formatDue(t.due_date, done)
                  const pr = PRIORITY_META[t.priority] || PRIORITY_META.medium
                  return (
                    <div key={t.id} draggable={canEdit} data-testid="board-card"
                      onDragStart={e => e.dataTransfer.setData('text/plain', t.id)}
                      onClick={() => onSelect(t.id)}
                      className={`bg-white rounded-lg border p-3 shadow-sm cursor-pointer hover:shadow ${selectedId === t.id ? 'border-blue-400' : 'border-gray-200'}`}>
                      <div className={`text-sm font-medium ${done ? 'text-gray-400' : 'text-gray-900'}`}>{t.title}</div>
                      <div className="mt-2"><span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${pr.pill}`}>{pr.label}</span></div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="text-gray-400 font-mono">#{t.num}</span>
                        {t.due_date && <span className={DUE_TONE[due.tone]}>{due.text}</span>}
                        <span className="flex items-center gap-1.5">{ticketCounts(t, staff)}</span>
                        <span className="ml-auto">{assignee && <Avatar name={assignee.name} color={assignee.color} />}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header */}
        <div className="px-6 pt-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center"><IconList width={18} height={18} /></div>
            <h1 className="text-xl font-semibold text-gray-900">{staff ? 'Service requests' : 'My requests'}</h1>
            <span className="text-sm text-gray-400">{visible.length} of {tickets.length}</span>
          </div>
          <div className="flex gap-1 mt-3 -mb-px">
            {[['list', 'List', IconList], ['board', 'Board', IconBoard]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setView(k)} data-testid={`tab-${k}`}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 ${view === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                <Icon width={14} height={14} />{label}
              </button>
            ))}
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-2.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 text-white text-sm font-medium px-3 py-1.5 hover:bg-blue-700">
            <IconPlus width={14} height={14} />Add ticket
          </button>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowFilters(s => !s)} aria-label="Filter"
              className={`inline-flex items-center gap-1.5 text-sm rounded px-2 py-1 hover:bg-gray-100 ${activeFilterCount ? 'text-blue-700' : 'text-gray-600'}`}>
              <IconFilter />Filter{activeFilterCount > 0 && <span className="bg-blue-600 text-white rounded-full text-[10px] px-1.5">{activeFilterCount}</span>}
            </button>
            <label className="text-sm text-gray-600 flex items-center gap-1">Sort
              <select aria-label="Sort" className="text-sm border-0 bg-transparent font-medium focus:outline-none cursor-pointer" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            {view === 'list' && (
              <label className="text-sm text-gray-600 flex items-center gap-1">Group
                <select aria-label="Group" className="text-sm border-0 bg-transparent font-medium focus:outline-none cursor-pointer" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                  <option value="none">None</option>
                  <option value="status">Status</option>
                  <option value="priority">Priority</option>
                  <option value="dept">Department</option>
                  {staff && <option value="assignee">Assignee</option>}
                </select>
              </label>
            )}
            <input aria-label="Search tickets" className="text-sm border border-gray-300 rounded-md px-2.5 py-1 w-48 focus:outline-none focus:border-blue-500" placeholder="Search tickets…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {showFilters && (
          <div className="px-6 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center gap-3 flex-wrap text-sm">
            <select aria-label="Filter status" className="input w-40 py-1" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
              <option value="all">All tickets</option>
              <option value="incomplete">Incomplete</option>
              <option value="completed">Completed</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select aria-label="Filter priority" className="input w-40 py-1" value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>
              <option value="">Any priority</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
            <select aria-label="Filter department" className="input w-48 py-1" value={filters.dept} onChange={e => setFilter('dept', e.target.value)}>
              <option value="">Any department</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {staff && (
              <select aria-label="Filter assignee" className="input w-48 py-1" value={filters.assignee} onChange={e => setFilter('assignee', e.target.value)}>
                <option value="">Any assignee</option>
                <option value="none">Unassigned</option>
                {users.filter(u => u.role !== 'requestor').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            {(activeFilterCount > 0 || search) && (
              <button className="text-blue-600 hover:underline" onClick={() => { setFilters({ status: 'all', priority: '', dept: '', assignee: '' }); setSearch('') }}>Clear all</button>
            )}
          </div>
        )}

        {view === 'list' ? listView : boardView}
      </div>

      {selectedId && (
        <TicketPanel
          ticketId={selectedId}
          version={version}
          users={users}
          departments={departments}
          onClose={() => onSelect(null)}
          onChanged={loadTickets}
        />
      )}
    </div>
  )
}
