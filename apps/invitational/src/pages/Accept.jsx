import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@skymga/supabase'

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID

function formatDeadline(utc, timezone) {
  if (!utc) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(utc))
}

function Countdown({ deadline }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    function update() {
      const ms = new Date(deadline) - Date.now()
      if (ms <= 0) { setRemaining('Expired'); return }
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      setRemaining(h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h remaining` : `${h}h ${m}m remaining`)
    }
    update()
    const id = setInterval(update, 60000)
    return () => clearInterval(id)
  }, [deadline])

  return <span className="text-amber-700 font-medium text-sm">{remaining}</span>
}

export default function Accept() {
  const { token } = useParams()
  const paypalContainerRef = useRef(null)
  const [state, setState] = useState('loading') // loading | invalid | expired | already_paid | withdrawn | declined_already | open | declining | confirmed | error
  const [data, setData] = useState(null)
  const [declineChecked, setDeclineChecked] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [paypalLoaded, setPaypalLoaded] = useState(false)
  const [paypalError, setPaypalError] = useState('')

  useEffect(() => {
    async function loadToken() {
      // Fetch registration + tournament info via the create-order validation path
      // We use a lightweight Supabase query here since the accept page doesn't require auth
      const { data: reg, error } = await supabase
        .from('registrations')
        .select(`
          id, status, deposit_paid, declined_at, acceptance_deadline,
          guest_name, guest_email, confirmation_number,
          member_id,
          members!inner(first_name, last_name),
          tournaments!inner(year, name, deposit_amount, timezone)
        `)
        .eq('acceptance_token', token)
        .single()

      if (error || !reg) { setState('invalid'); return }
      if (reg.deposit_paid) { setState('already_paid'); setData(reg); return }
      if (reg.status === 'withdrawn') { setState('withdrawn'); return }
      if (reg.declined_at) { setState('declined_already'); return }
      if (reg.acceptance_deadline && new Date(reg.acceptance_deadline) < new Date()) {
        setState('expired'); return
      }

      setData(reg)
      setState('open')
    }

    loadToken()
  }, [token])

  // Load PayPal SDK once we know deposit is required and state is open
  useEffect(() => {
    if (state !== 'open') return
    if (!data?.tournaments?.deposit_amount || data.tournaments.deposit_amount <= 0) return
    if (!PAYPAL_CLIENT_ID) return

    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`
    script.onload = () => setPaypalLoaded(true)
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [state, data])

  // Render PayPal button once SDK is loaded
  useEffect(() => {
    if (!paypalLoaded || !paypalContainerRef.current) return
    if (!window.paypal) return

    paypalContainerRef.current.innerHTML = ''

    window.paypal.Buttons({
      createOrder: async () => {
        const { data: result, error } = await supabase.functions.invoke('paypal-create-order', {
          body: { token },
        })
        if (error || result?.error) {
          setPaypalError(result?.error ?? error?.message ?? 'Could not create order')
          throw new Error(result?.error ?? error?.message)
        }
        return result.orderID
      },
      onApprove: async (paypalData) => {
        const { data: result, error } = await supabase.functions.invoke('paypal-capture-order', {
          body: { token, orderID: paypalData.orderID },
        })
        if (error || result?.error) {
          setPaypalError(result?.error ?? error?.message ?? 'Payment capture failed')
          return
        }
        setData(prev => ({ ...prev, confirmation_number: result.confirmationNumber }))
        setState('confirmed')
      },
      onError: (err) => {
        console.error('PayPal error:', err)
        setPaypalError('Payment failed. Please try again or contact the tournament coordinator.')
      },
    }).render(paypalContainerRef.current)
  }, [paypalLoaded])

  async function handleDecline() {
    if (!declineChecked) return
    setDeclining(true)
    const { data: result, error } = await supabase.functions.invoke('decline-registration', {
      body: { token },
    })
    setDeclining(false)
    if (error || result?.error) {
      setPaypalError(result?.error ?? error?.message ?? 'Decline failed')
      return
    }
    setState('declined_now')
  }

  // ── States ────────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return <p className="text-gray-400 text-sm text-center py-16">Loading…</p>
  }

  if (state === 'invalid') {
    return <StatusCard type="error" title="Invalid link" body="This link is invalid. Please check your email for the correct link." />
  }
  if (state === 'expired') {
    return <StatusCard type="error" title="Link expired" body="Your acceptance window has passed. Your spot has been released to the waitlist." />
  }
  if (state === 'withdrawn') {
    return <StatusCard type="error" title="Registration cancelled" body="Your registration has been cancelled by the tournament coordinator. Please contact admin@skymga.org with any questions." />
  }
  if (state === 'declined_already') {
    return <StatusCard type="info" title="Already declined" body="You have already declined your spot. You are no longer eligible for this tournament." />
  }
  if (state === 'declined_now') {
    return <StatusCard type="info" title="Spot declined" body="You have declined your spot. It will be offered to the next member on the waitlist. Thank you for letting us know." />
  }

  if (state === 'confirmed') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-green-800 font-semibold text-lg mb-1">You're confirmed!</p>
          <p className="text-green-700 text-sm mb-4">A confirmation email has been sent to your address.</p>
          <p className="text-4xl font-bold font-mono text-green-900 mb-2">{data?.confirmation_number}</p>
          <p className="text-green-700 text-sm">
            Present this confirmation number to the Pro Shop to finalize your registration.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm space-y-1">
          <p><span className="text-gray-500">Member:</span> <strong>{data?.members?.first_name} {data?.members?.last_name}</strong></p>
          <p><span className="text-gray-500">Guest:</span> <strong>{data?.guest_name}</strong></p>
          <p><span className="text-gray-500">Tournament:</span> <strong>{data?.tournaments?.year} {data?.tournaments?.name}</strong></p>
        </div>
        <button onClick={() => window.print()} className="w-full rounded-md border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Print confirmation
        </button>
      </div>
    )
  }

  if (state === 'already_paid') {
    return (
      <div className="space-y-4">
        <StatusCard type="info" title="Already confirmed" body="" />
        <div className="rounded-xl border border-gray-200 bg-white p-5 text-center">
          <p className="text-gray-500 text-sm mb-1">Your confirmation number</p>
          <p className="text-3xl font-bold font-mono text-sky-800">{data?.confirmation_number}</p>
          <p className="text-gray-500 text-sm mt-2">Present this to the Pro Shop to finalize registration.</p>
        </div>
      </div>
    )
  }

  // ── Open / payment state ─────────────────────────────────────────────────

  const tournament = data?.tournaments
  const member = data?.members
  const depositRequired = tournament?.deposit_amount > 0

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-sky-700">{tournament?.year} MGA Invitational</h2>
        <p className="text-gray-500 text-sm mt-1">Welcome, {member?.first_name}.</p>
      </div>

      {/* Selection details */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 space-y-2 text-sm">
        <p className="font-semibold text-sky-800">You've been selected!</p>
        <p className="text-sky-700">Guest: <strong>{data?.guest_name}</strong></p>
        {depositRequired && (
          <p className="text-sky-700">Deposit required: <strong>${Number(tournament.deposit_amount).toFixed(2)}</strong></p>
        )}
        {data?.acceptance_deadline && (
          <div className="flex items-center gap-2">
            <p className="text-sky-700">Deadline: <strong>{formatDeadline(data.acceptance_deadline, tournament?.timezone)}</strong></p>
            <Countdown deadline={data.acceptance_deadline} />
          </div>
        )}
      </div>

      {/* Payment section */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h3 className="font-semibold text-gray-800">
          {depositRequired ? 'Pay deposit to confirm your spot' : 'Confirm your spot'}
        </h3>

        {depositRequired ? (
          <>
            {!PAYPAL_CLIENT_ID ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                PayPal is not configured. Contact admin@skymga.org to complete your registration.
              </p>
            ) : !paypalLoaded ? (
              <p className="text-gray-400 text-sm">Loading payment options…</p>
            ) : null}
            <div ref={paypalContainerRef} />
            {paypalError && <p className="text-sm text-red-600">{paypalError}</p>}
          </>
        ) : (
          <p className="text-sm text-gray-500">No deposit is required for this tournament. Contact admin@skymga.org to confirm.</p>
        )}
      </div>

      {/* Decline section */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Can't attend?</h3>
        <label className="flex items-start gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={declineChecked}
            onChange={e => setDeclineChecked(e.target.checked)}
            className="mt-0.5 rounded border-gray-300"
          />
          <span>
            I understand that by declining, I am opting out of the {tournament?.year} MGA Invitational.
            My spot will be released and offered to the next member on the waitlist.
          </span>
        </label>
        <button
          onClick={handleDecline}
          disabled={!declineChecked || declining}
          className="w-full rounded-md border border-red-300 text-red-600 py-2 text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {declining ? 'Declining…' : 'Decline My Spot'}
        </button>
      </div>
    </div>
  )
}

function StatusCard({ type, title, body }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  }
  return (
    <div className={`rounded-xl border p-6 ${styles[type] ?? styles.info}`}>
      <p className="font-semibold mb-1">{title}</p>
      {body && <p className="text-sm opacity-90">{body}</p>}
    </div>
  )
}
