// Vercel cron job — runs daily at 10:00 AM UTC
// Expires overdue acceptance windows and promotes the next waitlist member.

import { createClient } from "@supabase/supabase-js"

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "admin@skymga.org"

async function sendExpiryEmail({ toEmail, firstName, tournamentYear, tournamentName }) {
  if (!RESEND_API_KEY) return
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: `Your ${tournamentYear} MGA Invitational spot has expired`,
      html: `
        <p>Hi ${firstName},</p>
        <p>Your acceptance window for the <strong>${tournamentYear} ${tournamentName}</strong> has passed
        and your spot has been released to the next member on the waitlist.</p>
        <p>If you believe this is an error or have questions, please contact
        <a href="mailto:admin@skymga.org">admin@skymga.org</a>.</p>
        <p>— Sky Meadow MGA</p>
      `,
    }),
  }).catch(console.error)
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date().toISOString()

  // Find all overdue selected registrations (unpaid, not declined, past deadline)
  const { data: overdue } = await db
    .from("registrations")
    .select(`
      id, member_id, tournament_id,
      members(first_name, email),
      tournaments(year, name)
    `)
    .eq("status", "selected")
    .eq("deposit_paid", false)
    .is("declined_at", null)
    .lt("acceptance_deadline", now)

  if (!overdue || overdue.length === 0) {
    return res.status(200).json({ expired: 0, promoted: 0 })
  }

  // Mark all as expired
  const overdueIds = overdue.map(r => r.id)
  await db.from("registrations").update({ status: "expired" }).in("id", overdueIds)

  // Send expiry notification emails
  const emailPromises = overdue.map(reg =>
    sendExpiryEmail({
      toEmail: reg.members?.email,
      firstName: reg.members?.first_name ?? "Member",
      tournamentYear: reg.tournaments?.year,
      tournamentName: reg.tournaments?.name ?? "MGA Invitational",
    })
  )
  await Promise.allSettled(emailPromises)

  // For each expired registration that was a waitlist promotion, promote the next member
  const waitlistExpired = []
  for (const reg of overdue) {
    const { data: lrEntry } = await db
      .from("lottery_results")
      .select("result")
      .eq("tournament_id", reg.tournament_id)
      .eq("member_id", reg.member_id)
      .eq("result", "waitlisted")
      .maybeSingle()
    if (lrEntry) waitlistExpired.push(reg)
  }

  // Group by tournament and promote once per tournament (avoid double-promoting)
  const tournamentsToPromote = [...new Set(waitlistExpired.map(r => r.tournament_id))]
  let promoted = 0

  for (const tournamentId of tournamentsToPromote) {
    await fetch(`${SUPABASE_URL}/functions/v1/decline-registration`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "x-promote-only": "true",
      },
      body: JSON.stringify({ tournament_id: tournamentId, promote_only: true }),
    }).catch(console.error)
    promoted++
  }

  return res.status(200).json({ expired: overdueIds.length, promoted })
}
