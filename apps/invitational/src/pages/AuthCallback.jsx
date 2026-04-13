import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@skymga/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    async function handleCallback() {
      // Exchange the code for a session (Supabase PKCE flow)
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !session) {
        setError('Sign-in link is invalid or has expired. Please request a new one.')
        return
      }

      // Call link-auth-uid edge function to bind this auth session to the member row
      try {
        const res = await supabase.functions.invoke('link-auth-uid')
        const body = res.data

        if (!body?.found) {
          // Email not in member roster
          navigate('/?error=not_member', { replace: true })
          return
        }

        if (!body?.active) {
          // Member is inactive
          navigate('/?error=inactive', { replace: true })
          return
        }
      } catch {
        // If the edge function fails, still let them through — Register page will re-check
      }

      navigate('/register', { replace: true })
    }

    handleCallback()
  }, [])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-red-700 font-medium mb-2">Sign-in failed</p>
        <p className="text-gray-500 text-sm mb-4">{error}</p>
        <a href="/" className="text-sky-600 hover:text-sky-800 text-sm">← Back to sign in</a>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <p className="text-gray-400 text-sm">Signing you in…</p>
    </div>
  )
}
