import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@skymga/supabase'
import { Button, Modal } from '@skymga/ui'
import { isValidGhin } from '@skymga/utils'

function normalizePhone(raw) {
  if (!raw) return { e164: null, valid: false }
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return { e164: `+1${digits}`, valid: true }
  if (digits.length === 11 && digits[0] === '1') return { e164: `+${digits}`, valid: true }
  return { e164: null, valid: false }
}

function findCol(headers, candidates) {
  for (const c of candidates) {
    const match = headers.find(h => h.toLowerCase().replace(/[^a-z]/g, '').includes(c))
    if (match) return match
  }
  return null
}

function parseExcelDate(val) {
  if (!val) return null
  const s = String(val).trim()
  // Already a date string like 2010-01-15 or 1/15/2010
  if (s.includes('-') || s.includes('/')) {
    const d = new Date(s)
    if (!isNaN(d)) return d.toISOString().slice(0, 10)
  }
  // Excel serial number
  if (/^\d+$/.test(s)) {
    const d = XLSX.SSF.parse_date_code(parseInt(s))
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  return null
}

export default function ImportModal({ onClose, onImported }) {
  const fileRef = useRef()
  const [rows, setRows] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  function parseFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (!raw.length) return

      const headers = Object.keys(raw[0])
      const firstCol = findCol(headers, ['firstname', 'first'])
      const lastCol = findCol(headers, ['lastname', 'last'])
      const emailCol = findCol(headers, ['email'])
      const phoneCol = findCol(headers, ['phone', 'cell', 'mobile'])
      const ghinCol = findCol(headers, ['ghin'])
      const sinceCol = findCol(headers, ['membersince', 'since', 'joined', 'startdate', 'start'])

      const parsed = raw.map((r, i) => {
        const phone = normalizePhone(phoneCol ? r[phoneCol] : '')
        const ghin = ghinCol ? String(r[ghinCol]).trim().replace(/\D/g, '') : ''
        const memberSince = parseExcelDate(sinceCol ? r[sinceCol] : '')

        const warnings = []
        if (!phone.valid) warnings.push('Invalid phone')
        if (ghin && !isValidGhin(ghin)) warnings.push('Invalid GHIN')
        if (!memberSince) warnings.push('Missing member since')
        if (!firstCol || !String(r[firstCol]).trim()) warnings.push('Missing first name')
        if (!lastCol || !String(r[lastCol]).trim()) warnings.push('Missing last name')
        if (!emailCol || !String(r[emailCol]).trim()) warnings.push('Missing email')

        return {
          _row: i + 2,
          first_name: firstCol ? String(r[firstCol]).trim() : '',
          last_name: lastCol ? String(r[lastCol]).trim() : '',
          email: emailCol ? String(r[emailCol]).trim().toLowerCase() : '',
          phone: phone.e164,
          phone_raw: phoneCol ? String(r[phoneCol]) : '',
          ghin: ghin || null,
          member_since: memberSince,
          is_active: true,
          warnings,
          valid: warnings.length === 0,
        }
      })
      setRows(parsed)
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (!rows) return
    setImporting(true)
    const validRows = rows
      .filter(r => r.valid)
      .map(({ _row, phone_raw, warnings, valid, ...rest }) => ({
        ...rest,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))

    const { error } = await supabase
      .from('members')
      .upsert(validRows, { onConflict: 'email' })

    setImporting(false)
    if (error) {
      setResult({ success: false, message: error.message })
    } else {
      setResult({ success: true, count: validRows.length, skipped: rows.length - validRows.length })
    }
  }

  const validCount = rows?.filter(r => r.valid).length ?? 0
  const warnCount = rows?.filter(r => !r.valid).length ?? 0

  return (
    <Modal title="Import Members from XLSX" onClose={onClose} size="lg">
      {result ? (
        <div className="space-y-4">
          {result.success ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <p className="text-green-800 font-medium">Import complete</p>
              <p className="text-green-700 text-sm mt-1">
                {result.count} member{result.count !== 1 ? 's' : ''} imported.
                {result.skipped > 0 && ` ${result.skipped} row${result.skipped !== 1 ? 's' : ''} skipped due to errors.`}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-red-800 font-medium">Import failed</p>
              <p className="text-red-700 text-sm mt-1">{result.message}</p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={result.success ? onImported : () => setResult(null)}>
              {result.success ? 'Done' : 'Try again'}
            </Button>
          </div>
        </div>
      ) : !rows ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Select an <code className="bg-gray-100 px-1 rounded">.xlsx</code> file to import. Expected columns: First Name, Last Name, Email, Phone, GHIN, Member Since.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={parseFile}
            className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:text-sm file:bg-white file:text-gray-700 hover:file:bg-gray-50 cursor-pointer"
          />
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <span className="text-green-700 font-medium">{validCount} ready to import</span>
            {warnCount > 0 && (
              <span className="text-amber-700 font-medium">{warnCount} will be skipped</span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 text-xs">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Row</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Phone (stored)</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rows.map(r => (
                  <tr key={r._row} className={r.valid ? '' : 'bg-amber-50'}>
                    <td className="px-3 py-2 text-gray-400">{r._row}</td>
                    <td className="px-3 py-2 text-gray-800">{r.first_name} {r.last_name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.email}</td>
                    <td className="px-3 py-2">
                      {r.phone
                        ? <span className="text-gray-600">{r.phone}</span>
                        : <span className="text-amber-600">{r.phone_raw || '—'}</span>
                      }
                    </td>
                    <td className="px-3 py-2">
                      {r.warnings.length > 0
                        ? <span className="text-amber-700">{r.warnings.join(', ')}</span>
                        : <span className="text-green-600">✓</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-1">
            <button
              className="text-sm text-gray-500 hover:text-gray-700"
              onClick={() => { setRows(null); if (fileRef.current) fileRef.current.value = '' }}
            >
              Choose different file
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={importing || validCount === 0}>
                {importing ? 'Importing…' : `Import ${validCount} members`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
