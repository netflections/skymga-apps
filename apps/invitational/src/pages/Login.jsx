import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { sendMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await sendMagicLink(email.trim().toLowerCase())
    setLoading(false)
    if (error) {
      setError('Something went wrong. Please check your email address and try again.')
    } else {
      setSent(true)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-sky-700">MGA Invitational</h1>
          <p className="text-gray-500 text-sm mt-2">
            Sign in with your MGA email address to register.
          </p>
        </div>

        {sent ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-6 text-center">
            <p className="text-sky-800 font-medium mb-1">Check your email</p>
            <p className="text-sky-700 text-sm">
              We sent a sign-in link to <strong>{email}</strong>.
              Click the link in that email to continue.
            </p>
            <button
              className="mt-4 text-sm text-sky-600 hover:text-sky-800"
              onClick={() => { setSent(false); setEmail('') }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-sky-700 text-white py-2 text-sm font-medium hover:bg-sky-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
