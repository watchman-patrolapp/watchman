/**
 * Volunteer badges derived from patrol_logs / patrol_routes.
 * 100 badges: levelled milestones plus unique calendar, time-of-day, and coverage awards.
 * Nothing here is granted by hand — every check reads computed volunteer stats.
 */

function hours(s) {
  return Math.floor((s.totalMinutes || 0) / 60);
}

function km(s) {
  return Math.floor(Number(s.routeStats?.totalDistance) || 0);
}

function holiday(s, id) {
  return s.holidayCounts?.[id] || 0;
}

function windowsHit(s) {
  const d = s.timeDistribution || {};
  return ["night", "morning", "afternoon", "evening"].filter((k) => (d[k] || 0) > 0).length;
}

function b(id, name, description, emoji, progress, extra = {}) {
  return { id, name, description, emoji, progress, personality: false, ...extra };
}

export const BADGE_DEFS = [
  // --- Patrol count levels ---
  b("first-light", "First Light", "Complete your first patrol", "🌅", (s) => ({ current: s.totalPatrols || 0, target: 1 })),
  b("five-patrols", "Getting Going", "Log 5 completed patrols", "🚶", (s) => ({ current: s.totalPatrols || 0, target: 5 })),
  b("ten-patrols", "10 Patrols", "Log 10 completed patrols", "🔟", (s) => ({ current: s.totalPatrols || 0, target: 10 })),
  b("fifteen-patrols", "Fifteen Strong", "Log 15 completed patrols", "📌", (s) => ({ current: s.totalPatrols || 0, target: 15 })),
  b("twenty-five", "Quarter Century", "Log 25 completed patrols", "🏅", (s) => ({ current: s.totalPatrols || 0, target: 25 })),
  b("forty-patrols", "Forty Watch", "Log 40 completed patrols", "🔷", (s) => ({ current: s.totalPatrols || 0, target: 40 })),
  b("fifty-patrols", "Fifty Strong", "Log 50 completed patrols", "🏆", (s) => ({ current: s.totalPatrols || 0, target: 50 })),
  b("seventy-five", "75 Patrols", "Log 75 completed patrols", "🎯", (s) => ({ current: s.totalPatrols || 0, target: 75 })),
  b("century-club", "Century Club", "Log 100 completed patrols", "💯", (s) => ({ current: s.totalPatrols || 0, target: 100 })),
  b("one-fifty", "One Fifty", "Log 150 completed patrols", "🌟", (s) => ({ current: s.totalPatrols || 0, target: 150 })),

  // --- Hours on watch ---
  b("five-hours", "Five Hours", "Reach 5 hours on patrol", "🕐", (s) => ({ current: hours(s), target: 5 })),
  b("ten-hours", "Ten Hours", "Reach 10 hours on patrol", "🕑", (s) => ({ current: hours(s), target: 10 })),
  b("dedicated", "Dedicated", "Reach 20 hours on patrol", "⏰", (s) => ({ current: hours(s), target: 20 })),
  b("thirty-five-hours", "Thirty-Five Hours", "Reach 35 hours on patrol", "🕒", (s) => ({ current: hours(s), target: 35 })),
  b("fifty-hours", "Fifty Hours", "Reach 50 hours on patrol", "⏳", (s) => ({ current: hours(s), target: 50 })),
  b("seventy-five-hours", "Seventy-Five Hours", "Reach 75 hours on patrol", "🕓", (s) => ({ current: hours(s), target: 75 })),
  b("iron-watch", "Iron Watch", "Reach 100 hours on patrol", "🛡️", (s) => ({ current: hours(s), target: 100 })),
  b("hundred-fifty-hours", "150 Hours", "Reach 150 hours on patrol", "🕔", (s) => ({ current: hours(s), target: 150 })),
  b("two-hundred-hours", "200 Hours", "Reach 200 hours on patrol", "🕕", (s) => ({ current: hours(s), target: 200 })),
  b("three-hundred-hours", "300 Hours", "Reach 300 hours on patrol", "🏰", (s) => ({ current: hours(s), target: 300 })),

  // --- Distance (needs GPS route rows) ---
  b("first-kilometres", "First Kilometres", "Cover 10 km on recorded patrol routes", "📍", (s) => ({ current: km(s), target: 10 }), { requiresDistance: true }),
  b("street-miles", "Street Miles", "Cover 25 km on recorded patrol routes", "🛣️", (s) => ({ current: km(s), target: 25 }), { requiresDistance: true }),
  b("fifty-km", "50 km Club", "Cover 50 km on recorded patrol routes", "📏", (s) => ({ current: km(s), target: 50 }), { requiresDistance: true }),
  b("hundred-km", "100 km Club", "Cover 100 km on recorded patrol routes", "🧭", (s) => ({ current: km(s), target: 100 }), { requiresDistance: true }),
  b("long-haul", "Long Haul", "Cover 150 km on recorded patrol routes", "🚛", (s) => ({ current: km(s), target: 150 }), { requiresDistance: true }),
  b("quarter-thousand", "250 km Club", "Cover 250 km on recorded patrol routes", "🗺️", (s) => ({ current: km(s), target: 250 }), { requiresDistance: true }),
  b("road-warrior", "Road Warrior", "Cover 400 km on recorded patrol routes", "🚗", (s) => ({ current: km(s), target: 400 }), { requiresDistance: true }),
  b("seven-fifty-km", "750 km Club", "Cover 750 km on recorded patrol routes", "🌍", (s) => ({ current: km(s), target: 750 }), { requiresDistance: true }),

  // --- Current streak ---
  b("spark", "Spark", "Patrol on 2 days in a row", "✨", (s) => ({ current: s.currentStreak || 0, target: 2 })),
  b("on-fire", "On Fire", "Patrol on 3 days in a row", "🔥", (s) => ({ current: s.currentStreak || 0, target: 3 })),
  b("week-warrior", "Week Warrior", "A 7-day patrol streak", "⚡", (s) => ({ current: s.currentStreak || 0, target: 7 })),
  b("unstoppable", "Unstoppable", "A 14-day patrol streak", "💪", (s) => ({ current: s.currentStreak || 0, target: 14 })),
  b("three-week-streak", "Three-Week Streak", "A 21-day patrol streak", "🚀", (s) => ({ current: s.currentStreak || 0, target: 21 })),

  // --- Best streak ever ---
  b("best-five", "Five-Day Best", "Reach a 5-day streak at any time", "📈", (s) => ({ current: s.longestStreak || 0, target: 5 })),
  b("best-ten", "Ten-Day Best", "Reach a 10-day streak at any time", "📊", (s) => ({ current: s.longestStreak || 0, target: 10 })),
  b("iron-streak", "Iron Streak", "Reach a 20-day streak at any time", "🧱", (s) => ({ current: s.longestStreak || 0, target: 20 })),

  // --- Personality (shown when earned) ---
  b("night-owl", "Night Owl", "Most of your patrols start between midnight and 6:00", "🌙", (s) => ({
    current: s.favoriteTime?.period === "night" ? s.favoriteTime.count || 0 : 0,
    target: 3,
  }), { personality: true }),
  b("early-bird", "Early Bird", "Most of your patrols start between 6:00 and 12:00", "🐦", (s) => ({
    current: s.favoriteTime?.period === "morning" ? s.favoriteTime.count || 0 : 0,
    target: 3,
  }), { personality: true }),
  b("day-patrol", "Day Patrol", "Most of your patrols start between 12:00 and 18:00", "☀️", (s) => ({
    current: s.favoriteTime?.period === "afternoon" ? s.favoriteTime.count || 0 : 0,
    target: 3,
  }), { personality: true }),
  b("evening-watch", "Evening Watch", "Most of your patrols start between 18:00 and midnight", "🌆", (s) => ({
    current: s.favoriteTime?.period === "evening" ? s.favoriteTime.count || 0 : 0,
    target: 3,
  }), { personality: true }),

  // --- Night / morning / evening / afternoon counts ---
  b("night-shift", "Night Shift", "Complete 10 night patrols (start 00:00–05:59)", "🦉", (s) => ({ current: s.timeDistribution?.night || 0, target: 10 })),
  b("midnight-regular", "Midnight Regular", "Complete 25 night patrols", "🌌", (s) => ({ current: s.timeDistribution?.night || 0, target: 25 })),
  b("night-veteran", "Night Veteran", "Complete 40 night patrols", "🦇", (s) => ({ current: s.timeDistribution?.night || 0, target: 40 })),
  b("night-legend", "Night Legend", "Complete 75 night patrols", "🌑", (s) => ({ current: s.timeDistribution?.night || 0, target: 75 })),
  b("dawn-patrol", "Dawn Patrol", "Complete 10 morning patrols (start 06:00–11:59)", "🌄", (s) => ({ current: s.timeDistribution?.morning || 0, target: 10 })),
  b("morning-regular", "Morning Regular", "Complete 20 morning patrols", "🌤️", (s) => ({ current: s.timeDistribution?.morning || 0, target: 20 })),
  b("sunrise-veteran", "Sunrise Veteran", "Complete 40 morning patrols", "🌻", (s) => ({ current: s.timeDistribution?.morning || 0, target: 40 })),
  b("dusk-watch", "Dusk Watch", "Complete 10 evening patrols (start 18:00–23:59)", "🌇", (s) => ({ current: s.timeDistribution?.evening || 0, target: 10 })),
  b("evening-regular", "Evening Regular", "Complete 20 evening patrols", "🌃", (s) => ({ current: s.timeDistribution?.evening || 0, target: 20 })),
  b("twilight-veteran", "Twilight Veteran", "Complete 40 evening patrols", "💫", (s) => ({ current: s.timeDistribution?.evening || 0, target: 40 })),
  b("afternoon-shift", "Afternoon Shift", "Complete 10 afternoon patrols (start 12:00–17:59)", "😎", (s) => ({ current: s.timeDistribution?.afternoon || 0, target: 10 })),
  b("day-regular", "Day Regular", "Complete 25 afternoon patrols", "🔆", (s) => ({ current: s.timeDistribution?.afternoon || 0, target: 25 })),

  // --- Weekend / weekday ---
  b("weekend-watch", "Weekend Watch", "Complete 5 weekend patrols", "🎈", (s) => ({ current: s.weekendPatrols || 0, target: 5 })),
  b("weekend-regular", "Weekend Regular", "Complete 15 weekend patrols", "📅", (s) => ({ current: s.weekendPatrols || 0, target: 15 })),
  b("weekend-veteran", "Weekend Veteran", "Complete 30 weekend patrols", "🛋️", (s) => ({ current: s.weekendPatrols || 0, target: 30 })),
  b("weekend-legend", "Weekend Legend", "Complete 50 weekend patrols", "🎪", (s) => ({ current: s.weekendPatrols || 0, target: 50 })),
  b("weeknight-warrior", "Weeknight Warrior", "Complete 10 weekday patrols", "💼", (s) => ({ current: s.weekdayPatrols || 0, target: 10 })),
  b("weekday-regular", "Weekday Regular", "Complete 25 weekday patrols", "🗂️", (s) => ({ current: s.weekdayPatrols || 0, target: 25 })),
  b("weekday-veteran", "Weekday Veteran", "Complete 50 weekday patrols", "🏫", (s) => ({ current: s.weekdayPatrols || 0, target: 50 })),
  b("friday-closer", "Friday Closer", "Complete 8 Friday patrols", "🎉", (s) => ({ current: s.fridayPatrols || 0, target: 8 })),
  b("saturday-regular", "Saturday Regular", "Complete 8 Saturday patrols", "🥳", (s) => ({ current: s.saturdayPatrols || 0, target: 8 })),
  b("sunday-sentinel", "Sunday Sentinel", "Complete 8 Sunday patrols", "🕊️", (s) => ({ current: s.sundayPatrols || 0, target: 8 })),

  // --- Single-patrol length ---
  b("two-hour-shift", "Two-Hour Shift", "Finish a single patrol of 2 hours or more", "⏱️", (s) => ({ current: Math.floor((s.longestPatrolMinutes || 0) / 60), target: 2 })),
  b("marathon", "Marathon Patrol", "Finish a single patrol of 3 hours or more", "🏃", (s) => ({ current: Math.floor((s.longestPatrolMinutes || 0) / 60), target: 3 })),
  b("double-shift", "Double Shift", "Finish a single patrol of 5 hours or more", "⭐", (s) => ({ current: Math.floor((s.longestPatrolMinutes || 0) / 60), target: 5 })),
  b("iron-shift", "Iron Shift", "Finish a single patrol of 8 hours or more", "🏋️", (s) => ({ current: Math.floor((s.longestPatrolMinutes || 0) / 60), target: 8 })),

  // --- Unique calendar days ---
  b("week-of-days", "Seven Days Logged", "Patrol on 7 different calendar days", "📆", (s) => ({ current: s.distinctDays || 0, target: 7 })),
  b("fortnight-days", "Fourteen Days Logged", "Patrol on 14 different calendar days", "🗓️", (s) => ({ current: s.distinctDays || 0, target: 14 })),
  b("month-of-days", "Thirty Days Logged", "Patrol on 30 different calendar days", "🧾", (s) => ({ current: s.distinctDays || 0, target: 30 })),
  b("hundred-days", "Hundred Days Logged", "Patrol on 100 different calendar days", "📚", (s) => ({ current: s.distinctDays || 0, target: 100 })),

  // --- Unique calendar dates (South African fixed public holidays + real calendar quirks) ---
  b("friday-13", "Friday the 13th", "Complete a patrol that starts on a Friday the 13th", "🍀", (s) => ({ current: s.friday13thCount || 0, target: 1 }), { hideUntilEarned: true }),
  b("leap-day", "Leap Day", "Complete a patrol that starts on 29 February", "🐸", (s) => ({ current: s.leapDayCount || 0, target: 1 }), { hideUntilEarned: true }),
  b("new-year", "New Year's Watch", "Patrol on 1 January (New Year's Day)", "🎆", (s) => ({ current: holiday(s, "new-year"), target: 1 }), { hideUntilEarned: true }),
  b("human-rights", "Human Rights Watch", "Patrol on 21 March (Human Rights Day)", "✊", (s) => ({ current: holiday(s, "human-rights"), target: 1 }), { hideUntilEarned: true }),
  b("freedom-day", "Freedom Day Watch", "Patrol on 27 April (Freedom Day)", "🇿🇦", (s) => ({ current: holiday(s, "freedom-day"), target: 1 }), { hideUntilEarned: true }),
  b("workers-day", "Workers' Day Watch", "Patrol on 1 May (Workers' Day)", "🛠️", (s) => ({ current: holiday(s, "workers-day"), target: 1 }), { hideUntilEarned: true }),
  b("youth-day", "Youth Day Watch", "Patrol on 16 June (Youth Day)", "🎓", (s) => ({ current: holiday(s, "youth-day"), target: 1 }), { hideUntilEarned: true }),
  b("womens-day", "Women's Day Watch", "Patrol on 9 August (National Women's Day)", "💜", (s) => ({ current: holiday(s, "womens-day"), target: 1 }), { hideUntilEarned: true }),
  b("heritage-day", "Heritage Day Watch", "Patrol on 24 September (Heritage Day)", "🍖", (s) => ({ current: holiday(s, "heritage-day"), target: 1 }), { hideUntilEarned: true }),
  b("reconciliation", "Reconciliation Watch", "Patrol on 16 December (Day of Reconciliation)", "🤝", (s) => ({ current: holiday(s, "reconciliation"), target: 1 }), { hideUntilEarned: true }),
  b("christmas-watch", "Christmas Watch", "Patrol on 25 December (Christmas Day)", "🎄", (s) => ({ current: holiday(s, "christmas"), target: 1 }), { hideUntilEarned: true }),
  b("goodwill-day", "Goodwill Watch", "Patrol on 26 December (Day of Goodwill)", "🎁", (s) => ({ current: holiday(s, "goodwill"), target: 1 }), { hideUntilEarned: true }),

  // --- Time-of-day quirks ---
  b("before-dawn", "Before Dawn", "Start 5 patrols before 06:00", "🌘", (s) => ({ current: s.startsBefore6 || 0, target: 5 })),
  b("graveyard", "Graveyard Shift", "Start 5 patrols between 00:00 and 04:59", "🪦", (s) => ({ current: s.startsGraveyard || 0, target: 5 })),
  b("coffee-patrol", "Coffee Patrol", "Start 5 patrols between 05:00 and 07:59", "☕", (s) => ({ current: s.startsCoffee || 0, target: 5 })),
  b("lunch-watch", "Lunch Watch", "Start 5 patrols between 12:00 and 13:59", "🥪", (s) => ({ current: s.startsLunch || 0, target: 5 })),
  b("twilight-run", "Twilight Run", "Start 8 patrols between 17:00 and 19:59", "🧡", (s) => ({ current: s.startsTwilight || 0, target: 8 })),
  b("late-lockup", "Late Lock-up", "Start 5 patrols at 22:00 or later", "🔐", (s) => ({ current: s.startsLateEvening || 0, target: 5 })),
  b("crossed-midnight", "Past Midnight", "Finish 3 patrols on the calendar day after they started", "🕛", (s) => ({ current: s.crossedMidnight || 0, target: 3 })),
  b("double-header", "Double Header", "Complete 2 or more patrols on the same day, 3 times", "🎭", (s) => ({ current: s.sameDayDoubles || 0, target: 3 })),

  // --- Coverage, rank, seasons, tenure ---
  b("full-week-map", "Every Weekday", "Patrol at least once on each day of the week", "🧭", (s) => ({ current: s.distinctWeekdays || 0, target: 7 })),
  b("all-rounder", "All-Rounder", "Patrol at least once in every time-of-day window", "🔄", (s) => ({ current: windowsHit(s), target: 4 })),
  b("zone-hopper", "Zone Hopper", "Patrol in 3 different zones", "📌", (s) => ({ current: s.distinctZones || 0, target: 3 })),
  b("still-showing", "Still Showing", "Complete a patrol in the last 7 days", "💚", (s) => ({ current: s.patrolsThisWeek || 0, target: 1 })),
  b("top-ten", "Top Ten", "Reach the top 10 on the all-time board", "🔝", (s) => {
    const rank = Number(s.globalRank) || 0;
    return { current: rank > 0 && rank <= 10 ? 1 : 0, target: 1 };
  }),
  b("podium", "Podium", "Reach the top 3 on the all-time board", "🥇", (s) => {
    const rank = Number(s.globalRank) || 0;
    return { current: rank > 0 && rank <= 3 ? 1 : 0, target: 1 };
  }),
  b("champion", "Champion", "Stand 1st on the all-time board", "👑", (s) => {
    const rank = Number(s.globalRank) || 0;
    return { current: rank === 1 ? 1 : 0, target: 1 };
  }, { hideUntilEarned: false }),
  b("winter-watch", "Winter Watch", "Complete 5 patrols in June, July or August", "❄️", (s) => ({ current: s.seasonCounts?.winter || 0, target: 5 })),
  b("summer-watch", "Summer Watch", "Complete 5 patrols in December, January or February", "🏖️", (s) => ({ current: s.seasonCounts?.summer || 0, target: 5 })),
  b("veteran", "Ninety Days In", "Stay on the watch for 90 days after your first patrol", "🎖️", (s) => ({ current: s.daysSinceFirst || 0, target: 90 })),
];

export const BADGE_COUNT = BADGE_DEFS.length;

export function evaluateLeaderboardBadges(stats) {
  const safe = stats || {};
  const evaluated = BADGE_DEFS.map((def) => {
    const { current, target } = def.progress(safe);
    const earned = target > 0 && current >= target;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      personality: Boolean(def.personality),
      requiresDistance: Boolean(def.requiresDistance),
      hideUntilEarned: Boolean(def.hideUntilEarned),
      current,
      target,
      earned,
      ratio: target > 0 ? Math.min(1, current / target) : 0,
    };
  });

  const earned = evaluated.filter((b) => b.earned);
  const hasRouteData = Boolean(safe.routeStats);
  const locked = evaluated
    .filter((b) => {
      if (b.earned || b.personality) return false;
      if (b.hideUntilEarned) return false;
      if (b.requiresDistance && !hasRouteData) return false;
      return true;
    })
    .sort((a, b) => b.ratio - a.ratio || a.target - b.target);

  return {
    earned,
    next: locked.slice(0, 10),
    earnedCount: earned.length,
    total: BADGE_COUNT,
  };
}
