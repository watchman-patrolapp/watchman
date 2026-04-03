/**
 * Sends a transactional “password changed” email via Resend after the user updates their password while signed in.
 *
 * Deploy: npx supabase functions deploy notify-password-changed
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   RESEND_API_KEY          — Resend API key (re_…)
 *   RESEND_FROM_EMAIL       — Verified sender, e.g. no-reply@africuz.co.za
 *   RESEND_FROM_NAME        — optional display name, e.g. Neighbourhood Watch
 *
 * Client: supabase.functions.invoke('notify-password-changed', { body: {} }) with user session.
 * JWT verification is enabled — only signed-in users can call this.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const sub = decodeJwtSub(token)
  if (!sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Use service role + user id: anon getUser() can fail right after updateUser (session rotation).
  const serviceRole =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (!serviceRole) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
    error: userErr,
  } = await admin.auth.admin.getUserById(sub)
  if (userErr || !user?.email) {
    console.error('notify-password-changed getUserById:', userErr)
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
  if (!apiKey || !fromEmail) {
    console.warn('notify-password-changed: RESEND_* not set — skipping email')
    return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'resend_not_configured' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const fromName = Deno.env.get('RESEND_FROM_NAME')?.trim() || 'Account security'
  const when = new Date().toISOString()
  const html = `
    <p>Hi,</p>
    <p>The password for your account (<strong>${escapeHtml(user.email)}</strong>) was just changed.</p>
    <p>If this was you, you can ignore this message.</p>
    <p>If you did <strong>not</strong> change your password, sign in if you still can and change it again, or contact your coordinator immediately.</p>
    <p style="color:#666;font-size:12px;margin-top:24px">Time (UTC): ${escapeHtml(when)}</p>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [user.email],
      subject: 'Your password was changed',
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('Resend error:', res.status, text)
    return new Response(JSON.stringify({ error: 'Failed to send email', detail: text }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

function decodeJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const json = atob(b64 + pad)
    const payload = JSON.parse(json) as { sub?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
