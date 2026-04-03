/**
 * profile_associates rows are directed: profile_id (owner of the link) → associate_profile_id (other person).
 * UI treats the network as undirected for display: both endpoints see the same edge.
 */

/**
 * @param {object} row - Raw Supabase row with subject_profile + associate_profile embeds
 * @param {string} viewerProfileId - Current criminal_profiles.id
 * @returns {object} Row with `other_profile_id`, `profile` (other person's card), `_viewerIsProfileId`
 */
export function normalizeProfileAssociateRow(row, viewerProfileId) {
  const outgoing = row.profile_id === viewerProfileId;
  const otherId = outgoing ? row.associate_profile_id : row.profile_id;
  const otherProfile = outgoing ? row.associate_profile : row.subject_profile;

  const { subject_profile, associate_profile, ...rest } = row;

  return {
    ...rest,
    other_profile_id: otherId,
    profile:
      otherProfile && otherProfile.id
        ? otherProfile
        : { id: otherId, primary_name: otherProfile?.primary_name ?? 'Unknown' },
    _viewerIsProfileId: outgoing,
    /** When the viewer is associate_profile_id, this is the profile that created the link */
    _linkerProfile: outgoing ? null : subject_profile ?? null,
  };
}

/**
 * Load all associate edges where this profile is either endpoint.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 */
export async function fetchAssociatesBidirectional(supabase, profileId) {
  const { data, error } = await supabase
    .from('profile_associates')
    .select(
      `
      *,
      subject_profile:profile_id(id, primary_name, risk_level, status, photo_urls),
      associate_profile:associate_profile_id(id, primary_name, risk_level, status, photo_urls)
    `
    )
    .or(`profile_id.eq.${profileId},associate_profile_id.eq.${profileId}`);

  if (error) throw error;
  return (data || []).map((r) => normalizeProfileAssociateRow(r, profileId));
}

/**
 * Dedupe associate profiles from search-page embeds (outgoing + incoming edges).
 * @param {string} viewerProfileId
 * @param {object[]|null|undefined} outRows - profile_associates where profile_id = viewer
 * @param {object[]|null|undefined} inRows - profile_associates where associate_profile_id = viewer
 * @returns {{ id: string, primary_name?: string, risk_level?: string, status?: string, photo_urls?: string[], relationship_type?: string }[]}
 */
export function buildAssociatesPreviewList(viewerProfileId, outRows, inRows) {
  const map = new Map();
  const add = (p, relationship_type) => {
    if (!p?.id || p.id === viewerProfileId) return;
    if (map.has(p.id)) return;
    map.set(p.id, {
      id: p.id,
      primary_name: p.primary_name,
      risk_level: p.risk_level,
      status: p.status,
      photo_urls: p.photo_urls,
      relationship_type: relationship_type || 'associate',
    });
  };
  for (const r of outRows || []) {
    add(r?.associate_profile, r?.relationship_type);
  }
  for (const r of inRows || []) {
    add(r?.subject_profile, r?.relationship_type);
  }
  return [...map.values()];
}
