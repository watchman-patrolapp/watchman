/**
 * Card "Locations" stat: geography table rows plus structured location fields on criminal_profiles.
 */

import { mergedSightingsForDisplay } from './criminalProfileSightings';

function embedCount(embed) {
  const c = embed?.[0]?.count;
  return typeof c === 'number' ? c : Number(c) || 0;
}

function sightingsRowsCount(profile) {
  if (!profile || typeof profile !== 'object') return 0;
  return mergedSightingsForDisplay(profile).length;
}

/** Non-geography-table location slots filled on the profile row (Location Data + last sighting). */
export function inlineCriminalProfileLocationCount(profile) {
  if (!profile || typeof profile !== 'object') return 0;
  let n = 0;
  if (typeof profile.common_presence === 'string' && profile.common_presence.trim()) n++;
  if (typeof profile.residence_last_known === 'string' && profile.residence_last_known.trim()) n++;
  n += sightingsRowsCount(profile);
  return n;
}

/** Total for CriminalProfileCard: profile_geography count + inline fields. */
export function totalProfileLocationCardCount(profile, geographyEmbed) {
  const geo = embedCount(geographyEmbed ?? profile?.profile_geography);
  return geo + inlineCriminalProfileLocationCount(profile);
}
