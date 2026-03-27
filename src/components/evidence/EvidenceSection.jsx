import React from 'react';
import { FaPlus, FaCamera, FaUserSecret, FaCar, FaTools, FaFileAlt, FaEye, FaTimes } from 'react-icons/fa';
import EvidenceEntry from './EvidenceEntry';

const iconMap = {
  scene_photos: FaCamera,
  suspects: FaUserSecret,
  vehicles: FaCar,
  physical_evidence: FaTools,
  documentation: FaFileAlt,
  contextual_intel: FaEye
};

export default function EvidenceSection({ 
  category, 
  entries, 
  onAddEntry, 
  onUpdateEntry, 
  onRemoveEntry, 
  onFileSelect 
}) {
  const Icon = iconMap[category.id] || FaCamera;

  return (
    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 mb-4 border border-gray-200 dark:border-gray-600">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">{category.label}</h3>
        </div>
        {category.allowMultipleEntries && (
          <button
            type="button"
            onClick={onAddEntry}
            className="text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium flex items-center gap-1"
          >
            <FaPlus className="w-3 h-3" />
            Add Another
          </button>
        )}
      </div>
      
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{category.description}</p>
      
      <div className="space-y-3">
        {entries.map((entry, index) => (
          <EvidenceEntry
            key={entry.id}
            entry={entry}
            index={index}
            onUpdate={onUpdateEntry}
            onRemove={onRemoveEntry}
            onFileSelect={onFileSelect}
            canRemove={category.allowMultipleEntries && entries.length > 0}
          />
        ))}
      </div>
      
      {!category.allowMultipleEntries && entries.length === 0 && (
        <button
          type="button"
          onClick={onAddEntry}
          className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:border-indigo-500 hover:text-indigo-600 dark:hover:border-indigo-400 dark:hover:text-indigo-400 transition flex items-center justify-center gap-2"
        >
          <Icon className="w-4 h-4" />
          Add {category.label}
        </button>
      )}
    </div>
  );
}
