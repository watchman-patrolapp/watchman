import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildAccountMediaPurgePlan, runAccountMediaPurge } from '../_shared/accountMediaPurge.ts'

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : { 'Access-Control-Allow-Origin': '*' }),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer',
    'Access-Control-Max-Age': '86400',
  }
}

async function safeCleanup(
  label: string,
  run: () => PromiseLike<{ error: { message?: string } | null }>
) {
  const { error } = await run()
  if (error) console.error(`delete-my-account cleanup [${label}]:`, error.message || error)
}

function roleKey(role: unknown): string | null {
  const value = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return value || null
}

/** Initials only — this person's name is being erased (POPIA). */
function nameInitials(fullName: unknown): string | null {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return null
  const initials = parts
    .map((part) => (part[0] || '').toUpperCase())
    .filter(Boolean)
    .join('.')
  return initials || null
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Please sign in again, then try deleting your account.' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      console.error('delete-my-account: missing SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ error: 'Account deletion is temporarily unavailable. Please try again later.' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const {
      data: { user: jwtUser },
      error: jwtError,
    } = await supabaseAdmin.auth.getUser(token)
    if (jwtError || !jwtUser) {
      return new Response(JSON.stringify({ error: 'Your session has expired. Please sign in again and retry.' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    let body: { confirm?: boolean }
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    if (body?.confirm !== true) {
      return new Response(JSON.stringify({ error: 'confirm: true required' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const targetId = jwtUser.id
    const uidText = targetId

    const { data: profile, error: profileLookupErr } = await supabaseAdmin
      .from('users')
      .select('role, full_name, organization_id')
      .eq('id', targetId)
      .maybeSingle()
    if (profileLookupErr) {
      console.error('delete-my-account: profile lookup failed:', profileLookupErr.message || profileLookupErr)
      return new Response(JSON.stringify({ error: 'Could not load your account' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const initials = nameInitials(profile?.full_name)
    const { error: auditErr } = await supabaseAdmin.from('activity_logs').insert({
      organization_id: profile?.organization_id || null,
      user_id: targetId,
      action: 'account_self_deleted',
      details_json: {
        subject_user_id: targetId,
        subject_role: roleKey(profile?.role),
        subject_name_initials: initials,
        actor_role: roleKey(profile?.role),
        actor_name: initials,
      },
    })
    if (auditErr) {
      console.error('delete-my-account: audit insert failed:', auditErr.message || auditErr)
      return new Response(
        JSON.stringify({ error: 'Could not write the audit log, so the account was not deleted.' }),
        {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      )
    }

    // Personal media (avatar, chat media, own City Hub general posts, own service listings).
    // Read now, before chat_messages and the users row are gone; removed only after the
    // login is deleted. Incident photos and suspect alerts are never touched.
    const mediaPlan = await buildAccountMediaPurgePlan(supabaseAdmin, targetId, 'delete-my-account')

    await safeCleanup('active_patrols', () =>
      supabaseAdmin.from('active_patrols').delete().eq('user_id', targetId)
    )
    await safeCleanup('patrol_locations', () =>
      supabaseAdmin.from('patrol_locations').delete().eq('user_id', targetId)
    )
    await safeCleanup('patrol_routes', () =>
      supabaseAdmin.from('patrol_routes').delete().eq('user_id', targetId)
    )
    await safeCleanup('patrol_logs', () =>
      supabaseAdmin.from('patrol_logs').delete().eq('user_id', targetId)
    )
    await safeCleanup('patrol_slots', () =>
      supabaseAdmin.from('patrol_slots').delete().eq('volunteer_uid', targetId)
    )
    await safeCleanup('user_vehicles', () =>
      supabaseAdmin.from('user_vehicles').delete().eq('user_id', targetId)
    )
    await safeCleanup('chat_messages', () =>
      supabaseAdmin.from('chat_messages').delete().eq('sender_id', targetId)
    )
    await safeCleanup('incidents submitted_by', () =>
      supabaseAdmin.from('incidents').update({ submitted_by: null }).eq('submitted_by', targetId)
    )

    await safeCleanup('criminal_profiles created_by', () =>
      supabaseAdmin.from('criminal_profiles').delete().eq('created_by', uidText)
    )

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(targetId)
    const authErrMsg = String(delErr?.message || '').toLowerCase()
    const authUserAlreadyGone =
      !!delErr &&
      (authErrMsg.includes('user not found') || authErrMsg.includes('users not found'))
    if (delErr && !authUserAlreadyGone) {
      console.error('delete-my-account: auth delete failed:', delErr.message || delErr)
      return new Response(JSON.stringify({ error: 'We could not delete your account right now. Please try again in a few minutes.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    // Never blocks the deletion: every failure is logged inside and the call never throws.
    await runAccountMediaPurge(supabaseAdmin, mediaPlan, 'delete-my-account')

    const { error: profileErr } = await supabaseAdmin.from('users').delete().eq('id', targetId)
    if (profileErr) {
      console.error('delete-my-account: public.users delete failed:', profileErr.message || profileErr)
      return new Response(
        JSON.stringify({ error: 'Your login was deleted, but we could not finish removing your profile. Please email africuz@gmail.com so we can complete it.' }),
        {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('delete-my-account: unexpected error:', message)
    return new Response(JSON.stringify({ error: 'We could not delete your account right now. Please try again in a few minutes.' }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
})
