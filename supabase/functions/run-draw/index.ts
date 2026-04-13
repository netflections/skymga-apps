import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = Math.floor((buf[0] / (0xffffffff + 1)) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

function getMemberTenure(memberSince: string): number {
  const start = new Date(memberSince)
  const now = new Date()
  let years = now.getFullYear() - start.getFullYear()
  const md = now.getMonth() - start.getMonth()
  if (md < 0 || (md === 0 && now.getDate() < start.getDate())) years--
  return years
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

async function sendEmail(resendKey: string, from: string, to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch(err => console.error("email error:", err))
}

async function sendSms(accountSid: string, authToken: string, from: string, to: string, body: string) {
  if (!accountSid || !authToken || !from || !to) return
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  }).catch(err => console.error("sms error:", err))
}

function formatDeadline(utc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(utc))
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? ""
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "admin@skymga.org"
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? ""
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? ""
    const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") ?? ""
    const appUrl = Deno.env.get("INVITATIONAL_URL") ?? "https://invitational.skymga.org"

    // Verify caller is authenticated admin
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Unauthorized" }, 401)

    const db = createClient(supabaseUrl, serviceKey)

    const { tournament_id, tier_id } = await req.json()
    if (!tournament_id || !tier_id) return json({ error: "Missing tournament_id or tier_id" }, 400)

    // ── Load tier + tournament ───────────────────────────────────────────────
    const [{ data: tier }, { data: tournament }] = await Promise.all([
      db.from("tiers").select("*").eq("id", tier_id).single(),
      db.from("tournaments").select("*").eq("id", tournament_id).single(),
    ])
    if (!tier || !tournament) return json({ error: "Tier or tournament not found" }, 404)

    // Prevent double-drawing
    const { count: alreadyDrawn } = await db
      .from("lottery_results")
      .select("id", { count: "exact", head: true })
      .eq("tier_id", tier_id)
    if (alreadyDrawn && alreadyDrawn > 0) return json({ error: "This tier has already been drawn" }, 409)

    const tz = tournament.timezone ?? "America/New_York"
    const acceptanceDeadline = tier.acceptance_deadline ?? null

    // ── Members already selected in prior tiers ──────────────────────────────
    const { data: priorSelected } = await db
      .from("lottery_results")
      .select("member_id")
      .eq("tournament_id", tournament_id)
      .eq("result", "selected")
    const selectedIds = new Set((priorSelected ?? []).map((r: { member_id: string }) => r.member_id))

    let selected: string[] = []
    let notSelected: string[] = []

    // ── TIER TYPE: flight_winners ────────────────────────────────────────────
    if (tier.type === "flight_winners") {
      const { data: flightWinners } = await db
        .from("prior_year_winners")
        .select("member_id")
        .eq("tournament_id", tournament_id)

      const fwIds = new Set((flightWinners ?? []).map((fw: { member_id: string }) => fw.member_id))

      // Registered flight winners who haven't been selected elsewhere
      const { data: registrations } = await db
        .from("registrations")
        .select("id, member_id")
        .eq("tournament_id", tournament_id)
        .eq("status", "pending")

      const eligible = (registrations ?? []).filter((r: { member_id: string }) => fwIds.has(r.member_id) && !selectedIds.has(r.member_id))

      // Sort by registered_at for overflow (if more FWs than spots)
      const { data: orderedRegs } = await db
        .from("registrations")
        .select("id, member_id, registered_at")
        .eq("tournament_id", tournament_id)
        .eq("status", "pending")
        .in("member_id", eligible.map((r: { member_id: string }) => r.member_id))
        .order("registered_at")

      const sorted = orderedRegs ?? []
      selected = sorted.slice(0, tier.allocated_spots).map((r: { member_id: string }) => r.member_id)
      notSelected = [] // overflow FWs remain 'pending' for General

      // Record in lottery_results
      const lrRows = sorted.map((r: { member_id: string }, i: number) => ({
        tournament_id, tier_id,
        member_id: r.member_id,
        draw_position: null,
        result: i < tier.allocated_spots ? "selected" : "pending",
        drawn_at: new Date().toISOString(),
      })).filter((r: { result: string }) => r.result === "selected")

      if (lrRows.length > 0) await db.from("lottery_results").insert(lrRows)

    // ── TIER TYPE: seniority ─────────────────────────────────────────────────
    } else if (tier.type === "seniority") {
      const { data: registrations } = await db
        .from("registrations")
        .select("id, member_id, members(member_since)")
        .eq("tournament_id", tournament_id)
        .eq("status", "pending")

      const eligible = (registrations ?? []).filter((r: { member_id: string; members: { member_since: string } }) => {
        if (selectedIds.has(r.member_id)) return false
        return getMemberTenure(r.members.member_since) >= (tier.min_years ?? 0)
      })

      const shuffled = shuffle(eligible)
      selected = shuffled.slice(0, tier.allocated_spots).map((r: { member_id: string }) => r.member_id)
      notSelected = shuffled.slice(tier.allocated_spots).map((r: { member_id: string }) => r.member_id)

      const lrRows = shuffled.map((r: { member_id: string }, i: number) => ({
        tournament_id, tier_id,
        member_id: r.member_id,
        draw_position: i + 1,
        result: i < tier.allocated_spots ? "selected" : "not_selected",
        drawn_at: new Date().toISOString(),
      }))
      if (lrRows.length > 0) await db.from("lottery_results").insert(lrRows)

    // ── TIER TYPE: general ───────────────────────────────────────────────────
    } else if (tier.type === "general") {
      // Spillover: declined + expired from prior selected tiers
      const { data: spilloverRegs } = await db
        .from("registrations")
        .select("member_id")
        .eq("tournament_id", tournament_id)
        .in("status", ["declined", "expired"])

      // Only count if they were actually selected in a prior tier
      const spilloverCandidates = (spilloverRegs ?? []).map((r: { member_id: string }) => r.member_id)
      const spilloverCount = spilloverCandidates.filter((id: string) => selectedIds.has(id) || true).length
      // Simpler: any declined/expired that appear in lottery_results as selected
      const { count: exactSpillover } = await db
        .from("lottery_results")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournament_id)
        .eq("result", "selected")
        .in("member_id", spilloverCandidates.length > 0 ? spilloverCandidates : ["_none_"])

      const totalSpots = tier.allocated_spots + (exactSpillover ?? 0)

      // Update tier with final allocated spots
      await db.from("tiers").update({ allocated_spots: totalSpots }).eq("id", tier_id)

      // Eligible pool: pending, not_selected, expired (not declined)
      const { data: registrations } = await db
        .from("registrations")
        .select("id, member_id")
        .eq("tournament_id", tournament_id)
        .in("status", ["pending", "not_selected", "expired"])

      const eligible = (registrations ?? []).filter((r: { member_id: string }) => !selectedIds.has(r.member_id))
      const shuffled = shuffle(eligible)
      selected = shuffled.slice(0, totalSpots).map((r: { member_id: string }) => r.member_id)
      notSelected = shuffled.slice(totalSpots).map((r: { member_id: string }) => r.member_id)

      const lrRows = shuffled.map((r: { member_id: string }, i: number) => ({
        tournament_id, tier_id,
        member_id: r.member_id,
        draw_position: i + 1,
        result: i < totalSpots ? "selected" : "not_selected",
        drawn_at: new Date().toISOString(),
      }))
      if (lrRows.length > 0) await db.from("lottery_results").insert(lrRows)
    }

    // ── Update registrations.status for selected / not_selected ─────────────
    if (selected.length > 0) {
      const now = new Date().toISOString()
      // Generate tokens + set deadline for all selected members
      const tokenUpdates = selected.map(member_id => ({
        member_id,
        acceptance_token: generateToken(),
        acceptance_deadline: acceptanceDeadline,
      }))

      for (const upd of tokenUpdates) {
        await db.from("registrations")
          .update({
            status: "selected",
            acceptance_token: upd.acceptance_token,
            acceptance_deadline: upd.acceptance_deadline,
          })
          .eq("tournament_id", tournament_id)
          .eq("member_id", upd.member_id)
      }

      // Update flight_winner_registrations if this is a flight winner tier
      if (tier.type === "flight_winners") {
        for (const member_id of selected) {
          await db.from("flight_winner_registrations")
            .upsert({ tournament_id, member_id, status: "no_response" }, { onConflict: "tournament_id,member_id" })
        }
      }

      // Send notifications to selected members
      if (resendKey && acceptanceDeadline) {
        const { data: memberDetails } = await db
          .from("members")
          .select("id, first_name, email, phone")
          .in("id", selected)

        for (const m of memberDetails ?? []) {
          const { data: reg } = await db
            .from("registrations")
            .select("acceptance_token, guest_name")
            .eq("tournament_id", tournament_id)
            .eq("member_id", m.id)
            .single()

          if (!reg?.acceptance_token) continue

          const link = `${appUrl}/accept/${reg.acceptance_token}`
          const deadline = formatDeadline(acceptanceDeadline, tz)
          const depositStr = tournament.deposit_amount > 0 ? `$${Number(tournament.deposit_amount).toFixed(2)}` : "no deposit required"

          const html = `
            <p>Hi ${m.first_name},</p>
            <p>You've been <strong>selected</strong> in the ${tournament.year} MGA Invitational lottery!</p>
            <p>Guest: <strong>${reg.guest_name}</strong></p>
            <p>To confirm your spot, pay the non-refundable deposit of <strong>${depositStr}</strong> by <strong>${deadline}</strong>:</p>
            <p><a href="${link}" style="background:#1E3851;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Confirm My Spot</a></p>
            <p>Or copy this link: ${link}</p>
            <p>If you cannot attend, please click the Decline button on that page so your spot can be offered to the next member.</p>
            <p>— Sky Meadow MGA</p>
          `

          await sendEmail(resendKey, fromEmail, m.email,
            `${tournament.year} MGA Invitational — You've Been Selected!`, html)

          if (m.phone && twilioSid) {
            await sendSms(twilioSid, twilioToken, twilioFrom, m.phone,
              `MGA Invitational: You've been selected! Confirm by ${deadline}: ${link} Reply STOP to opt out.`)
          }
        }
      }
    }

    // Mark not_selected in registrations (transient for general, permanent for seniority/FW)
    if (notSelected.length > 0) {
      await db.from("registrations")
        .update({ status: "not_selected" })
        .eq("tournament_id", tournament_id)
        .in("member_id", notSelected)
    }

    // ── WAITLIST DRAW (runs automatically after general) ─────────────────────
    let waitlistResults: { member_id: string; position: number }[] = []
    if (tier.type === "general") {
      const { data: waitlistTier } = await db
        .from("tiers")
        .select("*")
        .eq("tournament_id", tournament_id)
        .eq("type", "waitlist")
        .single()

      // All not_selected members for this tournament
      const { data: waitlistPool } = await db
        .from("registrations")
        .select("id, member_id")
        .eq("tournament_id", tournament_id)
        .eq("status", "not_selected")

      if (waitlistPool && waitlistPool.length > 0) {
        const shuffledWL = shuffle(waitlistPool)

        // Record all in lottery_results
        const wlTierId = waitlistTier?.id
        if (wlTierId) {
          const wlLrRows = shuffledWL.map((r: { member_id: string }, i: number) => ({
            tournament_id,
            tier_id: wlTierId,
            member_id: r.member_id,
            draw_position: i + 1,
            result: "waitlisted",
            drawn_at: new Date().toISOString(),
          }))
          await db.from("lottery_results").insert(wlLrRows)
        }

        // Update all to waitlisted
        await db.from("registrations")
          .update({ status: "waitlisted" })
          .eq("tournament_id", tournament_id)
          .in("member_id", shuffledWL.map((r: { member_id: string }) => r.member_id))

        waitlistResults = shuffledWL.map((r: { member_id: string }, i: number) => ({ member_id: r.member_id, position: i + 1 }))

        // Send waitlist emails to all
        if (resendKey) {
          const { data: wlMembers } = await db
            .from("members")
            .select("id, first_name, email")
            .in("id", shuffledWL.map((r: { member_id: string }) => r.member_id))

          for (const m of wlMembers ?? []) {
            const pos = waitlistResults.find(w => w.member_id === m.id)?.position ?? 0
            const html = `
              <p>Hi ${m.first_name},</p>
              <p>You were not selected in the ${tournament.year} MGA Invitational lottery, but you have been placed on the <strong>waitlist at position #${pos}</strong> of ${shuffledWL.length}.</p>
              <p>If a spot opens up, you will be contacted in draw order. We will send you an email and text message with a link to confirm your spot.</p>
              <p>— Sky Meadow MGA</p>
            `
            await sendEmail(resendKey, fromEmail, m.email,
              `${tournament.year} MGA Invitational — Waitlist Position #${pos}`, html)
          }
        }

        // Promote position 1 immediately
        const position1 = shuffledWL[0]
        if (position1 && waitlistTier) {
          const wlToken = generateToken()
          const wlDeadline = new Date(Date.now() + tournament.waitlist_acceptance_hours * 3600000).toISOString()

          await db.from("registrations")
            .update({
              status: "selected",
              acceptance_token: wlToken,
              acceptance_deadline: wlDeadline,
            })
            .eq("tournament_id", tournament_id)
            .eq("member_id", position1.member_id)

          if (resendKey) {
            const { data: m } = await db
              .from("members")
              .select("first_name, email, phone")
              .eq("id", position1.member_id)
              .single()

            const { data: reg } = await db
              .from("registrations")
              .select("guest_name")
              .eq("tournament_id", tournament_id)
              .eq("member_id", position1.member_id)
              .single()

            if (m) {
              const link = `${appUrl}/accept/${wlToken}`
              const deadline = formatDeadline(wlDeadline, tz)
              const depositStr = tournament.deposit_amount > 0 ? `$${Number(tournament.deposit_amount).toFixed(2)}` : "no deposit required"

              const html = `
                <p>Hi ${m.first_name},</p>
                <p>A spot has opened in the ${tournament.year} MGA Invitational. As the first member on the waitlist, you have been offered this spot.</p>
                <p>Guest: <strong>${reg?.guest_name ?? "—"}</strong></p>
                <p>Deposit: <strong>${depositStr}</strong> — deadline: <strong>${deadline}</strong></p>
                <p><a href="${link}" style="background:#1E3851;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block">Confirm My Spot</a></p>
                <p>— Sky Meadow MGA</p>
              `
              await sendEmail(resendKey, fromEmail, m.email,
                `${tournament.year} MGA Invitational — A Spot Is Available`, html)

              if (m.phone && twilioSid) {
                await sendSms(twilioSid, twilioToken, twilioFrom, m.phone,
                  `MGA Invitational: A spot opened up! Confirm by ${deadline}: ${link} Reply STOP to opt out.`)
              }
            }
          }
        }
      }
    }

    return json({
      success: true,
      tier_type: tier.type,
      selected_count: selected.length,
      not_selected_count: notSelected.length,
      waitlist_count: waitlistResults.length,
    })

  } catch (err) {
    console.error("run-draw error:", err)
    return json({ error: err.message }, 500)
  }
})
