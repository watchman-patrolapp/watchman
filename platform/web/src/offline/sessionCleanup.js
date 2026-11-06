import { clearPatrolLocationsForUser } from "../geo/patrolLocationSync";
import { clearEquipmentOfflineState } from "../utils/equipmentOfflineStore";
import { clearCriminalPhotoSignedCache } from "../utils/criminalPhotos";
import { clearSignedMediaCache } from "../utils/privateMedia";
import { clearOfflineUser } from "./snapshots";

/**
 * Drop this person's cached screens, unsent patrol points, and equipment queue.
 * In-memory signed media URLs go too. They are not kept past sign-out.
 */
export async function clearOfflineSession(userId) {
  if (!userId) return;
  const tasks = [
    clearOfflineUser(userId),
    clearPatrolLocationsForUser(userId),
    clearEquipmentOfflineState(),
  ];
  await Promise.all(tasks.map((task) => Promise.resolve(task).catch(() => undefined)));
  try {
    clearSignedMediaCache();
  } catch {
    /* ignore */
  }
  try {
    clearCriminalPhotoSignedCache();
  } catch {
    /* ignore */
  }
}
