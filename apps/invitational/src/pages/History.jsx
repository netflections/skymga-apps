import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@skymga/supabase'
import { useAuth } from '../context/AuthContext'
import { Badge } from '@skymga/ui'

const RESULT_COLORS = {
  selected: 'green',
  waitlisted: 'blue',
  not_selected: 'gray',
  expired: 'red',
  declined: 'red',
}

const STATUS_LABELS = {
  pending: 'Pending',
  selected: 'Selected',
  waitlisted: 'Waitlisted',
  not_selected: 'Not Selected',
  expired: 'Expired',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

export default function History() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { navigate('/'); return }

    async function load() {
      // Get the member row for this user
      const { data: member } = await supabase
        .from('members')
        .select('id')
        .eq('auth_uid', user.id)
        .single()

      if (!member) { setLoading(false); return }

      // Get all registrations for this member with tournament and lottery result info
      const { data: regs } = await supabase
        .from('registrations')
        .select(`
          id, status, deposit_paid, declined_at, guest_name, guest_email,
          registered_at, confirmation_number,
          tournaments(id, name, year),
          tiers(name, type)
        `)
        .eq('member_id', member.id)
        .order('registered_at', { ascending: false })

      if (!regs || regs.length === 0) { setRows([]); setLoading(false); return }

      // Fetch lottery results for all registrations
      const tournamentIds = [...new Set(regs.map(r => r.tournaments?.id).filter(Boolean))]
      const { data: lrData } = await supabase
        .from('lottery_results')
        .select('tournament_id, result, draw_position')
        .eq('member_id', member.id)
        .in('tournament_id', tournamentIds)

      const lrMap = {}
      for (const lr of lrData ?? []) {
        lrMap[lr.tournament_id] = lr
      }

      // Merge lottery results into rows
      const enriched = regs.map(r => ({
        ...r,
        lottery: lrMap[r.tournaments?.id] ?? null,
      }))

      setRows(enriched)
      setLoading(false)
    }

    load()
  }, [user])

  if (loading) return <p className="text-gray-400 text-sm text-center py-16">Loading…</p>

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-sky-700">My Invitational History</h2>
        <p className="text-gray-500 text-sm mt-1">Your registration history across all tournaments</p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-gray-400 text-sm">You haven't registered for any tournaments yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map(reg => {
            const t = reg.tournaments
            const tier = reg.tiers
            const lr = reg.lottery
            const isConfirmed = reg.deposit_paid

            return (
              <div key={reg.id} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
                {/* Tournament header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {t?.year} {t?.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Registered {new Date(reg.registered_at).toLocaleDateString('en-US', {
                        month: 'long', day: 'numeric', year: 'numeric'
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {tier && (
                      <Badge color={
                        tier.type === 'flight_winners' ? 'yellow' :
                        tier.type === 'seniority' ? 'blue' :
                        tier.type === 'general' ? 'green' : 'gray'
                      }>
                        {tier.name}
                      </Badge>
                    )}
                    {lr ? (
                      <Badge color={RESULT_COLORS[lr.result] ?? 'gray'}>
                        {isConfirmed ? 'Confirmed' : STATUS_LABELS[reg.status] ?? reg.status}
                      </Badge>
                    ) : (
                      <Badge color="gray">{STATUS_LABELS[reg.status] ?? reg.status}</Badge>
                    )}
                  </div>
                </div>

                {/* Registration details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <span className="text-gray-500">Guest: </span>
                    <span className="font-medium text-gray-800">{reg.guest_name}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Guest email: </span>
                    <span className="text-gray-700">{reg.guest_email}</span>
                  </div>
                </div>

                {/* Confirmation number */}
                {isConfirmed && reg.confirmation_number && (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 flex items-center justify-between">
                    <span className="text-green-700 text-sm">Confirmation #</span>
                    <span className="font-mono font-bold text-green-900">{reg.confirmation_number}</span>
                  </div>
                )}

                {/* Draw position for waitlisted */}
                {lr?.result === 'waitlisted' && lr.draw_position && (
                  <p className="text-xs text-blue-600">
                    Waitlist position: <strong>#{lr.draw_position}</strong>
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
