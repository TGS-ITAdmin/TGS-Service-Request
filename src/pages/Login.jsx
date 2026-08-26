import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

export default function Login() {
  const { login, setSession } = useAuth()
  const [screen, setScreen] = useState('login') // login | register | verify
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(form.email, form.password)
    } catch (err) {
      if (err.code === 'unverified') { setScreen('verify'); setError('Please verify your email first.') }
      else setError(err.message)
    } finally { setLoading(false) }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const r = await api.auth.register(form)
      setPreviewUrl(r.emailPreviewUrl || null)
      setScreen('verify')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const r = await api.auth.verify({ email: form.email, code })
      setSession(r.token, r.user)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const handleResend = async () => {
    setError(''); setMsg('')
    try {
      const r = await api.auth.resend({ email: form.email })
      setPreviewUrl(r.emailPreviewUrl || null)
      setMsg('New code sent.')
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-1">🎫</div>
          <div className="text-xl font-bold text-gray-900">HelpDesk</div>
          <div className="text-sm text-gray-500">Ticketing System</div>
        </div>

        <div className="card p-6">
          {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-sm mb-4">{error}</div>}
          {msg && <div className="bg-green-50 text-green-700 border border-green-200 rounded-lg px-3 py-2 text-sm mb-4">{msg}</div>}

          {screen === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" required value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" required value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <button className="btn-primary w-full justify-center" disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
              <button type="button" className="text-sm text-blue-600 hover:underline w-full text-center" onClick={() => { setScreen('register'); setError('') }}>
                Need an account? Register
              </button>
            </form>
          )}

          {screen === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" required value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" required minLength={8} value={form.password} onChange={e => set('password', e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">At least 8 characters.</p>
              </div>
              <button className="btn-primary w-full justify-center" disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</button>
              <button type="button" className="text-sm text-blue-600 hover:underline w-full text-center" onClick={() => { setScreen('login'); setError('') }}>
                Already have an account? Sign in
              </button>
            </form>
          )}

          {screen === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-gray-600">Enter the 6-digit code sent to <strong>{form.email}</strong>.</p>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 hover:underline">
                  Dev mode: view test email →
                </a>
              )}
              <div>
                <label className="label">Verification Code</label>
                <input className="input tracking-widest text-center text-lg" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
              </div>
              <button className="btn-primary w-full justify-center" disabled={loading}>{loading ? 'Verifying…' : 'Verify & Sign In'}</button>
              <button type="button" className="text-sm text-blue-600 hover:underline w-full text-center" onClick={handleResend}>
                Resend code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
