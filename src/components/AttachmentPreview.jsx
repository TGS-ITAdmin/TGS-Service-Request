import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'
import { previewInfo, fmtSize } from '../lib/meta.js'
import { IconClose, IconDownload, IconFile } from './Icons.jsx'

const MAX_TEXT_CHARS = 200000

// Saves a file to the user's computer (only ever called from an explicit Download click).
export async function saveAttachment(ticketId, a) {
  try {
    const blob = await api.tickets.downloadAttachment(ticketId, a.id)
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url; el.download = a.filename
    document.body.appendChild(el); el.click(); el.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) { alert(e.message) }
}

// Full-screen viewer for a ticket's attachments. Click a file to open it here instead of downloading it.
export default function AttachmentPreview({ ticketId, items, startId, onClose }) {
  const [currentId, setCurrentId] = useState(startId)
  const [view, setView] = useState({ status: 'loading' })
  const idx = items.findIndex(x => x.id === currentId)
  const a = items[idx]

  // the file was removed while open
  useEffect(() => { if (idx === -1) onClose() }, [idx, onClose])

  const go = (delta) => {
    if (items.length < 2) return
    setCurrentId(items[(idx + delta + items.length) % items.length].id)
  }

  // Esc / arrows. Capture phase + stopPropagation so Esc closes only the viewer, not the ticket panel behind it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1) }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    if (!a) return undefined
    let url = null
    let cancelled = false
    const info = previewInfo(a)
    setView({ status: info.kind === 'none' ? 'none' : 'loading' })
    if (info.kind === 'none') return undefined
    api.tickets.downloadAttachment(ticketId, a.id).then(async (blob) => {
      if (cancelled) return
      const typed = new Blob([blob], { type: info.mime })      // we choose the type; never trust what the upload claimed
      if (info.kind === 'text') {
        const text = await typed.text()
        if (!cancelled) setView({ status: 'ready', kind: 'text', text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS })
      } else {
        url = URL.createObjectURL(typed)
        setView({ status: 'ready', kind: info.kind, url })
      }
    }).catch((e) => { if (!cancelled) setView({ status: 'error', error: e.message }) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [ticketId, a?.id])    // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null
  const stop = (e) => e.stopPropagation()

  let body
  if (view.status === 'loading') body = <div className="text-white/80 text-sm">Loading preview…</div>
  else if (view.status === 'error') body = <div className="text-red-200 text-sm">Could not load this file: {view.error}</div>
  else if (view.status === 'none') {
    body = (
      <div className="bg-white rounded-xl p-8 text-center max-w-sm" data-testid="no-preview">
        <div className="mx-auto w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3"><IconFile width={26} height={26} /></div>
        <div className="font-medium text-gray-900 break-words">{a.filename}</div>
        <p className="text-sm text-gray-500 mt-1">Preview isn't available for this file type.</p>
        <button className="btn-primary mt-4 mx-auto" onClick={() => saveAttachment(ticketId, a)}><IconDownload /> Download</button>
      </div>
    )
  }
  else if (view.kind === 'image') body = <img src={view.url} alt={a.filename} className="max-w-full max-h-full object-contain rounded shadow-lg" />
  else if (view.kind === 'pdf') body = <iframe src={view.url} title={a.filename} className="w-full h-full bg-white rounded shadow-lg" />
  else if (view.kind === 'video') body = <video src={view.url} controls className="max-w-full max-h-full rounded shadow-lg" />
  else if (view.kind === 'audio') body = <audio src={view.url} controls className="w-96 max-w-full" />
  else if (view.kind === 'text') {
    body = (
      <pre data-testid="text-preview" className="bg-white text-gray-800 text-sm p-5 rounded-lg shadow-lg overflow-auto w-full max-w-4xl max-h-full whitespace-pre-wrap break-words">
        {view.text}{view.truncated ? '\n\n… (preview truncated — download the file to see everything)' : ''}
      </pre>
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${a.filename}`} onClick={onClose} className="fixed inset-0 z-[60] bg-black/80 flex flex-col">
      <div className="flex items-center gap-3 px-5 py-3 text-white" onClick={stop}>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{a.filename}</div>
          <div className="text-xs text-white/60">
            {fmtSize(a.size)} · {a.uploaded_by_name}{items.length > 1 ? ` · ${idx + 1} of ${items.length}` : ''}
          </div>
        </div>
        <button onClick={() => saveAttachment(ticketId, a)} className="inline-flex items-center gap-1.5 rounded-md bg-white/15 hover:bg-white/25 px-3 py-1.5 text-sm" aria-label="Download file">
          <IconDownload /> Download
        </button>
        <button onClick={onClose} aria-label="Close preview" title="Close (Esc)" className="rounded-md hover:bg-white/20 p-1.5"><IconClose width={20} height={20} /></button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-16 pb-8">
        {items.length > 1 && (
          <button onClick={(e) => { stop(e); go(-1) }} aria-label="Previous attachment" className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 hover:bg-white/30 text-white w-10 h-10 text-2xl leading-none">‹</button>
        )}
        <div className="w-full h-full flex items-center justify-center" onClick={stop}>{body}</div>
        {items.length > 1 && (
          <button onClick={(e) => { stop(e); go(1) }} aria-label="Next attachment" className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 hover:bg-white/30 text-white w-10 h-10 text-2xl leading-none">›</button>
        )}
      </div>
    </div>,
    document.body
  )
}
