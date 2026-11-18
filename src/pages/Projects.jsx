import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { notifyError } from '../lib/errors.js'
import ProjectView from './ProjectView.jsx'
import { NewProjectDialog } from '../components/ProjectDialogs.jsx'
import { PRIVACY_LABEL } from '../../shared/projects.js'

function ProjectCard({ p, onOpen }) {
  const pct = p.item_total ? Math.round((p.item_done / p.item_total) * 100) : 0
  return (
    <button onClick={onOpen} className="card p-4 text-left hover:shadow-md transition-shadow w-full" aria-label={`Open project ${p.name}`}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: p.color }} />
        <span className="font-semibold text-gray-900 truncate">{p.name}</span>
        {p.archived && <span className="text-[11px] bg-gray-200 text-gray-600 rounded px-1.5">Archived</span>}
      </div>
      {p.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{p.description}</p>}
      <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full" style={{ width: `${pct}%`, background: p.color }} /></div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>{p.item_done} of {p.item_total} complete</span>
        <span>{p.member_count} member{p.member_count === 1 ? '' : 's'} · {PRIVACY_LABEL[p.privacy]}</span>
      </div>
    </button>
  )
}

export default function Projects({ openId, onOpen }) {
  const [projects, setProjects] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(() => api.projects.list().then(setProjects).catch(e => { notifyError(e); setProjects([]) }), [])
  useEffect(() => { load() }, [load])

  if (openId) return <ProjectView projectId={openId} onBack={() => { onOpen(null); load() }} onDeleted={() => { onOpen(null); load() }} onProjectsChanged={load} />

  const active = (projects || []).filter(p => !p.archived)
  const archived = (projects || []).filter(p => p.archived)
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center mb-6">
          <div><h1 className="text-2xl font-bold text-gray-900">Projects</h1><p className="text-sm text-gray-500">Groups of tasks and service requests your team works on together.</p></div>
          <button className="btn-primary ml-auto" onClick={() => setShowNew(true)}>＋ New project</button>
        </div>
        {projects === null && <div className="text-gray-400">Loading…</div>}
        {projects && active.length === 0 && (
          <div className="card p-10 text-center text-gray-500">
            <div className="text-3xl mb-2">📋</div><div className="font-medium text-gray-800">No projects yet</div>
            <p className="text-sm mt-1">Create a project to plan work as tasks, sections and a board.</p>
            <button className="btn-primary mx-auto mt-4" onClick={() => setShowNew(true)}>Create your first project</button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(p => <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.id)} />)}</div>
        {archived.length > 0 && (
          <div className="mt-8">
            <button className="text-sm text-gray-500 hover:text-gray-800" onClick={() => setShowArchived(s => !s)}>{showArchived ? '▾' : '▸'} Archived ({archived.length})</button>
            {showArchived && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-3">{archived.map(p => <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.id)} />)}</div>}
          </div>
        )}
      </div>
      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} onCreated={(p) => { setShowNew(false); load(); onOpen(p.id) }} />}
    </div>
  )
}
