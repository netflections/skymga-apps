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

async function getPayPalToken(clientId: string, clientSecret: string, mode: string): Promise<string> {
  const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
  const data = await res.json()
  return data.access_token
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

    // Validate acceptance token
    const { data: reg } = await db
      .from("registrations")
      .select("id, status, deposit_paid, declined_at, acceptance_deadline, tournament_id")
      .eq("acceptance_token", token)
      .single()

    if (!reg) return json({ error: "invalid_token" }, 404)
    if (reg.deposit_paid) return json({ error: "already_paid" }, 409)
    if (reg.status === "withdrawn") return json({ error: "withdrawn" }, 410)
    if (reg.declined_at) return json({ error: "declined" }, 410)
    if (reg.acceptance_deadline && new Date(reg.acceptance_deadline) < new Date()) {
      return json({ error: "expired" }, 410)
    }

    const { data: tournament } = await db
      .from("tournaments")
      .select("deposit_amount, year")
      .eq("id", reg.tournament_id)
      .single()

    if (!tournament || tournament.deposit_amount <= 0) {
      return json({ error: "No deposit required for this tournament" }, 400)
    }

    const clientId = Deno.env.get("PAYPAL_CLIENT_ID")!
    const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET")!
    const mode = Deno.env.get("PAYPAL_MODE") ?? "sandbox"
    const base = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"

    const accessToken = await getPayPalToken(clientId, clientSecret, mode)

    const order = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: { currency_code: "USD", value: Number(tournament.deposit_amount).toFixed(2) },
          description: `${tournament.year} MGA Invitational Deposit`,
          custom_id: reg.id,
        }],
      }),
    }).then(r => r.json())

    if (!order.id) return json({ error: "PayPal order creation failed", detail: order }, 500)

    // Store the orderID on the registration
    await db.from("registrations").update({ paypal_order_id: order.id }).eq("id", reg.id)

    return json({ orderID: order.id })

  } catch (err) {
    console.error(err)
    return json({ error: err.message }, 500)
  }
})
