import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'
import { Modal } from '../components/Modal.jsx'

// forced=true: full-screen gate shown when an admin issued a temporary password.
// forced=false: regular modal opened from the sidebar.
export default function ChangePassword({ forced = false, onClose }) {
  const { user, setSession, logout } = useAuth()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword.length < 8) return setError('New password must be at least 8 characters.')
    if (form.newPassword !== form.confirm) return setError('New passwords do not match.')
    setSaving(true)
    try {
      const r = await api.auth.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      setSession(r.token, r.user)
      if (forced) return          // gate disappears once must_change_password is false
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  const body = done ? (
    <div className="space-y-4">
      <div className="bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-2 text-sm">Your password has been changed.</div>
      <div className="flex justify-end"><button className="btn-primary" onClick={onClose}>Done</button></div>
    </div>
  ) : (
    <form onSubmit={submit} className="space-y-4">
      {forced && (
        <div className="bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2 text-sm">
          Hi {user.name.split(' ')[0]}, you're using a temporary password. Please choose your own to continue.
        </div>
      )}
      {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-sm">{error}</div>}
      <div>
        <label className="label">{forced ? 'Temporary password' : 'Current password'}</label>
        <input className="input" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={e => set('currentPassword', e.target.value)} />
      </div>
      <div>
        <label className="label">New password</label>
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.newPassword} onChange={e => set('newPassword', e.target.value)} />
        <p className="text-xs text-gray-400 mt-1">At least 8 characters.</p>
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input className="input" type="password" autoComplete="new-password" required value={form.confirm} onChange={e => set('confirm', e.target.value)} />
      </div>
      <div className="flex justify-end gap-3 pt-1">
        {!forced && <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}
        <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  )

  if (!forced) return <Modal title="Change Password" onClose={onClose}>{body}</Modal>

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1">🔑</div>
          <div className="text-xl font-bold text-gray-900">Set your password</div>
        </div>
        <div className="card p-6">{body}</div>
        <button onClick={logout} className="block mx-auto mt-4 text-sm text-gray-400 hover:text-gray-600">Sign out</button>
      </div>
    </div>
  )
}
