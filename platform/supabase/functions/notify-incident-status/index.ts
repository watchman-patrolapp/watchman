/**
 * Incident status change webhook -> resident push notification + timeline event.
 *
 * Deploy:
 *   supabase functions deploy notify-incident-status --no-verify-jwt
 *
 * Required secrets:
 *   INCIDENT_STATUS_WEBHOOK_SECRET
 *   FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY
 * Optional:
 *   PUBLIC_APP_URL
 *
 * Database webhook:
 *   Table: incidents
 *   Events: UPDATE
 *   URL: https://<ref>.supabase.co/functions/v1/notify-incident-status
 *   Header: x-incident-status-secret: <INCIDENT_STATUS_WEBHOOK_SECRET>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.2.3";

function toLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  if (s === "pending") return "Pending";
  return s ? s[0].toUpperCase() + s.slice(1) : "Updated";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("INCIDENT_STATUS_WEBHOOK_SECRET");
  const provided = req.headers.get("x-incident-status-secret")?.trim();
  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!serviceRole) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, serviceRole);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = (body.record ?? {}) as Record<string, unknown>;
  const oldRecord = (body.old_record ?? {}) as Record<string, unknown>;

  const incidentId = String(record.id ?? "");
  const reporterId = String(record.reporter_id ?? "");
  const newStatus = String(record.status ?? "").toLowerCase();
  const oldStatus = String(oldRecord.status ?? "").toLowerCase();

  if (!incidentId || !reporterId || !newStatus || newStatus === oldStatus) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const statusLabel = toLabel(newStatus);
  const eventTitle = `Report status updated: ${statusLabel}`;

  // Best effort timeline event insertion.
  await supabase.from("resident_report_events").insert({
    incident_id: incidentId,
    reporter_id: reporterId,
    event_type: newStatus === "approved" || newStatus === "rejected" ? "resolved" : "status_changed",
    title: eventTitle,
    details: `Your report is now marked as ${statusLabel}.`,
    actor_user_id: record.approved_by ?? record.rejected_by ?? null,
  });

  const { data: tokenRows, error: tokenErr } = await supabase
    .from("user_push_tokens")
    .select("token")
    .eq("user_id", reporterId);
  if (tokenErr) {
    console.error("user_push_tokens:", tokenErr.message);
    return new Response(JSON.stringify({ ok: false, error: tokenErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tokens = (tokenRows || []).map((row) => String(row.token || "")).filter(Boolean);
  if (!tokens.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const projectId = Deno.env.get("FCM_PROJECT_ID") ?? Deno.env.get("project_id");
  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL") ?? Deno.env.get("client_email");
  const privateKeyRaw = Deno.env.get("FCM_PRIVATE_KEY") ?? Deno.env.get("private_key");
  if (!projectId || !clientEmail || !privateKeyRaw) {
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: "fcm_not_configured" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pem = privateKeyRaw.replace(/\\n/g, "\n").trim();
  let accessToken = "";
  try {
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

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error("oauth_failed");
    }
    accessToken = tokenJson.access_token;
  } catch (e) {
    console.error("FCM auth failed:", e);
    return new Response(JSON.stringify({ ok: false, error: "fcm_auth_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const publicUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "").trim();
  const link = publicUrl ? `${publicUrl.replace(/\/$/, "")}/resident/activity` : "/resident/activity";
  const title = "Watchman report update";
  const bodyText = `Your report is now ${statusLabel}.`;

  let sent = 0;
  const deadTokens: string[] = [];
  for (const token of tokens) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: bodyText },
          data: {
            url: "/resident/activity",
            incidentId,
            status: newStatus,
          },
          webpush: {
            notification: {
              title,
              body: bodyText,
              icon: "/assets/icons/icon-192.webp",
            },
            fcm_options: { link },
          },
          android: {
            priority: "HIGH",
            notification: {
              sound: "default",
              icon: "ic_notification",
              color: "#FFA532",
            },
          },
        },
      }),
    });

    if (response.ok) {
      sent += 1;
      continue;
    }
    const errText = await response.text();
    if (/UNREGISTERED|NotRegistered|registration.token/i.test(errText)) {
      deadTokens.push(token);
    }
  }

  if (deadTokens.length) {
    await supabase.from("user_push_tokens").delete().in("token", deadTokens);
  }

  return new Response(JSON.stringify({ ok: true, sent, attempted: tokens.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
