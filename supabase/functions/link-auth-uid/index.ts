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
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return json({ error: "No authorization header" }, 401)
    }

    const token = authHeader.replace("Bearer ", "")
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    // Verify the JWT and get the authenticated user
    const anonClient = createClient(supabaseUrl, anonKey)
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token)
    if (userError || !user) {
      return json({ error: "Invalid token" }, 401)
    }

    // Use service role to bypass RLS for roster lookup
    const adminClient = createClient(supabaseUrl, serviceKey)

    const { data: member, error: memberError } = await adminClient
      .from("members")
      .select("id, is_active, auth_uid")
      .eq("email", user.email!.toLowerCase())
      .maybeSingle()

    if (memberError) {
      console.error("member lookup error:", memberError)
      return json({ error: "Database error" }, 500)
    }

    if (!member) {
      return json({ found: false })
    }

    // Link auth_uid on first login (idempotent — guard prevents overwriting)
    if (!member.auth_uid) {
      const { error: updateError } = await adminClient
        .from("members")
        .update({ auth_uid: user.id, updated_at: new Date().toISOString() })
        .eq("id", member.id)

      if (updateError) {
        console.error("auth_uid link error:", updateError)
      }
    }

    return json({ found: true, active: member.is_active })

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
