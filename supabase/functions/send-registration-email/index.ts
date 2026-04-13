import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const { member_id, tournament_id, guest_name, tier_name } = await req.json()

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "admin@skymga.org"

    const adminClient = createClient(supabaseUrl, serviceKey)

    // Fetch member and tournament in parallel
    const [{ data: member }, { data: tournament }] = await Promise.all([
      adminClient.from("members").select("first_name, last_name, email").eq("id", member_id).single(),
      adminClient.from("tournaments").select("name, year, registration_deadline, timezone").eq("id", tournament_id).single(),
    ])

    if (!member || !tournament) {
      return json({ error: "Member or tournament not found" }, 404)
    }

    const deadline = new Intl.DateTimeFormat("en-US", {
      timeZone: tournament.timezone ?? "America/New_York",
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(tournament.registration_deadline))

    const html = `
      <p>Hi ${member.first_name},</p>
      <p>Your registration for the <strong>${tournament.year} MGA Invitational</strong> has been received.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#555">Guest</td><td><strong>${guest_name}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Draw tier</td><td><strong>${tier_name}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555">Registration deadline</td><td>${deadline}</td></tr>
      </table>
      <p>The lottery draw will run after the registration deadline. If selected, you will receive an email and text message with a link to pay your deposit and confirm your spot.</p>
      <p>— Sky Meadow MGA</p>
    `

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: member.email,
        subject: `${tournament.year} MGA Invitational — Registration Received`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error("Resend error:", err)
      return json({ error: "Email send failed" }, 500)
    }

    return json({ sent: true })

  } catch (err) {
    console.error("Unexpected error:", err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}
