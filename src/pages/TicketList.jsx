import { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'
import { StatusBadge, PriorityBadge, Avatar } from '../components/Badge.jsx'

const PAGE_SIZE = 15

export default function TicketList({ onSelect, onNew, refreshKey }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [filters, setFilters] = useState({ status: '', priority: '', dept: '', assignee: '', search: '' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    api.tickets.list().then(setTickets).finally(() => setLoading(false))
  }, [refreshKey])

  useEffect(() => {
    api.departments.list().then(setDepartments)
    api.users.list().then(setUsers).catch(() => setUsers([])) // requestors can't list users
  }, [])

  const deptById = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d])), [departments])
  const userById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1) }

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return tickets.filter(t => {
      if (filters.status && t.status !== filters.status) return false
      if (filters.priority && t.priority !== filters.priority) return false
      if (filters.dept && t.dept !== filters.dept) return false
      if (filters.assignee && t.assignee !== filters.assignee) return false
      if (q && !(`${t.title} ${t.req_name} ${t.req_email}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [tickets, filters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const timeAgo = (d) => {
    const s = Math.floor((Date.now() - new Date(d)) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tickets</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} total</p>
        </div>
        <button onClick={onNew} className="btn-primary">
          <span>＋</span> New Ticket
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 bg-white border-b border-gray-100 flex flex-wrap gap-2">
        <input
          className="input w-56"
          placeholder="Search tickets…"
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
        />
        <select className="input w-36" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">All status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select className="input w-32" value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>
          <option value="">All priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select className="input w-44" value={filters.dept} onChange={e => setFilter('dept', e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {users.length > 0 && (
          <select className="input w-44" value={filters.assignee} onChange={e => setFilter('assignee', e.target.value)}>
            <option value="">All agents</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {Object.values(filters).some(v => v) && (
          <button className="btn-secondary text-xs" onClick={() => { setFilters({ status:'',priority:'',dept:'',assignee:'',search:'' }); setPage(1) }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">Loading…</div>
        ) : pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400">
            <div className="text-4xl mb-2">🎫</div>
            <div>No tickets found</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Department</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Assignee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.map(t => {
                const dept = deptById[t.dept]
                const assignee = userById[t.assignee]
                return (
                  <tr
                    key={t.id}
                    onClick={() => onSelect(t.id)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{t.num}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-xs">{t.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{t.req_name} · {t.req_email}</div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-4 py-3">
                      {dept ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color }} />
                          <span className="text-gray-600">{dept.name}</span>
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={assignee.name} color={assignee.color} />
                          <span className="text-gray-600 truncate">{assignee.name}</span>
                        </div>
                      ) : <span className="text-gray-300">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(t.updated_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-gray-200 bg-white flex items-center justify-between text-sm">
          <span className="text-gray-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-secondary py-1" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button className="btn-secondary py-1" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
