import test from 'node:test'
import assert from 'node:assert/strict'
import { itemsIn, positionFor, applyMove, progress, fieldDisplay, filterItems } from '../src/lib/projects.js'

const it = (item_id, section_id, position, extra = {}) => ({ item_id, id: item_id, section_id, position, title: item_id, ...extra })

test('itemsIn: one section, sorted by position; null = no section', () => {
  const items = [it('a', 's1', 3), it('b', 's1', 1), it('c', 's2', 1), it('d', null, 5)]
  assert.deepEqual(itemsIn(items, 's1').map(i => i.item_id), ['b', 'a'])
  assert.deepEqual(itemsIn(items, null).map(i => i.item_id), ['d'])
  assert.deepEqual(itemsIn(items, undefined).map(i => i.item_id), ['d'])
})

test('positionFor: end, start, and between — always strictly ordered', () => {
  const list = [it('a', 's', 1), it('b', 's', 2), it('c', 's', 3)]
  assert.equal(positionFor([], null), 1)
  assert.equal(positionFor(list, null), 4)
  assert.equal(positionFor(list, 'nope'), 4)
  assert.equal(positionFor(list, 'a'), 0)          // before first: 2 below it
  assert.equal(positionFor(list, 'b'), 1.5)
  assert.ok(positionFor(list, 'c') > 2 && positionFor(list, 'c') < 3)
})

test('applyMove changes only the moved item', () => {
  const items = [it('a', 's1', 1), it('b', 's1', 2)]
  const out = applyMove(items, 'a', 's2', 9)
  assert.deepEqual(out.map(i => [i.item_id, i.section_id, i.position]), [['a', 's2', 9], ['b', 's1', 2]])
  assert.equal(items[0].section_id, 's1')           // original untouched
})

test('progress counts done items', () => {
  assert.deepEqual(progress([{ done: true }, { done: false }, { done: true }]), { done: 2, total: 3 })
  assert.deepEqual(progress([]), { done: 0, total: 0 })
})

test('fieldDisplay shows option labels, not ids', () => {
  const sel = { type: 'select', options: [{ id: 'x', label: 'Acme' }] }
  assert.equal(fieldDisplay(sel, 'x'), 'Acme')
  assert.equal(fieldDisplay(sel, 'gone'), '')
  assert.equal(fieldDisplay({ type: 'number' }, '4.5'), '4.5')
  assert.equal(fieldDisplay({ type: 'text' }, undefined), '')
})

test('filterItems: text, ticket number, assignee, hide done', () => {
  const items = [
    it('a', 's', 1, { title: 'Pack boxes', assignee: 'u1', done: false }),
    it('b', 's', 2, { title: 'Book movers', assignee: null, done: true }),
    it('c', 's', 3, { title: 'Printer broken', num: 1007, assignee: 'u2', done: false }),
  ]
  assert.deepEqual(filterItems(items, { q: 'BOX' }).map(i => i.item_id), ['a'])
  assert.deepEqual(filterItems(items, { q: '#1007' }).map(i => i.item_id), ['c'])
  assert.deepEqual(filterItems(items, { assignee: 'none' }).map(i => i.item_id), ['b'])
  assert.deepEqual(filterItems(items, { assignee: 'u1' }).map(i => i.item_id), ['a'])
  assert.deepEqual(filterItems(items, { hideDone: true }).map(i => i.item_id), ['a', 'c'])
  assert.equal(filterItems(items).length, 3)
})

import { bucketOf, groupMyTasks } from '../src/lib/myTasks.js'

test('My tasks buckets: overdue, today, upcoming, no date, completed', () => {
  const today = '2026-11-20'
  assert.equal(bucketOf({ due_date: '2026-11-19' }, today), 'overdue')
  assert.equal(bucketOf({ due_date: '2026-11-20' }, today), 'today')
  assert.equal(bucketOf({ due_date: '2026-11-21' }, today), 'upcoming')
  assert.equal(bucketOf({ due_date: null }, today), 'nodate')
  assert.equal(bucketOf({ due_date: '2026-01-01', done: true }, today), 'done')   // done wins over overdue
})

test('groupMyTasks: ordered groups, empty ones dropped, sorted by due then priority, filters work', () => {
  const today = '2026-11-20'
  const P = [{ id: 'p', name: 'Office Move', color: '#000' }]
  const items = [
    { kind: 'task', id: 'a', title: 'B task', due_date: '2026-11-25', priority: 'low', projects: P },
    { kind: 'ticket', id: 'b', num: 1007, title: 'Printer', due_date: '2026-11-25', priority: 'urgent', projects: [] },
    { kind: 'task', id: 'c', title: 'Late', due_date: '2026-11-01', priority: null, projects: P },
    { kind: 'task', id: 'd', title: 'Done one', due_date: null, done: true, projects: P },
  ]
  const g = groupMyTasks(items, today)
  assert.deepEqual(g.map(x => x.id), ['overdue', 'upcoming', 'done'])
  assert.deepEqual(g[1].items.map(i => i.id), ['b', 'a'])                           // same day: urgent first
  assert.deepEqual(groupMyTasks(items, today, { kind: 'ticket' }).flatMap(x => x.items.map(i => i.id)), ['b'])
  assert.deepEqual(groupMyTasks(items, today, { q: '#1007' }).flatMap(x => x.items.map(i => i.id)), ['b'])
  assert.deepEqual(groupMyTasks(items, today, { q: 'office' }).flatMap(x => x.items.map(i => i.id)).sort(), ['a', 'c', 'd'])
  assert.deepEqual(groupMyTasks([], today), [])
})
