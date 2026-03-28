import React, { useState } from 'react';
import { FaCamera, FaTimes, FaMapMarkerAlt } from 'react-icons/fa';

export default function EvidenceEntry({ 
  entry, 
  index, 
  onUpdate, 
  onRemove, 
  onFileSelect, 
  canRemove 
}) {
  const [previews, setPreviews] = useState([]);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 3) {
      alert('Maximum 3 images allowed per entry');
      return;
    }
    
    // Create previews
    const newPreviews = selectedFiles.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
    onFileSelect(entry.id, selectedFiles);
  };

  const removeFile = (fileIndex) => {
    const newFiles = entry.files.filter((_, i) => i !== fileIndex);
    setPreviews(prev => prev.filter((_, i) => i !== fileIndex));
    onUpdate(entry.id, 'files', newFiles);
  };

  const updateMetadata = (field, value) => {
    const newMetadata = { ...entry.metadata, [field]: value };
    onUpdate(entry.id, 'metadata', newMetadata);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-600 shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Entry #{index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Description / Context <span className="text-red-500">*</span>
        </label>
        <textarea
          value={entry.description}
          onChange={(e) => onUpdate(entry.id, 'description', e.target.value)}
          placeholder="Describe what this shows, when it was taken, and its relevance..."
          required={entry.files.length > 0}
          rows={2}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition resize-y"
        />
      </div>

      {/* Category-specific fields */}
      {entry.category === 'suspects' && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            placeholder="Approx. age"
            value={entry.metadata?.age || ''}
            onChange={(e) => updateMetadata('age', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Clothing description"
            value={entry.metadata?.clothing || ''}
            onChange={(e) => updateMetadata('clothing', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Direction of travel"
            value={entry.metadata?.direction || ''}
            onChange={(e) => updateMetadata('direction', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Time observed (e.g., 02:15 AM)"
            value={entry.metadata?.timeObserved || ''}
            onChange={(e) => updateMetadata('timeObserved', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
        </div>
      )}

      {entry.category === 'vehicles' && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text"
            placeholder="License plate"
            value={entry.metadata?.licensePlate || ''}
            onChange={(e) => updateMetadata('licensePlate', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Make / Model / Color"
            value={entry.metadata?.vehicleDetails || ''}
            onChange={(e) => updateMetadata('vehicleDetails', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
          />
          <input
            type="text"
            placeholder="Direction of travel"
            value={entry.metadata?.direction || ''}
            onChange={(e) => updateMetadata('direction', e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 col-span-2"
          />
        </div>
      )}

      {entry.category === 'contextual_intel' && (
        <div className="mb-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={entry.metadata?.potentiallyRelated || false}
              onChange={(e) => updateMetadata('potentiallyRelated', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500"
            />
            <span>Potentially related to this incident (uncertain connection)</span>
          </label>
          <div className="relative">
            <FaMapMarkerAlt className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Location observed (if different from incident)"
              value={entry.metadata?.location || ''}
              onChange={(e) => updateMetadata('location', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-10 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>
      )}

      {/* File Upload Zone */}
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 hover:border-teal-500 dark:hover:border-teal-400 transition">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
          id={`file-${entry.id}`}
        />
        <label 
          htmlFor={`file-${entry.id}`}
          className="flex flex-col items-center cursor-pointer"
        >
          <FaCamera className="w-8 h-8 text-gray-400 mb-2" />
          <span className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {entry.files?.length > 0 
              ? `${entry.files.length} image(s) selected (max 3)` 
              : 'Drop images here or click to upload (max 3)'
            }
          </span>
        </label>

        {/* Image Previews */}
        {previews.length > 0 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {previews.map((url, i) => (
              <div key={i} className="relative group">
                <img 
                  src={url} 
                  alt={`Preview ${i + 1}`}
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-600"
                />
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition shadow-sm"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
