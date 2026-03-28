// src/chat/components/MessageBubble/index.jsx
import React, { useMemo } from 'react';
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
}) {
  const formattedTime = useMemo(() => 
    formatMessageTime(message.created_at || message.localTimestamp),
    [message.created_at, message.localTimestamp]
  );

  const isCritical = message.is_critical;
  const isPending = message.status === 'sending' || message.status === 'failed';
  const showRetry = isMe && message.status === 'failed';

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
      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}>
        <div className={`flex ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-3 max-w-[90%] sm:max-w-[80%]`}>
          {!isMe && (
            <Avatar 
              name={message.sender_name} 
              avatarUrl={message.sender_avatar} 
              size="md"
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </ChatErrorBoundary>
  );
});

export default MessageBubble;