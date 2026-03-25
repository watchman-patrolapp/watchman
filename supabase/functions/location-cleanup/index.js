import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const now = new Date();
    
    // 1. Soft delete: Patrols ended > 7 days ago
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: oldPatrols } = await supabase
      .from('patrol_logs')
      .select('id')
      .lt('end_time', sevenDaysAgo.toISOString());
      
    if (oldPatrols?.length > 0) {
      const patrolIds = oldPatrols.map(p => p.id);
      
      await supabase
        .from('patrol_locations')
        .update({ deleted_at: now.toISOString() })
        .in('patrol_id', patrolIds)
        .is('deleted_at', null);
    }

    // 2. Archive: Locations > 90 days old
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const { data: veryOldLocations } = await supabase
      .from('patrol_locations')
      .select('*')
      .lt('timestamp', ninetyDaysAgo.toISOString())
      .is('deleted_at', null)
      .eq('is_archived', false);
      
    if (veryOldLocations?.length > 0) {
      await supabase
        .from('patrol_locations_archive')
        .insert(veryOldLocations.map(loc => ({
          ...loc,
          original_id: loc.id,
          archived_at: now.toISOString()
        })));
        
      await supabase
        .from('patrol_locations')
        .update({ 
          is_archived: true,
          archived_at: now.toISOString()
        })
        .lt('timestamp', ninetyDaysAgo.toISOString());
    }

    // 3. Hard delete: Archived > 2 years (GDPR)
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    
    await supabase
      .from('patrol_locations_archive')
      .delete()
      .lt('archived_at', twoYearsAgo.toISOString());

    return new Response(
      JSON.stringify({ 
        success: true, 
        softDeleted: oldPatrols?.length || 0,
        archived: veryOldLocations?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});