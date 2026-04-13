import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@skymga/supabase'
import { Badge } from '@skymga/ui'
import TournamentForm from '../components/TournamentForm'
import TierEditor from '../components/TierEditor'
import DrawConsole from '../components/DrawConsole'
import FlightWinnerEditor from '../components/FlightWinnerEditor'

const STATUS_COLORS = { draft: 'gray', open: 'green', closed: 'yellow', complete: 'blue' }

const TRANSITIONS = {
  draft:    { label: 'Open Registration →', next: 'open',     color: 'text-sky-600 hover:text-sky-800' },
  open:     { label: 'Close Registration →', next: 'closed',  color: 'text-amber-600 hover:text-amber-800' },
  closed:   { label: 'Mark Complete →',      next: 'complete', color: 'text-gray-600 hover:text-gray-800' },
  complete: null,
}

const TABS = [
  { id: 'settings',       label: 'Settings' },
  { id: 'tiers',          label: 'Tiers' },
  { id: 'flight-winners', label: 'Flight Winners' },
  { id: 'draw',           label: 'Draw Console' },
]

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state: routeState } = useLocation()
  const isNew = id === 'new'
  const topRef = useRef(null)

  const [tournament, setTournament] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [tab, setTab] = useState('settings')

  async function fetchTournament() {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single()
    setTournament(data)
    setLoading(false)
  }

  useEffect(() => {
    if (!isNew) fetchTournament()
  }, [id])

  useEffect(() => {
    if (routeState?.created) {
      topRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [routeState])

  async function handleSaveSettings(payload) {
    if (isNew) {
      const { data, error } = await supabase
        .from('tournaments')
        .insert(payload)
        .select()
        .single()
      if (!error) navigate(`/tournaments/${data.id}`, { state: { created: true } })
      return { error }
    } else {
      const { error } = await supabase
        .from('tournaments')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (!error) fetchTournament()
      return { error }
    }
  }

  async function transition(newStatus) {
    await supabase
      .from('tournaments')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
    fetchTournament()
  }

  if (loading) {
    return <p className="text-gray-400 text-sm py-12 text-center">Loading…</p>
  }

  const tx = !isNew ? TRANSITIONS[tournament?.status] : null

  return (
    <div ref={topRef}>
      {/* Created confirmation banner */}
      {routeState?.created && (
        <div className="mb-6 rounded-lg bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2">
          <span className="text-green-700 text-sm font-medium">Tournament created.</span>
          <span className="text-green-600 text-sm">Configure tiers below, then open registration when ready.</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/tournaments')}
          className="text-sm text-gray-400 hover:text-gray-600 mb-2 block"
        >
          ← Tournaments
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-sky-700">
            {isNew ? 'New Tournament' : tournament?.name}
          </h2>
          {!isNew && tournament && (
            <>
              <Badge color={STATUS_COLORS[tournament.status] ?? 'gray'}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
              {tx && (
                <button
                  onClick={() => transition(tx.next)}
                  className={`text-sm font-medium ${tx.color}`}
                >
                  {tx.label}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs (only for existing tournaments) */}
      {!isNew && (
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-sky-600 text-sky-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* Tab content */}
      {(isNew || tab === 'settings') && (
        <TournamentForm
          tournament={isNew ? null : tournament}
          onSave={handleSaveSettings}
          isNew={isNew}
        />
      )}

      {!isNew && tab === 'tiers' && (
        <TierEditor tournamentId={id} tournament={tournament} />
      )}

      {!isNew && tab === 'flight-winners' && (
        <FlightWinnerEditor tournamentId={id} />
      )}

      {!isNew && tab === 'draw' && (
        <DrawConsole tournamentId={id} tournament={tournament} />
      )}
    </div>
  )
}
