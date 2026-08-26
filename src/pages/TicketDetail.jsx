import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { StatusBadge, PriorityBadge, Avatar } from '../components/Badge.jsx'
import { useAuth, isStaff, canEditTicket } from '../AuthContext.jsx'

export default function TicketDetail({ ticketId, onBack, onUpdated }) {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [departments, setDepartments] = useState([])
  const [users, setUsers] = useState([])
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [ratingDraft, setRatingDraft] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [ratingSaving, setRatingSaving] = useState(false)
  const bottomRef = useRef(null)

  const staff = isStaff(user)
  const canEdit = canEditTicket(user)

  const load = async () => {
    const d = await api.tickets.get(ticketId)
    setData(d)
    setEditForm({
      status: d.ticket.status,
      priority: d.ticket.priority,
      dept: d.ticket.dept || '',
      category: d.ticket.category || '',
      assignee: d.ticket.assignee || '',
      due_date: d.ticket.due_date || '',
    })
    setLoading(false)
  }

  useEffect(() => { load() }, [ticketId])
  useEffect(() => {
    api.departments.list().then(setDepartments)
    if (staff) api.users.list().then(setUsers).catch(() => setUsers([]))
  }, [staff])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [data?.messages])

  const handleReply = async () => {
    if (!reply.trim()) return
    setSending(true)
    try {
      await api.tickets.addMessage(ticketId, { body: reply, internal: staff && isInternal })
      setReply('')
      await load()
      onUpdated?.()
    } finally {
      setSending(false)
    }
  }

  const handleSave = async () => {
    await api.tickets.update(ticketId, {
      status: editForm.status,
      priority: editForm.priority,
      dept: editForm.dept || null,
      category: editForm.category || null,
      assignee: editForm.assignee || null,
      due_date: editForm.due_date || null,
    })
    setEditing(false)
    await load()
    onUpdated?.()
  }

  const handleReopen = async () => {
    await api.tickets.update(ticketId, { status: 'open' })
    await load()
    onUpdated?.()
  }

  const handleRate = async () => {
    if (!ratingDraft) return
    setRatingSaving(true)
    try {
      await api.tickets.rate(ticketId, { stars: ratingDraft, comment: ratingComment })
      await load()
    } finally {
      setRatingSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-400">Loading…</div>
  )

  const { ticket, messages, audit, rating } = data
  const fmt = (d) => d ? new Date(d).toLocaleString() : '—'
  const dept = departments.find(d => d.id === ticket.dept)
  const assignee = users.find(u => u.id === ticket.assignee)
  const selectedDept = departments.find(d => d.id === editForm.dept)
  const isOwnTicket = ticket.requestor_id === user.id
  const canReopen = isOwnTicket && !staff && ticket.status === 'resolved'
  const canRate = isOwnTicket && ['resolved', 'closed'].includes(ticket.status) && !rating

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex items-start gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 mt-1 text-lg">←</button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-gray-400">#{ticket.num}</span>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mt-1 truncate">{ticket.title}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              From <strong>{ticket.req_name}</strong> ({ticket.req_email}) · {fmt(ticket.created_at)}
            </p>
          </div>
          {canReopen && (
            <button className="btn-secondary text-xs h-fit" onClick={handleReopen}>↺ Reopen Ticket</button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Conversation */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Original description */}
            {ticket.description && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
                  {ticket.req_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-semibold text-sm text-gray-900">{ticket.req_name}</span>
                    <span className="text-xs text-gray-400">{fmt(ticket.created_at)}</span>
                    <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded">Requestor</span>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap">
                    {ticket.description}
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map(m => (
              <div key={m.id} className={`flex gap-3 ${m.sender_type === 'agent' ? 'flex-row-reverse' : ''}`}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                  style={{ backgroundColor: m.sender_type === 'agent' ? '#2563eb' : '#6366f1' }}
                >
                  {m.sender_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className={`flex-1 ${m.sender_type === 'agent' ? 'items-end' : ''} flex flex-col`}>
                  <div className={`flex items-baseline gap-2 mb-1 ${m.sender_type === 'agent' ? 'flex-row-reverse' : ''}`}>
                    <span className="font-semibold text-sm text-gray-900">{m.sender_name}</span>
                    <span className="text-xs text-gray-400">{fmt(m.created_at)}</span>
                    {m.sender_type === 'agent' && <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Agent</span>}
                    {m.internal ? <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">🔒 Internal</span> : null}
                  </div>
                  <div className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap max-w-prose ${
                    m.internal
                      ? 'bg-yellow-50 border border-yellow-200 text-yellow-900'
                      : m.sender_type === 'agent'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-700'
                  }`}>
                    {m.body}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Reply box */}
          <div className="px-6 py-4 bg-white border-t border-gray-200">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-sm font-medium text-gray-700">Reply as {user.name}</span>
              {staff && (
                <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                  Internal note (not sent to requestor)
                </label>
              )}
            </div>
            <textarea
              className={`input resize-none h-24 ${isInternal ? 'bg-yellow-50 border-yellow-300' : ''}`}
              placeholder={isInternal ? 'Add an internal note…' : 'Write a reply…'}
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply() }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">⌘↵ to send · {isInternal ? 'Not emailed' : 'Will notify the other party by email'}</span>
              <button className="btn-primary" onClick={handleReply} disabled={sending || !reply.trim()}>
                {sending ? 'Sending…' : isInternal ? '🔒 Add Note' : '📨 Send Reply'}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-72 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
          <div className="p-5 space-y-5">
            {/* Properties */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Properties</h3>
                {canEdit && (!editing
                  ? <button className="text-xs text-blue-600 hover:underline" onClick={() => setEditing(true)}>Edit</button>
                  : <div className="flex gap-2">
                      <button className="text-xs text-green-600 hover:underline" onClick={handleSave}>Save</button>
                      <button className="text-xs text-gray-400 hover:underline" onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                )}
              </div>
              <div className="space-y-3">
                {editing ? (
                  <>
                    <div>
                      <label className="label">Status</label>
                      <select className="input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Priority</label>
                      <select className="input" value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Department</label>
                      <select className="input" value={editForm.dept} onChange={e => setEditForm(f => ({ ...f, dept: e.target.value, category: '' }))}>
                        <option value="">Unassigned</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Category</label>
                      <select className="input" value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} disabled={!selectedDept}>
                        <option value="">None</option>
                        {(selectedDept?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Assignee</label>
                      <select className="input" value={editForm.assignee} onChange={e => setEditForm(f => ({ ...f, assignee: e.target.value }))}>
                        <option value="">Unassigned</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Due Date</label>
                      <input type="date" className="input" value={editForm.due_date || ''} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <Row label="Status"><StatusBadge status={ticket.status} /></Row>
                    <Row label="Priority"><PriorityBadge priority={ticket.priority} /></Row>
                    <Row label="Department">
                      {dept ? (
                        <span className="flex items-center gap-1.5 text-sm text-gray-700">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color }} />
                          {dept.name}
                        </span>
                      ) : <span className="text-sm text-gray-400">Unassigned</span>}
                    </Row>
                    {ticket.category && <Row label="Category"><span className="text-sm text-gray-700">{ticket.category}</span></Row>}
                    <Row label="Assignee">
                      {assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={assignee.name} color={assignee.color} />
                          <div>
                            <div className="text-sm font-medium text-gray-700">{assignee.name}</div>
                            <div className="text-xs text-gray-400">{assignee.email}</div>
                          </div>
                        </div>
                      ) : <span className="text-sm text-gray-400">Unassigned</span>}
                    </Row>
                    {ticket.due_date && <Row label="Due Date"><span className="text-sm text-gray-700">{ticket.due_date}</span></Row>}
                  </>
                )}
              </div>
            </div>

            {/* Requestor */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Requestor</h3>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-sm font-semibold text-purple-700">
                  {ticket.req_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-700">{ticket.req_name}</div>
                  <div className="text-xs text-gray-400">{ticket.req_email}</div>
                </div>
              </div>
            </div>

            {/* Rating */}
            {canRate && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Rate Your Experience</h3>
                <div className="flex gap-1 mb-2">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setRatingDraft(n)} className="text-2xl leading-none" style={{ color: n <= ratingDraft ? '#f59e0b' : '#d1d5db' }}>★</button>
                  ))}
                </div>
                <textarea className="input resize-none h-16 text-sm mb-2" placeholder="Optional comment…" value={ratingComment} onChange={e => setRatingComment(e.target.value)} />
                <button className="btn-primary w-full justify-center text-xs" disabled={!ratingDraft || ratingSaving} onClick={handleRate}>
                  {ratingSaving ? 'Saving…' : 'Submit Rating'}
                </button>
              </div>
            )}
            {rating?.stars && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rating</h3>
                <div className="text-amber-500 text-lg leading-none">{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</div>
                {rating.comment && <p className="text-sm text-gray-600 mt-1">{rating.comment}</p>}
              </div>
            )}

            {/* Timeline */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Activity</h3>
              <div className="space-y-2 text-xs text-gray-500">
                {audit.map(a => (
                  <div key={a.id} className="border-l-2 border-gray-100 pl-2">
                    <div className="text-gray-600">
                      <strong>{a.actor}</strong> {a.action === 'changed' ? `changed ${a.field}` : a.action}
                      {a.action === 'changed' && <> from <em>{a.from}</em> to <em>{a.to}</em></>}
                      {a.action !== 'changed' && a.to ? `: ${a.to}` : ''}
                    </div>
                    <div className="text-gray-300">{fmt(a.ts)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            {canEdit && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h3>
                <div className="space-y-2">
                  {ticket.status !== 'in_progress' && (
                    <button className="w-full btn-secondary text-xs justify-start" onClick={async () => { await api.tickets.update(ticketId, { status: 'in_progress' }); load(); onUpdated?.() }}>
                      ▶ Mark In Progress
                    </button>
                  )}
                  {ticket.status !== 'resolved' && (
                    <button className="w-full btn-secondary text-xs justify-start text-green-600" onClick={async () => { await api.tickets.update(ticketId, { status: 'resolved' }); load(); onUpdated?.() }}>
                      ✓ Resolve Ticket
                    </button>
                  )}
                  {ticket.status !== 'closed' && (
                    <button className="w-full btn-secondary text-xs justify-start text-gray-500" onClick={async () => { await api.tickets.update(ticketId, { status: 'closed' }); load(); onUpdated?.() }}>
                      ✕ Close Ticket
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      {children}
    </div>
  )
}
