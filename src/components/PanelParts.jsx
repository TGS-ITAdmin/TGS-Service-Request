import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { fmtDateTime, fmtSize, previewInfo } from '../lib/meta.js'
import { saveAttachment } from './AttachmentPreview.jsx'
import { IconClose, IconDownload, IconFile } from './Icons.jsx'

// Pieces shared by the ticket panel and the task panel.
export const FIELD_CTRL = 'w-full bg-transparent rounded border border-transparent hover:border-gray-300 hover:bg-white focus:border-blue-400 focus:bg-white focus:outline-none px-2 py-1 text-sm cursor-pointer'

export function Field({ label, children }) {
  return (
    <div className="flex items-center min-h-[36px] py-0.5">
      <div className="w-32 flex-shrink-0 text-sm text-gray-500">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export function SectionHeader({ title, count, action }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {count !== undefined && <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5">{count}</span>}
      <div className="ml-auto">{action}</div>
    </div>
  )
}

export function AttachmentItem({ ticketId, a, canDelete, onDelete, onOpen, scope = 'tickets' }) {
  const [thumb, setThumb] = useState(null)
  useEffect(() => {
    let url = null
    let cancelled = false
    const info = previewInfo(a)
    if (info.kind === 'image' && a.size < 3 * 1024 * 1024 && typeof URL.createObjectURL === 'function') {
      api[scope].downloadAttachment(ticketId, a.id).then(blob => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([blob], { type: info.mime }))
        setThumb(url)
      }).catch(() => {})
    }
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [ticketId, scope, a.id, a.mime, a.size, a.filename])

  return (
    <div className="group flex items-center gap-3 py-2 border-b border-gray-100">
      <button onClick={onOpen} aria-label={`Preview ${a.filename}`} className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 text-gray-400 hover:ring-2 hover:ring-blue-300">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <IconFile width={18} height={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} title="Click to preview" className="text-sm text-blue-600 hover:underline truncate block max-w-full text-left">{a.filename}</button>
        <div className="text-xs text-gray-400">{fmtSize(a.size)} · {a.uploaded_by_name} · {fmtDateTime(a.created_at)}</div>
      </div>
      <button title="Download" aria-label={`Download ${a.filename}`} onClick={() => saveAttachment(ticketId, a, scope)} className="text-gray-400 hover:text-gray-700"><IconDownload /></button>
      {canDelete && <button title="Remove" aria-label={`Remove ${a.filename}`} onClick={onDelete} className="text-gray-300 hover:text-red-500"><IconClose /></button>}
    </div>
  )
}

