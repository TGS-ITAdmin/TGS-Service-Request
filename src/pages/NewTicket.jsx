import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Modal } from '../components/Modal.jsx'
import { useAuth, isStaff } from '../AuthContext.jsx'
import { PRIORITY_META } from '../lib/meta.js'

export default function NewTicket({ onClose, onCreated }) {
  const { user } = useAuth()
  const staff = isStaff(user)
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    dept: '', category: '', due_date: '',
    reqName: staff ? '' : user.name,
    reqEmail: staff ? '' : user.email,
  })
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState([])

  useEffect(() => { api.departments.list().then(setDepartments) }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const selectedDept = departments.find(d => d.id === form.dept)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim()) { setError('Subject is required.'); return }
    if (staff && (!form.reqName.trim() || !form.reqEmail.trim())) {
      setError('Requestor name and email are required.'); return
    }
    setLoading(true)
    try {
      const ticket = await api.tickets.create({
        ...form,
        dept: form.dept || null,
        category: form.category || null,
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
    <Modal title="Create New Ticket" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-2 text-sm">{error}</div>}

        {staff && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Requestor Name *</label>
              <input className="input" value={form.reqName} onChange={e => set('reqName', e.target.value)} placeholder="John Doe" />
            </div>
            <div>
              <label className="label">Requestor Email *</label>
              <input className="input" type="email" value={form.reqEmail} onChange={e => set('reqEmail', e.target.value)} placeholder="john@company.com" />
            </div>
          </div>
        )}

        <div>
          <label className="label">Subject *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Brief description of the issue" />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input resize-none h-28"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            placeholder="Provide as much detail as possible…"
          />
        </div>

        <div>
          <label className="label">Priority</label>
          <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
            <option value="urgent">{PRIORITY_META.urgent.desc}</option>
            <option value="high">{PRIORITY_META.high.desc}</option>
            <option value="medium">{PRIORITY_META.medium.desc}</option>
            <option value="low">{PRIORITY_META.low.desc}</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">The due date is set automatically from the priority.</p>
        </div>
        {staff && (
          <div>
            <label className="label">Due date <span className="font-normal text-gray-400">(optional — overrides the automatic date)</span></label>
            <input type="date" className="input w-48" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Department</label>
            <select className="input" value={form.dept} onChange={e => { set('dept', e.target.value); set('category', '') }}>
              <option value="">Unassigned</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)} disabled={!selectedDept}>
              <option value="">None</option>
              {(selectedDept?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400 -mt-2">Tickets are routed to the right person automatically based on department and category.</p>

        <div>
          <label className="label">Attachments</label>
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
            {loading ? 'Creating…' : '🎫 Create Ticket'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
