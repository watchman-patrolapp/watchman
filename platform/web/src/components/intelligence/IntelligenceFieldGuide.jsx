import React from 'react';
import { FaBook, FaChevronDown } from 'react-icons/fa';
import {
  RISK_ASSESSMENT_EXPLAINER,
  RISK_LEVELS,
  PRIORITY_LEVELS,
  PROFILE_STATUSES,
  WATCHLIST_FLAGS_EXPLAINER,
  MO_EXPLAINER,
} from '../../data/intelligenceTaxonomy';

/** @typedef {'risk' | 'priority' | 'status' | 'watchlist' | 'mo'} FieldGuideTopic */

export const FIELD_GUIDE_TOPIC_TITLES = {
  risk: RISK_ASSESSMENT_EXPLAINER.title,
  priority: 'Operational priority',
  status: 'Profile status',
  watchlist: WATCHLIST_FLAGS_EXPLAINER.title,
  mo: MO_EXPLAINER.title,
};

function DisclosureBlock({ title, children, defaultOpen = false }) {
  return (
    <details
      open={defaultOpen}
      className="group/disclosure rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800/80"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <FaChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400 transition group-open/disclosure:rotate-180" />
      </summary>
      <div className="border-t border-gray-100 px-4 pb-4 pt-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {children}
      </div>
    </details>
  );
}

function RiskGuideBody() {
  return (
    <>
      <p className="mb-3 leading-relaxed">{RISK_ASSESSMENT_EXPLAINER.body}</p>
      <dl className="space-y-2">
        {RISK_LEVELS.map((row) => (
          <div key={row.value}>
            <dt className="font-medium text-gray-800 dark:text-gray-200">{row.label}</dt>
            <dd className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{row.summary}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function PriorityGuideBody() {
  return (
    <>
      <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Priority drives how quickly your structure should act — separate from long-term risk scoring.
      </p>
      <dl className="space-y-2">
        {PRIORITY_LEVELS.map((row) => (
          <div key={row.value}>
            <dt className="font-medium text-gray-800 dark:text-gray-200">{row.label}</dt>
            <dd className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{row.summary}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function StatusGuideBody() {
  return (
    <dl className="space-y-2">
      {PROFILE_STATUSES.map((row) => (
        <div key={row.value}>
          <dt className="font-medium text-gray-800 dark:text-gray-200">{row.label}</dt>
          <dd className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">{row.summary}</dd>
        </div>
      ))}
    </dl>
  );
}

function WatchlistGuideBody() {
  return <p className="leading-relaxed">{WATCHLIST_FLAGS_EXPLAINER.body}</p>;
}

function MoGuideBody() {
  return (
    <>
      <p className="leading-relaxed">{MO_EXPLAINER.body}</p>
      <ul className="mt-2 list-inside list-disc text-xs text-gray-500 dark:text-gray-400">
        <li>
          <strong className="text-gray-700 dark:text-gray-300">Methods</strong> — discrete actions (e.g. break-in,
          robbery).
        </li>
        <li>
          <strong className="text-gray-700 dark:text-gray-300">Patterns</strong> — timing, victim type, sequence,
          vehicles.
        </li>
        <li>
          <strong className="text-gray-700 dark:text-gray-300">Notes</strong> — anything that does not fit the first two
          lines.
        </li>
      </ul>
    </>
  );
}

const TOPIC_INTRO =
  "Definitions support consistent reporting across patrollers and committees. Align serious incidents with SAPS and your watch's SOP.";

/**
 * Single-topic explainer for modals and inline help.
 * @param {{ topic: FieldGuideTopic, withIntro?: boolean, className?: string }} props
 */
export function IntelligenceFieldGuideTopic({ topic, withIntro = false, className = '' }) {
  const body = (() => {
    switch (topic) {
      case 'risk':
        return <RiskGuideBody />;
      case 'priority':
        return <PriorityGuideBody />;
      case 'status':
        return <StatusGuideBody />;
      case 'watchlist':
        return <WatchlistGuideBody />;
      case 'mo':
        return <MoGuideBody />;
      default:
        return null;
    }
  })();

  if (!body) return null;

  return (
    <div className={`space-y-3 text-sm text-gray-600 dark:text-gray-300 ${className}`.trim()}>
      {withIntro && <p className="text-xs text-gray-500 dark:text-gray-400">{TOPIC_INTRO}</p>}
      {body}
    </div>
  );
}

/**
 * Opens the contextual field guide modal (Create Profile).
 * @param {{ topic: FieldGuideTopic, onOpen: (t: FieldGuideTopic) => void, children: React.ReactNode, className?: string }} props
 */
export function FieldGuideExplainerLink({ topic, onOpen, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(topic)}
      className={`shrink-0 text-xs font-medium text-teal-600 underline decoration-teal-600/50 underline-offset-2 hover:text-teal-800 dark:text-teal-400 dark:decoration-teal-400/40 dark:hover:text-teal-300 ${className}`.trim()}
    >
      {children}
    </button>
  );
}

/**
 * Full reference (all topics). Used on the intelligence search page and inside the collapsible guide.
 * @param {{ className?: string }} props
 */
export function IntelligenceFieldGuidePanel({ className = '' }) {
  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{TOPIC_INTRO}</p>

      <DisclosureBlock title={RISK_ASSESSMENT_EXPLAINER.title}>
        <RiskGuideBody />
      </DisclosureBlock>

      <DisclosureBlock title="Operational priority">
        <PriorityGuideBody />
      </DisclosureBlock>

      <DisclosureBlock title="Profile status">
        <StatusGuideBody />
      </DisclosureBlock>

      <DisclosureBlock title={WATCHLIST_FLAGS_EXPLAINER.title}>
        <WatchlistGuideBody />
      </DisclosureBlock>

      <DisclosureBlock title={MO_EXPLAINER.title}>
        <MoGuideBody />
      </DisclosureBlock>
    </div>
  );
}

/**
 * Expandable reference for risk, priority, status, watchlist flags, and MO.
 * @param {{ className?: string, defaultOpen?: boolean }} props
 */
export default function IntelligenceFieldGuide({ className = '', defaultOpen = false }) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-xl border border-teal-200/80 bg-teal-50/50 dark:border-teal-900/50 dark:bg-teal-950/20 ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-white">
          <FaBook className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 dark:text-white">Intelligence field guide</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Risk, priority, status, watchlist flags, and modus operandi — how terms are used in this app.
          </p>
        </div>
        <FaChevronDown className="h-4 w-4 shrink-0 text-teal-600 transition group-open:rotate-180 dark:text-teal-400" />
      </summary>

      <div className="border-t border-teal-200/60 px-4 py-4 dark:border-teal-900/50">
        <IntelligenceFieldGuidePanel />
      </div>
    </details>
  );
}
