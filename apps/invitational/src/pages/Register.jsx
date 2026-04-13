import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@skymga/supabase'
import { useAuth } from '../context/AuthContext'
import { isValidGhin, getMemberTenure, isRegistrationOpen, getEligibleTierType } from '@skymga/utils'

function formatDate(utcString, timezone) {
  if (!utcString) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(utcString))
}

const STATUS_LABELS = {
  pending:      { label: 'Registered — awaiting draw', color: 'text-sky-700 bg-sky-50 border-sky-200' },
  selected:     { label: 'Selected! Check your email for the acceptance link.', color: 'text-green-700 bg-green-50 border-green-200' },
  waitlisted:   { label: 'On the waitlist', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  not_selected: { label: 'Not selected in the draw', color: 'text-gray-700 bg-gray-50 border-gray-200' },
  expired:      { label: 'Acceptance window expired', color: 'text-red-700 bg-red-50 border-red-200' },
  declined:     { label: 'You declined your spot', color: 'text-gray-700 bg-gray-50 border-gray-200' },
  withdrawn:    { label: 'Registration withdrawn', color: 'text-gray-700 bg-gray-50 border-gray-200' },
}

export default function Register() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [state, setState] = useState('loading') // loading | error | no_tournament | not_member | inactive | registered | too_early | flight_winner_only | open | submitted
  const [member, setMember] = useState(null)
  const [tournament, setTournament] = useState(null)
  const [tiers, setTiers] = useState([])
  const [registration, setRegistration] = useState(null)
  const [eligibility, setEligibility] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Form state
  const [form, setForm] = useState({ guest_name: '', guest_email: '', guest_phone: '', guest_ghin: '' })
  const [formErrors, setFormErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!user) { navigate('/', { replace: true }); return }
    load()
  }, [user])

  async function load() {
    setState('loading')

    // 1. Load this member's record (RLS: only own row via auth_uid)
    const { data: memberData } = await supabase
      .from('members')
      .select('*')
      .single()

    if (!memberData) { setState('not_member'); return }
    if (!memberData.is_active) { setState('inactive'); return }
    setMember(memberData)

    // 2. Load the current open tournament
    const { data: tournamentData } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .order('year', { ascending: false })
      .limit(1)
      .single()

    if (!tournamentData) { setState('no_tournament'); return }
    setTournament(tournamentData)

    // 3. Load tiers for eligibility display
    const { data: tierData } = await supabase
      .from('tiers')
      .select('*')
      .eq('tournament_id', tournamentData.id)
      .order('draw_order')
    setTiers(tierData ?? [])

    // 4. Check if this member is a prior year flight winner for this tournament
    const { data: fwData } = await supabase
      .from('prior_year_winners')
      .select('id')
      .eq('tournament_id', tournamentData.id)
      .eq('member_id', memberData.id)
      .maybeSingle()
    const isFlightWinner = !!fwData

    // 5. Determine eligible tier type
    const elig = getEligibleTierType(memberData, tierData ?? [], isFlightWinner)
    setEligibility(elig)

    // 6. Check existing registration
    const { data: regData } = await supabase
      .from('registrations')
      .select('*')
      .eq('tournament_id', tournamentData.id)
      .eq('member_id', memberData.id)
      .maybeSingle()

    if (regData) {
      setRegistration(regData)
      setState('registered')
      return
    }

    // 7. Check registration window
    const windowState = isRegistrationOpen(tournamentData, elig.type, new Date())
    setState(windowState === 'open' ? 'open' : windowState)
  }

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setFormErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const errs = {}
    if (!form.guest_name.trim()) errs.guest_name = 'Required'
    if (!form.guest_email.trim()) errs.guest_email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guest_email)) errs.guest_email = 'Invalid email'
    if (!form.guest_phone.trim()) errs.guest_phone = 'Required'
    if (!form.guest_ghin.trim()) errs.guest_ghin = 'Required'
    else if (!isValidGhin(form.guest_ghin.replace(/\D/g, ''))) errs.guest_ghin = 'GHIN must be exactly 7 digits'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setFormErrors(errs); return }

    setSubmitting(true)
    const { error } = await supabase.from('registrations').insert({
      tournament_id: tournament.id,
      member_id: member.id,
      guest_name: form.guest_name.trim(),
      guest_email: form.guest_email.trim().toLowerCase(),
      guest_phone: form.guest_phone.trim(),
      guest_ghin: form.guest_ghin.replace(/\D/g, ''),
    })

    if (error) {
      setSubmitting(false)
      setErrorMsg('Something went wrong. Please try again.')
      return
    }

    // Send confirmation email (best-effort — don't block on failure)
    try {
      await supabase.functions.invoke('send-registration-email', {
        body: {
          member_id: member.id,
          tournament_id: tournament.id,
          guest_name: form.guest_name.trim(),
          tier_name: eligibility?.tierName ?? 'General Draw',
        },
      })
    } catch { /* non-blocking */ }

    setSubmitting(false)
    setState('submitted')
  }

  if (state === 'loading') {
    return <p className="text-gray-400 text-sm text-center py-16">Loading…</p>
  }

  // ── Error / edge states ──────────────────────────────────────────────────

  if (state === 'not_member') {
    return (
      <Message type="error" title="Not an MGA member">
        Your email address is not in the MGA member roster. If you believe this is an error,
        please contact the tournament coordinator.
      </Message>
    )
  }

  if (state === 'inactive') {
    return (
      <Message type="error" title="Inactive membership">
        Your MGA membership is currently inactive. Please contact the tournament coordinator.
      </Message>
    )
  }

  if (state === 'no_tournament') {
    return (
      <Message type="info" title="No active tournament">
        There is no MGA Invitational currently open for registration. Check back soon.
      </Message>
    )
  }

  // ── Already registered ───────────────────────────────────────────────────

  if (state === 'registered' && registration) {
    const statusInfo = STATUS_LABELS[registration.status] ?? STATUS_LABELS.pending
    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h2 className="text-2xl font-bold text-sky-700">{tournament.year} MGA Invitational</h2>
          <p className="text-gray-500 text-sm mt-1">Welcome back, {member.first_name}.</p>
        </div>
        <div className={`rounded-xl border p-5 ${statusInfo.color}`}>
          <p className="font-medium">{statusInfo.label}</p>
          {registration.guest_name && (
            <p className="text-sm mt-1 opacity-80">Guest: {registration.guest_name}</p>
          )}
          {registration.confirmation_number && (
            <p className="text-sm mt-1 font-mono font-bold">{registration.confirmation_number}</p>
          )}
        </div>
        {eligibility && (
          <p className="text-sm text-gray-500">
            Draw tier: <span className="font-medium text-gray-700">{eligibility.tierName}</span>
          </p>
        )}
      </div>
    )
  }

  // ── Registration window states ───────────────────────────────────────────

  if (state === 'too_early') {
    return (
      <div className="space-y-4">
        <TournamentHeader tournament={tournament} member={member} />
        <Message type="info" title="Registration not yet open">
          Registration opens on{' '}
          <strong>{formatDate(tournament.registration_opens_at, tournament.timezone)}</strong>.
        </Message>
        {eligibility && (
          <p className="text-sm text-gray-500">
            You are eligible for: <span className="font-medium text-gray-700">{eligibility.tierName}</span>
          </p>
        )}
      </div>
    )
  }

  if (state === 'flight_winner_only') {
    return (
      <div className="space-y-4">
        <TournamentHeader tournament={tournament} member={member} />
        <Message type="info" title="Registration opens soon">
          Registration for your tier opens on{' '}
          <strong>{formatDate(tournament.registration_opens_at, tournament.timezone)}</strong>.
          Prior year flight winners may register now.
        </Message>
      </div>
    )
  }

  if (state === 'closed') {
    return (
      <div className="space-y-4">
        <TournamentHeader tournament={tournament} member={member} />
        <Message type="error" title="Registration is closed">
          The registration deadline has passed.
        </Message>
      </div>
    )
  }

  // ── Submitted confirmation ───────────────────────────────────────────────

  if (state === 'submitted') {
    return (
      <div className="space-y-4">
        <TournamentHeader tournament={tournament} member={member} />
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <p className="text-green-800 font-semibold text-lg mb-1">You're registered!</p>
          <p className="text-green-700 text-sm">
            A confirmation email has been sent to <strong>{member.email}</strong>.
            You'll hear from us once the lottery draw runs.
          </p>
          <div className="mt-3 text-sm text-green-800 space-y-0.5">
            <p>Guest: <strong>{form.guest_name}</strong></p>
            <p>Tier: <strong>{eligibility?.tierName}</strong></p>
          </div>
        </div>
      </div>
    )
  }

  // ── Registration form ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <TournamentHeader tournament={tournament} member={member} />

      {eligibility && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm">
          <span className="text-sky-700">You are eligible for the </span>
          <span className="font-semibold text-sky-800">{eligibility.tierName}</span>
          {eligibility.type === 'seniority' && (
            <span className="text-sky-700"> ({getMemberTenure(member.member_since)} years of membership)</span>
          )}
          {eligibility.type === 'flight_winner' && (
            <span className="text-sky-700"> — you are a prior year flight winner</span>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Guest Information</h3>
        <p className="text-sm text-gray-500 mb-5">
          Registration deadline:{' '}
          <strong>{formatDate(tournament.registration_deadline, tournament.timezone)}</strong>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Guest Full Name"
            id="guest_name"
            value={form.guest_name}
            onChange={e => setField('guest_name', e.target.value)}
            error={formErrors.guest_name}
          />
          <Field
            label="Guest Email"
            id="guest_email"
            type="email"
            value={form.guest_email}
            onChange={e => setField('guest_email', e.target.value)}
            error={formErrors.guest_email}
          />
          <Field
            label="Guest Phone"
            id="guest_phone"
            type="tel"
            placeholder="(617) 555-1234"
            value={form.guest_phone}
            onChange={e => setField('guest_phone', e.target.value)}
            error={formErrors.guest_phone}
          />
          <Field
            label="Guest GHIN Number"
            id="guest_ghin"
            placeholder="7-digit number"
            value={form.guest_ghin}
            onChange={e => setField('guest_ghin', e.target.value)}
            error={formErrors.guest_ghin}
            hint="Your guest's 7-digit GHIN as shown on their GHIN card."
          />

          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-sky-700 text-white py-2.5 text-sm font-medium hover:bg-sky-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit Registration'}
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">
              No payment is collected now. You'll receive a link to pay the deposit if selected in the draw.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Small reusable components ────────────────────────────────────────────────

function TournamentHeader({ tournament, member }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-sky-700">{tournament.year} MGA Invitational</h2>
      {member && <p className="text-gray-500 text-sm mt-1">Welcome, {member.first_name}.</p>}
    </div>
  )
}

function Message({ type, title, children }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  }
  return (
    <div className={`rounded-xl border p-5 ${styles[type] ?? styles.info}`}>
      <p className="font-semibold mb-1">{title}</p>
      <p className="text-sm opacity-90">{children}</p>
    </div>
  )
}

function Field({ label, id, error, hint, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        id={id}
        className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 ${error ? 'border-red-500' : 'border-gray-300'}`}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
