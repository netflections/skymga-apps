import { useState } from 'react'
import { Button, Input } from '@skymga/ui'
import { utcToLocal, localToUtc } from '../lib/datetime'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

function DatetimeInput({ label, value, onChange, error, hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 ${error ? 'border-red-500' : 'border-gray-300'}`}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function NumberInput({ label, value, onChange, error, min = 1, hint }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 ${error ? 'border-red-500' : 'border-gray-300'}`}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

export default function TournamentForm({ tournament, onSave, isNew }) {
  const tz = tournament?.timezone ?? 'America/New_York'

  const [form, setForm] = useState({
    name: tournament?.name ?? '',
    year: tournament?.year ?? new Date().getFullYear(),
    description: tournament?.description ?? '',
    deposit_amount: tournament?.deposit_amount ?? 0,
    timezone: tz,
    confirmation_cc_email: tournament?.confirmation_cc_email ?? '',
    registration_opens_at: utcToLocal(tournament?.registration_opens_at, tz),
    registration_deadline: utcToLocal(tournament?.registration_deadline, tz),
    seniority_acceptance_days: tournament?.seniority_acceptance_days ?? 7,
    general_acceptance_days: tournament?.general_acceptance_days ?? 7,
    waitlist_acceptance_hours: tournament?.waitlist_acceptance_hours ?? 24,
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: '' }))
    setSavedMessage('')
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (!form.year || parseInt(form.year) < 2020) errs.year = 'Enter a valid year'
    if (!form.registration_opens_at) errs.registration_opens_at = 'Required'
    if (!form.registration_deadline) errs.registration_deadline = 'Required'
    if (form.registration_opens_at && form.registration_deadline &&
        form.registration_opens_at >= form.registration_deadline)
      errs.registration_deadline = 'Must be after registration opens'
    if (parseFloat(form.deposit_amount) < 0) errs.deposit_amount = 'Cannot be negative'
    if (!form.seniority_acceptance_days || parseInt(form.seniority_acceptance_days) < 1)
      errs.seniority_acceptance_days = 'Must be at least 1'
    if (!form.general_acceptance_days || parseInt(form.general_acceptance_days) < 1)
      errs.general_acceptance_days = 'Must be at least 1'
    if (!form.waitlist_acceptance_hours || parseInt(form.waitlist_acceptance_hours) < 1)
      errs.waitlist_acceptance_hours = 'Must be at least 1'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    setServerError('')
    const currentTz = form.timezone

    const payload = {
      name: form.name.trim(),
      year: parseInt(form.year),
      description: form.description.trim() || null,
      deposit_amount: parseFloat(form.deposit_amount) || 0,
      timezone: currentTz,
      confirmation_cc_email: form.confirmation_cc_email.trim() || null,
      registration_opens_at: localToUtc(form.registration_opens_at, currentTz),
      registration_deadline: localToUtc(form.registration_deadline, currentTz),
      seniority_acceptance_days: parseInt(form.seniority_acceptance_days),
      general_acceptance_days: parseInt(form.general_acceptance_days),
      waitlist_acceptance_hours: parseInt(form.waitlist_acceptance_hours),
    }

    const { error } = await onSave(payload)
    setSaving(false)
    if (error) {
      if (error.code === '23505') setServerError('A tournament for this year already exists.')
      else setServerError('Something went wrong. Please try again.')
    } else if (!isNew) {
      setSavedMessage('Settings saved.')
      setTimeout(() => setSavedMessage(''), 3000)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">

      {/* Basic Info */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="font-semibold text-gray-800">Basic Info</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <Input
              id="name" label="Tournament Name"
              value={form.name} onChange={e => set('name', e.target.value)}
              error={errors.name}
            />
          </div>
          <Input
            id="year" label="Year" type="number" min="2020"
            value={form.year} onChange={e => set('year', e.target.value)}
            error={errors.year}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={2}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Amount (USD)</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-sm text-gray-400">$</span>
              <input
                type="number" min="0" step="0.01"
                value={form.deposit_amount}
                onChange={e => set('deposit_amount', e.target.value)}
                className={`block w-full rounded-md border pl-7 pr-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 ${errors.deposit_amount ? 'border-red-500' : 'border-gray-300'}`}
              />
            </div>
            {errors.deposit_amount && <p className="mt-1 text-sm text-red-600">{errors.deposit_amount}</p>}
          </div>
          <Input
            id="cc" label="Confirmation CC Email (optional)" type="email"
            value={form.confirmation_cc_email}
            onChange={e => set('confirmation_cc_email', e.target.value)}
            error={errors.confirmation_cc_email}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
          <select
            value={form.timezone}
            onChange={e => set('timezone', e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </section>

      {/* Registration Window */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-gray-800">Registration Window</h3>
          <p className="text-xs text-gray-400 mt-0.5">All times in {form.timezone}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <DatetimeInput
            label="Registration Opens"
            value={form.registration_opens_at}
            onChange={v => set('registration_opens_at', v)}
            error={errors.registration_opens_at}
          />
          <DatetimeInput
            label="Registration Deadline"
            value={form.registration_deadline}
            onChange={v => set('registration_deadline', v)}
            error={errors.registration_deadline}
          />
        </div>
      </section>

      {/* Acceptance Windows */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h3 className="font-semibold text-gray-800">Acceptance Windows</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            How long selected members have to confirm and pay. Reminder email/SMS timing
            (e.g. 48 hours before deadline) is configured per tier in the Tiers tab.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <NumberInput
            label="Seniority (days)"
            value={form.seniority_acceptance_days}
            onChange={v => set('seniority_acceptance_days', v)}
            error={errors.seniority_acceptance_days}
          />
          <NumberInput
            label="General (days)"
            value={form.general_acceptance_days}
            onChange={v => set('general_acceptance_days', v)}
            error={errors.general_acceptance_days}
          />
          <NumberInput
            label="Waitlist (hours)"
            value={form.waitlist_acceptance_hours}
            onChange={v => set('waitlist_acceptance_hours', v)}
            error={errors.waitlist_acceptance_hours}
          />
        </div>
      </section>

      {serverError && <p className="text-sm text-red-600">{serverError}</p>}

      <div className="flex items-center justify-end gap-3">
        {savedMessage && <p className="text-sm text-green-600">{savedMessage}</p>}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create Tournament' : 'Save Settings'}
        </Button>
      </div>
    </form>
  )
}
