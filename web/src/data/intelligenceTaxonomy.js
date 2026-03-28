/**
 * Shared definitions and starter templates for criminal intelligence UI.
 * Copy is operational guidance for neighbourhood watch — not legal advice.
 */

export const PRIORITY_LEVELS = [
  {
    value: 'routine',
    label: 'Routine',
    summary: 'Standard monitoring and record-keeping.',
  },
  {
    value: 'priority',
    label: 'Priority',
    summary: 'Elevated interest: allocate analyst or patrol attention when resources allow.',
  },
  {
    value: 'urgent',
    label: 'Urgent',
    summary: 'Time-sensitive; coordination with SAPS or security should be considered promptly.',
  },
  {
    value: 'immediate',
    label: 'Immediate',
    summary: 'Active or imminent threat to life or property; escalate per SOP and local protocols.',
  },
];

export const RISK_LEVELS = [
  {
    value: 'low',
    label: 'Low',
    summary: 'Limited history of harm or threat; still document for pattern analysis.',
  },
  {
    value: 'medium',
    label: 'Medium',
    summary: 'Credible concern or repeat behaviour; warrants routine intelligence sharing.',
  },
  {
    value: 'high',
    label: 'High',
    summary: 'Significant violence, weapons, or repeat serious offending in your area.',
  },
  {
    value: 'critical',
    label: 'Critical',
    summary: 'Extreme risk (e.g. known armed violence, imminent threat). Flag clearly for command.',
  },
];

export const PROFILE_STATUSES = [
  {
    value: 'active',
    label: 'Active',
    summary: 'Subject is believed active in the community or relevant to current operations.',
  },
  {
    value: 'wanted',
    label: 'Wanted',
    summary: 'Law enforcement or your structure has an active interest in locating the subject.',
  },
  {
    value: 'incarcerated',
    label: 'Incarcerated',
    summary: 'Subject is in custody; profile kept for history, associates, and release planning.',
  },
  {
    value: 'cleared',
    label: 'Inactive (cleared)',
    summary: 'No longer treated as an active intelligence target (resolved, mistaken identity, etc.).',
  },
  {
    value: 'deceased',
    label: 'Deceased',
    summary: 'Confirmed deceased; retain record for audit trail only.',
  },
];

export const WATCHLIST_FLAGS_EXPLAINER = {
  title: 'Watchlist flags',
  body:
    'Short, searchable tags that tell patrol and analysts why this profile matters — e.g. “armed”, “vehicle theft ring”, “targets elderly”. They complement risk level and status: risk is how dangerous, status is lifecycle, flags are quick reasons to heighten awareness.',
};

export const MO_EXPLAINER = {
  title: 'Modus operandi (MO)',
  body:
    'MO describes how an offender typically acts: methods (what they do), patterns (timing, targets, sequence), and free-form notes. Consistent MO entries help link incidents and brief patrols without repeating long narratives.',
};

export const RISK_ASSESSMENT_EXPLAINER = {
  title: 'Risk assessment',
  body:
    'Risk level is your structured estimate of danger and impact if the subject offends again. It is separate from priority (how fast you must act operationally) and status (whether they are active, wanted, in custody, etc.). Use SOP and committee guidance when unsure.',
};

/** Grouped chips — appending adds to watchlist flag rows (deduplicated). */
export const WATCHLIST_FLAG_TEMPLATE_GROUPS = [
  {
    id: 'violence',
    title: 'Violence & weapons',
    flags: [
      'Armed / firearm mentioned',
      'Knife or edged weapon',
      'Violence toward residents',
      'Violence toward security or SAPS',
      'Escalating aggression',
    ],
  },
  {
    id: 'property',
    title: 'Property & theft',
    flags: [
      'Housebreaking / burglary pattern',
      'Theft from motor vehicle',
      'Cable or infrastructure theft',
      'Livestock / farm theft',
      'Repeat perimeter breaches',
    ],
  },
  {
    id: 'community',
    title: 'Community & vulnerable targets',
    flags: [
      'Targets elderly or isolated homes',
      'Schools or playgrounds nearby',
      'Prowling / surveillance behaviour',
      'Suspicious vehicles / plate switching',
    ],
  },
  {
    id: 'mobility',
    title: 'Flight & coordination',
    flags: ['Flight risk if confronted', 'Multiple suspects / crew', 'Cross-area pattern (other suburbs)'],
  },
];

/**
 * MO templates: clicking applies methods (deduped), appends pattern and note fragments.
 */
export const MO_TEMPLATE_GROUPS = [
  {
    id: 'property',
    title: 'Property & theft',
    templates: [
      {
        label: 'Residential break-in',
        methods: ['Forced or stealth entry into dwelling'],
        pattern: 'Often targets rear doors/windows; weekday daytime or night absence',
      },
      {
        label: 'Theft from vehicle',
        methods: ['Theft from motor vehicle'],
        pattern: 'Targets unsecured cars; smash-and-grab or silent entry',
      },
      {
        label: 'Cable / infrastructure',
        methods: ['Theft of copper cable or infrastructure'],
        pattern: 'Service interruption; may work in pairs; utility access points',
      },
    ],
  },
  {
    id: 'violence',
    title: 'Robbery & confrontation',
    templates: [
      {
        label: 'Street / pathway robbery',
        methods: ['Robbery with confrontation'],
        pattern: 'Approaches on foot; demands valuables; may flee on foot or vehicle',
      },
      {
        label: 'Home invasion style',
        methods: ['Home invasion', 'Forced entry under threat'],
        pattern: 'Demands keys, phones, safes; short time on site',
      },
    ],
  },
  {
    id: 'surveillance',
    title: 'Surveillance & scouting',
    templates: [
      {
        label: 'Neighbourhood scouting',
        methods: ['Reconnaissance / suspicious loitering'],
        pattern: 'Repeated slow passes; photographing properties; unusual timing',
        note: 'Correlate with incident reports and vehicle descriptors.',
      },
      {
        label: 'Marked vehicle pattern',
        methods: ['Suspicious vehicle linked to incidents'],
        pattern: 'Same plate or vehicle colour/model near multiple events',
      },
    ],
  },
];
