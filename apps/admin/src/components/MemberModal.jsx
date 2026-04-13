import { useState } from 'react'
import { supabase } from '@skymga/supabase'
import { Button, Input, Modal } from '@skymga/ui'
import { isValidGhin } from '@skymga/utils'

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return { e164: `+1${digits}`, valid: true }
  if (digits.length === 11 && digits[0] === '1') return { e164: `+${digits}`, valid: true }
  return { e164: null, valid: false }
}

function displayPhone(e164) {
  if (!e164) return ''
  const d = e164.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return e164
}

export default function MemberModal({ member, onClose, onSaved }) {
  const isNew = !member.id
  const [form, setForm] = useState({
    first_name: member.first_name ?? '',
    last_name: member.last_name ?? '',
    email: member.email ?? '',
    phone: displayPhone(member.phone),
    ghin: member.ghin ?? '',
    member_since: member.member_since ?? '',
    is_active: member.is_active ?? true,
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
  }

  function validate() {
    const errs = {}
    if (!form.first_name.trim()) errs.first_name = 'Required'
    if (!form.last_name.trim()) errs.last_name = 'Required'
    if (!form.email.trim()) errs.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email'
    if (!form.phone.trim()) errs.phone = 'Required'
    else if (!normalizePhone(form.phone).valid) errs.phone = 'Enter a valid 10-digit US phone number'
    if (form.ghin && !isValidGhin(form.ghin)) errs.ghin = 'GHIN must be exactly 7 digits'
    if (!form.member_since) errs.member_since = 'Required'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerError('')
    const { e164 } = normalizePhone(form.phone)
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: e164,
      ghin: form.ghin.trim() || null,
      member_since: form.member_since,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }

    let error
    if (isNew) {
      ;({ error } = await supabase.from('members').insert(payload))
    } else {
      ;({ error } = await supabase.from('members').update(payload).eq('id', member.id))
    }

    setSaving(false)
    if (error) {
      if (error.code === '23505') setServerError('A member with this email already exists.')
      else setServerError('Something went wrong. Please try again.')
    } else {
      onSaved()
    }
  }

  return (
    <Modal title={isNew ? 'Add Member' : 'Edit Member'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input
            id="first_name" label="First Name"
            value={form.first_name} onChange={e => set('first_name', e.target.value)}
            error={errors.first_name}
          />
          <Input
            id="last_name" label="Last Name"
            value={form.last_name} onChange={e => set('last_name', e.target.value)}
            error={errors.last_name}
          />
        </div>
        <Input
          id="email" label="Email" type="email"
          value={form.email} onChange={e => set('email', e.target.value)}
          error={errors.email}
        />
        <Input
          id="phone" label="Phone" placeholder="(617) 555-1234"
          value={form.phone} onChange={e => set('phone', e.target.value)}
          error={errors.phone}
        />
        <Input
          id="ghin" label="GHIN (optional)" placeholder="7-digit number"
          value={form.ghin} onChange={e => set('ghin', e.target.value)}
          error={errors.ghin}
        />
        <Input
          id="member_since" label="Member Since" type="date"
          value={form.member_since} onChange={e => set('member_since', e.target.value)}
          error={errors.member_since}
        />
        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)}
              className="rounded border-gray-300 text-sky-600"
            />
            Active member
          </label>
        )}
        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}
