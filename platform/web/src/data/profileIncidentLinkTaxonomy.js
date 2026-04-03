/**
 * `profile_incidents` link fields — operational intelligence, not a court finding.
 */

/** @typedef {{ value: string, label: string, hint?: string }} ConnectionTypeOption */

/** Shown when linking a suspect from an incident report (subset of DB CHECK). */
export const INCIDENT_REPORT_CONNECTION_TYPE_OPTIONS = [
  {
    value: 'probable_suspect',
    label: 'Probable suspect',
    hint: 'Strong reason to believe this subject was involved; not yet verified in court.',
  },
  {
    value: 'person_of_interest',
    label: 'Person of interest',
    hint: 'Relevant to the investigation; role or involvement not yet established.',
  },
  {
    value: 'apprehended_released',
    label: 'Apprehended then released',
    hint:
      'Caught or detained (e.g. security → SAPS), then released on bail, with a warning, or without charge. Use when they are not still in custody.',
  },
  {
    value: 'apprehended',
    label: 'Apprehended / police handover',
    hint:
      'Taken into custody or formally handed to police in connection with this incident. Does not require them to still be in custody today — if they were later released, prefer “Apprehended then released”.',
  },
  {
    value: 'witness',
    label: 'Witness',
    hint: 'Linked profile observed or reported information; not treated as a suspect.',
  },
];

export const ALL_CONNECTION_TYPE_LABELS = {
  confirmed_perpetrator: 'Confirmed perpetrator',
  probable_suspect: 'Probable suspect',
  person_of_interest: 'Person of interest',
  apprehended: 'Apprehended / police handover',
  apprehended_released: 'Apprehended then released',
  witness: 'Witness',
  associate_present: 'Associate present',
  victim: 'Victim',
  false_positive: 'False positive',
};

export function connectionTypeLabel(value) {
  if (!value) return 'Person of interest';
  return ALL_CONNECTION_TYPE_LABELS[value] || String(value).replace(/_/g, ' ');
}

export function connectionTypeBadgeClasses(value) {
  switch (value) {
    case 'confirmed_perpetrator':
      return 'bg-red-100 text-red-900 dark:bg-red-950/55 dark:text-red-200';
    case 'probable_suspect':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200';
    case 'apprehended':
    case 'apprehended_released':
      return 'bg-violet-100 text-violet-900 dark:bg-violet-950/45 dark:text-violet-200';
    case 'witness':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200';
    case 'victim':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200';
    case 'false_positive':
      return 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    default:
      return 'bg-blue-100 text-blue-900 dark:bg-blue-950/45 dark:text-blue-200';
  }
}

/** Short copy for incident / profile UIs */
export const PROFILE_INCIDENT_CONFIDENCE_EXPLAINER =
  'Optional 1–100 score for how strong the intelligence link is between this dossier and the incident (evidence quality, ID certainty, corroboration). It is not a court verdict and does not replace SAPS or prosecution outcomes. Reserve very high scores (e.g. 95–100) for unusually strong corroboration; a solid security handover and on-scene ID often fits the high 80s–90s unless your SOP says otherwise. Leave blank if unsure.';

/** One line when the score is missing */
export const PROFILE_INCIDENT_CONFIDENCE_NOT_SET_HINT =
  'No score saved — add one when editing the report (1–100) or leave blank if the link is still informal.';
