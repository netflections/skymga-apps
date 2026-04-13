import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  try {
    const clientId = Deno.env.get("PAYPAL_CLIENT_ID")!
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")!
    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID")!
    const mode = Deno.env.get("PAYPAL_MODE") ?? "sandbox"
    const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"

    const body = await req.text()
    const event = JSON.parse(body)

    // Verify PayPal webhook signature
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    })
    const { access_token } = await tokenRes.json()

    const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: req.headers.get("PAYPAL-AUTH-ALGO"),
        cert_url: req.headers.get("PAYPAL-CERT-URL"),
        transmission_id: req.headers.get("PAYPAL-TRANSMISSION-ID"),
        transmission_sig: req.headers.get("PAYPAL-TRANSMISSION-SIG"),
        transmission_time: req.headers.get("PAYPAL-TRANSMISSION-TIME"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
    })
    const { verification_status } = await verifyRes.json()
    if (verification_status !== "SUCCESS") {
      return new Response("Signature verification failed", { status: 400 })
    }

    // Only handle payment captures
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return new Response("OK", { status: 200 })
    }

    const registrationId = event.resource?.custom_id
    if (!registrationId) return new Response("OK", { status: 200 })

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    )

    const { data: reg } = await db
      .from("registrations")
      .select("id, deposit_paid, tournament_id")
      .eq("id", registrationId)
      .single()

    if (!reg || reg.deposit_paid) {
      // Already handled — idempotent
      return new Response("OK", { status: 200 })
    }

    // Finalize payment
    const { data: tournament } = await db
      .from("tournaments")
      .select("id, year, last_confirmation_seq")
      .eq("id", reg.tournament_id)
      .single()

    if (!tournament) return new Response("OK", { status: 200 })

    const newSeq = (tournament.last_confirmation_seq ?? 0) + 1
    const confirmationNumber = `MGA-${tournament.year}-${String(newSeq).padStart(4, "0")}`

    await db.from("tournaments").update({ last_confirmation_seq: newSeq }).eq("id", tournament.id)

    const now = new Date().toISOString()
    await db.from("registrations").update({
      deposit_paid: true,
      accepted_at: now,
      confirmed_at: now,
      confirmation_number: confirmationNumber,
      paypal_order_id: event.resource?.id ?? null,
    }).eq("id", reg.id)

    return new Response("OK", { status: 200 })

  } catch (err) {
    console.error("webhook error:", err)
    // Return 200 to prevent PayPal retries on unexpected errors
    return new Response("OK", { status: 200 })
  }
})
