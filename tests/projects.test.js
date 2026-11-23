import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canCreateProject, canViewProject, canManageProject, createsCycle, normalizeRecurrence, describeRecurrence, nextDueDate, cleanFieldValue,
} from '../shared/projects.js'
import { taskState, taskStateOf, isTaskDone } from '../shared/taskState.js'

const U = (role) => ({ role })

test('only staff create projects', () => {
  assert.deepEqual(['owner', 'admin', 'manager', 'requestor'].map(r => canCreateProject(U(r))), [true, true, true, false])
})

test('visibility: requestors never; the Owner always; Admins and Managers when staff-visible or a member', () => {
  const priv = { privacy: 'members' }, open = { privacy: 'staff' }
  assert.equal(canViewProject(U('requestor'), open, 'owner'), false)
  assert.equal(canViewProject(U('owner'), priv, null), true)
  assert.equal(canViewProject(U('admin'), priv, null), false, 'an Admin does not see private projects they are not in')
  assert.equal(canViewProject(U('admin'), priv, 'member'), true)
  assert.equal(canViewProject(U('admin'), open, null), true)
  assert.equal(canViewProject(U('manager'), priv, null), false)
  assert.equal(canViewProject(U('manager'), priv, 'member'), true)
  assert.equal(canViewProject(U('manager'), open, null), true)
})

test('managing: the Owner; a project owner; an Admin in any project they belong to', () => {
  assert.equal(canManageProject(U('manager'), 'member'), false)
  assert.equal(canManageProject(U('manager'), null), false)
  assert.equal(canManageProject(U('manager'), 'owner'), true)
  assert.equal(canManageProject(U('owner'), null), true)
  assert.equal(canManageProject(U('admin'), null), false, 'an Admin outside the project has no manage rights')
  assert.equal(canManageProject(U('admin'), 'member'), true, 'added Admin has full access')
  assert.equal(canManageProject(U('admin'), 'owner'), true)
  assert.equal(canManageProject(U('requestor'), 'owner'), false)
})

test('task machine: incomplete <-> complete, with the named effects', () => {
  assert.equal(taskState.initial, 'incomplete')
  const c = taskState.transition('incomplete', 'complete')
  assert.equal(c.ok, true)
  assert.deepEqual([...c.effects], ['stamp_completed_at', 'spawn_next_occurrence'])
  const o = taskState.transition('complete', 'incomplete')
  assert.deepEqual([o.ok, [...o.effects]], [true, ['clear_completed_at']])
  assert.equal(taskState.transition('complete', 'complete').reason, 'same_state')
  assert.equal(taskState.transition('incomplete', 'banana').reason, 'unknown_state')
  assert.equal(taskStateOf({ completed: true }), 'complete')
  assert.equal(isTaskDone({ completed: false }), false)
})

test('dependency cycles are detected (self, direct, indirect) and chains are fine', () => {
  const edges = [{ task_id: 'b', blocked_by: 'a' }, { task_id: 'c', blocked_by: 'b' }]   // c waits on b waits on a
  assert.equal(createsCycle(edges, 'a', 'a'), true)
  assert.equal(createsCycle(edges, 'a', 'b'), true)     // a waits on b, but b waits on a
  assert.equal(createsCycle(edges, 'a', 'c'), true)     // indirect
  assert.equal(createsCycle(edges, 'd', 'c'), false)
  assert.equal(createsCycle(edges, 'c', 'a'), false)    // redundant but harmless
  assert.equal(createsCycle([], 'x', 'y'), false)
})

test('recurrence input is validated', () => {
  assert.equal(normalizeRecurrence(null), null)
  assert.equal(normalizeRecurrence(''), null)
  assert.deepEqual(normalizeRecurrence({ unit: 'week' }), { unit: 'week', interval: 1 })
  assert.deepEqual(normalizeRecurrence({ unit: 'month', interval: '2' }), { unit: 'month', interval: 2 })
  for (const bad of [{ unit: 'year' }, { unit: 'day', interval: 0 }, { unit: 'day', interval: 1.5 }, { unit: 'day', interval: 400 }, 'weekly'])
    assert.throws(() => normalizeRecurrence(bad), undefined, JSON.stringify(bad))
  assert.equal(describeRecurrence({ unit: 'week', interval: 1 }), 'Every week')
  assert.equal(describeRecurrence({ unit: 'day', interval: 3 }), 'Every 3 days')
  assert.equal(describeRecurrence(null), 'Does not repeat')
})

test('next due date: from the old due date, never in the past, months clamp', () => {
  const today = '2026-11-19'
  assert.equal(nextDueDate('2026-11-20', { unit: 'day', interval: 1 }, today), '2026-11-21')
  assert.equal(nextDueDate('2026-11-20', { unit: 'week', interval: 1 }, today), '2026-11-27')
  assert.equal(nextDueDate('2026-11-01', { unit: 'week', interval: 1 }, today), '2026-11-22')     // overdue: skips to the next upcoming slot
  assert.equal(nextDueDate(null, { unit: 'day', interval: 2 }, today), '2026-11-21')                 // no due date: counts from today
  assert.equal(nextDueDate('2026-01-31', { unit: 'month', interval: 1 }, '2026-01-31'), '2026-02-28')
  assert.equal(nextDueDate('2028-01-31', { unit: 'month', interval: 1 }, '2028-01-31'), '2028-02-29')
  assert.equal(nextDueDate('2026-12-15', { unit: 'month', interval: 2 }, today), '2027-02-15')
  assert.equal(nextDueDate('2026-11-20', null, today), null)
})

test('custom field values are checked against their type', () => {
  const sel = { name: 'Stage', type: 'select', options: [{ id: 'o1', label: 'A' }] }
  assert.equal(cleanFieldValue({ name: 'N', type: 'number' }, ' 4.50 '), '4.5')
  assert.throws(() => cleanFieldValue({ name: 'N', type: 'number' }, 'abc'))
  assert.equal(cleanFieldValue({ name: 'D', type: 'date' }, '2026-11-19'), '2026-11-19')
  assert.throws(() => cleanFieldValue({ name: 'D', type: 'date' }, '19/11/2026'))
  assert.equal(cleanFieldValue(sel, 'o1'), 'o1')
  assert.throws(() => cleanFieldValue(sel, 'nope'))
  assert.equal(cleanFieldValue(sel, ''), '')
  assert.equal(cleanFieldValue({ name: 'T', type: 'text' }, null), '')
  assert.equal(cleanFieldValue({ name: 'T', type: 'text' }, 'x'.repeat(900)).length, 500)
})
