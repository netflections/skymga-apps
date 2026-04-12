/**
 * Validate a GHIN number (must be exactly 7 digits).
 */
export function isValidGhin(ghin) {
  return /^\d{7}$/.test(ghin)
}

/**
 * Calculate member tenure in whole years from their member_since date.
 */
export function getMemberTenure(memberSince) {
  const start = new Date(memberSince)
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  const monthDiff = now.getMonth() - start.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < start.getDate())) {
    years--
  }
  return years
}

/**
 * Check if a member's tenure falls within a seniority tier's year band.
 */
export function isEligibleForTier(tenure, minYears, maxYears) {
  if (tenure < minYears) return false
  if (maxYears !== null && tenure > maxYears) return false
  return true
}

/**
 * Validate seniority tier bands for gaps and overlaps.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateSeniorityBands(tiers) {
  const errors = []
  const bands = tiers
    .filter(t => t.type === 'seniority')
    .map(t => ({ name: t.name, min: t.min_years, max: t.max_years }))
    .sort((a, b) => a.min - b.min)

  if (bands.length === 0) return { valid: true, errors: [] }

  const openEnded = bands.filter(b => b.max === null)
  if (openEnded.length !== 1) {
    errors.push(`Exactly one seniority tier must have no upper limit (found ${openEnded.length}).`)
  }

  for (const band of bands) {
    if (band.min < 0) {
      errors.push(`"${band.name}" has a negative min_years.`)
    }
    if (band.max !== null && band.min >= band.max) {
      errors.push(`"${band.name}" has min_years >= max_years.`)
    }
  }

  for (let i = 0; i < bands.length - 1; i++) {
    const current = bands[i]
    const next = bands[i + 1]
    const currentEnd = current.max ?? Infinity

    if (currentEnd < next.min) {
      errors.push(`Gap between "${current.name}" (max ${current.max}) and "${next.name}" (min ${next.min}).`)
    } else if (currentEnd > next.min) {
      errors.push(`Overlap between "${current.name}" and "${next.name}".`)
    }
  }

  if (bands[0].min !== 0) {
    errors.push(`Seniority bands should start at 0 years (first band starts at ${bands[0].min}).`)
  }

  return { valid: errors.length === 0, errors }
}
