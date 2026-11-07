import React from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';
import WatchlistTemplatePicker from '../WatchlistTemplatePicker';
import { FieldGuideExplainerLink } from '../IntelligenceFieldGuide';
import { formFlexInputSm, formLabelBlock } from './formStyles';

export function AliasesSection({
  knownAliases,
  setKnownAliases,
  addArrayField,
  updateArrayField,
  removeArrayField,
}) {
  return (
    <div className="mt-4">
      <label className={formLabelBlock}>Known Aliases</label>
      {knownAliases.map((alias, index) => (
        <div key={index} className="flex gap-2 mb-2">
          <input
            type="text"
            value={alias}
            onChange={(e) => updateArrayField(setKnownAliases, knownAliases, index, e.target.value)}
            className={formFlexInputSm}
            placeholder={`Alias ${index + 1}`}
          />
          {knownAliases.length > 1 && (
            <button
              type="button"
              onClick={() => removeArrayField(setKnownAliases, knownAliases, index)}
              className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
            >
              <FaTimes />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => addArrayField(setKnownAliases, knownAliases)}
        className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
      >
        <FaPlus size={12} /> Add Alias
      </button>
    </div>
  );
}

export function WatchlistFlagsSection({
  watchlistFlags,
  setWatchlistFlags,
  setFieldGuideTopic,
  addArrayField,
  updateArrayField,
  removeArrayField,
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Watchlist Flags</label>
        <FieldGuideExplainerLink topic="watchlist" onOpen={setFieldGuideTopic}>
          Explain watchlist flags
        </FieldGuideExplainerLink>
      </div>
      <WatchlistTemplatePicker watchlistFlags={watchlistFlags} setWatchlistFlags={setWatchlistFlags} />
      {watchlistFlags.map((flag, index) => (
        <div key={index} className="flex gap-2 mb-2">
          <input
            type="text"
            value={flag}
            onChange={(e) => updateArrayField(setWatchlistFlags, watchlistFlags, index, e.target.value)}
            className={formFlexInputSm}
            placeholder="e.g., Violent, Armed, Flight Risk"
          />
          {watchlistFlags.length > 1 && (
            <button
              type="button"
              onClick={() => removeArrayField(setWatchlistFlags, watchlistFlags, index)}
              className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
            >
              <FaTimes />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => addArrayField(setWatchlistFlags, watchlistFlags)}
        className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
      >
        <FaPlus size={12} /> Add Flag
      </button>
    </div>
  );
}

export function DistinguishingMarksSection({
  distinguishingMarks,
  setDistinguishingMarks,
  addArrayField,
  updateArrayField,
  removeArrayField,
}) {
  return (
    <div className="mt-4">
      <label className={formLabelBlock}>Distinguishing Marks</label>
      {distinguishingMarks.map((mark, index) => (
        <div key={index} className="flex gap-2 mb-2">
          <input
            type="text"
            value={mark}
            onChange={(e) =>
              updateArrayField(setDistinguishingMarks, distinguishingMarks, index, e.target.value)
            }
            className={formFlexInputSm}
            placeholder="Tattoo, scar, birthmark description"
          />
          {distinguishingMarks.length > 1 && (
            <button
              type="button"
              onClick={() => removeArrayField(setDistinguishingMarks, distinguishingMarks, index)}
              className="px-3 py-2 bg-red-100 text-red-600 rounded-md hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-900/60"
            >
              <FaTimes />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => addArrayField(setDistinguishingMarks, distinguishingMarks)}
        className="text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300 flex items-center gap-1"
      >
        <FaPlus size={12} /> Add Mark
      </button>
    </div>
  );
}
