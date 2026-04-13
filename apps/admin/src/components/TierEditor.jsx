import { useEffect, useState } from 'react'
import { supabase } from '@skymga/supabase'
import { Button, Badge } from '@skymga/ui'
import { validateSeniorityTiers } from '@skymga/utils'
import { utcToLocal, localToUtc } from '../lib/datetime'

const DEFAULT_TIERS = [
  { name: 'Flight Winners', type: 'flight_winners', allocated_spots: 6,  min_years: null, reminder_hours_before_deadline: 48 },
  { name: '15+ Years',      type: 'seniority',      allocated_spots: 4,  min_years: 15,   reminder_hours_before_deadline: 48 },
  { name: '10+ Years',      type: 'seniority',      allocated_spots: 6,  min_years: 10,   reminder_hours_before_deadline: 48 },
  { name: '5+ Years',       type: 'seniority',      allocated_spots: 8,  min_years: 5,    reminder_hours_before_deadline: 48 },
  { name: 'General',        type: 'general',         allocated_spots: 36, min_years: null, reminder_hours_before_deadline: 48 },
  { name: 'Waitlist',       type: 'waitlist',        allocated_spots: 0,  min_years: null, reminder_hours_before_deadline: 12 },
]

const TYPE_COLORS = {
  flight_winners: 'yellow',
  seniority: 'blue',
  general: 'green',
  waitlist: 'gray',
}

function uid() {
  return Math.random().toString(36).slice(2)
}

function calcDeadline(drawDateLocal, type, tournament, tz) {
  if (!drawDateLocal || type === 'waitlist') return ''
  const days = type === 'general'
    ? tournament.general_acceptance_days
    : tournament.seniority_acceptance_days
  const utc = localToUtc(drawDateLocal, tz)
  if (!utc) return ''
  const deadline = new Date(new Date(utc).getTime() + days * 86400000)
  return utcToLocal(deadline.toISOString(), tz)
}

function blankTier(drawOrder) {
  return {
    _key: uid(),
    id: null,
    type: 'general',
    name: '',
    allocated_spots: 10,
    min_years: '',
    draw_date_local: '',
    acceptance_deadline_local: '',
    reminder_hours_before_deadline: 48,
    draw_order: drawOrder,
  }
}

export default function TierEditor({ tournamentId, tournament }) {
  const tz = tournament.timezone ?? 'America/New_York'
  const [tiers, setTiers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  async function fetchTiers() {
    const { data } = await supabase
      .from('tiers')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('draw_order')
    setTiers((data ?? []).map(t => ({
      _key: t.id,
      id: t.id,
      type: t.type,
      name: t.name,
      allocated_spots: t.allocated_spots,
      min_years: t.min_years ?? '',
      draw_date_local: utcToLocal(t.draw_date, tz),
      acceptance_deadline_local: utcToLocal(t.acceptance_deadline, tz),
      reminder_hours_before_deadline: t.reminder_hours_before_deadline,
      draw_order: t.draw_order,
    })))
    setLoading(false)
  }

  useEffect(() => { fetchTiers() }, [tournamentId])

  function loadDefaults() {
    setTiers(DEFAULT_TIERS.map((t, i) => ({
      _key: uid(),
      id: null,
      draw_order: i + 1,
      draw_date_local: '',
      acceptance_deadline_local: '',
      ...t,
      min_years: t.min_years ?? '',
    })))
  }

  function addTier() {
    setTiers(prev => [...prev, blankTier(prev.length + 1)])
  }

  function removeTier(idx) {
    setTiers(prev =>
      prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, draw_order: i + 1 }))
    )
  }

  function move(idx, dir) {
    setTiers(prev => {
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr.map((t, i) => ({ ...t, draw_order: i + 1 }))
    })
  }

  function update(idx, field, value) {
    setTiers(prev => {
      const arr = [...prev]
      arr[idx] = { ...arr[idx], [field]: value }
      // Auto-fill acceptance deadline when draw date changes
      if (field === 'draw_date_local') {
        arr[idx].acceptance_deadline_local = calcDeadline(value, arr[idx].type, tournament, tz)
      }
      // Reset acceptance deadline when type changes
      if (field === 'type') {
        arr[idx].acceptance_deadline_local = calcDeadline(arr[idx].draw_date_local, value, tournament, tz)
      }
      return arr
    })
  }

  // Seniority validation for real-time feedback
  const seniorityCheck = validateSeniorityTiers(
    tiers
      .filter(t => t.type === 'seniority')
      .map((t, _, arr) => ({
        name: t.name,
        type: t.type,
        min_years: parseInt(t.min_years) || 0,
        draw_order: t.draw_order,
      }))
  )

  async function saveTiers() {
    setSaveError('')
    setSavedMsg('')

    // Validate required fields on non-waitlist tiers
    const missing = tiers
      .filter(t => t.type !== 'waitlist')
      .filter(t => !t.draw_date_local || !t.acceptance_deadline_local)
      .map(t => t.name || `Tier ${t.draw_order}`)
    if (missing.length) {
      setSaveError(`Draw date and acceptance deadline are required for: ${missing.join(', ')}`)
      return
    }

    setSaving(true)

    // Wipe and re-insert — simplest correct approach
    const { error: delErr } = await supabase
      .from('tiers')
      .delete()
      .eq('tournament_id', tournamentId)

    if (delErr) {
      setSaving(false)
      setSaveError(delErr.message)
      return
    }

    const rows = tiers.map(t => ({
      tournament_id: tournamentId,
      name: t.name,
      type: t.type,
      allocated_spots: parseInt(t.allocated_spots) || 0,
      min_years: t.type === 'seniority' ? (parseInt(t.min_years) || null) : null,
      draw_date: t.type !== 'waitlist' && t.draw_date_local
        ? localToUtc(t.draw_date_local, tz)
        : null,
      acceptance_deadline: t.type !== 'waitlist' && t.acceptance_deadline_local
        ? localToUtc(t.acceptance_deadline_local, tz)
        : null,
      draw_order: t.draw_order,
      reminder_hours_before_deadline: parseInt(t.reminder_hours_before_deadline) || 48,
    }))

    const { error } = await supabase.from('tiers').insert(rows)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
    } else {
      fetchTiers()
      setSavedMsg('Tiers saved.')
      setTimeout(() => setSavedMsg(''), 3000)
    }
  }

  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">All draw times in {tz}.</p>
        <div className="flex gap-2">
          {tiers.length === 0 && (
            <Button variant="outline" onClick={loadDefaults}>Load defaults</Button>
          )}
          <Button variant="outline" onClick={addTier}>+ Add tier</Button>
        </div>
      </div>

      {!seniorityCheck.valid && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-amber-800 text-sm font-medium">Seniority tier issues</p>
          <ul className="list-disc list-inside text-amber-700 text-sm mt-1 space-y-0.5">
            {seniorityCheck.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {tiers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-gray-500 text-sm mb-3">No tiers configured.</p>
          <Button variant="outline" onClick={loadDefaults}>Load default tiers</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <TierRow
              key={tier._key}
              tier={tier}
              idx={idx}
              total={tiers.length}
              onUpdate={(field, value) => update(idx, field, value)}
              onRemove={() => removeTier(idx)}
              onMoveUp={() => move(idx, -1)}
              onMoveDown={() => move(idx, 1)}
            />
          ))}
        </div>
      )}

      {tiers.length > 0 && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {savedMsg && <p className="text-sm text-green-600">{savedMsg}</p>}
          <Button
            onClick={saveTiers}
            disabled={saving || !seniorityCheck.valid}
          >
            {saving ? 'Saving…' : 'Save Tiers'}
          </Button>
        </div>
      )}
    </div>
  )
}

function TierRow({ tier, idx, total, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const isWaitlist = tier.type === 'waitlist'
  const isSeniority = tier.type === 'seniority'

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm px-4 py-3">
      <div className="flex items-center gap-3">

        {/* Order controls */}
        <div className="flex flex-col shrink-0">
          <button
            onClick={onMoveUp}
            disabled={idx === 0}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-tight"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={idx === total - 1}
            className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-tight"
          >▼</button>
        </div>

        {/* Draw order number */}
        <span className="shrink-0 w-5 text-center text-sm font-semibold text-gray-400">
          {idx + 1}
        </span>

        {/* Type */}
        <select
          value={tier.type}
          onChange={e => onUpdate('type', e.target.value)}
          className="shrink-0 rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          <option value="flight_winners">Flight Winners</option>
          <option value="seniority">Seniority</option>
          <option value="general">General</option>
          <option value="waitlist">Waitlist</option>
        </select>

        {/* Name */}
        <input
          type="text"
          placeholder="Tier name"
          value={tier.name}
          onChange={e => onUpdate('name', e.target.value)}
          className="flex-1 min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
        />

        {/* Spots */}
        <div className="shrink-0 w-20">
          <input
            type="number"
            min="0"
            value={tier.allocated_spots}
            onChange={e => onUpdate('allocated_spots', e.target.value)}
            disabled={isWaitlist}
            placeholder={isWaitlist ? '∞' : 'Spots'}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-500 text-center mt-0.5">{isWaitlist ? 'unlimited' : 'spots'}</p>
        </div>

        {/* Min Years — seniority only */}
        <div className="shrink-0 w-20">
          <input
            type="number"
            min="0"
            value={tier.min_years}
            onChange={e => onUpdate('min_years', e.target.value)}
            disabled={!isSeniority}
            placeholder={isSeniority ? 'Min yrs' : '—'}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-500 text-center mt-0.5">min yrs</p>
        </div>

        {/* Draw Date */}
        <div className="shrink-0 w-40">
          <input
            type="datetime-local"
            value={tier.draw_date_local}
            onChange={e => onUpdate('draw_date_local', e.target.value)}
            disabled={isWaitlist}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-500 mt-0.5">draw date</p>
        </div>

        {/* Acceptance Deadline */}
        <div className="shrink-0 w-40">
          <input
            type="datetime-local"
            value={tier.acceptance_deadline_local}
            onChange={e => onUpdate('acceptance_deadline_local', e.target.value)}
            disabled={isWaitlist}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-500 mt-0.5">acceptance deadline</p>
        </div>

        {/* Reminder hours */}
        <div className="shrink-0 w-20">
          <input
            type="number"
            min="1"
            value={tier.reminder_hours_before_deadline}
            onChange={e => onUpdate('reminder_hours_before_deadline', e.target.value)}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <p className="text-xs text-gray-500 text-center mt-0.5 whitespace-nowrap">reminder hrs</p>
        </div>

        {/* Delete */}
        <button
          onClick={onRemove}
          className="shrink-0 text-gray-300 hover:text-red-500 text-xl leading-none ml-1"
          title="Remove tier"
        >
          ×
        </button>
      </div>
    </div>
  )
}
