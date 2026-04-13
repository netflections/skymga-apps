import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@skymga/supabase'
import { Button, Badge } from '@skymga/ui'
import { getMemberTenure } from '@skymga/utils'
import MemberModal from '../components/MemberModal'
import ImportModal from '../components/ImportModal'

function formatPhone(e164) {
  if (!e164) return '—'
  const d = e164.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return e164
}

export default function Members() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editMember, setEditMember] = useState(null) // null = closed, {} = new, {...data} = edit
  const [showImport, setShowImport] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  async function fetchMembers() {
    const { data } = await supabase
      .from('members')
      .select('*')
      .order('last_name')
      .order('first_name')
    setMembers(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchMembers() }, [])

  const filtered = members.filter(m => {
    if (!showInactive && !m.is_active) return false
    const q = search.toLowerCase()
    return (
      m.first_name.toLowerCase().includes(q) ||
      m.last_name.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    )
  })

  function exportXLSX() {
    const rows = members.map(m => ({
      'First Name': m.first_name,
      'Last Name': m.last_name,
      'Email': m.email,
      'Phone': formatPhone(m.phone),
      'GHIN': m.ghin ?? '',
      'Member Since': m.member_since,
      'Tenure (yrs)': getMemberTenure(m.member_since),
      'Active': m.is_active ? 'Yes' : 'No',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Members')
    XLSX.writeFile(wb, `MGA_Members_${new Date().getFullYear()}.xlsx`)
  }

  async function toggleActive(member) {
    await supabase
      .from('members')
      .update({ is_active: !member.is_active, updated_at: new Date().toISOString() })
      .eq('id', member.id)
    fetchMembers()
  }

  const activeCount = members.filter(m => m.is_active).length

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-sky-700">Member Roster</h2>
          <p className="text-sm text-gray-500 mt-0.5">{activeCount} active member{activeCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>Import XLSX</Button>
          <Button variant="outline" onClick={exportXLSX}>Export XLSX</Button>
          <Button onClick={() => setEditMember({})}>+ Add Member</Button>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded border-gray-300 text-sky-600"
          />
          Show inactive
        </label>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-12 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">GHIN</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Member Since</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Tenure</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    {members.length === 0 ? 'No members yet. Import an XLSX or add manually.' : 'No members match your search.'}
                  </td>
                </tr>
              ) : filtered.map(m => (
                <tr key={m.id} className={`hover:bg-gray-50 ${!m.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {m.last_name}, {m.first_name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatPhone(m.phone)}</td>
                  <td className="px-4 py-3 text-gray-600">{m.ghin ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.member_since}</td>
                  <td className="px-4 py-3 text-gray-600">{getMemberTenure(m.member_since)} yrs</td>
                  <td className="px-4 py-3">
                    <Badge color={m.is_active ? 'green' : 'gray'}>
                      {m.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditMember(m)}
                      className="text-sky-600 hover:text-sky-800 text-sm font-medium mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(m)}
                      className="text-gray-400 hover:text-gray-600 text-sm font-medium"
                    >
                      {m.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editMember !== null && (
        <MemberModal
          member={editMember}
          onClose={() => setEditMember(null)}
          onSaved={() => { setEditMember(null); fetchMembers() }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchMembers() }}
        />
      )}
    </div>
  )
}
