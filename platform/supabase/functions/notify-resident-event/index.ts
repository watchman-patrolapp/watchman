/**
 * Lock-screen pushes for household events: neighbour vouch, area broadcast.
 *
 * Deploy: supabase functions deploy notify-resident-event
 *
 * Client (signed in): supabase.functions.invoke('notify-resident-event', { body: { type, ... } })
 *
 * Secrets: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, PUBLIC_APP_URL (optional)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.2.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeJwtSub(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return String(json.sub || "");
  } catch {
    return "";
  }
}

async function fcmAccessToken(clientEmail: string, privateKeyRaw: string) {
  const pem = privateKeyRaw.replace(/\\n/g, "\n").trim();
  const key = await importPKCS8(pem, "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("55m")
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .sign(key);
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const td = (await tr.json()) as { access_token?: string };
  if (!tr.ok || !td.access_token) throw new Error("oauth_failed");
  return td.access_token;
}

async function sendPush(
  projectId: string,
  accessToken: string,
  tokens: string[],
  title: string,
  bodyText: string,
  path: string,
  tag: string
) {
  const publicUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "").trim();
  const link = publicUrl ? `${publicUrl.replace(/\/$/, "")}${path}` : path;
  const dead: string[] = [];
  let sent = 0;
  for (const token of tokens) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: bodyText },
          data: { url: path, tag },
          android: {
            priority: "HIGH",
            notification: { sound: "default", icon: "ic_notification", color: "#0d9488" },
          },
          webpush: {
            notification: { title, body: bodyText, icon: "/assets/icons/icon-192.webp" },
            fcm_options: { link },
          },
        },
      }),
    });
    if (res.ok) {
      sent += 1;
      continue;
    }
    const errText = await res.text();
    if (/UNREGISTERED|NotRegistered|registration.token/i.test(errText)) dead.push(token);
  }
  return { sent, dead };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const callerId = decodeJwtSub(authHeader.replace(/^Bearer\s+/i, "").trim());
  if (!callerId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!serviceRole) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, serviceRole);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const type = String(body.type || "").toLowerCase();
  let title = "";
  let bodyText = "";
  let path = "/resident";
  let tag = "resident_event";
  let recipientIds: string[] = [];

  if (type === "vouch") {
    const residentId = String(body.residentUserId || "").trim();
    if (!residentId || residentId === callerId) {
      return new Response(JSON.stringify({ error: "Invalid vouch target" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: vouch } = await supabase
      .from("resident_verification_vouchers")
      .select("resident_user_id")
      .eq("resident_user_id", residentId)
      .eq("voucher_user_id", callerId)
      .maybeSingle();
    if (!vouch) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    title = "Someone vouched for you";
    bodyText = "Someone in your neighbourhood confirmed they know you.";
    path = "/profile";
    tag = "vouch";
    recipientIds = [residentId];
  } else if (type === "broadcast") {
    const broadcastId = String(body.broadcastId || "").trim();
    if (!broadcastId) {
      return new Response(JSON.stringify({ error: "Missing broadcast" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: broadcast } = await supabase
      .from("area_broadcasts")
      .select("id, organization_id, author_id, headline, body")
      .eq("id", broadcastId)
      .maybeSingle();
    if (!broadcast || String(broadcast.author_id) !== callerId) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orgId = String(broadcast.organization_id);
    const ids = new Set<string>();
    const { data: orgUsers } = await supabase.from("users").select("id").eq("organization_id", orgId);
    for (const u of orgUsers || []) ids.add(String(u.id));
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("status", "active");
    for (const m of members || []) ids.add(String(m.user_id));
    ids.delete(callerId);
    title = String(broadcast.headline || "").trim() || "Neighbourhood notice";
    bodyText = String(broadcast.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    path = "/resident";
    tag = "broadcast";
    recipientIds = [...ids];
  } else if (type === "membership") {
    const residentId = String(body.residentUserId || "").trim();
    const status = String(body.status || "").toLowerCase();
    const companyName = String(body.companyName || "").trim() || "your security company";
    if (!residentId) {
      return new Response(JSON.stringify({ error: "Invalid membership target" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: actor } = await supabase.from("users").select("id, role").eq("id", callerId).maybeSingle();
    const role = String(actor?.role || "").toLowerCase().replace(/-/g, "_");
    const staff = ["admin", "technical_support", "security_admin"].includes(role);
    if (!staff && callerId !== residentId) {
      const { data: membership } = await supabase
        .from("resident_security_memberships")
        .select("id, security_company_id")
        .eq("resident_user_id", residentId)
        .limit(20);
      const { data: orgs } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", callerId)
        .eq("status", "active");
      const mine = new Set((orgs || []).map((row) => String(row.organization_id)));
      const allowed = (membership || []).some((row) => mine.has(String(row.security_company_id)));
      if (!allowed) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (status === "verified") {
      title = "Security company verified you";
      bodyText = `${companyName} confirmed you as their client.`;
    } else if (status === "rejected") {
      title = "Security membership was not confirmed";
      bodyText = `${companyName} rejected this client claim. You can withdraw or transfer in Profile.`;
    } else {
      title = "Security membership updated";
      bodyText = `${companyName} updated your membership.`;
    }
    path = "/profile";
    tag = "membership";
    recipientIds = [residentId];
  } else {
    return new Response(JSON.stringify({ error: "Unknown type" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: tokenRows } = await supabase
    .from("user_push_tokens")
    .select("token")
    .in("user_id", recipientIds.length ? recipientIds : ["00000000-0000-0000-0000-000000000000"]);
  const tokens = (tokenRows || []).map((row) => String(row.token || "")).filter(Boolean);
  if (!tokens.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const projectId = Deno.env.get("FCM_PROJECT_ID") ?? Deno.env.get("project_id");
  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL") ?? Deno.env.get("client_email");
  const privateKeyRaw = Deno.env.get("FCM_PRIVATE_KEY") ?? Deno.env.get("private_key");
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "fcm_not_configured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await fcmAccessToken(clientEmail, privateKeyRaw);
    const { sent, dead } = await sendPush(projectId, accessToken, tokens, title, bodyText, path, tag);
    if (dead.length) {
      await supabase.from("user_push_tokens").delete().in("token", dead);
    }
    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "fcm_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
