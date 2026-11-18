import { ticketStatus, STATUS_IDS, isDone as machineIsDone } from '../../shared/ticketStatus.js'

// Display metadata for tickets. The hours behind each priority live in server/sla.js.

export const PRIORITIES = ['urgent', 'high', 'medium', 'low']

export const PRIORITY_META = {
  urgent: { label: 'Critical', pill: 'bg-red-300 text-red-950',       desc: 'Critical - Request needs to be completed within 24 hours' },
  high:   { label: 'High',     pill: 'bg-orange-300 text-orange-950', desc: 'High - Request needs to be completed within 48 hours' },
  medium: { label: 'Medium',   pill: 'bg-yellow-400 text-yellow-950', desc: 'Medium - Request needs to be completed within 72 hours' },
  low:    { label: 'Low',      pill: 'bg-lime-300 text-lime-950',     desc: 'Low - Request can be completed more than 72 hours' },
}

// Status ids, labels and "done" come from the machine in shared/ticketStatus.js. Only the colours live here.
export const STATUSES = STATUS_IDS
const STATUS_STYLE = {
  open:        { dot: 'bg-blue-500',   pill: 'bg-blue-100 text-blue-700' },
  in_progress: { dot: 'bg-yellow-500', pill: 'bg-yellow-100 text-yellow-700' },
  resolved:    { dot: 'bg-green-500',  pill: 'bg-green-100 text-green-700' },
  closed:      { dot: 'bg-gray-400',   pill: 'bg-green-100 text-green-700' },
}
export const STATUS_META = Object.fromEntries(STATUS_IDS.map(id => [id, { label: ticketStatus.states[id].label, ...STATUS_STYLE[id] }]))
export const isDone = machineIsDone

// ---- dates ----
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function parseDay(str) {            // 'YYYY-MM-DD' -> local midnight
  if (!str) return null
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Asana-style due date: Today / Tomorrow / Yesterday / weekday name / "Nov 13".
// tone: overdue (red) | soon (green) | normal | muted (completed)
export function formatDue(due, done = false, today = new Date()) {
  const d = parseDay(due)
  if (!d) return { text: '', tone: 'normal' }
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((d - t0) / 86400000)
  let text
  if (diff === 0) text = 'Today'
  else if (diff === 1) text = 'Tomorrow'
  else if (diff === -1) text = 'Yesterday'
  else if (diff > 1 && diff < 7) text = WEEKDAYS[d.getDay()]
  else text = `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== t0.getFullYear() ? ', ' + d.getFullYear() : ''}`
  let tone = 'normal'
  if (done) tone = 'muted'
  else if (diff < 0) tone = 'overdue'
  else if (diff <= 1) tone = 'soon'
  return { text, tone }
}
export const DUE_TONE = { overdue: 'text-red-600', soon: 'text-green-600', normal: 'text-gray-700', muted: 'text-gray-400' }

export function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(d).toLocaleDateString()
}
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---- attachment previews ----
// Only these types are ever rendered in the viewer. HTML, SVG, scripts and unknown types are never displayed;
// they get a "no preview" card with a Download button instead.
const BY_MIME = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'application/pdf': 'pdf',
  'text/plain': 'text', 'text/csv': 'text', 'text/markdown': 'text', 'application/json': 'text',
  'video/mp4': 'video', 'video/webm': 'video',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio', 'audio/mp4': 'audio', 'audio/ogg': 'audio', 'audio/webm': 'audio',
}
const BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain', log: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json',
  mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
}
// -> { kind: 'image'|'pdf'|'text'|'video'|'audio'|'none', mime }   (mime is the type the viewer will use)
export function previewInfo(a) {
  const declared = String(a?.mime || '').split(';')[0].trim().toLowerCase()
  if (BY_MIME[declared]) return { kind: BY_MIME[declared], mime: declared }
  const ext = String(a?.filename || '').split('.').pop().toLowerCase()      // browsers often send no type; trust the extension
  const mime = BY_EXT[ext]
  return mime ? { kind: BY_MIME[mime], mime } : { kind: 'none', mime: 'application/octet-stream' }
}
