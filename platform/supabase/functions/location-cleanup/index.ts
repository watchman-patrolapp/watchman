import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { getServiceRoleKey, requireCronSecret } from '../_shared/auth.ts';

const HARD_DELETE_BATCH_SIZE = 200;
const HARD_DELETE_MAX_BATCHES = 50;

interface CleanupResult {
  success: boolean;
  softDeleted: number;
  archived: number;
  hardDeleted: number;
  hardDeletedLive: number;
  hardDeletedArchive: number;
  errors: string[];
}

async function hardDeleteOlderThan(
  supabase: SupabaseClient,
  table: 'patrol_locations' | 'patrol_locations_archive',
  cutoffIso: string,
  allowMissingTable = false,
): Promise<number> {
  let totalDeleted = 0;

  for (let batch = 0; batch < HARD_DELETE_MAX_BATCHES; batch++) {
    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select('id')
      .lt('timestamp', cutoffIso)
      .limit(HARD_DELETE_BATCH_SIZE);

    if (selectError) {
      if (allowMissingTable && String(selectError.message || '').includes('does not exist')) {
        console.warn(`${table} does not exist; skipping hard delete`);
        return totalDeleted;
      }
      throw selectError;
    }

    if (!rows || rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .in('id', ids);

    if (deleteError) throw deleteError;

    totalDeleted += ids.length;
    if (rows.length < HARD_DELETE_BATCH_SIZE) break;
  }

  return totalDeleted;
}

Deno.serve(async (req): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result: CleanupResult = {
    success: true,
    softDeleted: 0,
    archived: 0,
    hardDeleted: 0,
    hardDeletedLive: 0,
    hardDeletedArchive: 0,
    errors: [],
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = getServiceRoleKey();

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('location-cleanup: missing SUPABASE_URL or service role key');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    const oneYearIso = oneYearAgo.toISOString();

    // STEP 1: SOFT DELETE - Patrols ended > 7 days ago
    try {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: oldPatrols, error: patrolError } = await supabase
        .from('patrol_logs')
        .select('id')
        .lt('end_time', sevenDaysAgo.toISOString())
        .is('deleted_at', null);

      if (patrolError) throw patrolError;

      if (oldPatrols && oldPatrols.length > 0) {
        const patrolIds = oldPatrols.map((p) => p.id);

        const { error: softDeleteError } = await supabase
          .from('patrol_locations')
          .update({ deleted_at: now.toISOString() })
          .in('patrol_id', patrolIds)
          .is('deleted_at', null);

        if (softDeleteError) throw softDeleteError;

        result.softDeleted = oldPatrols.length;
        console.log(`Soft deleted locations for ${oldPatrols.length} patrols`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push('Soft delete failed');
      console.error('Soft delete error:', message);
    }

    // STEP 2: ARCHIVE - Locations > 90 days old (and <= 1 year old; older rows are purged in Step 4)
    try {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data: oldLocations, error: fetchError } = await supabase
        .from('patrol_locations')
        .select('*')
        .lt('timestamp', ninetyDaysAgo.toISOString())
        .gte('timestamp', oneYearIso)
        .is('deleted_at', null)
        .eq('is_archived', false)
        .limit(1000);

      if (fetchError) throw fetchError;

      if (oldLocations && oldLocations.length > 0) {
        const { error: archiveInsertError } = await supabase
          .from('patrol_locations_archive')
          .insert(
            oldLocations.map((loc) => ({
              ...loc,
              original_id: loc.id,
              archived_at: now.toISOString(),
            })),
          );

        if (archiveInsertError) {
          if (String(archiveInsertError.message || '').includes('does not exist')) {
            console.warn('Archive table does not exist');
            result.errors.push('Archive table missing');
          } else {
            throw archiveInsertError;
          }
        } else {
          const locationIds = oldLocations.map((l) => l.id);
          const { error: archiveUpdateError } = await supabase
            .from('patrol_locations')
            .update({
              is_archived: true,
              archived_at: now.toISOString(),
            })
            .in('id', locationIds);

          if (archiveUpdateError) throw archiveUpdateError;

          result.archived = oldLocations.length;
          console.log(`Archived ${oldLocations.length} locations`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push('Archive failed');
      console.error('Archive error:', message);
    }

    // STEP 3: ARCHIVE patrol_routes (keep route summaries for history; never delete)
    try {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { error: routesError } = await supabase
        .from('patrol_routes')
        .update({
          is_archived: true,
          archived_at: now.toISOString(),
        })
        .lt('created_at', ninetyDaysAgo.toISOString())
        .eq('is_archived', false);

      if (routesError) throw routesError;

      console.log('Archived old patrol_routes');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push('Routes archive failed');
      console.error('Routes archive error:', message);
    }

    // STEP 4: HARD DELETE - Permanently delete raw GPS points older than 1 year (live + archive)
    try {
      result.hardDeletedLive = await hardDeleteOlderThan(
        supabase,
        'patrol_locations',
        oneYearIso,
        false,
      );
      result.hardDeletedArchive = await hardDeleteOlderThan(
        supabase,
        'patrol_locations_archive',
        oneYearIso,
        true,
      );
      result.hardDeleted = result.hardDeletedLive + result.hardDeletedArchive;

      if (result.hardDeleted > 0) {
        console.log(
          `Hard deleted ${result.hardDeleted} raw GPS points older than 1 year (${result.hardDeletedLive} live, ${result.hardDeletedArchive} archive)`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push('Hard delete failed');
      console.error('Hard delete error:', message);
    }

    if (result.errors.length > 0) {
      result.success = false;
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Fatal location-cleanup error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
