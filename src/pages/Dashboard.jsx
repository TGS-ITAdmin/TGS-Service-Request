import { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'

export default function Dashboard({ onSelect }) {
  const [tickets, setTickets] = useState([])
  const [depts, setDepts] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.tickets.list(),
      api.departments.list(),
      api.users.list().catch(() => []),
    ]).then(([ts, d, u]) => {
      setTickets(ts)
      setDepts(d)
      setUsers(u)
    }).finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    urgent: tickets.filter(t => t.priority === 'urgent').length,
  }), [tickets])

  const recent = useMemo(() => (
    [...tickets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
  ), [tickets])

  const deptStats = useMemo(() => depts.map(d => ({
    ...d,
    ticket_count: tickets.filter(t => t.dept === d.id).length,
    member_count: users.filter(u => u.dept === d.id).length,
  })), [depts, tickets, users])

  const StatCard = ({ label, value, color, icon }) => (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value ?? '—'}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  )

  const timeAgo = (d) => {
    const s = Math.floor((Date.now() - new Date(d)) / 1000)
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">Loading…</div>

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Tickets" value={stats.total} color="text-gray-900" icon="🎫" />
        <StatCard label="Open" value={stats.open} color="text-blue-600" icon="📬" />
        <StatCard label="In Progress" value={stats.in_progress} color="text-yellow-600" icon="⚙️" />
        <StatCard label="Urgent" value={stats.urgent} color="text-red-600" icon="⚡" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent tickets */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-700">Recent Tickets</div>
          <div className="divide-y divide-gray-50">
            {recent.length === 0 && <div className="px-5 py-4 text-gray-400 text-sm">No tickets yet</div>}
            {recent.map(t => (
              <div key={t.id} className="px-5 py-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onClick={() => onSelect(t.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{t.title}</div>
                  <div className="text-xs text-gray-400">{t.req_name} · #{t.num}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    t.status === 'open' ? 'bg-blue-100 text-blue-700' :
                    t.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-700'
                  }`}>{t.status.replace('_',' ')}</span>
                  <span className="text-xs text-gray-400">{timeAgo(t.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Departments */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-700">Departments</div>
          <div className="divide-y divide-gray-50">
            {deptStats.map(d => (
              <div key={d.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-sm font-medium text-gray-700">{d.name}</span>
                </div>
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>{d.ticket_count} tickets</span>
                  <span>{d.member_count} members</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
