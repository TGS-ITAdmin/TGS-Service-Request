import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Modal } from '../components/Modal.jsx'
import { useAuth, isStaff } from '../AuthContext.jsx'

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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="label">Due Date</label>
            <input type="date" className="input" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </div>
        </div>

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
        <p className="text-xs text-gray-400 -mt-2">Tickets are routed to the right agent automatically based on department and category.</p>

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
