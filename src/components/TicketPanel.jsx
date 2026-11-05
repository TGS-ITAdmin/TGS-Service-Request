import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { api } from '../api.js'
import { Avatar } from './Badge.jsx'
import { useAuth, isStaff, canEditTicket } from '../AuthContext.jsx'
import {
  PRIORITIES, PRIORITY_META, STATUSES, STATUS_META, isDone,
  fmtDateTime, fmtSize, IMAGE_MIMES,
} from '../lib/meta.js'
import { CompleteCircle, CircleIcon, IconPlus, IconClose, IconDownload, IconFile, IconClip } from './Icons.jsx'

const FIELD_CTRL = 'w-full bg-transparent rounded border border-transparent hover:border-gray-300 hover:bg-white focus:border-blue-400 focus:bg-white focus:outline-none px-2 py-1 text-sm cursor-pointer'

function Field({ label, children }) {
  return (
    <div className="flex items-center min-h-[36px] py-0.5">
      <div className="w-32 flex-shrink-0 text-sm text-gray-500">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function SectionHeader({ title, count, action }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {count !== undefined && <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5">{count}</span>}
      <div className="ml-auto">{action}</div>
    </div>
  )
}

function eventText(a) {
  switch (a.action) {
    case 'created': return 'created this ticket'
    case 'auto-assigned': return `assigned this ticket to ${a.to}`
    case 'changed': return `changed ${a.field} from “${a.from}” to “${a.to}”`
    case 'rated': return `rated this ticket ${a.to}`
    case 'subtask-added': return `added subtask “${a.to}”`
    case 'subtask-done': return `completed subtask “${a.to}”`
    case 'subtask-reopened': return `reopened subtask “${a.to}”`
    case 'subtask-removed': return `removed subtask “${a.from}”`
    case 'attached': return `attached ${a.to}`
    case 'attachment-removed': return `removed attachment ${a.from}`
    default: return a.action
  }
}

function AttachmentItem({ ticketId, a, canDelete, onDelete }) {
  const [thumb, setThumb] = useState(null)
  useEffect(() => {
    let url = null
    let cancelled = false
    if (IMAGE_MIMES.includes(a.mime) && a.size < 3 * 1024 * 1024 && typeof URL.createObjectURL === 'function') {
      api.tickets.downloadAttachment(ticketId, a.id).then(blob => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setThumb(url)
      }).catch(() => {})
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [ticketId, a.id, a.mime, a.size])

  const download = async () => {
    try {
      const blob = await api.tickets.downloadAttachment(ticketId, a.id)
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url; el.download = a.filename
      document.body.appendChild(el); el.click(); el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="group flex items-center gap-3 py-2 border-b border-gray-100">
      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 text-gray-400">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <IconFile width={18} height={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <button onClick={download} className="text-sm text-blue-600 hover:underline truncate block max-w-full text-left">{a.filename}</button>
        <div className="text-xs text-gray-400">{fmtSize(a.size)} · {a.uploaded_by_name} · {fmtDateTime(a.created_at)}</div>
      </div>
      <button title="Download" onClick={download} className="text-gray-400 hover:text-gray-700"><IconDownload /></button>
      {canDelete && <button title="Remove" onClick={onDelete} className="text-gray-300 hover:text-red-500"><IconClose /></button>}
    </div>
  )
}

export default function TicketPanel({ ticketId, version, users, departments, onClose, onChanged }) {
  const { user } = useAuth()
  const staff = isStaff(user)
  const canEdit = canEditTicket(user)

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [tab, setTab] = useState('all')                // all | comments
  const [newestFirst, setNewestFirst] = useState(false)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [subDraft, setSubDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [ratingDraft, setRatingDraft] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const fileRef = useRef(null)
  const currentId = useRef(ticketId)
  currentId.current = ticketId

  const load = useCallback(async () => {
    try {
      const d = await api.tickets.get(ticketId)
      if (currentId.current !== ticketId) return          // user already switched tickets
      setData(d); setTitleDraft(d.ticket.title); setError('')
    } catch (e) {
      if (currentId.current === ticketId) setError(e.message)
    }
  }, [ticketId])

  useEffect(() => { setData(null); setError(''); setAddingSub(false); setReply('') }, [ticketId])
  useEffect(() => { load() }, [load, version])

  const run = async (fn) => {
    try { await fn(); await load(); onChanged?.() } catch (e) { alert(e.message) }
  }
  const patch = (fields) => run(() => api.tickets.update(ticketId, fields))

  const feed = useMemo(() => {
    if (!data) return []
    const items = data.messages.map(m => ({ kind: 'comment', at: m.created_at, m }))
    if (tab === 'all') data.audit.forEach(a => items.push({ kind: 'event', at: a.ts, a }))
    items.sort((x, y) => new Date(x.at) - new Date(y.at))
    return newestFirst ? items.reverse() : items
  }, [data, tab, newestFirst])

  if (error) {
    return (
      <aside className="w-[520px] max-w-[55vw] border-l border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-4 flex justify-between items-center border-b border-gray-100">
          <span className="text-sm text-red-600">{error}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><IconClose /></button>
        </div>
      </aside>
    )
  }
  if (!data) {
    return (
      <aside className="w-[520px] max-w-[55vw] border-l border-gray-200 bg-white flex items-center justify-center text-gray-400 text-sm flex-shrink-0">
        Loading…
      </aside>
    )
  }

  const { ticket: t, subtasks = [], attachments = [], rating } = data
  const done = isDone(t.status)
  const isOwn = t.requestor_id === user.id
  const dept = departments.find(d => d.id === t.dept)
  const assignee = users.find(u => u.id === t.assignee)
  const userById = Object.fromEntries(users.map(u => [u.id, u]))
  const subDone = subtasks.filter(s => s.done).length
  const canRate = isOwn && done && !rating

  const sendReply = async () => {
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await api.tickets.addMessage(ticketId, { body: reply, internal: staff && internal })
      setReply(''); await load(); onChanged?.()
    } catch (e) { alert(e.message) } finally { setSending(false) }
  }

  const addSubtask = async () => {
    const title = subDraft.trim()
    if (!title) { setAddingSub(false); return }
    setSubDraft('')
    await run(() => api.tickets.addSubtask(ticketId, { title }))
  }

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) { alert(`${f.name} is larger than 10 MB and was skipped.`); continue }
        await api.tickets.uploadAttachment(ticketId, f)
      }
      await load(); onChanged?.()
    } catch (e) { alert(e.message) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveTitle = () => {
    const v = titleDraft.trim()
    if (!v) { setTitleDraft(t.title); return }
    if (v !== t.title) patch({ title: v })
  }

  return (
    <aside className="w-[520px] max-w-[55vw] border-l border-gray-200 bg-white flex flex-col flex-shrink-0 min-h-0" data-testid="ticket-panel">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-shrink-0">
        {canEdit ? (
          <button
            onClick={() => patch({ status: done ? 'open' : 'resolved' })}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              done ? 'border-green-500 text-green-700 bg-green-50 hover:bg-green-100' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <CircleIcon done={done} size={16} />
            {done ? 'Completed' : 'Mark complete'}
          </button>
        ) : !staff && isOwn && t.status === 'resolved' ? (
          <button onClick={() => patch({ status: 'open' })} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">
            ↺ Reopen ticket
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-gray-600">
            <span className={`w-2 h-2 rounded-full ${STATUS_META[t.status]?.dot}`} />{STATUS_META[t.status]?.label}
          </span>
        )}
        <span className="text-xs text-gray-400 font-mono">#{t.num}</span>
        <button onClick={onClose} title="Close panel" className="ml-auto text-gray-400 hover:text-gray-700 p-1"><IconClose width={18} height={18} /></button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-5">
        {canEdit ? (
          <input
            className="w-full text-2xl font-semibold text-gray-900 bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1 -mx-1 py-0.5 focus:outline-none"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            aria-label="Ticket title"
          />
        ) : (
          <h1 className="text-2xl font-semibold text-gray-900">{t.title}</h1>
        )}

        {/* Fields */}
        <div className="mt-4">
          {staff && (
            <Field label="Assignee">
              {canEdit ? (
                <div className="flex items-center gap-2">
                  {assignee && <Avatar name={assignee.name} color={assignee.color} />}
                  <select aria-label="Assignee" className={FIELD_CTRL} value={t.assignee || ''} onChange={e => patch({ assignee: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {users.filter(u => u.role !== 'requestor').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-2 text-sm">
                  {assignee ? <><Avatar name={assignee.name} color={assignee.color} />{assignee.name}</> : <span className="text-gray-400">Unassigned</span>}
                </div>
              )}
            </Field>
          )}
          <Field label="Due date">
            {canEdit ? (
              <div className="flex items-center gap-1">
                <input aria-label="Due date" type="date" className={FIELD_CTRL + ' w-auto'} value={t.due_date || ''} onChange={e => patch({ due_date: e.target.value || null })} />
                {t.due_date && <button title="Clear due date" className="text-gray-300 hover:text-gray-600" onClick={() => patch({ due_date: null })}><IconClose /></button>}
              </div>
            ) : <span className="px-2 text-sm">{t.due_date || <span className="text-gray-400">None</span>}</span>}
          </Field>
          <Field label="Status">
            {canEdit ? (
              <select aria-label="Status" className={FIELD_CTRL} value={t.status} onChange={e => patch({ status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            ) : <span className="px-2 text-sm">{STATUS_META[t.status]?.label}</span>}
          </Field>
          <Field label="Priority">
            {canEdit ? (
              <select aria-label="Priority" className={`rounded px-2 py-1 text-sm font-medium cursor-pointer max-w-full truncate focus:outline-none ${PRIORITY_META[t.priority]?.pill}`} value={t.priority} onChange={e => patch({ priority: e.target.value })}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].desc}</option>)}
              </select>
            ) : <span className={`inline-block rounded px-2 py-1 text-sm font-medium ${PRIORITY_META[t.priority]?.pill}`}>{PRIORITY_META[t.priority]?.desc}</span>}
          </Field>
          <Field label="Service Request #"><span className="px-2 text-sm font-mono text-gray-700">{t.num}</span></Field>
          <Field label="Department">
            {canEdit ? (
              <select aria-label="Department" className={FIELD_CTRL} value={t.dept || ''} onChange={e => patch({ dept: e.target.value || null, category: null })}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : <span className="px-2 text-sm">{dept?.name || <span className="text-gray-400">None</span>}</span>}
          </Field>
          <Field label="Category">
            {canEdit ? (
              <select aria-label="Category" className={FIELD_CTRL} value={t.category || ''} disabled={!dept} onChange={e => patch({ category: e.target.value || null })}>
                <option value="">None</option>
                {(dept?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : <span className="px-2 text-sm">{t.category || <span className="text-gray-400">None</span>}</span>}
          </Field>
          <Field label="Requestor">
            <div className="flex items-center gap-2 px-2 text-sm min-w-0">
              <Avatar name={t.req_name} color="#8b5cf6" />
              <div className="min-w-0"><div className="truncate">{t.req_name}</div><div className="text-xs text-gray-400 truncate">{t.req_email}</div></div>
            </div>
          </Field>
          <Field label="Created"><span className="px-2 text-sm text-gray-600">{fmtDateTime(t.created_at)}</span></Field>
          {t.resolved_at && done && <Field label="Resolved"><span className="px-2 text-sm text-gray-600">{fmtDateTime(t.resolved_at)}</span></Field>}
        </div>

        {/* Description, laid out like an Asana form submission */}
        <section className="mt-6" data-testid="description">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Description</h3>
          <div className="text-sm text-gray-800 space-y-4">
            <div><div className="font-bold">Request Title:</div><div>{t.title}</div></div>
            <div><div className="font-bold">Urgency:</div><div>{PRIORITY_META[t.priority]?.desc}</div></div>
            <div><div className="font-bold">Requestor:</div><div>{t.req_name} ({t.req_email})</div></div>
            {dept && <div><div className="font-bold">Department:</div><div>{dept.name}</div></div>}
            {t.category && <div><div className="font-bold">Concern:</div><div>{t.category}</div></div>}
            <div><div className="font-bold">Details of Request:</div><div className="whitespace-pre-wrap">{t.description || <span className="text-gray-400">No details provided.</span>}</div></div>
            <div className="border-t border-gray-300 w-40 pt-2 text-gray-500">
              This ticket was submitted through <strong className="text-gray-800">Service request</strong> #{t.num}
            </div>
          </div>
        </section>

        {/* Subtasks (staff only) */}
        {staff && (
          <section className="mt-7" data-testid="subtasks">
            <SectionHeader
              title="Subtasks"
              count={`${subDone}/${subtasks.length}`}
              action={<button title="Add subtask" aria-label="Add subtask" onClick={() => setAddingSub(true)} className="text-gray-500 hover:text-gray-900"><IconPlus width={16} height={16} /></button>}
            />
            <div>
              {subtasks.map(s => (
                <div key={s.id} className="group flex items-center gap-2 py-1.5 border-b border-gray-100">
                  <CompleteCircle done={s.done} onClick={() => run(() => api.tickets.updateSubtask(ticketId, s.id, { done: !s.done }))} />
                  <span className={`flex-1 text-sm ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.title}</span>
                  {userById[s.assignee] && <Avatar name={userById[s.assignee].name} color={userById[s.assignee].color} />}
                  {canEdit && (
                    <button title="Delete subtask" aria-label={`Delete subtask ${s.title}`} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500"
                      onClick={() => { if (confirm('Delete this subtask?')) run(() => api.tickets.deleteSubtask(ticketId, s.id)) }}>
                      <IconClose />
                    </button>
                  )}
                </div>
              ))}
              {addingSub ? (
                <input
                  autoFocus
                  className="mt-2 w-full text-sm border-b border-blue-400 focus:outline-none py-1"
                  placeholder="Write a subtask name, press Enter"
                  value={subDraft}
                  onChange={e => setSubDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSubtask(); if (e.key === 'Escape') { setAddingSub(false); setSubDraft('') } }}
                  onBlur={() => { if (!subDraft.trim()) setAddingSub(false) }}
                />
              ) : (
                <button className="mt-1.5 text-sm text-gray-500 hover:text-gray-800" onClick={() => setAddingSub(true)}>Add subtask</button>
              )}
            </div>
          </section>
        )}

        {/* Attachments */}
        <section className="mt-7" data-testid="attachments">
          <SectionHeader
            title="Attachments"
            count={attachments.length}
            action={
              <>
                <input ref={fileRef} type="file" multiple className="hidden" data-testid="file-input" onChange={e => handleFiles(e.target.files)} />
                <button title="Attach files" aria-label="Attach files" disabled={uploading} onClick={() => fileRef.current?.click()} className="text-gray-500 hover:text-gray-900 disabled:opacity-40 flex items-center gap-1">
                  {uploading ? <span className="text-xs">Uploading…</span> : <IconClip width={16} height={16} />}
                </button>
              </>
            }
          />
          {attachments.length === 0 && <div className="text-sm text-gray-400">No attachments. Files can be up to 10 MB.</div>}
          {attachments.map(a => (
            <AttachmentItem key={a.id} ticketId={ticketId} a={a}
              canDelete={canEdit || a.uploaded_by === user.id}
              onDelete={() => { if (confirm(`Remove ${a.filename}?`)) run(() => api.tickets.deleteAttachment(ticketId, a.id)) }} />
          ))}
        </section>

        {/* Rating */}
        {canRate && (
          <section className="mt-7 card p-4">
            <h3 className="text-sm font-semibold mb-2">How did we do?</h3>
            <div className="flex gap-1 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} aria-label={`${n} stars`} onClick={() => setRatingDraft(n)} className="text-2xl leading-none" style={{ color: n <= ratingDraft ? '#f59e0b' : '#d1d5db' }}>★</button>
              ))}
            </div>
            <textarea className="input resize-none h-16 text-sm mb-2" placeholder="Optional comment…" value={ratingComment} onChange={e => setRatingComment(e.target.value)} />
            <button className="btn-primary text-xs" disabled={!ratingDraft} onClick={() => run(() => api.tickets.rate(ticketId, { stars: ratingDraft, comment: ratingComment }))}>Submit rating</button>
          </section>
        )}
        {rating?.stars && (
          <section className="mt-7">
            <h3 className="text-sm font-semibold mb-1">Rating</h3>
            <div className="text-amber-500 text-lg leading-none">{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</div>
            {rating.comment && <p className="text-sm text-gray-600 mt-1">{rating.comment}</p>}
          </section>
        )}

        {/* Activity */}
        <section className="mt-8 pb-4" data-testid="activity">
          <div className="flex items-center border-b border-gray-200 mb-3">
            {[['comments', 'Comments'], ['all', 'All activity']].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                {label}
              </button>
            ))}
            <button onClick={() => setNewestFirst(n => !n)} className="ml-auto text-xs text-gray-500 hover:text-gray-800">⇅ {newestFirst ? 'Newest' : 'Oldest'}</button>
          </div>
          <div className="space-y-3">
            {feed.length === 0 && <div className="text-sm text-gray-400">No {tab === 'comments' ? 'comments' : 'activity'} yet.</div>}
            {feed.map(item => item.kind === 'event' ? (
              <div key={'a' + item.a.id} className="text-xs text-gray-500 pl-1">
                <strong className="text-gray-700">{item.a.actor}</strong> {eventText(item.a)} · {fmtDateTime(item.at)}
              </div>
            ) : (
              <div key={'m' + item.m.id} className="flex gap-3">
                <Avatar name={item.m.sender_name} color={item.m.sender_type === 'agent' ? '#2563eb' : '#8b5cf6'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{item.m.sender_name}</span>
                    <span className="text-xs text-gray-400">{fmtDateTime(item.m.created_at)}</span>
                    {item.m.internal && <span className="text-[10px] bg-yellow-100 text-yellow-800 rounded px-1.5 py-0.5">🔒 Internal note</span>}
                  </div>
                  <div className={`mt-1 text-sm whitespace-pre-wrap rounded-lg px-3 py-2 ${item.m.internal ? 'bg-yellow-50 border border-yellow-200 text-yellow-900' : 'bg-gray-50 text-gray-800'}`}>{item.m.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 px-5 py-3 flex-shrink-0 bg-white">
        <textarea
          aria-label="Add a comment"
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${internal ? 'bg-yellow-50 border-yellow-300' : 'border-gray-300'}`}
          rows={2}
          placeholder={internal ? 'Add an internal note (not sent to the requestor)…' : 'Add a comment…'}
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply() }}
        />
        <div className="flex items-center justify-between mt-2">
          {staff ? (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" className="rounded" checked={internal} onChange={e => setInternal(e.target.checked)} />
              Internal note
            </label>
          ) : <span className="text-xs text-gray-400">Support will be notified by email</span>}
          <button className="btn-primary py-1.5" disabled={sending || !reply.trim()} onClick={sendReply}>
            {sending ? 'Sending…' : internal ? 'Add note' : 'Comment'}
          </button>
        </div>
      </div>
    </aside>
  )
}
