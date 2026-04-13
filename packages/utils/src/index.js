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
 * Check if a member's tenure meets a seniority tier's cumulative threshold.
 */
export function isEligibleForTier(tenure, minYears) {
  return tenure >= minYears
}

/**
 * Validate seniority tier configuration (cumulative model).
 * Returns { valid: boolean, errors: string[] }
 */
export function validateSeniorityTiers(tiers) {
  const errors = []
  const seniorityTiers = tiers
    .filter(t => t.type === 'seniority')
    .sort((a, b) => b.min_years - a.min_years)

  if (seniorityTiers.length === 0) return { valid: true, errors: [] }

  for (const tier of seniorityTiers) {
    if (tier.min_years < 0) {
      errors.push(`"${tier.name}" has a negative min_years.`)
    }
  }

  const thresholds = seniorityTiers.map(t => t.min_years)
  const unique = new Set(thresholds)
  if (unique.size !== thresholds.length) {
    errors.push('Seniority tiers must have unique min_years thresholds.')
  }

  for (let i = 0; i < seniorityTiers.length - 1; i++) {
    if (seniorityTiers[i].draw_order >= seniorityTiers[i + 1].draw_order) {
      errors.push('Seniority tiers must be drawn in descending min_years order (most senior first).')
      break
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Determine the registration window state for a member.
 * memberType: 'flight_winner' | 'seniority' | 'general'
 * Returns: 'open' | 'too_early' | 'closed' | 'flight_winner_only'
 */
export function isRegistrationOpen(tournament, memberType, now = new Date()) {
  const opens = new Date(tournament.registration_opens_at)
  const deadline = new Date(tournament.registration_deadline)
  const fwDeadline = tournament.flight_winner_registration_deadline
    ? new Date(tournament.flight_winner_registration_deadline)
    : null

  if (memberType === 'flight_winner') {
    if (fwDeadline && now > fwDeadline) {
      // Flight winner exclusive window closed; fall through to general window
      if (now < opens) return 'too_early'
      if (now > deadline) return 'closed'
      return 'open'
    }
    if (now > deadline) return 'closed'
    return 'open'
  }

  // General / seniority members
  if (fwDeadline && now < opens) return 'flight_winner_only'
  if (now < opens) return 'too_early'
  if (now > deadline) return 'closed'
  return 'open'
}

/**
 * Determine the display tier label for a member given tournament context.
 * Returns: 'flight_winner' | 'seniority' | 'general'
 * Also returns the matching seniority tier name if applicable.
 */
export function getEligibleTierType(member, tiers, isFlightWinner) {
  if (isFlightWinner) return { type: 'flight_winner', tierName: 'Flight Winners' }

  const tenure = getMemberTenure(member.member_since)
  const seniorityTiers = tiers
    .filter(t => t.type === 'seniority')
    .sort((a, b) => b.min_years - a.min_years) // highest threshold first

  for (const tier of seniorityTiers) {
    if (tenure >= tier.min_years) {
      return { type: 'seniority', tierName: tier.name }
    }
  }

  return { type: 'general', tierName: 'General Draw' }
}
