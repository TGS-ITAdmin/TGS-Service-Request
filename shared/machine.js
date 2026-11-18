// A tiny, dependency-free state-machine helper used by BOTH the server and the browser.
//
// Why it exists: lifecycles (ticket status, account state, sign-in session) used to be encoded as strings and flags
// scattered across many files. Defining each one here, once, gives the code, the UI, the docs and AI agents a single
// source of truth. Nothing in here touches the DB, the DOM or React.
//
// A machine is: states + a list of transition RULES.
//   rule = { event, from: [state | null, ...], to: state, caps?: [...], effects?: [...], note?: string }
//   - `from: [null]` means "the thing does not exist yet" (creation).
//   - `caps` are capability names the actor must have (e.g. 'staff', 'requester'). Omit `caps` for "anyone".
//   - `effects` are named side effects the CALLER applies (stamp a timestamp, send an email...). The machine only
//     names them; it never performs them.
// Actors are plain objects: { caps: ['staff'] }. If you pass NO actor, capability checks are skipped — use that only
// for transitions a route guard has already authorised.

export function defineMachine({ id, description = '', initial = null, states, transitions }) {
  if (!id) throw new Error('defineMachine: id is required')
  const stateIds = Object.keys(states || {})
  if (!stateIds.length) throw new Error(`${id}: at least one state is required`)
  if (initial !== null && !stateIds.includes(initial)) throw new Error(`${id}: initial state "${initial}" is not a state`)

  const rules = (transitions || []).map((r, i) => {
    if (!r.event) throw new Error(`${id}: transition #${i} has no event name`)
    if (!Array.isArray(r.from) || !r.from.length) throw new Error(`${id}: ${r.event} needs a non-empty "from" array`)
    for (const f of r.from) if (f !== null && !stateIds.includes(f)) throw new Error(`${id}: ${r.event} starts from unknown state "${f}"`)
    if (!stateIds.includes(r.to)) throw new Error(`${id}: ${r.event} goes to unknown state "${r.to}"`)
    if (r.caps !== undefined && (!Array.isArray(r.caps) || r.caps.some(c => typeof c !== 'string'))) throw new Error(`${id}: ${r.event} caps must be an array of strings`)
    return Object.freeze({ ...r, from: Object.freeze([...r.from]), effects: Object.freeze([...(r.effects || [])]) })
  })

  const permitted = (rule, actor) => actor === undefined || !rule.caps || rule.caps.some(c => (actor?.caps || []).includes(c))

  // Every state reachable from `from` in one step for this actor (excluding staying put).
  const targets = (from, actor) => {
    const out = []
    for (const r of rules) if (r.from.includes(from) && permitted(r, actor) && r.to !== from && !out.includes(r.to)) out.push(r.to)
    return stateIds.filter(s => out.includes(s))
  }

  return Object.freeze({
    id, description, initial, states, stateIds, rules,
    has: (s) => stateIds.includes(s),
    can: (from, event, actor) => rules.some(r => r.event === event && r.from.includes(from) && permitted(r, actor)),
    // Event-driven use: where does `event` take us from `from`? null = not allowed from here.
    next: (from, event, actor) => rules.find(r => r.event === event && r.from.includes(from) && permitted(r, actor))?.to ?? null,
    targets,
    // Target-driven use (e.g. an API that receives "set status to X"). Never throws.
    //   ok:true  -> { ok, event, rule, effects }
    //   ok:false -> { ok, reason: 'unknown_state' | 'same_state' | 'not_allowed', allowed: [states reachable now] }
    transition(from, to, actor) {
      if (!stateIds.includes(to)) return { ok: false, reason: 'unknown_state', allowed: targets(from, actor) }
      if (from === to) return { ok: false, reason: 'same_state', allowed: targets(from, actor) }
      const rule = rules.find(r => r.to === to && r.from.includes(from) && permitted(r, actor))
      if (!rule) return { ok: false, reason: 'not_allowed', allowed: targets(from, actor) }
      return { ok: true, event: rule.event, rule, effects: rule.effects }
    },
    // Plain JSON (served at /api/machines, used by the docs generator)
    describe: () => ({
      id, description, initial,
      states: Object.fromEntries(stateIds.map(s => [s, { ...states[s] }])),
      transitions: rules.map(r => ({ event: r.event, from: [...r.from], to: r.to, caps: r.caps ? [...r.caps] : null, effects: [...r.effects], note: r.note || null })),
    }),
    // Mermaid stateDiagram-v2 source (GitHub renders it natively)
    toMermaid() {
      const lines = ['stateDiagram-v2']
      if (initial) lines.push(`  [*] --> ${initial}`)
      for (const r of rules) for (const f of r.from) {
        const label = r.caps ? `${r.event} (${r.caps.join(' / ')})` : r.event
        lines.push(`  ${f === null ? '[*]' : f} --> ${r.to}: ${label}`)
      }
      return lines.join('\n')
    },
  })
}
