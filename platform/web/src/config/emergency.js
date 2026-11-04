/**
 * Civic emergency line shown when an SOS cannot be delivered.
 * SAPS 10111 is the national number seeded in the emergency directory.
 * Neighbourhood-specific numbers live in that directory; this constant is
 * the fallback when the directory cannot be loaded.
 */
export const EMERGENCY_CALL_NUMBER = "10111";
export const EMERGENCY_CALL_NAME = "SAPS";

export function emergencyCallHref(number = EMERGENCY_CALL_NUMBER) {
  const digits = String(number || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "tel:10111";
}
