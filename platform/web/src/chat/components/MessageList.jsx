// src/chat/components/MessageList.jsx
import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import ChatErrorBoundary from '../../components/ChatErrorBoundary';
import { APP_CONFIG } from '../utils/constants';

export const MessageList = React.memo(function MessageList({
  messages,
  currentUserId,
  containerRef,
  endRef,
  onRetry,
  typingUsers = [],
  onCriticalMessageVisible,
  reactionsByMessage = {},
  onToggleReaction,
  onReplyRequest,
  onCompileReport,
}) {
  const useVirtual = messages.length >= APP_CONFIG.CHAT_VIRTUALIZATION_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 100,
    overscan: 10,
  });

  return (
    <ChatErrorBoundary>
      <div
        ref={containerRef}
        className="relative z-0 isolate flex-1 overflow-y-auto p-4 space-y-0"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="space-y-4 py-8 text-center text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-2">💬</div>
            <p className="font-medium">No messages yet</p>
            <p className="text-sm mt-1">Start the conversation!</p>
          </div>
        ) : useVirtual ? (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              return (
                <div
                  key={msg.id || msg.localId || virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-4"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MessageBubble
                    message={msg}
                    isMe={msg.sender_id === currentUserId}
                    onRetry={onRetry}
                    onCriticalMessageVisible={onCriticalMessageVisible}
                    reactions={reactionsByMessage[msg.id] || {}}
                    currentUserId={currentUserId}
                    onToggleReaction={onToggleReaction}
                    onReplyRequest={onReplyRequest}
                    onCompileReport={onCompileReport}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id || msg.localId}
                message={msg}
                isMe={msg.sender_id === currentUserId}
                onRetry={onRetry}
                onCriticalMessageVisible={onCriticalMessageVisible}
                reactions={reactionsByMessage[msg.id] || {}}
                currentUserId={currentUserId}
                onToggleReaction={onToggleReaction}
                onReplyRequest={onReplyRequest}
                onCompileReport={onCompileReport}
              />
            ))}
          </div>
        )}
        <TypingIndicator users={typingUsers} />
        <div ref={endRef} className="h-1 shrink-0" aria-hidden="true" />
      </div>
    </ChatErrorBoundary>
  );
});
