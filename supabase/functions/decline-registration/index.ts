import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  })
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { token } = await req.json()
    if (!token) return json({ error: "Missing token" }, 400)

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: reg } = await db
      .from("registrations")
      .select("id, status, deposit_paid, declined_at, acceptance_deadline, member_id, tournament_id")
      .eq("acceptance_token", token)
      .single()

    if (!reg) return json({ error: "invalid_token" }, 404)
    if (reg.deposit_paid) return json({ error: "already_paid" }, 409)
    if (reg.declined_at) return json({ error: "already_declined" }, 409)
    if (reg.status === "withdrawn") return json({ error: "withdrawn" }, 410)
    if (reg.acceptance_deadline && new Date(reg.acceptance_deadline) < new Date()) {
      return json({ error: "expired" }, 410)
    }

    const now = new Date().toISOString()

    // Mark as declined
    await db.from("registrations").update({
      status: "declined",
      declined_at: now,
    }).eq("id", reg.id)

    // Update flight_winner_registrations if applicable
    await db.from("flight_winner_registrations")
      .update({ status: "declined", responded_at: now })
      .eq("tournament_id", reg.tournament_id)
      .eq("member_id", reg.member_id)

    // If this was a waitlist promotion, immediately promote the next member
    const { data: lrEntry } = await db
      .from("lottery_results")
      .select("result")
      .eq("tournament_id", reg.tournament_id)
      .eq("member_id", reg.member_id)
      .eq("result", "waitlisted")
      .maybeSingle()

    if (lrEntry) {
      // This was a promoted waitlist member — promote the next one
      await promoteNextWaitlist(db, reg.tournament_id)
    }

    return json({ declined: true })

  } catch (err) {
    console.error(err)
    return json({ error: err.message }, 500)
  }
})

async function promoteNextWaitlist(db: ReturnType<typeof createClient>, tournamentId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? ""
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "admin@skymga.org"
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? ""
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") ?? ""
  const appUrl = Deno.env.get("INVITATIONAL_URL") ?? "https://invitational.skymga.org"

  const { data: tournament } = await db
    .from("tournaments")
    .select("waitlist_acceptance_hours, deposit_amount, year, timezone")
    .eq("id", tournamentId)
    .single()
  if (!tournament) return

  // Find the next waitlisted member (lowest draw_position with acceptance_token IS NULL)
  const { data: nextWL } = await db
    .from("registrations")
    .select("id, member_id, guest_name")
    .eq("tournament_id", tournamentId)
    .eq("status", "waitlisted")
    .is("acceptance_token", null)
    .order("id") // use lottery_results draw_position ideally, but this approximates

  // Get the proper next member by draw_position
  const { data: nextByPosition } = await db
    .from("lottery_results")
    .select("member_id, draw_position")
    .eq("tournament_id", tournamentId)
    .eq("result", "waitlisted")
    .order("draw_position")

  // Cross-reference to find the lowest draw_position still on waitlisted status
  const { data: waitlistedRegs } = await db
    .from("registrations")
    .select("member_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "waitlisted")
    .is("acceptance_token", null)

  if (!waitlistedRegs || waitlistedRegs.length === 0) return

  const waitlistedIds = new Set(waitlistedRegs.map((r: { member_id: string }) => r.member_id))
  const next = (nextByPosition ?? []).find((r: { member_id: string }) => waitlistedIds.has(r.member_id))
  if (!next) return

  const wlToken = generateToken()
  const wlDeadline = new Date(Date.now() + tournament.waitlist_acceptance_hours * 3600000).toISOString()

  await db.from("registrations").update({
    status: "selected",
    acceptance_token: wlToken,
    acceptance_deadline: wlDeadline,
  }).eq("tournament_id", tournamentId).eq("member_id", next.member_id)

  if (!resendKey) return

  const { data: m } = await db
    .from("members").select("first_name, email, phone").eq("id", next.member_id).single()
  const { data: reg } = await db
    .from("registrations").select("guest_name").eq("tournament_id", tournamentId).eq("member_id", next.member_id).single()

  if (!m) return

  const link = `${appUrl}/accept/${wlToken}`
  const tz = tournament.timezone ?? "America/New_York"
  const deadline = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(wlDeadline))
  const depositStr = tournament.deposit_amount > 0 ? `$${Number(tournament.deposit_amount).toFixed(2)}` : "no deposit required"

  const html = `
    <p>Hi ${m.first_name},</p>
    <p>A spot has opened in the ${tournament.year} MGA Invitational and you're next on the waitlist!</p>
    <p>Guest: <strong>${reg?.guest_name ?? "—"}</strong> | Deposit: <strong>${depositStr}</strong></p>
    <p>You have until <strong>${deadline}</strong> to confirm:</p>
    <p><a href="${link}" style="background:#1E3851;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Confirm My Spot</a></p>
    <p>— Sky Meadow MGA</p>
  `

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: m.email, subject: `${tournament.year} MGA Invitational — A Spot Is Available`, html }),
  }).catch(console.error)

  if (m.phone && twilioSid) {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: twilioFrom, To: m.phone, Body: `MGA Invitational: A spot opened! Confirm by ${deadline}: ${link} Reply STOP to opt out.` }).toString(),
    }).catch(console.error)
  }
}
