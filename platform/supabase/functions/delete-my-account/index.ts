import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  run: () => Promise<{ error: { message?: string } | null }>
) {
  const { error } = await run()
  if (error) console.error(`delete-my-account cleanup [${label}]:`, error.message || error)
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      console.error('delete-my-account: missing SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
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
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
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
      return new Response(JSON.stringify({ error: delErr.message || 'Delete failed' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const { error: profileErr } = await supabaseAdmin.from('users').delete().eq('id', targetId)
    if (profileErr) {
      console.error('delete-my-account: public.users delete failed:', profileErr.message || profileErr)
      return new Response(
        JSON.stringify({ error: profileErr.message || 'Failed to remove profile row' }),
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    })
  }
})
