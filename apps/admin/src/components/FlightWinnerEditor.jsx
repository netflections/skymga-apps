import { useEffect, useState } from 'react'
import { supabase } from '@skymga/supabase'
import { Badge, Button } from '@skymga/ui'

const STATUS_COLORS = {
  accepted: 'green',
  declined: 'red',
  no_response: 'gray',
}

const STATUS_LABELS = {
  accepted: 'Accepted',
  declined: 'Declined',
  no_response: 'No Response',
}

export default function FlightWinnerEditor({ tournamentId }) {
  const [entries, setEntries] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null) // member_id being saved
  const [addOpen, setAddOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState('')
  const [addError, setAddError] = useState('')

  async function load() {
    const [fwRes, memberRes] = await Promise.all([
      supabase
        .from('flight_winner_registrations')
        .select('*, members(first_name, last_name, email)')
        .eq('tournament_id', tournamentId),
      supabase
        .from('members')
        .select('id, first_name, last_name, email')
        .eq('is_active', true)
        .order('last_name'),
    ])
    setEntries(fwRes.data ?? [])
    setMembers(memberRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [tournamentId])

  async function updateStatus(memberId, status) {
    setSaving(memberId)
    await supabase
      .from('flight_winner_registrations')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('tournament_id', tournamentId)
      .eq('member_id', memberId)
    setSaving(null)
    load()
  }

  async function remove(memberId) {
    await supabase
      .from('flight_winner_registrations')
      .delete()
      .eq('tournament_id', tournamentId)
      .eq('member_id', memberId)
    load()
  }

  async function addEntry() {
    if (!selectedMember) return
    setAddError('')
    const { error } = await supabase
      .from('flight_winner_registrations')
      .insert({ tournament_id: tournamentId, member_id: selectedMember, status: 'no_response' })
    if (error) {
      if (error.code === '23505') setAddError('This member is already in the flight winner list.')
      else setAddError(error.message)
      return
    }
    setAddOpen(false)
    setSelectedMember('')
    load()
  }

  // Members not yet in the list
  const existingIds = new Set(entries.map(e => e.member_id))
  const availableMembers = members.filter(m => !existingIds.has(m.id))

  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Flight Winners</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Members who qualified as flight winners this year. They receive an exclusive early registration window.
          </p>
        </div>
        <Button onClick={() => { setAddOpen(true); setAddError('') }}>
          + Add Flight Winner
        </Button>
      </div>

      {/* Add entry panel */}
      {addOpen && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 space-y-3">
          <p className="text-sm font-medium text-sky-800">Add Flight Winner</p>
          <div className="flex gap-2">
            <select
              value={selectedMember}
              onChange={e => setSelectedMember(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Select a member…</option>
              {availableMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.last_name}, {m.first_name} ({m.email})
                </option>
              ))}
            </select>
            <Button onClick={addEntry} disabled={!selectedMember}>Add</Button>
            <Button variant="outline" onClick={() => { setAddOpen(false); setAddError('') }}>Cancel</Button>
          </div>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-gray-500 text-sm">No flight winners added yet.</p>
          <p className="text-gray-400 text-xs mt-1">Click "Add Flight Winner" to add members who qualified this year.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Member</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500">Responded</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map(entry => {
                const member = entry.members
                return (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">
                      {member ? `${member.last_name}, ${member.first_name}` : entry.member_id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{member?.email ?? '—'}</td>
                    <td className="px-5 py-3">
                      <Badge color={STATUS_COLORS[entry.status] ?? 'gray'}>
                        {STATUS_LABELS[entry.status] ?? entry.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {entry.responded_at
                        ? new Date(entry.responded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'
                      }
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {entry.status !== 'accepted' && (
                          <button
                            onClick={() => updateStatus(entry.member_id, 'accepted')}
                            disabled={saving === entry.member_id}
                            className="text-xs text-green-600 hover:text-green-800 disabled:opacity-40"
                          >
                            Mark Accepted
                          </button>
                        )}
                        {entry.status !== 'declined' && (
                          <button
                            onClick={() => updateStatus(entry.member_id, 'declined')}
                            disabled={saving === entry.member_id}
                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                          >
                            Mark Declined
                          </button>
                        )}
                        {entry.status === 'no_response' && (
                          <button
                            onClick={() => remove(entry.member_id)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        {entries.filter(e => e.status === 'accepted').length} of {entries.length} flight winners have accepted.
      </p>
    </div>
  )
}
