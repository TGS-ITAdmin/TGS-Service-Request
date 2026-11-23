# AGENTS.md — read this before changing the code

Service-request ("HelpDesk") app: Express + PostgreSQL API, React (Vite + Tailwind) front end, deployed on Railway.

## Map
| Path | What lives there |
|---|---|
| `shared/` | **Source of truth used by both server and browser.** State machines (`ticketStatus`, `taskState`, `account`, `session`), the role policy (`roles`) and the Projects rules (`projects`: access, dependency cycles, recurrence, custom-field checks). Plain JS only — no Node or DOM APIs. |
| `server/` | `index.js` (app + `/api/machines`), `db.js` (schema, idempotent migrations, first-run seed), `auth.js`, `email.js`, `sla.js` (priority → due date), `projectAccess.js`, `routes/{auth,tickets,users,departments,projects,tasks}.js` |
| `src/` | `App.jsx`, `AuthContext.jsx`, `api.js` (all HTTP; handles a rejected session in one place), `lib/{meta,session,errors}.js`, `pages/`, `components/` |
| `tests/` | Unit tests (`node:test`, **no database needed**) |
| `docs/STATE_MACHINES.md` | Every lifecycle in the app, with diagrams generated from `shared/` |

## Commands
```
npm run dev              # API on :3001 + Vite on :3000 (needs DATABASE_URL, see .env.example)
npm run build            # production front-end build into dist/
npm start                # what Railway runs
npm test                 # unit tests
npm run test:api         # end-to-end Projects API check; needs DATABASE_URL pointing at an EMPTY scratch database
npm run check            # tests + "is docs/STATE_MACHINES.md up to date?"  ← run before you finish
npm run machines:docs    # regenerate the diagrams after editing shared/
```

## Rules that keep this codebase coherent
1. **Never decide anything from a status, role or account-state string literal.** Ask the machine:
   `ticketStatus.transition/can/targets`, `isDone`, `canManageRole`, `assignableRoles`, `accountState`. The server and the UI
   use the same functions, so they cannot disagree.
2. **Changing a lifecycle?** Edit the machine in `shared/`, implement any new *effect* (effects are names; `routes/tickets.js`
   performs them), add a test case, then `npm run machines:docs && npm run check`.
3. **Validate before you write.** A request must be fully validated before the first database write. A ticket update and its
   audit-log rows go through `applyTicketChange` (one transaction).
4. **API errors** are `{ error: "human text", code?: "machine_code", allowed?: [...] }`. In the UI show them with
   `notifyError(e)` (`src/lib/errors.js`) — it stays quiet when the session just ended.
5. **Permissions are enforced on the server.** The UI only mirrors them to hide buttons. Routes use `requireAuth`,
   `requireStaff`, `requireManageAccounts`, `requirePerm('departments'|'ratings')`; ticket scope via `inTicketScope`/`ticketVisible`; row-level rules (own tickets only, internal notes staff-only) live in the route.
6. **Schema changes** go in `server/db.js` as idempotent statements (`CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) — they run on every start against the live database. There is no migration tool.
7. **Dates:** due dates are `YYYY-MM-DD` strings computed in the business time zone (`APP_TIMEZONE`, default `Asia/Manila`).

## Projects (staff only)
- **Tasks are not tickets.** A project *task* (`tasks`) has no ticket number or SLA and completes with `taskState` (complete / incomplete;
  workflow is the *section* it sits in). A form *ticket* can also be placed in projects. Both appear as a `project_items` row
  (exactly one of `task_id` / `ticket_id`), so one task or ticket can live in several projects.
- Access: only Owner/Admin/Manager. A project is `members`-private or `staff`-visible; only the Owner always sees all (an Admin sees projects
  they are in, plus staff-visible ones). Project owners, Admins who belong to the project, and the Owner manage settings, members, sections and custom fields. A project you may not see answers **404**, not 403.
- Dependencies (`task_deps`): a task cannot be completed while a task it waits on is incomplete (409 `code: "blocked"`); loops are refused.
- Recurring tasks: completing one creates the next copy (same sections, subtasks reset). Reopening and completing again creates another.
- Removing a task from its last project deletes it; deleting a project deletes only tasks that live nowhere else — never tickets.

## Roles (Owner > Admin > Manager > Requestor)
* **Staff** = Owner, Admin, Manager: see every ticket, edit any field, complete/close, subtasks, internal notes.
* **Accounts** (add / change role / reset password / remove): the **Owner** and **Admins in IT Support** (`dept-it`) only. IT/Owner also grant each Admin the switches `tickets` (see tickets of other departments), `departments` (departments & routing) and `ratings` (customer ratings), all off by default; IT and Owner hold them always. **Ticket scope:** an Admin outside IT sees only tickets in their own department plus tickets assigned to them, unless `tickets` is on; Managers, IT and Owner see all. Rules: `shared/roles.js` (`canManageAccounts`, `hasPerm`, `canSetPerms`).
* **Owner** alone manages Admin and Owner accounts. Nobody changes or deletes themselves; the last Owner cannot be removed.
* **Requestor**: only their own tickets; may reopen their own *resolved* ticket; may rate it once.
* There is no Agent role any more (old ones were converted to Manager on startup).

## Configuration (Railway variables)
`DATABASE_URL` (reference the Postgres service), `JWT_SECRET` (required in production), `NODE_ENV=production`,
`RESEND_API_KEY` + `MAIL_FROM` (Railway blocks SMTP on lower plans, so email goes through Resend's HTTPS API),
`APP_TIMEZONE` (optional), `CORS_ORIGIN` (optional), `PGSSL=false` only if the database connection reports an SSL error.

## Known gaps
* No automated API or browser tests are committed yet — only the unit tests above. Verify behaviour changes against a real
  Postgres before shipping.
* `tickets.status` has no database CHECK constraint (validation is in the API). Add one only after confirming no row holds
  an invalid value.
* Candidate for the next explicit machine: the App-shell navigation flags (see `docs/STATE_MACHINES.md`, #14).
