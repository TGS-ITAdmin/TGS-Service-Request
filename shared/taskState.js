import { defineMachine } from './machine.js'

// Completion lifecycle of a PROJECT TASK (not a form ticket — tickets use shared/ticketStatus.js).
// Asana style: a task is either incomplete or complete. Workflow ("To do / Doing / Review") is shown by which
// SECTION the task sits in, not by a status.
//   Guards the route checks before firing `complete`: every task it depends on must already be complete.
//   Effects: stamp/clear completed_at; spawn_next_occurrence creates the next copy of a recurring task.
export const taskState = defineMachine({
  id: 'taskState',
  description: 'Complete / incomplete lifecycle of a project task. Workflow stages are sections, not statuses.',
  initial: 'incomplete',
  states: {
    incomplete: { label: 'Incomplete', done: false },
    complete:   { label: 'Complete',   done: true },
  },
  transitions: [
    { event: 'complete', from: ['incomplete'], to: 'complete', effects: ['stamp_completed_at', 'spawn_next_occurrence'],
      note: 'Blocked while any task it depends on is still incomplete. A recurring task spawns its next occurrence.' },
    { event: 'reopen',   from: ['complete'], to: 'incomplete', effects: ['clear_completed_at'],
      note: 'Does not undo a spawned recurrence.' },
  ],
})

export const taskStateOf = (task) => task?.completed ? 'complete' : 'incomplete'
export const isTaskDone = (task) => !!task?.completed
