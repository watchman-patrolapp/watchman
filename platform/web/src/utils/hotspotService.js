import { supabase } from '../supabase/client';

export async function fetchHotspotEvents() {
  const { data, error } = await supabase
    .from('hotspot_events')
    .select('*')
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchCameraSpots() {
  const { data, error } = await supabase.from('camera_spots').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function fetchHotspotCameraChecks(eventId) {
  const { data, error } = await supabase
    .from('hotspot_camera_checks')
    .select('*')
    .eq('hotspot_event_id', eventId);
  if (error) throw error;
  return data || [];
}

export async function insertHotspotEvent(row) {
  const { data, error } = await supabase.from('hotspot_events').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateHotspotEvent(id, patch) {
  const { data, error } = await supabase
    .from('hotspot_events')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHotspotEvent(id) {
  const { error } = await supabase.from('hotspot_events').delete().eq('id', id);
  if (error) throw error;
}

export async function insertCameraSpot(row) {
  const { data, error } = await supabase.from('camera_spots').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateCameraSpot(id, patch) {
  const { data, error } = await supabase
    .from('camera_spots')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCameraSpot(id) {
  const { error } = await supabase.from('camera_spots').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertCameraCheck({ eventId, cameraId, userId, status }) {
  const { data: existing, error: findError } = await supabase
    .from('hotspot_camera_checks')
    .select('id')
    .eq('hotspot_event_id', eventId)
    .eq('camera_spot_id', cameraId)
    .eq('created_by', userId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('hotspot_camera_checks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('hotspot_camera_checks')
    .insert({
      hotspot_event_id: eventId,
      camera_spot_id: cameraId,
      status,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
