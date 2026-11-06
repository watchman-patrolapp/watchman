import { FaTimes } from 'react-icons/fa';
import {
  IntelligenceFieldGuideTopic,
  FIELD_GUIDE_TOPIC_TITLES,
} from '../../components/intelligence/IntelligenceFieldGuide';

export default function ProfileFieldGuideModal({ topic, onClose }) {
  if (topic == null) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-field-guide-modal-title"
        className="grid max-h-[min(90vh,720px)] w-full max-w-lg grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3
            id="profile-field-guide-modal-title"
            className="pr-2 text-lg font-semibold text-gray-900 dark:text-white"
          >
            {FIELD_GUIDE_TOPIC_TITLES[topic]}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <FaTimes className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <IntelligenceFieldGuideTopic topic={topic} />
        </div>
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-700 dark:hover:bg-teal-500"
          >
            Done — continue editing
          </button>
        </div>
      </div>
    </div>
  );
}
