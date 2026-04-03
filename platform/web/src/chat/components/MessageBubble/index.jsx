// src/chat/components/MessageBubble/index.jsx
import React, { useMemo, useRef, useEffect, useState } from 'react';
import { supabase } from '../../../supabase/client';
import { FaChevronLeft, FaChevronRight, FaReply, FaFileAlt } from 'react-icons/fa';
import { Avatar } from '../common/Avatar';
import { VoicePlayer } from '../voice/VoicePlayer';
import { LocationMessage } from './LocationMessage';
import { TextMessage } from './TextMessage';
import { ImageMessage } from './ImageMessage';
import { MessageStatus } from './MessageStatus';
import { MessageType } from '../../utils/constants';
import { formatMessageTime } from '../../utils/formatters';
import ChatErrorBoundary from '../../../components/ChatErrorBoundary';

export const MessageBubble = React.memo(function MessageBubble({
  message,
  isMe,
  onRetry,
  onCriticalMessageVisible,
  reactions = {},
  currentUserId,
  onToggleReaction,
  onReplyRequest,
  onCompileReport,
}) {
  const rootRef = useRef(null);
  const criticalSeenRef = useRef(false);
  const [criticalReadCount, setCriticalReadCount] = useState(null);
  const [showMoreEmojis, setShowMoreEmojis] = useState(false);

  const formattedTime = useMemo(() => 
    formatMessageTime(message.created_at || message.localTimestamp),
    [message.created_at, message.localTimestamp]
  );

  const isCritical = message.is_critical;

  useEffect(() => {
    const id = message.id;
    if (!id || isMe || !isCritical || !onCriticalMessageVisible || criticalSeenRef.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.2) {
          criticalSeenRef.current = true;
          onCriticalMessageVisible(id);
          obs.disconnect();
        }
      },
      { threshold: [0.2, 0.4] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [message.id, isCritical, isMe, onCriticalMessageVisible]);

  useEffect(() => {
    if (!isMe || !isCritical || !message.id) {
      setCriticalReadCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count, error } = await supabase
        .from('chat_message_reads')
        .select('*', { count: 'exact', head: true })
        .eq('message_id', message.id);
      if (!cancelled && !error) setCriticalReadCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [message.id, isMe, isCritical]);
  const isPending = message.status === 'sending' || message.status === 'failed';
  const showRetry = isMe && message.status === 'failed';
  const defaultReaction = '👍';
  const moreEmojis = ['✅', '🛡️', '🔍', '📹', '🎯', '🔥', '🚓', '❤️', '😂', '😮', '😢', '🙏', '👏', '👌', '🤝', '😡', '😬', '👀', '💯'];
  const canReact = !!message.id && typeof onToggleReaction === 'function';

  const renderContent = () => {
    switch (message.type) {
      case MessageType.IMAGE:
        return <ImageMessage url={message.media_url} alt={message.text} />;
      
      case MessageType.VOICE:
        return (
          <VoicePlayer 
            src={message.media_url || message.url}  // Use media_url first (from DB), fallback to url
            blob={message.blob}
            duration={message.duration || 0} 
            status={message.status}
          />
        );
      
      case MessageType.LOCATION:
        return (
          <LocationMessage 
            text={message.text}
            lat={message.location_lat} 
            lng={message.location_lng} 
            address={message.location_address}
            isEmergency={message.is_emergency || message.is_critical}
          />
        );
      
      default:
        return <TextMessage text={message.text} isCritical={isCritical && !isMe} />;
    }
  };

  return (
    <ChatErrorBoundary>
      <div ref={rootRef} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}>
        <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-3 max-w-[90%] sm:max-w-[80%]`}>
          {!isMe && (
            <Avatar
              name={message.sender_name}
              avatarUrl={message.sender_avatar}
              size="md"
              variant="chat"
            />
          )}
        
          <div className="flex flex-col">
            {!isMe && (
              <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 ml-1">
                {message.sender_name}
              </span>
            )}
          
            <div className={`px-4 py-3 rounded-2xl shadow-sm relative ${
              isMe
                ? 'bg-teal-600 text-white rounded-br-md'
                : isCritical
                ? 'bg-red-50 text-red-800 border-2 border-red-200 dark:bg-red-900/30 dark:border-red-700 dark:text-red-200 rounded-bl-md'
                : 'bg-white text-gray-900 border border-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 rounded-bl-md'
            } ${isPending ? 'opacity-75' : ''}`}>
              {renderContent()}
              {message.reply_preview_text && (
                <div className={`mt-2 rounded-md border px-2 py-1 text-xs ${
                  isMe
                    ? 'border-teal-300/60 bg-teal-500/20 text-teal-50'
                    : 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                }`}>
                  Reply: {message.reply_preview_text}
                </div>
              )}
            
              <div className={`flex items-center gap-2 mt-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                <time 
                  className={`text-xs ${isMe ? 'text-teal-200' : 'text-gray-500 dark:text-gray-300'}`}
                  aria-label={`Sent at ${formattedTime}`}
                >
                  {formattedTime}
                </time>
              
                {isMe && (
                  <MessageStatus 
                    status={message.status} 
                    retryCount={message.retryCount}
                    onRetry={showRetry ? () => onRetry(message) : undefined}
                  />
                )}
                {isMe && isCritical && message.id && criticalReadCount != null && criticalReadCount > 0 && (
                  <span className="text-[10px] opacity-80" title="Other members opened this critical message">
                    Seen · {criticalReadCount}
                  </span>
                )}
              </div>
            </div>
            {message.id && (
              <div className={`mt-1 flex items-center gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                <button
                  type="button"
                  onClick={() => onReplyRequest?.(message)}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white/90 px-2 py-0.5 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  title="Reply to this message"
                >
                  <FaReply className="h-3 w-3" />
                  Reply
                </button>
                <button
                  type="button"
                  onClick={() => onCompileReport?.(message)}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white/90 px-2 py-0.5 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  title="Compile report from this message"
                >
                  <FaFileAlt className="h-3 w-3" />
                  Compile report
                </button>
              </div>
            )}
            {canReact && (
              <div className={`mt-1 flex flex-wrap items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                {[defaultReaction].map((emoji) => {
                  const users = reactions[emoji] || [];
                  const count = users.length;
                  const mine = users.includes(currentUserId);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onToggleReaction(message.id, emoji)}
                      className={`text-xs rounded-full border px-2 py-0.5 transition ${
                        mine
                          ? 'bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/50 dark:border-teal-600 dark:text-teal-200'
                          : 'bg-white/80 border-gray-200 text-gray-700 hover:border-teal-300 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200'
                      }`}
                      title={`React with ${emoji}`}
                    >
                      {emoji} {count > 0 ? count : ''}
                    </button>
                  );
                })}
                {showMoreEmojis &&
                  moreEmojis.map((emoji) => {
                    const users = reactions[emoji] || [];
                    const mine = users.includes(currentUserId);
                    return (
                      <button
                        key={`more-inline-${emoji}`}
                        type="button"
                        onClick={() => {
                          onToggleReaction(message.id, emoji);
                          setShowMoreEmojis(false);
                        }}
                        className={`text-xs rounded-full border px-2 py-0.5 transition ${
                          mine
                            ? 'bg-teal-100 border-teal-300 text-teal-800 dark:bg-teal-900/50 dark:border-teal-600 dark:text-teal-200'
                            : 'bg-white/80 border-gray-200 text-gray-700 hover:border-teal-300 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200'
                        }`}
                        title={`React with ${emoji}`}
                      >
                        {emoji} {users.length > 0 ? users.length : ''}
                      </button>
                    );
                  })}
                <button
                  type="button"
                  onClick={() => setShowMoreEmojis((v) => !v)}
                  className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  title="More emojis"
                >
                  {showMoreEmojis ? <FaChevronLeft className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ChatErrorBoundary>
  );
});

export default MessageBubble;