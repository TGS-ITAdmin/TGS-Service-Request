// Pure helpers for the "My tasks" page.
const RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
export const todayLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const GROUPS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Do today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'nodate', label: 'No due date' },
  { id: 'done', label: 'Completed' },
]

// Which bucket an item belongs to. `today` is 'YYYY-MM-DD'.
export function bucketOf(item, today) {
  if (item.done) return 'done'
  if (!item.due_date) return 'nodate'
  if (item.due_date < today) return 'overdue'
  return item.due_date === today ? 'today' : 'upcoming'
}

// Sort inside a bucket: earliest due first, then most urgent, then name. Completed: newest first isn't known, so by name.
const cmp = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')
  || (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || a.title.localeCompare(b.title)

export const itemKey = (i) => `${i.kind}:${i.id}`

// filter: 'all' | 'task' | 'ticket'.  Returns [{ id, label, items }] for non-empty buckets, in display order.
export function groupMyTasks(items, today, { kind = 'all', q = '' } = {}) {
  const needle = q.trim().toLowerCase()
  const shown = items.filter(i => (kind === 'all' || i.kind === kind) &&
    (!needle || i.title.toLowerCase().includes(needle) || (i.num !== undefined && `#${i.num}`.includes(needle)) || i.projects.some(p => p.name.toLowerCase().includes(needle))))
  return GROUPS.map(g => ({ ...g, items: shown.filter(i => bucketOf(i, today) === g.id).sort(cmp) })).filter(g => g.items.length)
}
