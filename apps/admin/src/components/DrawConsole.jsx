import { useEffect, useState } from 'react'
import { supabase } from '@skymga/supabase'
import { Button, Badge } from '@skymga/ui'
import { formatDatetime } from '../lib/datetime'

const TIER_TYPE_COLORS = {
  flight_winners: 'yellow',
  seniority: 'blue',
  general: 'green',
  waitlist: 'gray',
}

const REG_STATUS_COLORS = {
  selected: 'green',
  pending: 'gray',
  waitlisted: 'blue',
  not_selected: 'gray',
  expired: 'red',
  declined: 'red',
  withdrawn: 'gray',
}

export default function DrawConsole({ tournamentId, tournament }) {
  const tz = tournament.timezone ?? 'America/New_York'
  const [tiers, setTiers] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [lotteryResults, setLotteryResults] = useState([])
  const [members, setMembers] = useState({})
  const [loading, setLoading] = useState(true)
  const [confirmTier, setConfirmTier] = useState(null) // tier to confirm draw for
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [expandedTier, setExpandedTier] = useState(null)

  async function load() {
    const [tiersRes, regsRes, lrRes] = await Promise.all([
      supabase.from('tiers').select('*').eq('tournament_id', tournamentId).order('draw_order'),
      supabase.from('registrations').select('*, members(first_name, last_name, email)').eq('tournament_id', tournamentId),
      supabase.from('lottery_results').select('*, tiers(type)').eq('tournament_id', tournamentId),
    ])

    setTiers(tiersRes.data ?? [])
    setRegistrations(regsRes.data ?? [])
    setLotteryResults(lrRes.data ?? [])

    // Build member map
    const memberMap = {}
    for (const reg of regsRes.data ?? []) {
      if (reg.members) memberMap[reg.member_id] = reg.members
    }
    setMembers(memberMap)
    setLoading(false)
  }

  useEffect(() => { load() }, [tournamentId])

  function tierHasBeenDrawn(tierId) {
    return lotteryResults.some(lr => lr.tier_id === tierId)
  }

  function getResultsForTier(tierId) {
    return lotteryResults
      .filter(lr => lr.tier_id === tierId)
      .sort((a, b) => (a.draw_position ?? 0) - (b.draw_position ?? 0))
  }

  function getRegForMember(memberId) {
    return registrations.find(r => r.member_id === memberId)
  }

  function registrationCountForTier(tier) {
    return registrations.filter(r => r.status === 'pending').length
  }

  async function runDraw(tier) {
    setRunning(true)
    setRunError('')
    setConfirmTier(null)

    const { data, error } = await supabase.functions.invoke('run-draw', {
      body: { tournament_id: tournamentId, tier_id: tier.id },
    })

    setRunning(false)
    if (error || data?.error) {
      setRunError(error?.message ?? data?.error ?? 'Draw failed')
    } else {
      load()
    }
  }

  async function markWithdrawn(regId) {
    await supabase.from('registrations').update({ status: 'withdrawn' }).eq('id', regId)
    load()
  }

  async function publishResults() {
    await supabase
      .from('tournaments')
      .update({ results_published: true, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
    load()
  }

  async function unpublishResults() {
    await supabase
      .from('tournaments')
      .update({ results_published: false, updated_at: new Date().toISOString() })
      .eq('id', tournamentId)
    load()
  }

  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>

  const totalRegistrations = registrations.length
  const pendingCount = registrations.filter(r => r.status === 'pending').length
  const confirmedCount = registrations.filter(r => r.deposit_paid).length
  const waitlistCount = registrations.filter(r => r.status === 'waitlisted').length
  const isPublished = tournament?.results_published ?? false
  const isComplete = tournament?.status === 'complete'

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total registrations', value: totalRegistrations },
          { label: 'Awaiting draw', value: pendingCount },
          { label: 'Confirmed + paid', value: confirmedCount },
          { label: 'On waitlist', value: waitlistCount },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-sky-700">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Publish results */}
      {isComplete && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4">
          <div>
            <p className="font-medium text-gray-900 text-sm">Public Results</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {isPublished
                ? 'Results are visible at invitational.skymga.org/results'
                : 'Publish confirmed participant list to the public results page'}
            </p>
          </div>
          {isPublished ? (
            <div className="flex items-center gap-3">
              <Badge color="green">Published</Badge>
              <button
                onClick={unpublishResults}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Unpublish
              </button>
            </div>
          ) : (
            <Button onClick={publishResults}>Publish Results</Button>
          )}
        </div>
      )}

      {runError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {runError}
        </div>
      )}

      {/* Tiers */}
      {tiers.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No tiers configured. Go to the Tiers tab to set them up.</p>
      ) : tiers.map((tier, idx) => {
        const drawn = tierHasBeenDrawn(tier.id)
        const results = getResultsForTier(tier.id)
        const expanded = expandedTier === tier.id
        const selectedResults = results.filter(r => r.result === 'selected')
        const waitlistResults = results.filter(r => r.result === 'waitlisted')

        return (
          <div key={tier.id} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Tier header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-400 w-5 text-center">{idx + 1}</span>
                <Badge color={TIER_TYPE_COLORS[tier.type] ?? 'gray'}>{tier.name}</Badge>
                <span className="text-sm text-gray-500">
                  {tier.type === 'waitlist' ? 'Unlimited' : `${tier.allocated_spots} spots`}
                </span>
                {tier.draw_date && (
                  <span className="text-xs text-gray-400">
                    Draw: {formatDatetime(tier.draw_date, tz)}
                  </span>
                )}
                {tier.acceptance_deadline && (
                  <span className="text-xs text-gray-400">
                    Deadline: {formatDatetime(tier.acceptance_deadline, tz)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {drawn && (
                  <Badge color="green">Drawn</Badge>
                )}
                {drawn && results.length > 0 && (
                  <button
                    onClick={() => setExpandedTier(expanded ? null : tier.id)}
                    className="text-sm text-sky-600 hover:text-sky-800"
                  >
                    {expanded ? 'Hide results' : `View results (${results.length})`}
                  </button>
                )}
                {!drawn && tier.type !== 'waitlist' && (
                  <Button
                    onClick={() => setConfirmTier(tier)}
                    disabled={running}
                    variant={idx === 0 || tierHasBeenDrawn(tiers[idx - 1]?.id) ? 'primary' : 'outline'}
                  >
                    Run Draw
                  </Button>
                )}
                {!drawn && tier.type === 'waitlist' && (
                  <span className="text-xs text-gray-400">Runs automatically after General draw</span>
                )}
              </div>
            </div>

            {/* Results table */}
            {expanded && results.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {tier.type !== 'flight_winners' && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">#</th>}
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Member</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Guest</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Draw result</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Confirmation</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map(lr => {
                      const reg = getRegForMember(lr.member_id)
                      const member = members[lr.member_id]
                      return (
                        <tr key={lr.id} className="hover:bg-gray-50">
                          {tier.type !== 'flight_winners' && (
                            <td className="px-4 py-2 text-gray-400 text-xs">{lr.draw_position ?? '—'}</td>
                          )}
                          <td className="px-4 py-2 font-medium text-gray-800">
                            {member ? `${member.last_name}, ${member.first_name}` : lr.member_id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{reg?.guest_name ?? '—'}</td>
                          <td className="px-4 py-2">
                            <Badge color={lr.result === 'selected' ? 'green' : lr.result === 'waitlisted' ? 'blue' : 'gray'}>
                              {lr.result}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            {reg && (
                              <Badge color={REG_STATUS_COLORS[reg.status] ?? 'gray'}>
                                {reg.deposit_paid ? 'Confirmed' : reg.status}
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                            {reg?.confirmation_number ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {reg?.deposit_paid && reg?.status !== 'withdrawn' && (
                              <button
                                onClick={() => markWithdrawn(reg.id)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Withdraw
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {/* Confirm draw modal */}
      {confirmTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setConfirmTier(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-2">Run draw for {confirmTier.name}?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will randomly select members for {confirmTier.allocated_spots} spot{confirmTier.allocated_spots !== 1 ? 's' : ''} and send notifications. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmTier(null)}>Cancel</Button>
              <Button onClick={() => runDraw(confirmTier)} disabled={running}>
                {running ? 'Running…' : 'Run Draw'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
