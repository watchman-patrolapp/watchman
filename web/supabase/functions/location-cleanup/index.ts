import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupResult {
  success: boolean;
  softDeleted: number;
  archived: number;
  hardDeleted: number;
  errors: string[];
}

Deno.serve(async (req): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const result: CleanupResult = {
    success: true,
    softDeleted: 0,
    archived: 0,
    hardDeleted: 0,
    errors: []
  };

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const now = new Date();

    // ============================================================================
    // STEP 1: SOFT DELETE - Patrols ended > 7 days ago
    // ============================================================================
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
        const patrolIds = oldPatrols.map(p => p.id);

        const { error: softDeleteError } = await supabase
          .from('patrol_locations')
          .update({ deleted_at: now.toISOString() })
          .in('patrol_id', patrolIds)
          .is('deleted_at', null);

        if (softDeleteError) throw softDeleteError;

        result.softDeleted = oldPatrols.length;
        console.log(`✅ Soft deleted locations for ${oldPatrols.length} patrols`);
      }
    } catch (err) {
      result.errors.push(`Soft delete failed: ${err.message}`);
      console.error('❌ Soft delete error:', err);
    }

    // ============================================================================
    // STEP 2: ARCHIVE - Locations > 90 days old
    // ============================================================================
    try {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data: oldLocations, error: fetchError } = await supabase
        .from('patrol_locations')
        .select('*')
        .lt('timestamp', ninetyDaysAgo.toISOString())
        .is('deleted_at', null)
        .eq('is_archived', false)
        .limit(1000);

      if (fetchError) throw fetchError;

      if (oldLocations && oldLocations.length > 0) {
        const { error: archiveInsertError } = await supabase
          .from('patrol_locations_archive')
          .insert(oldLocations.map(loc => ({
            ...loc,
            original_id: loc.id,
            archived_at: now.toISOString()
          })));

        if (archiveInsertError) {
          if (archiveInsertError.message.includes('does not exist')) {
            console.warn('⚠️ Archive table does not exist');
            result.errors.push('Archive table missing');
          } else {
            throw archiveInsertError;
          }
        } else {
          const locationIds = oldLocations.map(l => l.id);
          const { error: archiveUpdateError } = await supabase
            .from('patrol_locations')
            .update({ 
              is_archived: true,
              archived_at: now.toISOString()
            })
            .in('id', locationIds);

          if (archiveUpdateError) throw archiveUpdateError;

          result.archived = oldLocations.length;
          console.log(`✅ Archived ${oldLocations.length} locations`);
        }
      }
    } catch (err) {
      result.errors.push(`Archive failed: ${err.message}`);
      console.error('❌ Archive error:', err);
    }

    // ============================================================================
    // STEP 3: ARCHIVE patrol_routes
    // ============================================================================
    try {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { error: routesError } = await supabase
        .from('patrol_routes')
        .update({
          is_archived: true,
          archived_at: now.toISOString()
        })
        .lt('created_at', ninetyDaysAgo.toISOString())
        .eq('is_archived', false);

      if (routesError) throw routesError;
      
      console.log('✅ Archived old patrol_routes');
    } catch (err) {
      result.errors.push(`Routes archive failed: ${err.message}`);
      console.error('❌ Routes archive error:', err);
    }

    // ============================================================================
    // STEP 4: HARD DELETE - Archived > 2 years (GDPR)
    // ============================================================================
    try {
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const { data: deletedData, error: hardDeleteError } = await supabase
        .from('patrol_locations_archive')
        .delete()
        .lt('archived_at', twoYearsAgo.toISOString())
        .select('id');

      if (hardDeleteError) throw hardDeleteError;

      result.hardDeleted = deletedData?.length || 0;
      if (result.hardDeleted > 0) {
        console.log(`✅ Hard deleted ${result.hardDeleted} old records`);
      }
    } catch (err) {
      result.errors.push(`Hard delete failed: ${err.message}`);
      console.error('❌ Hard delete error:', err);
    }

    if (result.errors.length > 0) {
      result.success = false;
    }

    return new Response(
      JSON.stringify(result),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('💥 Fatal error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});