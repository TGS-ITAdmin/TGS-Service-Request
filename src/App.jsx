import { useState } from 'react'
import Dashboard from './pages/Dashboard.jsx'
import TicketList from './pages/TicketList.jsx'
import TicketDetail from './pages/TicketDetail.jsx'
import NewTicket from './pages/NewTicket.jsx'
import PeopleSettings from './pages/PeopleSettings.jsx'
import Login from './pages/Login.jsx'
import { AuthProvider, useAuth, isStaff, isAdmin } from './AuthContext.jsx'
import { Avatar } from './components/Badge.jsx'

function Shell() {
  const { user, checking, logout } = useAuth()
  const [page, setPage] = useState('dashboard')
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey(k => k + 1)

  const handleNewCreated = (ticket) => {
    setShowNew(false)
    refresh()
    setSelectedTicket(ticket.id)
    setPage('tickets')
  }

  if (checking) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading…</div>
  }
  if (!user) return <Login />

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', icon: '▦' },
    { id: 'tickets', label: 'Tickets', icon: '🎫' },
    ...(isStaff(user) ? [{ id: 'people', label: 'People', icon: '👥' }] : []),
  ]

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 bg-slate-900 flex flex-col flex-shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎫</span>
            <div>
              <div className="text-white font-bold text-base leading-tight">HelpDesk</div>
              <div className="text-slate-400 text-xs">Ticketing System</div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => { setPage(n.id); if (n.id !== 'tickets') setSelectedTicket(null) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                page === n.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </div>

        <div className="px-3 py-4 border-t border-slate-800">
          <button
            onClick={() => setShowNew(true)}
            className="w-full btn bg-blue-600 text-white hover:bg-blue-500 justify-center"
          >
            ＋ New Ticket
          </button>
        </div>

        <div className="px-5 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <Avatar name={user.name} color={user.color} />
            <div className="min-w-0">
              <div className="text-white text-xs font-medium truncate">{user.name}</div>
              <div className="text-slate-500 text-xs truncate">{user.email}</div>
            </div>
            <button onClick={logout} className="ml-auto text-slate-500 hover:text-white text-xs" title="Sign out">⎋</button>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        {page === 'dashboard' && <Dashboard onSelect={(id) => { setSelectedTicket(id); setPage('tickets') }} />}
        {page === 'tickets' && !selectedTicket && (
          <TicketList
            onSelect={setSelectedTicket}
            onNew={() => setShowNew(true)}
            refreshKey={refreshKey}
          />
        )}
        {page === 'tickets' && selectedTicket && (
          <TicketDetail
            ticketId={selectedTicket}
            onBack={() => setSelectedTicket(null)}
            onUpdated={refresh}
          />
        )}
        {page === 'people' && isStaff(user) && <PeopleSettings />}
      </main>

      {showNew && <NewTicket onClose={() => setShowNew(false)} onCreated={handleNewCreated} />}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
