// One place to show an API error to the user.
// A rejected session is handled by the sign-in screen ("Your session has ended"), so we stay quiet instead of
// stacking an alert on top of it.
export function notifyError(e) {
  if (e?.sessionExpired) return
  alert(e?.message || 'Something went wrong')
}
