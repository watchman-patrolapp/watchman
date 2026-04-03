// src/chat/components/TypingIndicator.jsx
import React from 'react';

export const TypingIndicator = React.memo(function TypingIndicator({ users = [] }) {
  if (!users?.length) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 italic px-4 py-2">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span>
        {users.map(u => u.user_name).join(', ')} {users.length === 1 ? 'is' : 'are'} typing...
      </span>
    </div>
  );
});