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

async function getPayPalToken(clientId: string, secret: string, mode: string) {
  const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
  return (await r.json()).access_token
}

async function finalizePayment(db: ReturnType<typeof createClient>, regId: string) {
  // Atomically increment confirmation sequence and generate number
  const { data: reg } = await db
    .from("registrations")
    .select("tournament_id")
    .eq("id", regId)
    .single()
  if (!reg) return null

  const { data: tournament } = await db
    .from("tournaments")
    .select("id, year, last_confirmation_seq, confirmation_cc_email, deposit_amount, timezone")
    .eq("id", reg.tournament_id)
    .single()
  if (!tournament) return null

  const newSeq = (tournament.last_confirmation_seq ?? 0) + 1
  const confirmationNumber = `MGA-${tournament.year}-${String(newSeq).padStart(4, "0")}`

  await db.from("tournaments")
    .update({ last_confirmation_seq: newSeq })
    .eq("id", tournament.id)

  const now = new Date().toISOString()
  await db.from("registrations").update({
    deposit_paid: true,
    accepted_at: now,
    confirmed_at: now,
    confirmation_number: confirmationNumber,
  }).eq("id", regId)

  return { confirmationNumber, tournament }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  try {
    const { token, orderID } = await req.json()
    if (!token || !orderID) return json({ error: "Missing token or orderID" }, 400)

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: reg } = await db
      .from("registrations")
      .select("id, status, deposit_paid, declined_at, acceptance_deadline, paypal_order_id")
      .eq("acceptance_token", token)
      .single()

    if (!reg) return json({ error: "invalid_token" }, 404)
    if (reg.deposit_paid) {
      // Already captured — return existing confirmation number
      const { data: existing } = await db.from("registrations").select("confirmation_number").eq("id", reg.id).single()
      return json({ confirmationNumber: existing?.confirmation_number })
    }
    if (reg.status === "withdrawn") return json({ error: "withdrawn" }, 410)
    if (reg.declined_at) return json({ error: "declined" }, 410)
    if (reg.acceptance_deadline && new Date(reg.acceptance_deadline) < new Date()) {
      return json({ error: "expired" }, 410)
    }
    if (reg.paypal_order_id !== orderID) return json({ error: "Order ID mismatch" }, 400)

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID")!
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")!
    const mode = Deno.env.get("PAYPAL_MODE") ?? "sandbox"
    const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"

    const accessToken = await getPayPalToken(clientId, clientSecret, mode)
    const capture = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    }).then(r => r.json())

    if (capture.status !== "COMPLETED") {
      return json({ error: "Capture not completed", status: capture.status }, 400)
    }

    const result = await finalizePayment(db, reg.id)
    if (!result) return json({ error: "Finalization failed" }, 500)

    // Send confirmation email (best-effort)
    const resendKey = Deno.env.get("RESEND_API_KEY")
    if (resendKey) {
      const { data: fullReg } = await db
        .from("registrations")
        .select("member_id, guest_name")
        .eq("id", reg.id)
        .single()
      const { data: member } = await db
        .from("members")
        .select("first_name, last_name, email")
        .eq("id", fullReg?.member_id)
        .single()

      if (member) {
        const { tournament } = result
        const ccEmail = tournament.confirmation_cc_email
        const tz = tournament.timezone ?? "America/New_York"
        const html = `
          <p>Hi ${member.first_name},</p>
          <p>Your spot in the <strong>${tournament.year} MGA Invitational</strong> is confirmed!</p>
          <h2 style="font-size:28px;color:#1E3851;margin:16px 0">Confirmation: <strong>${result.confirmationNumber}</strong></h2>
          <p>Guest: <strong>${fullReg?.guest_name}</strong></p>
          <p>Deposit paid: <strong>$${Number(tournament.deposit_amount).toFixed(2)}</strong></p>
          <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
          <p><strong>Next step:</strong> Print this email or save your confirmation number and present it to the Pro Shop to finalize your registration.</p>
          <p>— Sky Meadow MGA</p>
        `
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "admin@skymga.org"
        const payload: Record<string, unknown> = {
          from: fromEmail,
          to: member.email,
          subject: `Your MGA Invitational Registration is Confirmed — ${result.confirmationNumber}`,
          html,
        }
        if (ccEmail) payload.cc = ccEmail

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(err => console.error("confirmation email error:", err))
      }
    }

    return json({ confirmationNumber: result.confirmationNumber })

  } catch (err) {
    console.error(err)
    return json({ error: err.message }, 500)
  }
})
