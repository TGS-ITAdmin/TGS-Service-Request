import { useState } from 'react'
import { api } from '../api.js'
import { Modal } from '../components/Modal.jsx'
import { useAuth, isStaff } from '../AuthContext.jsx'
import { PRIORITY_META } from '../lib/meta.js'
import { CLIENTS, SITES, CONCERNS, URGENCY_NOTE, DETAILS_NOTE, validateServiceRequest } from '../../shared/ticketForm.js'

export default function NewTicket({ onClose, onCreated }) {
  const { user } = useAuth()
  const staff = isStaff(user)
  const [first0, ...rest0] = (staff ? '' : user.name || '').split(' ')
  const [form, setForm] = useState({
    title: '', description: '', priority: '',
    client: '', site: '', category: '', due_date: '',
    firstName: first0 || '', lastName: rest0.join(' '),
    reqEmail: staff ? '' : user.email,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState([])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Request Title is required.'); return }
    if (!form.priority) { setError('Urgency is required.'); return }
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First Name and Last Name are required.'); return }
    if (!form.reqEmail.trim()) { setError('Email address is required.'); return }
    const formError = validateServiceRequest(form)
    if (formError) { setError(formError + '.'); return }
    setLoading(true)
    try {
      const { firstName, lastName, ...rest } = form
      const ticket = await api.tickets.create({
        ...rest,
        reqName: `${firstName.trim()} ${lastName.trim()}`,
        due_date: form.due_date || null,
      })
      for (const f of files) {
        try { await api.tickets.uploadAttachment(ticket.id, f) }
        catch (e) { alert(`Ticket created, but "${f.name}" could not be attached: ${e.message}`) }
      }
      onCreated(ticket)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Service request" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm">{error}</div>}

        <div>
          <label className="label">Request Title *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Enter your answer" />
        </div>

        <div>
          <label className="label">Urgency *</label>
          <p className="text-xs text-gray-500 mb-1">{URGENCY_NOTE}</p>
          <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option value="">Choose one</option>
            {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{PRIORITY_META[p].desc}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">First Name *</label>
            <input className="input" value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="Enter your name" />
          </div>
          <div>
            <label className="label">Last Name *</label>
            <input className="input" value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Enter your answer" />
          </div>
        </div>

        <div>
          <label className="label">Email address (Responses will be sent to this email address) *</label>
          <input className="input" type="email" value={form.reqEmail} onChange={e => set('reqEmail', e.target.value)} placeholder="Enter your email address" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Client *</label>
            <select className="input" value={form.client} onChange={e => set('client', e.target.value)}>
              <option value="">Choose one</option>
              {CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Site *</label>
            <select className="input" value={form.site} onChange={e => set('site', e.target.value)}>
              <option value="">Choose one</option>
              {SITES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Concern *</label>
          <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="">Choose one</option>
            {CONCERNS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Your request is routed to the right team automatically based on the concern.</p>
        </div>

        <div>
          <label className="label">Details of Request *</label>
          <p className="text-xs text-gray-500 mb-1">{DETAILS_NOTE}</p>
          <textarea className="input resize-none h-28" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Enter your answer" />
        </div>

        {staff && (
          <div>
            <label className="label">Due date <span className="font-normal text-gray-400">(optional, staff only; overrides the automatic date)</span></label>
            <input type="date" className="input w-48" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </div>
        )}

        <div>
          <label className="label">Screenshots or Files to support request</label>
          <input type="file" multiple data-testid="new-ticket-files"
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-200"
            onChange={e => {
              const picked = Array.from(e.target.files || [])
              const tooBig = picked.filter(f => f.size > 10 * 1024 * 1024)
              if (tooBig.length) alert(`${tooBig.map(f => f.name).join(', ')} exceed${tooBig.length === 1 ? 's' : ''} the 10 MB limit and will be skipped.`)
              setFiles(picked.filter(f => f.size <= 10 * 1024 * 1024))
            }} />
          {files.length > 0 && <p className="text-xs text-gray-400 mt-1">{files.length} file{files.length > 1 ? 's' : ''} will be attached.</p>}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating…' : 'Submit'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
