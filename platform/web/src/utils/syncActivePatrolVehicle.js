/**
 * When a volunteer changes vehicles (delete / new primary), active_patrols can still hold the old
 * vehicle_id and vehicle_color until they end patrol. The live map reads those columns — so the
 * marker stays e.g. red. Map code defaults missing color to blue, not red; red always means DB value.
 *
 * Call after vehicle list changes and when dashboard loads with an active patrol.
 */
export async function syncActivePatrolVehicleFromVehicleList(supabase, userId, vehicles, activePatrol = null) {
  if (!userId || !vehicles?.length) return { updated: false, data: null };

  let ap = activePatrol;
  if (!ap) {
    const { data, error } = await supabase.from('active_patrols').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return { updated: false, data: null };
    ap = data;
  }

  const apVid = ap.vehicle_id != null ? String(ap.vehicle_id) : '';
  let target = apVid ? vehicles.find((v) => String(v.id) === apVid) : null;
  if (!target) {
    target = vehicles.find((v) => v.is_primary) || vehicles[0];
  }
  if (!target) return { updated: false, data: null };

  const mm = (target.make_model || '').toLowerCase();
  const vehicleType =
    target.vehicle_type ||
    (mm.includes('motorcycle') || mm.includes('motorbike')
      ? 'motorcycle'
      : mm.includes('bicycle') || (mm.includes('bike') && !mm.includes('motor'))
        ? 'bicycle'
        : mm.includes('boat') || mm.includes('yacht')
          ? 'boat'
          : mm.includes('foot')
            ? 'on_foot'
            : 'car');

  const next = {
    vehicle_id: target.id,
    vehicle_type: vehicleType,
    vehicle_make_model: target.make_model,
    vehicle_reg: target.registration,
    vehicle_color: target.color || 'gray',
  };

  const norm = (c) => (c || '').toString().toLowerCase();
  const same =
    String(ap.vehicle_id ?? '') === String(next.vehicle_id ?? '') &&
    norm(ap.vehicle_color) === norm(next.vehicle_color) &&
    (ap.vehicle_make_model || '') === (next.vehicle_make_model || '') &&
    (ap.vehicle_reg || '') === (next.vehicle_reg || '');

  if (same) return { updated: false, data: null };

  const { data: updatedRow, error: upErr } = await supabase
    .from('active_patrols')
    .update(next)
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  if (upErr) {
    console.warn('syncActivePatrolVehicleFromVehicleList:', upErr);
    return { updated: false, data: null };
  }
  return { updated: true, data: updatedRow };
}
