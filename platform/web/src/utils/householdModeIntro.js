const SEEN_PREFIX = "nw_household_intro_seen:";

function seenKey(userId) {
  return `${SEEN_PREFIX}${userId}`;
}

export const HOUSEHOLD_MODE_INTRO = {
  title: "Your household",
  body: "Name, email, phone, and address come from your patrol profile. Set a home pin and your security company on Profile if you have not already. You stay a patroller — this is not a second account.",
};

export function householdIntroWasSeen(userId) {
  if (!userId) return false;
  try {
    return localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markHouseholdIntroSeen(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* ignore quota / private mode */
  }
}
