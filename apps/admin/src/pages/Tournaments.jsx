import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@skymga/supabase'
import { Button, Badge } from '@skymga/ui'

const STATUS_COLORS = {
  draft: 'gray',
  open: 'green',
  closed: 'yellow',
  complete: 'blue',
}

export default function Tournaments() {
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('tournaments')
      .select('id, name, year, status')
      .order('year', { ascending: false })
      .then(({ data }) => {
        setTournaments(data ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-sky-700">Tournaments</h2>
        <Button onClick={() => navigate('/tournaments/new')}>+ New Tournament</Button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-12 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Year</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tournaments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-gray-400">
                    No tournaments yet.
                  </td>
                </tr>
              ) : tournaments.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{t.year}</td>
                  <td className="px-4 py-3 text-gray-800">{t.name}</td>
                  <td className="px-4 py-3">
                    <Badge color={STATUS_COLORS[t.status] ?? 'gray'}>
                      {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/tournaments/${t.id}`)}
                      className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
