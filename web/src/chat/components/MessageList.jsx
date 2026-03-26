// src/chat/components/MessageList.jsx
import React from 'react';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import ChatErrorBoundary from '../../components/ChatErrorBoundary';

export const MessageList = React.memo(function MessageList({
  messages,
  currentUserId,
  containerRef,
  endRef,
  onRetry,
  typingUsers,
}) {
  return (
    <ChatErrorBoundary>
      <div 
        ref={containerRef} 
        className="flex-1 overflow-y-auto p-4 space-y-4"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-8">
            <div className="text-4xl mb-2">💬</div>
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">Start the conversation!</p>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble 
              key={msg.id || msg.localId} 
              message={msg} 
              isMe={msg.sender_id === currentUserId}
              onRetry={onRetry}
            />
          ))
        )}
        <TypingIndicator users={typingUsers} />
        <div ref={endRef} />
      </div>
    </ChatErrorBoundary>
  );
});