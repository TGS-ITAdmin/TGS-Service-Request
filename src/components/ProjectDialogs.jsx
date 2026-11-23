import { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'
import { notifyError } from '../lib/errors.js'
import { Modal } from './Modal.jsx'
import { Avatar } from './Badge.jsx'
import { PRIVACY, PRIVACY_LABEL, FIELD_TYPES } from '../../shared/projects.js'
import { PROJECT_COLORS } from '../lib/projects.js'
import { IconClose } from './Icons.jsx'

export function ColorPicker({ value, onChange }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Colour">
      {PROJECT_COLORS.map(c => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full ring-offset-2 ${value === c ? 'ring-2 ring-gray-700' : ''}`} style={{ background: c }} />
      ))}
    </div>
  )
}

export function NewProjectDialog({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const [privacy, setPrivacy] = useState('members')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try { onCreated(await api.projects.create({ name, description, color, privacy })) } catch (err) { notifyError(err); setBusy(false) }
  }
  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label" htmlFor="np-name">Project name</label><input id="np-name" autoFocus className="input" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></div>
        <div><label className="label" htmlFor="np-desc">Description (optional)</label><textarea id="np-desc" className="input h-20 resize-none" value={description} onChange={e => setDescription(e.target.value)} /></div>
        <div><div className="label">Colour</div><ColorPicker value={color} onChange={setColor} /></div>
        <div>
          <label className="label" htmlFor="np-privacy">Who can see it</label>
          <select id="np-privacy" className="input" value={privacy} onChange={e => setPrivacy(e.target.value)}>
            {PRIVACY.map(p => <option key={p} value={p}>{PRIVACY_LABEL[p]}</option>)}
          </select>
          <p className="text-xs text-gray-500 mt-1">The Owner can always see every project. You can add members after it is created.</p>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim() || busy}>{busy ? 'Creating…' : 'Create project'}</button></div>
      </form>
    </Modal>
  )
}

export function MembersDialog({ project, members, users, me, canManage, onClose, onChanged }) {
  const [adding, setAdding] = useState('')
  const candidates = users.filter(u => u.role !== 'requestor' && !members.some(m => m.id === u.id))
  const run = async (fn) => { try { await fn(); onChanged() } catch (e) { notifyError(e) } }
  return (
    <Modal title={`Members of ${project.name}`} onClose={onClose}>
      <ul className="divide-y divide-gray-100 mb-4">
        {members.map(m => (
          <li key={m.id} className="flex items-center gap-3 py-2">
            <Avatar name={m.name} color={m.color} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{m.name}</div><div className="text-xs text-gray-400 truncate">{m.email}</div></div>
            {canManage ? (
              <select aria-label={`Role of ${m.name}`} className="text-sm border border-gray-300 rounded px-2 py-1" value={m.role} onChange={e => run(() => api.projects.setMemberRole(project.id, m.id, e.target.value))}>
                <option value="owner">Project owner</option><option value="member">Member</option>
              </select>
            ) : <span className="text-xs text-gray-500">{m.role === 'owner' ? 'Project owner' : 'Member'}</span>}
            {(canManage || m.id === me.id) && (
              <button aria-label={m.id === me.id ? 'Leave project' : `Remove ${m.name}`} title={m.id === me.id ? 'Leave project' : 'Remove'} className="text-gray-300 hover:text-red-500"
                onClick={() => { if (confirm(m.id === me.id ? 'Leave this project?' : `Remove ${m.name} from this project?`)) run(() => api.projects.removeMember(project.id, m.id)) }}><IconClose /></button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex gap-2">
          <select aria-label="Add a member" className="input flex-1" value={adding} onChange={e => setAdding(e.target.value)}>
            <option value="">Add a member…</option>
            {candidates.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <button className="btn-primary" disabled={!adding} onClick={() => run(async () => { await api.projects.addMember(project.id, { user_id: adding }); setAdding('') })}>Add</button>
        </div>
      )}
      {!canManage && <p className="text-xs text-gray-500">Only project owners, Admins who belong to the project, and the Owner can change members.</p>}
    </Modal>
  )
}

export function SettingsDialog({ project, fields, onClose, onChanged, onDeleted }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [color, setColor] = useState(project.color)
  const [privacy, setPrivacy] = useState(project.privacy)
  const [fName, setFName] = useState('')
  const [fType, setFType] = useState('text')
  const [fOptions, setFOptions] = useState('')
  const run = async (fn) => { try { await fn(); onChanged() } catch (e) { notifyError(e) } }
  const dirty = name !== project.name || description !== (project.description || '') || color !== project.color || privacy !== project.privacy
  return (
    <Modal title="Project settings" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div><label className="label" htmlFor="ps-name">Name</label><input id="ps-name" className="input" value={name} onChange={e => setName(e.target.value)} maxLength={120} /></div>
        <div><label className="label" htmlFor="ps-desc">Description</label><textarea id="ps-desc" className="input h-16 resize-none" value={description} onChange={e => setDescription(e.target.value)} /></div>
        <div className="flex gap-6 flex-wrap">
          <div><div className="label">Colour</div><ColorPicker value={color} onChange={setColor} /></div>
          <div><label className="label" htmlFor="ps-privacy">Who can see it</label>
            <select id="ps-privacy" className="input" value={privacy} onChange={e => setPrivacy(e.target.value)}>{PRIVACY.map(p => <option key={p} value={p}>{PRIVACY_LABEL[p]}</option>)}</select></div>
        </div>
        <div className="flex justify-end"><button className="btn-primary" disabled={!dirty || !name.trim()} onClick={() => run(() => api.projects.update(project.id, { name, description, color, privacy }))}>Save changes</button></div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold mb-2">Custom fields</h3>
          {fields.length === 0 && <p className="text-sm text-gray-400 mb-2">No custom fields yet. Add one to track things like cost, vendor or stage.</p>}
          <ul className="mb-3 divide-y divide-gray-100">
            {fields.map(f => (
              <li key={f.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="font-medium">{f.name}</span><span className="text-xs text-gray-400">{f.type}{f.type === 'select' ? ` · ${f.options.map(o => o.label).join(', ')}` : ''}</span>
                <button className="ml-auto text-xs text-gray-400 hover:text-red-600" onClick={() => { if (confirm(`Delete the field “${f.name}” and all its values?`)) run(() => api.projects.deleteField(project.id, f.id)) }}>Delete</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[140px]"><label className="label" htmlFor="cf-name">Field name</label><input id="cf-name" className="input" value={fName} onChange={e => setFName(e.target.value)} /></div>
            <div><label className="label" htmlFor="cf-type">Type</label><select id="cf-type" className="input" value={fType} onChange={e => setFType(e.target.value)}>{FIELD_TYPES.map(t => <option key={t} value={t}>{t === 'select' ? 'dropdown' : t}</option>)}</select></div>
            {fType === 'select' && <div className="flex-1 min-w-[160px]"><label className="label" htmlFor="cf-opts">Options (comma separated)</label><input id="cf-opts" className="input" value={fOptions} onChange={e => setFOptions(e.target.value)} placeholder="Acme, Globex" /></div>}
            <button className="btn-secondary" disabled={!fName.trim() || (fType === 'select' && !fOptions.trim())}
              onClick={() => run(async () => { await api.projects.addField(project.id, { name: fName, type: fType, options: fOptions.split(',') }); setFName(''); setFOptions('') })}>Add field</button>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4 flex gap-3 flex-wrap">
          <button className="btn-secondary" onClick={() => run(async () => { await api.projects.update(project.id, { archived: !project.archived }); onClose() })}>{project.archived ? 'Restore project' : 'Archive project'}</button>
          <button className="btn-danger ml-auto" onClick={async () => {
            if (!confirm(`Delete “${project.name}”? Tasks that only exist in this project are deleted too. Tickets are never deleted.`)) return
            try { await api.projects.delete(project.id); onDeleted() } catch (e) { notifyError(e) }
          }}>Delete project</button>
        </div>
      </div>
    </Modal>
  )
}

export function AddTicketDialog({ project, existingTicketIds, sections, onClose, onAdded }) {
  const [tickets, setTickets] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { api.tickets.list().then(setTickets).catch(e => { notifyError(e); setTickets([]) }) }, [])
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (tickets || []).filter(t => !existingTicketIds.has(t.id) && (!n || t.title.toLowerCase().includes(n) || `#${t.num}`.includes(n))).slice(0, 30)
  }, [tickets, q, existingTicketIds])
  const add = async (t) => { try { await api.projects.addTicket(project.id, { ticket_id: t.id, section_id: sections[0]?.id }); onAdded() } catch (e) { notifyError(e) } }
  return (
    <Modal title="Add a service request to this project" onClose={onClose}>
      <input autoFocus aria-label="Search tickets" className="input mb-3" placeholder="Search by subject or #number" value={q} onChange={e => setQ(e.target.value)} />
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
        {tickets === null && <div className="text-sm text-gray-400 py-3">Loading…</div>}
        {tickets && rows.length === 0 && <div className="text-sm text-gray-400 py-3">No tickets to add.</div>}
        {rows.map(t => (
          <button key={t.id} onClick={() => add(t)} className="w-full text-left py-2 px-1 hover:bg-gray-50 flex items-center gap-3">
            <span className="text-xs font-mono text-gray-400 w-12">#{t.num}</span><span className="text-sm truncate flex-1">{t.title}</span><span className="text-xs text-gray-400">{t.status.replace('_', ' ')}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
