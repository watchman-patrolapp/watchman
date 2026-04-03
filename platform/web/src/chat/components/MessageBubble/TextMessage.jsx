import React from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { sanitizeInput } from '../../utils/security';

export const TextMessage = React.memo(function TextMessage({ text, isCritical }) {
  const sanitized = sanitizeInput(text);
  
  return (
    <div className="relative">
      {isCritical && (
        <div className="flex items-center gap-1 mb-1 text-red-600 dark:text-red-300 text-xs font-bold uppercase tracking-wider">
          <FaExclamationTriangle className="w-3 h-3 animate-pulse" />
          Emergency Alert
        </div>
      )}
      <p className="break-words text-sm leading-relaxed whitespace-pre-wrap text-current">
        {sanitized}
      </p>
    </div>
  );
});

export default TextMessage;