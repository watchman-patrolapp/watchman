/**
 * Emergency chat → FCM push for all registered devices except the sender.
 *
 * Deploy: supabase functions deploy notify-chat-message --no-verify-jwt
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   CHAT_NOTIFY_WEBHOOK_SECRET   — random string; same value in Database Webhook header
 *   FCM_PROJECT_ID               — Firebase project id
 *   FCM_CLIENT_EMAIL             — service account client_email
 *   FCM_PRIVATE_KEY              — service account private_key (PEM; use \n for newlines in secret)
 *   PUBLIC_APP_URL               — optional; e.g. https://yourapp.vercel.app (webpush deep link)
 *
 * Database Webhook (Dashboard → Database → Webhooks):
 *   Table: chat_messages, Events: INSERT
 *   HTTP Request URL: https://<ref>.supabase.co/functions/v1/notify-chat-message
 *   HTTP Headers: x-chat-notify-secret: <CHAT_NOTIFY_WEBHOOK_SECRET>
 *
 * Firebase: enable Cloud Messaging; use a service account with Firebase Cloud Messaging API enabled.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.2.3'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const secret = Deno.env.get('CHAT_NOTIFY_WEBHOOK_SECRET')
  const provided = req.headers.get('x-chat-notify-secret')?.trim()
  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRole =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (!serviceRole) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const record = (body.record ?? body) as Record<string, unknown>
  const senderRaw = record?.sender_id ?? record?.user_id
  if (senderRaw == null || senderRaw === '') {
    return new Response(JSON.stringify({ error: 'Missing record.sender_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const senderId = String(senderRaw)
  let senderName = String(record.sender_name ?? '').trim()
  const text = (String(record.text ?? record.content ?? '') || 'New message').slice(0, 200)
  const roomId = String(record.room_id ?? '').trim()

  // Prefer FCM_* names; accept JSON-style names from Dashboard (project_id, client_email, private_key).
  const projectId = Deno.env.get('FCM_PROJECT_ID') ?? Deno.env.get('project_id')
  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL') ?? Deno.env.get('client_email')
  const privateKeyRaw = Deno.env.get('FCM_PRIVATE_KEY') ?? Deno.env.get('private_key')
  if (!projectId || !clientEmail || !privateKeyRaw) {
    console.warn('notify-chat-message: FCM env not set — skipping push')
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'fcm_not_configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceRole)

  // If sender_name is missing in the row payload, resolve from profiles.
  if (!senderName) {
    try {
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('display_name, full_name')
        .eq('id', senderId)
        .single()
      senderName =
        String(senderProfile?.display_name ?? senderProfile?.full_name ?? '').trim() || 'Someone'
    } catch {
      senderName = 'Someone'
    }
  }

  let tokenQuery = supabase.from('user_push_tokens').select('token').neq('user_id', senderId)

  // Optional room-targeting: if room_id exists and room_members table is available, only notify members in that room.
  if (roomId) {
    try {
      const { data: members, error: memberErr } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', roomId)
        .neq('user_id', senderId)
      if (!memberErr) {
        const memberIds = (members ?? []).map((m) => String(m.user_id)).filter(Boolean)
        if (memberIds.length === 0) {
          return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_room_members' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        tokenQuery = tokenQuery.in('user_id', memberIds)
      }
    } catch {
      // Fallback to global recipient set when room_members is not present.
    }
  }

  const { data: rows, error: tokErr } = await tokenQuery

  if (tokErr) {
    console.error(tokErr)
    return new Response(JSON.stringify({ error: tokErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const tokens = (rows ?? []).map((r) => r.token as string).filter(Boolean)
  if (tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const pem = privateKeyRaw.replace(/\\n/g, '\n').trim()
  let accessToken: string
  try {
    const key = await importPKCS8(pem, 'RS256')
    const jwt = await new SignJWT({
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('55m')
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .sign(key)

    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })
    const td = (await tr.json()) as { access_token?: string; error?: string }
    if (!tr.ok || !td.access_token) {
      console.error('oauth2', td)
      return new Response(JSON.stringify({ error: 'oauth_failed', detail: td }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    accessToken = td.access_token
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ error: 'fcm_auth_failed', detail: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const title = `Watchman — ${senderName}`
  const bodyText = `${senderName}: ${text}`.slice(0, 400)
  const publicUrl = (Deno.env.get('PUBLIC_APP_URL') ?? '').trim()

  let sent = 0
  const dead: string[] = []

  for (const token of tokens) {
    const webLink = publicUrl.length > 0 ? `${publicUrl.replace(/\/$/, '')}/chat` : '/chat'
    const webpush = {
      notification: {
        title,
        body: bodyText,
        icon: '/assets/icons/icon-192.webp',
        badge: '/assets/icons/icon-192.webp',
      },
      fcm_options: { link: webLink },
    }

    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: bodyText },
          data: {
            url: '/chat',
            tag: 'emergency_chat',
            senderId,
            ...(String(record.id ?? '').trim()
              ? { messageId: String(record.id) }
              : {}),
            ...(roomId ? { roomId } : {}),
          },
          android: {
            priority: 'HIGH',
            notification: {
              sound: 'default',
              icon: 'ic_notification',
              color: '#FFA532',
            },
          },
          webpush,
        },
      }),
    })

    if (res.ok) {
      sent++
      continue
    }

    const errText = await res.text()
    console.warn('fcm send fail', token.slice(0, 14), errText.slice(0, 200))
    if (/UNREGISTERED|NotRegistered|registration.token/i.test(errText)) {
      dead.push(token)
    }
  }

  if (dead.length > 0) {
    await supabase.from('user_push_tokens').delete().in('token', dead)
  }

  return new Response(JSON.stringify({ ok: true, sent, attempted: tokens.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
