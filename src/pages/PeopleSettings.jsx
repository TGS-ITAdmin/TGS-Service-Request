import { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'
import { Avatar } from '../components/Badge.jsx'
import { Modal } from '../components/Modal.jsx'
import { useAuth, isAdmin } from '../AuthContext.jsx'

function genPassword() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

export default function PeopleSettings() {
  const { user } = useAuth()
  const admin = isAdmin(user)
  const [tab, setTab] = useState('people')
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [tickets, setTickets] = useState([])
  const [showNewUser, setShowNewUser] = useState(false)
  const [showNewDept, setShowNewDept] = useState(false)
  const [newUser, setNewUser] = useState({ name:'', email:'', role:'agent', dept:'', password: genPassword() })
  const [newDept, setNewDept] = useState({ name:'', color:'#3b82f6' })
  const [error, setError] = useState('')
  const [createdCreds, setCreatedCreds] = useState(null)

  const load = () => {
    api.users.list().then(setUsers)
    api.departments.list().then(setDepartments)
    api.tickets.list().then(setTickets)
  }
  useEffect(load, [])

  const deptCounts = useMemo(() => {
    const map = {}
    for (const d of departments) {
      map[d.id] = {
        members: users.filter(u => u.dept === d.id).length,
        tickets: tickets.filter(t => t.dept === d.id).length,
      }
    }
    return map
  }, [departments, users, tickets])

  const handleAddUser = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.users.create({ ...newUser, dept: newUser.dept || null })
      setCreatedCreds({ email: newUser.email, password: newUser.password })
      setShowNewUser(false)
      setNewUser({ name:'', email:'', role:'agent', dept:'', password: genPassword() })
      load()
    } catch (e) { setError(e.message) }
  }

  const handleAddDept = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.departments.create(newDept)
      setShowNewDept(false)
      setNewDept({ name:'', color:'#3b82f6' })
      load()
    } catch (e) { setError(e.message) }
  }

  const updateRole = async (id, role) => {
    try { await api.users.update(id, { role }); load() } catch (e) { alert(e.message) }
  }
  const updateDept = async (id, dept) => {
    try { await api.users.update(id, { dept: dept || null }); load() } catch (e) { alert(e.message) }
  }

  const deleteUser = async (id) => {
    if (!confirm('Remove this user?')) return
    await api.users.delete(id); load()
  }

  const deleteDept = async (id) => {
    if (!confirm('Delete this department? Tickets and users will become unassigned.')) return
    await api.departments.delete(id); load()
  }

  const COLORS = ['#3b82f6','#06b6d4','#10b981','#f59e0b','#8b5cf6','#ef4444','#ec4899','#64748b']

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">People & Departments</h1>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {['people','departments'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {createdCreds && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          <span>Created <strong>{createdCreds.email}</strong> with temporary password <code className="bg-white px-1.5 py-0.5 rounded border border-blue-200">{createdCreds.password}</code> — share it securely and ask them to change it.</span>
          <button className="text-blue-500 hover:text-blue-700 ml-4" onClick={() => setCreatedCreds(null)}>✕</button>
        </div>
      )}

      {tab === 'people' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Team Members ({users.length})</h2>
            {admin && <button className="btn-primary" onClick={() => setShowNewUser(true)}>＋ Add Person</button>}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Person</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Department</th>
                  {admin && <th className="px-4 py-3 w-16"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} color={u.color} size="md" />
                        <div>
                          <div className="font-medium text-gray-800">{u.name}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {admin && u.id !== user.id ? (
                        <select className="input py-1 text-xs w-28" value={u.role} onChange={e => updateRole(u.id, e.target.value)}>
                          <option value="admin">Admin</option>
                          <option value="manager">Manager</option>
                          <option value="agent">Agent</option>
                          <option value="requestor">Requestor</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          u.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{u.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {admin ? (
                        <select className="input py-1 text-xs w-36" value={u.dept || ''} onChange={e => updateDept(u.id, e.target.value)}>
                          <option value="">None</option>
                          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      ) : (
                        departments.find(d => d.id === u.dept)?.name || <span className="text-gray-300">—</span>
                      )}
                    </td>
                    {admin && (
                      <td className="px-4 py-3">
                        {u.id !== user.id && <button className="text-gray-300 hover:text-red-500 transition-colors" onClick={() => deleteUser(u.id)}>✕</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'departments' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Departments ({departments.length})</h2>
            {admin && <button className="btn-primary" onClick={() => setShowNewDept(true)}>＋ Add Department</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map(d => (
              <div key={d.id} className="card p-5 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: d.color + '22' }}>
                    <span className="w-4 h-4 rounded-full" style={{ backgroundColor: d.color, display: 'block' }} />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-800">{d.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{deptCounts[d.id]?.members ?? 0} members · {deptCounts[d.id]?.tickets ?? 0} tickets</div>
                    {d.categories?.length > 0 && (
                      <div className="text-xs text-gray-400 mt-1">{d.categories.length} categories</div>
                    )}
                  </div>
                </div>
                {admin && <button className="text-gray-300 hover:text-red-500 transition-colors" onClick={() => deleteDept(d.id)}>✕</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showNewUser && (
        <Modal title="Add Team Member" onClose={() => { setShowNewUser(false); setError('') }}>
          <form onSubmit={handleAddUser} className="space-y-4">
            {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded px-3 py-2 text-sm">{error}</div>}
            <div>
              <label className="label">Full Name *</label>
              <input className="input" value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Email *</label>
              <input className="input" type="email" value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Role</label>
                <select className="input" value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}>
                  <option value="agent">Agent</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="label">Department</label>
                <select className="input" value={newUser.dept} onChange={e => setNewUser(u => ({ ...u, dept: e.target.value }))}>
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Temporary Password</label>
              <div className="flex gap-2">
                <input className="input font-mono" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} required minLength={8} />
                <button type="button" className="btn-secondary text-xs" onClick={() => setNewUser(u => ({ ...u, password: genPassword() }))}>Regenerate</button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Share this with them directly — it won't be shown again after creation.</p>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setShowNewUser(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Add Member</button>
            </div>
          </form>
        </Modal>
      )}

      {showNewDept && (
        <Modal title="Add Department" onClose={() => { setShowNewDept(false); setError('') }}>
          <form onSubmit={handleAddDept} className="space-y-4">
            {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded px-3 py-2 text-sm">{error}</div>}
            <div>
              <label className="label">Department Name *</label>
              <input className="input" value={newDept.name} onChange={e => setNewDept(d => ({ ...d, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Color</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {COLORS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setNewDept(d => ({ ...d, color: c }))}
                    className={`w-8 h-8 rounded-full transition-transform ${newDept.color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-400' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setShowNewDept(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Add Department</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
