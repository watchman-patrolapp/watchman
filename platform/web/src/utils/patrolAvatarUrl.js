/**
 * Effective avatar URL for a patrol card row (enriched from DB + viewer fallback).
 */
export function resolvePatrolAvatarUrl(patrol, viewer) {
  if (patrol?.patrol_avatar_url) return patrol.patrol_avatar_url;
  if (viewer?.id && patrol?.user_id === viewer.id && viewer.avatarUrl) {
    return viewer.avatarUrl;
  }
  return null;
}
