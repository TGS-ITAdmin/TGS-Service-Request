// Generates the diagrams and tables in docs/STATE_MACHINES.md from the machine definitions in shared/.
//   npm run machines:docs    rewrite the generated block
//   npm run machines:check   fail (exit 1) if the file is out of date — part of `npm run check`
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { machines, rolePolicy } from '../shared/index.js'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'STATE_MACHINES.md')
const BEGIN = '<!-- BEGIN GENERATED (do not edit by hand — run `npm run machines:docs`) -->'
const END = '<!-- END GENERATED -->'

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|')
const code = (v) => v === null ? '*(new)*' : `\`${v}\``
const list = (a) => a && a.length ? a.map(code).join(', ') : '—'

function machineSection(m, title, source) {
  const d = m.describe()
  const out = [`### ${title}`, '', `Source: \`${source}\` · ${d.description}`, '', '```mermaid', m.toMermaid(), '```', '']
  const metaKeys = [...new Set(Object.values(d.states).flatMap(s => Object.keys(s).filter(k => k !== 'label')))]
  out.push(`| State | Meaning |${metaKeys.map(k => ` ${k} |`).join('')}`, `|---|---|${metaKeys.map(() => '---|').join('')}`)
  for (const [id, s] of Object.entries(d.states)) out.push(`| \`${id}\` | ${cell(s.label)} |${metaKeys.map(k => ` ${cell(s[k])} |`).join('')}`)
  out.push('', '| Event | From | To | Who | Effects | Note |', '|---|---|---|---|---|---|')
  for (const t of d.transitions) out.push(`| \`${t.event}\` | ${t.from.map(code).join(', ')} | ${code(t.to)} | ${t.caps ? t.caps.join(', ') : 'anyone'} | ${list(t.effects)} | ${cell(t.note) || ''} |`)
  out.push('')
  return out.join('\n')
}

function rolesSection() {
  const p = rolePolicy()
  const out = ['### Role assignment policy', '', 'Source: `shared/roles.js` · Owner > Admin > Manager > Requestor. Also guarded in `server/routes/users.js`: nobody changes or deletes their own account, and the last Owner cannot be removed.', '',
    '| Role | Works tickets (staff) | Admin-level | May manage | May assign |', '|---|---|---|---|---|']
  for (const r of p.roles) out.push(`| \`${r}\` | ${p.staff.includes(r) ? 'yes' : 'no'} | ${p.adminLevel.includes(r) ? 'yes' : 'no'} | ${list(p.byActor[r].manages)} | ${list(p.byActor[r].assigns)} |`)
  out.push('', '### Admin access', '',
    `Admins work tickets like Managers. Adding or changing accounts belongs to the **${p.access.accountManagers}** (IT Support is department \`${p.access.itDept}\`). `
    + 'IT and the Owner also switch these on per Admin (they hold them by default): ' + p.access.perms.map(x => `**${x.label}** (\`${x.id}\`)`).join(', ') + '. '
    + 'Admins have full access only to projects they created or were added to; the Owner sees every project.', '')
  return out.join('\n')
}

const generated = [
  BEGIN, '',
  machineSection(machines.ticketStatus, 'Ticket status', 'shared/ticketStatus.js'),
  machineSection(machines.taskState, 'Project task completion', 'shared/taskState.js'),
  machineSection(machines.account, 'Account lifecycle', 'shared/account.js'),
  rolesSection(),
  machineSection(machines.session, 'Browser session', 'shared/session.js'),
  END,
].join('\n')

const current = readFileSync(file, 'utf8')
const a = current.indexOf(BEGIN), b = current.indexOf(END)
if (a === -1 || b === -1) { console.error(`docs/STATE_MACHINES.md must contain the markers:\n${BEGIN}\n${END}`); process.exit(1) }
const next = current.slice(0, a) + generated + current.slice(b + END.length)

if (process.argv.includes('--check')) {
  if (next !== current) { console.error('docs/STATE_MACHINES.md is out of date. Run: npm run machines:docs'); process.exit(1) }
  console.log('docs/STATE_MACHINES.md is up to date.')
} else {
  writeFileSync(file, next)
  console.log('docs/STATE_MACHINES.md updated.')
}
