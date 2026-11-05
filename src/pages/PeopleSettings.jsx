import { useState, useEffect, useMemo } from 'react'
import { api } from '../api.js'
import { Avatar } from '../components/Badge.jsx'
import { Modal } from '../components/Modal.jsx'
import { useAuth, isAdmin } from '../AuthContext.jsx'

const ROLES = ['admin', 'manager', 'agent', 'requestor']
const ROLE_INFO = {
  admin:     { label: 'Admin',     desc: 'Full access: manage people, departments, routing, and every ticket.', cls: 'bg-purple-100 text-purple-700' },
  manager:   { label: 'Manager',   desc: 'See all tickets, edit ticket fields, reply, and view the team.',      cls: 'bg-blue-100 text-blue-700' },
  agent:     { label: 'Agent',     desc: 'See all tickets and reply. Cannot edit ticket fields.',               cls: 'bg-cyan-100 text-cyan-700' },
  requestor: { label: 'Requestor', desc: 'Can only create and view their own tickets.',                         cls: 'bg-gray-100 text-gray-600' },
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="btn-secondary text-xs" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
    }}>{copied ? '✓ Copied' : 'Copy'}</button>
  )
}

export default function PeopleSettings() {
  const { user } = useAuth()
  const admin = isAdmin(user)
  const [tab, setTab] = useState('people')
  const [users, setUsers] = useState([])
  const [departments, setDepartments] = useState([])
  const [tickets, setTickets] = useState([])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showNewUser, setShowNewUser] = useState(false)
  const [showNewDept, setShowNewDept] = useState(false)
  const [showRoles, setShowRoles] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'agent', dept: '', password: genPassword() })
  const [newDept, setNewDept] = useState({ name: '', color: '#3b82f6' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)         // { email, password, title }
  const [resetTarget, setResetTarget] = useState(null)
  const [resetForm, setResetForm] = useState({ mode: 'generate', password: '', requireChange: true })
  const [resetting, setResetting] = useState(false)

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

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter(u =>
      (!roleFilter || u.role === roleFilter) &&
      (!q || `${u.name} ${u.email}`.toLowerCase().includes(q))
    )
  }, [users, query, roleFilter])

  const adminTotal = users.filter(u => u.role === 'admin').length

  const handleAddUser = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.users.create({ ...newUser, dept: newUser.dept || null })
      setNotice({ title: `Created ${newUser.email}`, email: newUser.email, password: newUser.password })
      setShowNewUser(false)
      setNewUser({ name: '', email: '', role: 'agent', dept: '', password: genPassword() })
      load()
    } catch (e) { setError(e.message) }
  }

  const handleAddDept = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.departments.create(newDept)
      setShowNewDept(false)
      setNewDept({ name: '', color: '#3b82f6' })
      load()
    } catch (e) { setError(e.message) }
  }

  const updateRole = async (u, role) => {
    const verb = role === 'admin' ? `Make ${u.name} an ADMIN? They will have full control, including managing other people.`
      : `Change ${u.name}'s role from ${ROLE_INFO[u.role].label} to ${ROLE_INFO[role].label}?`
    if (!confirm(verb)) { load(); return }
    try { await api.users.update(u.id, { role }); load() } catch (e) { alert(e.message); load() }
  }
  const updateDept = async (id, dept) => {
    try { await api.users.update(id, { dept: dept || null }); load() } catch (e) { alert(e.message) }
  }

  const deleteUser = async (u) => {
    if (!confirm(`Remove ${u.name}? Their tickets are kept, but they will lose access immediately.`)) return
    try { await api.users.delete(u.id); load() } catch (e) { alert(e.message) }
  }

  const deleteDept = async (id) => {
    if (!confirm('Delete this department? Tickets and users will become unassigned.')) return
    await api.departments.delete(id); load()
  }

  const openReset = (u) => {
    setError('')
    setResetForm({ mode: 'generate', password: '', requireChange: true })
    setResetTarget(u)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setError('')
    if (resetForm.mode === 'custom' && resetForm.password.length < 8) return setError('Password must be at least 8 characters.')
    setResetting(true)
    try {
      const r = await api.users.resetPassword(resetTarget.id, {
        password: resetForm.mode === 'custom' ? resetForm.password : undefined,
        requireChange: resetForm.requireChange,
      })
      setNotice({
        title: `Password reset for ${resetTarget.email}`,
        email: resetTarget.email,
        password: r.temporaryPassword || resetForm.password,
        requireChange: resetForm.requireChange,
      })
      setResetTarget(null)
      load()
    } catch (e) { setError(e.message) } finally { setResetting(false) }
  }

  const COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#64748b']

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">People & Departments</h1>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {['people', 'departments'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="font-semibold">{notice.title}</div>
            <button className="text-blue-500 hover:text-blue-700" onClick={() => setNotice(null)}>✕</button>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span>Temporary password:</span>
            <code className="bg-white px-2 py-1 rounded border border-blue-200 font-mono select-all">{notice.password}</code>
            <CopyButton text={notice.password} />
          </div>
          <p className="mt-2 text-xs text-blue-700">
            Share it privately (not in a ticket or group chat). It is shown only now — close this and it can't be retrieved, but you can always reset again.
            {notice.requireChange === false ? '' : ' They will be asked to choose their own password at next sign-in.'}
          </p>
        </div>
      )}

      {tab === 'people' && (
        <div>
          <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Team Members ({filteredUsers.length}{filteredUsers.length !== users.length ? ` of ${users.length}` : ''})</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="input w-52" placeholder="Search name or email…" value={query} onChange={e => setQuery(e.target.value)} />
              <select className="input w-36" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
              </select>
              {admin && <button className="btn-primary" onClick={() => { setError(''); setShowNewUser(true) }}>＋ Add Person</button>}
            </div>
          </div>

          <button className="text-xs text-blue-600 hover:underline mb-3" onClick={() => setShowRoles(s => !s)}>
            {showRoles ? 'Hide' : 'What can each role do?'}
          </button>
          {showRoles && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
              {ROLES.map(r => (
                <div key={r} className="card px-4 py-3 flex items-start gap-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_INFO[r].cls}`}>{ROLE_INFO[r].label}</span>
                  <span className="text-xs text-gray-500">{ROLE_INFO[r].desc}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Person</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Department</th>
                  {admin && <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={admin ? 4 : 3} className="px-4 py-8 text-center text-gray-400">No matching people</td></tr>
                )}
                {filteredUsers.map(u => {
                  const isSelf = u.id === user.id
                  const lastAdmin = u.role === 'admin' && adminTotal <= 1
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} color={u.color} size="md" />
                          <div>
                            <div className="font-medium text-gray-800">
                              {u.name}{isSelf && <span className="ml-1.5 text-xs text-gray-400 font-normal">(you)</span>}
                            </div>
                            <div className="text-xs text-gray-400">{u.email}</div>
                            <div className="flex gap-1 mt-0.5">
                              {!u.verified && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 rounded">Unverified</span>}
                              {u.must_change_password && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 rounded" title="Has a temporary password">Temp password</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {admin && !isSelf ? (
                          <select className="input py-1 text-xs w-32" value={u.role} disabled={lastAdmin} title={lastAdmin ? 'At least one admin is required' : ''} onChange={e => updateRole(u, e.target.value)}>
                            {ROLES.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_INFO[u.role]?.cls}`} title={isSelf ? 'You cannot change your own role' : ''}>{ROLE_INFO[u.role]?.label || u.role}</span>
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
                          <div className="flex items-center justify-end gap-3">
                            {!isSelf && <button className="text-xs text-blue-600 hover:underline whitespace-nowrap" onClick={() => openReset(u)}>Reset password</button>}
                            {!isSelf && !lastAdmin && <button className="text-gray-300 hover:text-red-500 transition-colors" title="Remove user" onClick={() => deleteUser(u)}>✕</button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'departments' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-700">Departments ({departments.length})</h2>
            {admin && <button className="btn-primary" onClick={() => { setError(''); setShowNewDept(true) }}>＋ Add Department</button>}
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

      {resetTarget && (
        <Modal title={`Reset password — ${resetTarget.name}`} onClose={() => setResetTarget(null)}>
          <form onSubmit={handleReset} className="space-y-4">
            {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded px-3 py-2 text-sm">{error}</div>}
            <p className="text-sm text-gray-600">
              This signs <strong>{resetTarget.email}</strong> out everywhere and replaces their password.
              {!resetTarget.verified && ' It also marks their unverified email as verified.'}
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={resetForm.mode === 'generate'} onChange={() => setResetForm(f => ({ ...f, mode: 'generate' }))} />
                Generate a random temporary password
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={resetForm.mode === 'custom'} onChange={() => setResetForm(f => ({ ...f, mode: 'custom' }))} />
                I'll type one myself
              </label>
              {resetForm.mode === 'custom' && (
                <div className="flex gap-2 pl-6">
                  <input className="input font-mono" minLength={8} value={resetForm.password} onChange={e => setResetForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" autoFocus />
                  <button type="button" className="btn-secondary text-xs" onClick={() => setResetForm(f => ({ ...f, password: genPassword() }))}>Suggest</button>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="rounded" checked={resetForm.requireChange} onChange={e => setResetForm(f => ({ ...f, requireChange: e.target.checked }))} />
              Require them to choose a new password at next sign-in
            </label>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>Cancel</button>
              <button className="btn-primary" disabled={resetting}>{resetting ? 'Resetting…' : 'Reset password'}</button>
            </div>
          </form>
        </Modal>
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
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
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
            <p className="text-xs text-gray-400 -mt-2">{ROLE_INFO[newUser.role].desc}</p>
            <div>
              <label className="label">Temporary Password</label>
              <div className="flex gap-2">
                <input className="input font-mono" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} required minLength={8} />
                <button type="button" className="btn-secondary text-xs" onClick={() => setNewUser(u => ({ ...u, password: genPassword() }))}>Regenerate</button>
              </div>
              <p className="text-xs text-gray-400 mt-1">They'll be asked to choose their own password at first sign-in.</p>
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
