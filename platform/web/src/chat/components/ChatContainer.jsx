// src/chat/components/ChatContainer.jsx
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { messageService } from '../services/messageService';
import { useAuth } from '../../auth/useAuth';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useMessageQueue } from '../hooks/useMessageQueue';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { OfflineBanner } from './OfflineBanner';
import toast from '../../utils/notify';
import { markChatVisited } from '../utils/markChatVisited';
import BrandedLoader from '../../components/layout/BrandedLoader';
import { ChatIncomingOverlay } from './ChatIncomingOverlay';
import { useUnreadCount } from '../hooks/useUnreadCount';
import { useActiveOrganization } from '../../auth/useActiveOrganization';
import {
  CHAT_CHANNEL_PATROL,
  CHAT_CHANNEL_RESIDENT,
  canAccessPatrolOpsChat,
} from '../utils/chatChannels';
import { summarizeMessageForReply } from '../utils/chatMessageMerge';
import { chatInputRateLimiter, useChatComposer } from '../hooks/useChatComposer';
import { useChatSession } from '../hooks/useChatSession';
import { useChatIncidentReport } from '../hooks/useChatIncidentReport';
import ChatIncidentReportModal from './ChatIncidentReportModal';

export default function ChatContainer() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const { activeOrganizationId } = useActiveOrganization();
  const { isOnline } = useNetworkStatus();
  const { addToQueue, queueLength } = useMessageQueue(isOnline);
  const isOpsChat = canAccessPatrolOpsChat(user?.role);
  const [chatChannel, setChatChannel] = useState(CHAT_CHANNEL_PATROL);
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [, rateLimitUiTick] = useReducer((n) => n + 1, 0);

  const { count: patrolUnread } = useUnreadCount(
    isOpsChat ? user?.id : null,
    CHAT_CHANNEL_PATROL,
    { pauseIncrements: chatChannel === CHAT_CHANNEL_PATROL }
  );
  const { count: neighbourUnread } = useUnreadCount(
    isOpsChat ? user?.id : null,
    CHAT_CHANNEL_RESIDENT,
    { pauseIncrements: chatChannel === CHAT_CHANNEL_RESIDENT }
  );

  const session = useChatSession({
    user,
    chatChannel,
    setChatChannel,
    activeOrganizationId,
    isOpsChat,
    searchParams,
  });

  const inputRateLimited = chatInputRateLimiter.isRateLimited();

  useEffect(() => {
    if (!inputRateLimited) return undefined;
    const id = window.setInterval(() => rateLimitUiTick(), 1000);
    return () => window.clearInterval(id);
  }, [inputRateLimited]);

  const composer = useChatComposer({
    user,
    isOnline,
    addToQueue,
    scrollToBottom: session.scrollToBottom,
    replyToMessage,
    setReplyToMessage,
    setMessages: session.setMessages,
    setIsEmergencyMode,
    isMountedRef: session.isMountedRef,
    chatChannelRef: session.chatChannelRef,
  });

  const report = useChatIncidentReport(user);

  const handleIncomingOverlayQuickReply = useCallback(
    async (text) => {
      await composer.handleSendText(text);
      if (!session.isMountedRef.current) return;
      session.removeCurrentIncomingItem();
      session.scrollToBottom('smooth', true);
    },
    [composer, session]
  );

  const handleReplyRequest = useCallback(
    (message) => {
      if (!message?.id) return;
      setReplyToMessage({
        id: message.id,
        sender_name: message.sender_name,
        text: message.text,
        type: message.type,
        reply_preview_text: summarizeMessageForReply(message),
      });
    },
    []
  );

  const handleChannelChange = useCallback((next) => {
    if (!next || next === session.chatChannelRef.current) return;
    const list = session.messagesRef.current;
    const last = list?.[list.length - 1];
    const serverId =
      last?.id && typeof last.id === 'string' && !String(last.id).startsWith('msg-')
        ? last.id
        : null;
    void markChatVisited(serverId, session.chatChannelRef.current);
    setReplyToMessage(null);
    setChatChannel(next);
  }, [session.chatChannelRef, session.messagesRef]);

  const handleToggleReaction = useCallback(
    async (messageId, emoji) => {
      if (!user?.id || !messageId || !emoji) return;
      const hasReacted = !!session.reactionState?.[messageId]?.[emoji]?.includes(user.id);
      session.setReactionState((prev) => {
        const next = { ...prev };
        const messageBucket = { ...(next[messageId] || {}) };
        const users = new Set(messageBucket[emoji] || []);
        if (hasReacted) users.delete(user.id);
        else users.add(user.id);
        if (users.size === 0) delete messageBucket[emoji];
        else messageBucket[emoji] = Array.from(users);
        next[messageId] = messageBucket;
        return next;
      });
      try {
        if (hasReacted) {
          await messageService.removeReaction({ messageId, reaction: emoji, userId: user.id });
        } else {
          await messageService.addReaction({ messageId, reaction: emoji, userId: user.id });
        }
      } catch {
        session.setReactionState((prev) => {
          const next = { ...prev };
          const messageBucket = { ...(next[messageId] || {}) };
          const users = new Set(messageBucket[emoji] || []);
          if (hasReacted) users.add(user.id);
          else users.delete(user.id);
          if (users.size === 0) delete messageBucket[emoji];
          else messageBucket[emoji] = Array.from(users);
          next[messageId] = messageBucket;
          return next;
        });
        toast.error('Could not update reaction');
      }
    },
    [session, user]
  );

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <BrandedLoader message="Loading chat…" size="lg" />
      </div>
    );
  }

  const overlayQueue = session.incomingOverlay.queue;
  const overlayIdx = overlayQueue.length
    ? Math.min(session.incomingOverlay.index, overlayQueue.length - 1)
    : 0;
  const overlayCurrent = overlayQueue.length ? overlayQueue[overlayIdx] : null;

  return (
    <div
      className="min-h-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] max-md:flex max-md:min-h-0 max-md:flex-col max-md:overflow-hidden max-md:h-[calc(100dvh-4rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] max-[639px]:overflow-x-hidden sm:px-4 sm:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] md:h-auto md:min-h-screen md:min-h-[100dvh] md:overflow-visible md:pb-6 md:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] lg:px-8"
    >
      <div className="max-w-4xl mx-auto flex min-h-0 w-full flex-1 flex-col h-chat-shell">
        <ChatHeader
          isOnline={isOnline}
          messageCount={session.messages.length}
          isEmergencyMode={isEmergencyMode}
          channel={chatChannel}
          canSwitchChannels={isOpsChat}
          patrolUnread={patrolUnread}
          neighbourUnread={neighbourUnread}
          onChannelChange={handleChannelChange}
        />

        <OfflineBanner
          isOnline={isOnline}
          pendingCount={queueLength}
        />

        <div className={`flex-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl shadow-lg border overflow-hidden flex flex-col min-h-0 transition-all ${
          isEmergencyMode
            ? 'border-red-500 shadow-red-500/20'
            : chatChannel === CHAT_CHANNEL_RESIDENT
              ? 'border-teal-300 shadow-teal-500/10 dark:border-teal-700/70'
              : 'border-amber-300 shadow-amber-500/10 dark:border-amber-700/70'
        }`}>
          <div
            className={`h-1 w-full shrink-0 ${
              isEmergencyMode
                ? 'bg-red-500'
                : chatChannel === CHAT_CHANNEL_RESIDENT
                  ? 'bg-gradient-to-r from-teal-500 to-teal-600'
                  : 'bg-gradient-to-r from-amber-400 to-amber-600'
            }`}
            aria-hidden
          />
          <MessageList
            messages={session.messages}
            currentUserId={user?.id}
            containerRef={session.containerRef}
            endRef={session.endRef}
            typingUsers={session.typingUsers}
            onCriticalMessageVisible={session.handleCriticalMessageVisible}
            reactionsByMessage={session.reactionState}
            onToggleReaction={handleToggleReaction}
            onReplyRequest={handleReplyRequest}
            onCompileReport={report.handleCompileReport}
          />

          <MessageInput
            onSendText={composer.handleSendText}
            onSendImage={composer.handleSendImage}
            onSendVoice={composer.handleSendVoice}
            onSendLocation={composer.handleSendLocation}
            onQuickTemplateSend={composer.handleQuickSend}
            isOnline={isOnline}
            disabled={inputRateLimited}
            isEmergencyMode={isEmergencyMode}
            soundEnabled={session.soundEnabled}
            onToggleSound={session.toggleSound}
            notificationsEnabled={session.notificationsEnabled}
            onToggleNotifications={session.toggleNotifications}
            getLocationForTemplates={composer.getLocation}
            onComposerTyping={session.onComposerTyping}
            replyToMessage={replyToMessage}
            onClearReply={() => setReplyToMessage(null)}
            composerPlaceholder={
              !isOnline
                ? 'Offline…'
                : chatChannel === CHAT_CHANNEL_RESIDENT
                  ? 'Message neighbours…'
                  : 'Message the watch…'
            }
          />
        </div>
      </div>
      {overlayQueue.length > 0 && overlayCurrent && (
        <ChatIncomingOverlay
          currentItem={overlayCurrent}
          position={{ current: overlayIdx + 1, total: overlayQueue.length }}
          onDismissCurrent={session.removeCurrentIncomingItem}
          onDismissAll={session.dismissAllIncoming}
          onNavigatePrev={session.goPrevIncoming}
          onNavigateNext={session.goNextIncoming}
          onOpen={session.handleIncomingOverlayOpen}
          onQuickReply={handleIncomingOverlayQuickReply}
          quickReplyDisabled={inputRateLimited}
        />
      )}
      <ChatIncidentReportModal
        draft={report.reportDraft}
        onChange={report.setReportDraft}
        onClose={() => report.setReportDraft(null)}
        onSave={report.handleSaveCompiledReport}
      />
    </div>
  );
}
