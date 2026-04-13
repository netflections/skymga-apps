import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@skymga/supabase'
import { Badge } from '@skymga/ui'

const TIER_TYPE_COLORS = {
  flight_winners: 'yellow',
  seniority: 'blue',
  general: 'green',
  waitlist: 'gray',
}

// ── Tournament list ──────────────────────────────────────────────────────────

function TournamentList({ tournaments }) {
  if (tournaments.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-400 text-sm">No results have been published yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tournaments.map(t => (
        <Link
          key={t.id}
          to={`/results/${t.year}`}
          className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 hover:border-sky-300 hover:shadow-sm transition-all group"
        >
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-sky-700 transition-colors">
              {t.year} {t.name}
            </p>
          </div>
          <span className="text-sky-600 text-sm">View results →</span>
        </Link>
      ))}
    </div>
  )
}

// ── Tournament results detail ────────────────────────────────────────────────

function TournamentResults({ year }) {
  const [tournament, setTournament] = useState(null)
  const [tiers, setTiers] = useState([])
  const [results, setResults] = useState([])
  const [members, setMembers] = useState({})
  const [registrations, setRegistrations] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      // Fetch the tournament
      const { data: t } = await supabase
        .from('tournaments')
        .select('id, name, year, results_published, status')
        .eq('year', year)
        .eq('results_published', true)
        .single()

      if (!t) { setNotFound(true); setLoading(false); return }
      setTournament(t)

      // Fetch tiers + lottery results + members in parallel
      const [tiersRes, lrRes] = await Promise.all([
        supabase.from('tiers').select('*').eq('tournament_id', t.id).order('draw_order'),
        supabase
          .from('lottery_results')
          .select('*, members(first_name, last_name)')
          .eq('tournament_id', t.id)
          .eq('result', 'selected'),
      ])

      const tierList = tiersRes.data ?? []
      const lrList = lrRes.data ?? []

      // Build member map and registration guest-name map
      const memberMap = {}
      for (const lr of lrList) {
        if (lr.members) memberMap[lr.member_id] = lr.members
      }

      // Fetch registrations to get guest names
      const memberIds = lrList.map(lr => lr.member_id)
      let regMap = {}
      if (memberIds.length > 0) {
        const { data: regs } = await supabase
          .from('registrations')
          .select('member_id, guest_name')
          .eq('tournament_id', t.id)
          .in('member_id', memberIds)
        for (const r of regs ?? []) {
          regMap[r.member_id] = r
        }
      }

      setTiers(tierList)
      setResults(lrList)
      setMembers(memberMap)
      setRegistrations(regMap)
      setLoading(false)
    }
    load()
  }, [year])

  if (loading) return <p className="text-gray-400 text-sm text-center py-16">Loading…</p>
  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500 text-sm mb-3">Results for {year} are not available.</p>
        <Link to="/results" className="text-sky-600 hover:text-sky-800 text-sm">← All results</Link>
      </div>
    )
  }

  const resultsByTier = {}
  for (const lr of results) {
    if (!resultsByTier[lr.tier_id]) resultsByTier[lr.tier_id] = []
    resultsByTier[lr.tier_id].push(lr)
  }

  const tiersWithResults = tiers.filter(t => (resultsByTier[t.id] ?? []).length > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/results" className="text-sm text-gray-400 hover:text-gray-600">← All results</Link>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-sky-700">{tournament.year} {tournament.name}</h2>
        <p className="text-gray-500 text-sm mt-1">Confirmed participants</p>
      </div>

      {tiersWithResults.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No confirmed participants to display.</p>
      ) : tiersWithResults.map(tier => {
        const tierResults = (resultsByTier[tier.id] ?? [])
          .sort((a, b) => (a.draw_position ?? 0) - (b.draw_position ?? 0))

        return (
          <div key={tier.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <Badge color={TIER_TYPE_COLORS[tier.type] ?? 'gray'}>{tier.name}</Badge>
              <span className="text-sm text-gray-400">{tierResults.length} confirmed</span>
            </div>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Member</th>
                  <th className="px-5 py-2 text-left text-xs font-medium text-gray-500">Guest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tierResults.map(lr => {
                  const member = members[lr.member_id]
                  const reg = registrations[lr.member_id]
                  return (
                    <tr key={lr.id}>
                      <td className="px-5 py-2.5 font-medium text-gray-800">
                        {member ? `${member.last_name}, ${member.first_name}` : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-gray-600">{reg?.guest_name ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ── Top-level component ──────────────────────────────────────────────────────

export default function Results() {
  const { year } = useParams()
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (year) { setLoading(false); return }
    supabase
      .from('tournaments')
      .select('id, name, year')
      .eq('results_published', true)
      .order('year', { ascending: false })
      .then(({ data }) => {
        setTournaments(data ?? [])
        setLoading(false)
      })
  }, [year])

  if (year) return <TournamentResults year={parseInt(year, 10)} />

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-sky-700">Invitational Results</h2>
        <p className="text-gray-500 text-sm mt-1">Published results for past tournaments</p>
      </div>
      {loading
        ? <p className="text-gray-400 text-sm text-center py-16">Loading…</p>
        : <TournamentList tournaments={tournaments} />
      }
    </div>
  )
}
