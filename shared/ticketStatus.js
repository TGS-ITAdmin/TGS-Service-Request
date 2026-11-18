import { defineMachine } from './machine.js'
import { isStaffRole } from './roles.js'

// Ticket status lifecycle — the ONLY place that decides which status changes are legal and what they cause.
// Staff may move a ticket between any two statuses. A requester may only reopen their own RESOLVED ticket.
//
// Named effects (applied by server/routes/tickets.js):
//   stamp_resolved_at             resolved_at = now
//   stamp_resolved_at_if_missing  resolved_at = now, only if it is empty (keeps the first resolution time)
//   clear_resolved_at             resolved_at = NULL
//   notify_requestor_resolved     email the requestor that the ticket was resolved
//   notify_assignee_reopened      email the assignee that the requestor reopened it
export const ticketStatus = defineMachine({
  id: 'ticketStatus',
  description: 'Lifecycle of a ticket: open → in progress → resolved → closed, with reopening.',
  initial: 'open',
  states: {
    open:        { label: 'Open',        done: false },
    in_progress: { label: 'In progress', done: false },
    resolved:    { label: 'Resolved',    done: true },
    closed:      { label: 'Closed',      done: true },
  },
  transitions: [
    { event: 'start',   from: ['open', 'resolved', 'closed'],        to: 'in_progress', caps: ['staff'], effects: ['clear_resolved_at'] },
    { event: 'resolve', from: ['open', 'in_progress', 'closed'],     to: 'resolved',    caps: ['staff'], effects: ['stamp_resolved_at', 'notify_requestor_resolved'] },
    { event: 'close',   from: ['open', 'in_progress', 'resolved'],   to: 'closed',      caps: ['staff'], effects: ['stamp_resolved_at_if_missing'] },
    { event: 'reopen',  from: ['in_progress', 'resolved', 'closed'], to: 'open',        caps: ['staff'], effects: ['clear_resolved_at'] },
    { event: 'reopen',  from: ['resolved'],                          to: 'open',        caps: ['requester'], effects: ['clear_resolved_at', 'notify_assignee_reopened'],
      note: 'A requestor can only reopen their own resolved ticket.' },
  ],
})

export const STATUS_IDS = ticketStatus.stateIds
export const INITIAL_STATUS = ticketStatus.initial
export const isDone = (status) => !!ticketStatus.states[status]?.done
export const statusLabel = (status) => ticketStatus.states[status]?.label ?? String(status)

// What the "complete" circle / button does: finished tickets reopen, unfinished ones resolve.
export const completeToggleTarget = (status) => isDone(status) ? 'open' : 'resolved'

// Who is acting on this ticket? staff => 'staff'; the ticket's own requestor => 'requester'; anyone else => nothing.
export function ticketActor(user, ticket) {
  if (user && isStaffRole(user.role)) return { caps: ['staff'] }
  if (user && ticket && ticket.requestor_id && ticket.requestor_id === user.id) return { caps: ['requester'] }
  return { caps: [] }
}
