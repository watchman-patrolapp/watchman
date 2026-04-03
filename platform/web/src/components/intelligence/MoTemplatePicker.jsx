import React from 'react';
import { FaChevronDown, FaPlus } from 'react-icons/fa';
import { MO_TEMPLATE_GROUPS } from '../../data/intelligenceTaxonomy';

function mergeMethods(prevMethods, incoming) {
  const existing = prevMethods.map((m) => m.trim()).filter(Boolean);
  const add = incoming.map((m) => m.trim()).filter(Boolean);
  const set = new Set([...existing, ...add]);
  const merged = Array.from(set);
  return merged.length ? [...merged, ''] : [''];
}

function applyMoTemplate(prev, template) {
  const methods = mergeMethods(prev.methods, template.methods || []);
  let patterns = (prev.patterns || '').trim();
  const p = (template.pattern || '').trim();
  if (p) {
    patterns = patterns ? `${patterns}; ${p}` : p;
  }
  let notes = (prev.notes || '').trim();
  const n = (template.note || '').trim();
  if (n) {
    notes = notes ? `${notes}\n${n}` : n;
  }
  return { ...prev, methods, patterns, notes };
}

/**
 * Expandable MO starter templates — appends to methods / patterns / notes (does not replace).
 */
export default function MoTemplatePicker({ moSignature, setMoSignature }) {
  return (
    <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/30">
      <p className="mb-2 text-xs font-medium text-gray-800 dark:text-gray-200">MO starter templates</p>
      <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
        Opens by category. Each option <strong>adds</strong> to your fields (deduplicated methods). Refine text
        afterwards.
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {MO_TEMPLATE_GROUPS.map((group) => (
          <details
            key={group.id}
            className="group rounded-xl border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700/50"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-gray-800 dark:text-gray-200 [&::-webkit-details-marker]:hidden">
              {group.title}
              <FaChevronDown className="h-3 w-3 shrink-0 text-gray-500 transition group-open:rotate-180 dark:text-gray-400" />
            </summary>
            <ul className="space-y-1 border-t border-gray-100 px-2 py-2 dark:border-gray-600">
              {group.templates.map((tpl) => (
                <li key={tpl.label}>
                  <button
                    type="button"
                    onClick={() => setMoSignature((prev) => applyMoTemplate(prev, tpl))}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600/50"
                  >
                    <FaPlus className="mt-0.5 h-3 w-3 shrink-0 text-teal-600 dark:text-teal-400" />
                    <span>{tpl.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
