import { canAccessPatrolOpsChat, isResidentAppRole } from "../../auth/roleMatrix";

export const CHAT_CHANNEL_PATROL = "patrol";
export const CHAT_CHANNEL_RESIDENT = "resident";

export { canAccessPatrolOpsChat };

/** Households open Neighbours. Admins, patrollers, and other watch roles open Patrol ops. */
export function defaultChatChannel(role) {
  if (isResidentAppRole(role)) return CHAT_CHANNEL_RESIDENT;
  return CHAT_CHANNEL_PATROL;
}

/** If visibility is missing (SQL not applied yet), show the message in every tab. */
export function messageMatchesChannel(message, channel) {
  const vis = message?.visibility;
  if (vis == null || vis === "") return true;
  return vis === channel;
}

export function isResidentChatMessage(message) {
  return message?.visibility === CHAT_CHANNEL_RESIDENT;
}

export function shouldAlertForChatMessage(message, { activeChannel, isOps } = {}) {
  if (!message) return false;
  const vis = message.visibility;
  const critical = Boolean(message.is_critical);
  if (critical) return true;
  if (vis == null || vis === "") return true;
  if (!isOps) return vis === CHAT_CHANNEL_RESIDENT;
  if (activeChannel && vis === activeChannel) return true;
  return vis === CHAT_CHANNEL_PATROL;
}
