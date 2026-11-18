// Pure helpers for the Projects screens (no React, no network) so they can be unit-tested.

// Items of one section, in display order. sectionId null = items that belong to no section.
export const itemsIn = (items, sectionId) =>
  items.filter(i => (i.section_id ?? null) === (sectionId ?? null)).sort((a, b) => a.position - b.position)

// Position for an item dropped into `list` (already without the dragged item) just before `beforeItemId`
// (or at the end when null/unknown). Positions are floats, so one move changes one row.
export function positionFor(list, beforeItemId) {
  const idx = beforeItemId ? list.findIndex(i => i.item_id === beforeItemId) : -1
  if (idx === -1) return (list.length ? list[list.length - 1].position : 0) + 1
  const next = list[idx].position
  const prev = idx > 0 ? list[idx - 1].position : next - 2
  return (prev + next) / 2
}

// Applies a move locally so the UI updates instantly (the server call confirms it).
export function applyMove(items, itemId, sectionId, position) {
  return items.map(i => i.item_id === itemId ? { ...i, section_id: sectionId, position } : i)
}

// { done, total } for progress text
export const progress = (items) => ({ done: items.filter(i => i.done).length, total: items.length })

// Display text for a custom-field value ('' when empty)
export function fieldDisplay(field, value) {
  if (value === undefined || value === null || value === '') return ''
  if (field.type === 'select') return field.options.find(o => o.id === value)?.label || ''
  return String(value)
}

// Search/filter used by the list and board toolbar
export function filterItems(items, { q = '', assignee = '', hideDone = false } = {}) {
  const needle = q.trim().toLowerCase()
  return items.filter(i =>
    (!hideDone || !i.done) &&
    (!assignee || (assignee === 'none' ? !i.assignee : i.assignee === assignee)) &&
    (!needle || i.title.toLowerCase().includes(needle) || (i.num !== undefined && `#${i.num}`.includes(needle))))
}

export const PROJECT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']
