// Vercel cron job — runs daily at 10:00 AM UTC
// Sends reminder emails/SMS to selected members approaching their acceptance deadline.

import { createClient } from "@supabase/supabase-js"

const CRON_SECRET = process.env.CRON_SECRET
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "admin@skymga.org"
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER
const INVITATIONAL_URL = process.env.INVITATIONAL_URL ?? "https://invitational.skymga.org"

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()

  // Find all selected, unpaid, undeclined registrations where reminder hasn't been sent
  // and acceptance_deadline is within reminder_hours_before_deadline hours
  const { data: candidates } = await db
    .from("registrations")
    .select(`
      id, acceptance_token, acceptance_deadline, member_id, tournament_id, guest_name,
      tiers!inner(reminder_hours_before_deadline),
      members!inner(first_name, email, phone),
      tournaments!inner(year, deposit_amount, timezone)
    `)
    .eq("status", "selected")
    .eq("deposit_paid", false)
    .is("declined_at", null)
    .is("reminder_sent_at", null)

  let sent = 0

  for (const reg of candidates ?? []) {
    if (!reg.acceptance_deadline) continue
    const deadline = new Date(reg.acceptance_deadline)
    const reminderWindowMs = (reg.tiers?.reminder_hours_before_deadline ?? 48) * 3600000
    const hoursUntilDeadline = (deadline - now) / 3600000

    if (hoursUntilDeadline > (reg.tiers?.reminder_hours_before_deadline ?? 48)) continue
    if (hoursUntilDeadline < 0) continue // expired — handled by expire cron

    const link = `${INVITATIONAL_URL}/accept/${reg.acceptance_token}`
    const tz = reg.tournaments?.timezone ?? "America/New_York"
    const deadlineStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(deadline)
    const depositStr = reg.tournaments?.deposit_amount > 0
      ? `$${Number(reg.tournaments.deposit_amount).toFixed(2)}`
      : "no deposit required"

    const html = `
      <p>Hi ${reg.members.first_name},</p>
      <p>This is a reminder that your spot in the ${reg.tournaments.year} MGA Invitational expires on <strong>${deadlineStr}</strong>.</p>
      <p>Deposit: <strong>${depositStr}</strong></p>
      <p><a href="${link}" style="background:#1E3851;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Confirm My Spot</a></p>
      <p>If you cannot attend, please decline so your spot can be offered to the next member.</p>
      <p>— Sky Meadow MGA</p>
    `

    if (RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: reg.members.email,
          subject: `Reminder: Confirm Your MGA Invitational Spot by ${deadlineStr}`,
          html,
        }),
      }).catch(console.error)
    }

    if (reg.members.phone && TWILIO_ACCOUNT_SID) {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: TWILIO_FROM_NUMBER,
          To: reg.members.phone,
          Body: `MGA Invitational reminder: confirm your spot by ${deadlineStr}: ${link} Reply STOP to opt out.`,
        }).toString(),
      }).catch(console.error)
    }

    await db.from("registrations").update({ reminder_sent_at: now.toISOString() }).eq("id", reg.id)
    sent++
  }

  return res.status(200).json({ reminders_sent: sent })
}
