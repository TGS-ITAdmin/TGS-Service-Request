// Service levels: how long each priority has before it is due.
// Edit the hours here to change the policy. "Low" is "more than 72 hours" in the form, so 96h (4 days) is used.
export const SLA_HOURS = { urgent: 24, high: 48, medium: 72, low: 96 }
export const PRIORITIES = Object.keys(SLA_HOURS)

// Due dates are calendar dates, so work them out in the business's own time zone (the server runs in UTC).
let TZ = process.env.APP_TIMEZONE || 'Asia/Manila'
try { new Intl.DateTimeFormat('en-CA', { timeZone: TZ }) } catch {
  console.warn(`⚠️  APP_TIMEZONE "${TZ}" is not valid — using UTC for due dates.`)
  TZ = 'UTC'
}

// 'YYYY-MM-DD' of (from + SLA hours) in the business time zone
export function dueDateFor(priority, from = new Date()) {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.medium
  const due = new Date(from.getTime() + hours * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(due)
}
