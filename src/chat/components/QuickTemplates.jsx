// src/chat/components/QuickTemplates.jsx
import React, { useState, useCallback, useMemo } from 'react';
import { FaTimes, FaBolt, FaExclamationTriangle, FaEye, FaCheck, FaClipboard } from 'react-icons/fa';
import { QUICK_TEMPLATES, CATEGORY_COLORS, EmergencyLevel } from '../utils/constants';
import { playPanicSiren } from '../../utils/sound';
import toast from 'react-hot-toast';

const categoryIcons = {
  emergency: FaExclamationTriangle,
  suspicious: FaEye,
  status: FaCheck,
  report: FaClipboard,
};

// Fixed category order for tabs
const CATEGORY_ORDER = ['emergency', 'suspicious', 'status', 'report'];

export const QuickTemplates = React.memo(function QuickTemplates({
  onSelect,
  onClose,
  isOnline,
  getLocation,
}) {
  const [activeCategory, setActiveCategory] = useState('emergency');
  const [sendingId, setSendingId] = useState(null);

  // Group templates by category
  const groupedTemplates = useMemo(() => {
    return QUICK_TEMPLATES.reduce((acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = [];
      }
      acc[template.category].push(template);
      return acc;
    }, {});
  }, []);

  const handleTemplateClick = useCallback(
    async (template) => {
      if (sendingId) return;
      setSendingId(template.id);

      try {
        if (template.sound === 'emergency') {
          playPanicSiren();
        }

        const messageData = {
          text: template.text,
          isCritical: template.level === EmergencyLevel.CRITICAL || template.level === EmergencyLevel.HIGH,
          priority: template.level,
          category: template.category,
        };

        if (template.requireLocation) {
          try {
            const location = await getLocation();
            messageData.location = location;
          } catch (err) {
            console.warn('Location not available:', err);
            if (template.category === 'emergency' && template.requireLocation) {
              toast.error('Location required for this emergency message.');
              return;
            }
          }
        }

        // ALL templates send instantly
        await onSelect(messageData, { instant: true });
      } catch (err) {
        console.error('Failed to send quick template:', err);
        toast.error('Failed to send message');
      } finally {
        setTimeout(() => setSendingId(null), 600);
      }
    },
    [onSelect, getLocation, sendingId]
  );

  const activeTemplates = groupedTemplates[activeCategory] || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 mb-2">
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b dark:border-gray-700">
        <h3 className="text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
          <FaBolt className="w-3.5 h-3.5 text-yellow-500" />
          Quick Messages
          {sendingId && <span className="text-[10px] text-gray-400">(sending...)</span>}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition p-1"
          aria-label="Close quick messages"
        >
          <FaTimes className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 🔑 Horizontal category tabs - Scrollable on mobile with hidden scrollbar */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
        {CATEGORY_ORDER.map((cat) => {
          const colors = CATEGORY_COLORS[cat];
          const Icon = categoryIcons[cat];
          const count = groupedTemplates[cat]?.length || 0;
          const isActive = activeCategory === cat;

          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded-full transition whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 ${
                isActive
                  ? `${colors.bg} ${colors.text} ${colors.darkBg} ${colors.darkText} border ${colors.border}`
                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
              aria-label={`Show ${cat} templates`}
            >
              {Icon && <Icon className="w-3 h-3" />}
              <span className="capitalize">{cat}</span>
              <span className="text-[9px] opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Vertical list of templates for active category */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {activeTemplates.map((template) => {
          const isSending = sendingId === template.id;
          const isAutoSend = template.autoSend;
          const isCritical = template.level === EmergencyLevel.CRITICAL;

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => handleTemplateClick(template)}
              disabled={isSending || !isOnline}
              className={`w-full text-left text-[11px] p-2 rounded-lg transition-all duration-150 border relative overflow-hidden flex items-center gap-2 ${
                isAutoSend
                  ? `bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200 font-medium shadow-sm`
                  : `bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500`
              } ${isSending ? 'animate-pulse opacity-90' : 'hover:shadow'} ${isCritical ? 'ring-1 ring-red-400/50' : ''}`}
              aria-label={`Send: ${template.text}`}
            >
              {/* Bolt icon for auto‑send templates */}
              {isAutoSend && (
                <FaBolt
                  className={`w-3 h-3 flex-shrink-0 ${isCritical ? 'text-red-600 animate-pulse' : 'text-amber-500'}`}
                  aria-hidden="true"
                />
              )}
              
              {/* Template text */}
              <span className="flex-1 leading-tight truncate">{template.text}</span>
              
              {/* Location badge */}
              {template.requireLocation && (
                <span className="text-[9px] opacity-70 bg-white/60 dark:bg-black/30 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                  +LOC
                </span>
              )}

              {/* Sending overlay animation */}
              {isSending && (
                <div className="absolute inset-0 bg-white/80 dark:bg-gray-800/80 flex items-center justify-center rounded-lg">
                  <div className="flex gap-0.5">
                    <span className="w-1 h-1 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-yellow-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </button>
          );
        })}
        {activeTemplates.length === 0 && (
          <div className="text-center py-3 text-gray-400 text-[10px]">
            No templates in this category.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 flex justify-between items-center">
        <span>⚡ All send instantly</span>
        <span className="tabular-nums">{QUICK_TEMPLATES.length} templates</span>
      </div>
    </div>
  );
});