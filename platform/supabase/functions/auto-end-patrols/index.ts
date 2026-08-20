import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function resolveOrganizationId(supabase, patrol) {
  if (patrol?.organization_id) return patrol.organization_id

  if (patrol?.user_id) {
    const { data: userRow } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', patrol.user_id)
      .maybeSingle()
    if (userRow?.organization_id) return userRow.organization_id
  }

  const zone = String(patrol?.zone || '').trim().toLowerCase()
  if (zone && zone !== 'unknown') {
    const short = zone.replace(/\s+(neighbourhood|neighborhood)\s+watch$/i, '').trim()
    const { data: byName } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('type', 'nw_group')
      .or(`name.ilike.${short},name.ilike.${short}%`)
      .limit(5)
    const exact = (byName || []).find((o) => String(o.name || '').trim().toLowerCase() === short)
    if (exact?.id) return exact.id
    if (byName?.[0]?.id) return byName[0].id
  }

  // Do not invent Theescombe for blank / unrelated zones.
  return null
}

/** Match client watchTime.parsePatrolTime for Postgres timestamp strings. */
function parsePatrolTime(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  if (!raw) return null
  let normalized = /T/.test(raw) ? raw : raw.replace(' ', 'T')
  normalized = normalized.replace(/([+-])(\d{2})$/, '$1$2:00')
  const d = new Date(normalized)
  if (!Number.isNaN(d.getTime())) return d
  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

/** Align with Dashboard Guide: warn 2h, auto-end at 2.5h. */
const PATROL_MAX_MS = Math.round(2.5 * 60 * 60 * 1000)

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabase = createClient(supabaseUrl!, serviceRoleKey!)

    const cutoffTime = new Date(Date.now() - PATROL_MAX_MS).toISOString()

    const { data: oldPatrols, error: fetchError } = await supabase
      .from('active_patrols')
      .select('*')
      .lt('start_time', cutoffTime)

    if (fetchError) throw fetchError

    if (!oldPatrols || oldPatrols.length === 0) {
      return new Response('No stale patrols found', { status: 200 })
    }

    let ended = 0
    for (const patrol of oldPatrols) {
      const endTime = new Date()
      const started = parsePatrolTime(patrol.start_time)
      if (!started) continue
      const durationMinutes = Math.max(
        1,
        Math.floor((endTime.getTime() - started.getTime()) / 60000)
      )
      const organizationId = await resolveOrganizationId(supabase, patrol)

      const { error: insertError } = await supabase
        .from('patrol_logs')
        .insert({
          user_id: patrol.user_id,
          user_name: patrol.user_name,
          start_time: patrol.start_time,
          end_time: endTime.toISOString(),
          duration_minutes: durationMinutes,
          zone: patrol.zone || 'Unknown',
          organization_id: organizationId,
          auto_closed: true,
          admin_ended: false,
          vehicle_make_model: patrol.vehicle_make_model || patrol.car_type || null,
          vehicle_reg: patrol.vehicle_reg || patrol.reg_number || null,
          vehicle_color: patrol.vehicle_color || 'gray',
        })

      if (insertError) throw insertError

      const { error: deleteError } = await supabase
        .from('active_patrols')
        .delete()
        .eq('user_id', patrol.user_id)

      if (deleteError) throw deleteError
      ended += 1
    }

    return new Response(`Auto-ended ${ended} patrols`, { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message, details: err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
