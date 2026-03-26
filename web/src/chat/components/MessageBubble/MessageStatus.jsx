import React from 'react';
import { FaSpinner, FaCheck, FaExclamationTriangle, FaClock } from 'react-icons/fa';

const icons = {
  sending: <FaSpinner className="w-3 h-3 animate-spin text-gray-400" />,
  sent: <FaCheck className="w-3 h-3 text-gray-400" />,
  delivered: <FaCheck className="w-3 h-3 text-blue-500" />,
  read: <FaCheck className="w-3 h-3 text-green-500" />,
  failed: <FaExclamationTriangle className="w-3 h-3 text-red-500" />,
  queued: <FaClock className="w-3 h-3 text-amber-500" />,
  priority_queued: <FaClock className="w-3 h-3 text-red-500 animate-pulse" />,
};

export const MessageStatus = React.memo(function MessageStatus({ status, retryCount, onRetry }) {
  const icon = icons[status] || icons.sending;
  const showRetry = status === 'failed' && onRetry;

  return (
    <span className="flex items-center gap-1" title={`${status}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`}>
      {icon}
      {showRetry && (
        <button onClick={onRetry} className="text-xs underline hover:text-white ml-1">
          Retry
        </button>
      )}
    </span>
  );
});

export default MessageStatus;