/**
 * Convert a UTC ISO string to a datetime-local input value in the given timezone.
 * Returns "YYYY-MM-DDTHH:mm"
 */
export function utcToLocal(utcString, timezone) {
  if (!utcString) return ''
  const date = new Date(utcString)
  const opts = {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }
  const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(date)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  const hour = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`
}

/**
 * Convert a datetime-local input value (interpreted as being in `timezone`) to a UTC ISO string.
 * Input: "YYYY-MM-DDTHH:mm"
 */
export function localToUtc(localStr, timezone) {
  if (!localStr) return null
  // Treat localStr as UTC, see what that looks like in the target timezone,
  // then compute the real offset and adjust.
  const naiveUtc = new Date(localStr + ':00Z')
  const opts = {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }
  const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(naiveUtc)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  const hour = p.hour === '24' ? '00' : p.hour
  const tzEquivalent = new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:00Z`)
  const offsetMs = naiveUtc.getTime() - tzEquivalent.getTime()
  return new Date(naiveUtc.getTime() + offsetMs).toISOString()
}

/**
 * Format a UTC ISO string for display in the given timezone.
 */
export function formatDatetime(utcString, timezone) {
  if (!utcString) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(utcString))
}
