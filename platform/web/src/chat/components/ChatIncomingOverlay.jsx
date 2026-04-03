import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  classifyIncomingUrgency,
  formatShortRelativeTime,
  getSenderInitials,
} from '../utils/inAppUrgency';

const tierStyles = {
  critical: {
    panel: 'border-red-500/55 shadow-[0_0_40px_-8px_rgba(220,38,38,0.45)] ring-1 ring-red-500/25',
    dot: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]',
    badge: 'bg-red-600/90 text-white',
    accent: 'text-red-400',
    primaryBtn: 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600',
  },
  elevated: {
    panel: 'border-amber-500/45 shadow-[0_0_32px_-8px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/20',
    dot: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.7)]',
    badge: 'bg-amber-600/90 text-black',
    accent: 'text-amber-400',
    primaryBtn: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500',
  },
  standard: {
    panel: 'border-cyan-500/25 shadow-xl ring-1 ring-white/10',
    dot: 'bg-orange-500/90',
    badge: 'bg-cyan-900/80 text-cyan-200 border border-cyan-500/40',
    accent: 'text-orange-400',
    primaryBtn: 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500',
  },
};

function HexChatIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 2L20 6V14L12 18L4 14V6L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 10.5C9 9.67 9.67 9 10.5 9H13.5C14.33 9 15 9.67 15 10.5V11.5C15 12.33 14.33 13 13.5 13H11L9 15V10.5Z"
        fill="currentColor"
        fillOpacity="0.85"
      />
    </svg>
  );
}

/**
 * Foreground in-app alert queue (e.g. "2 / 5") when multiple messages arrive while focused.
 */
export function ChatIncomingOverlay({
  currentItem,
  position,
  onDismissCurrent,
  onDismissAll,
  onNavigatePrev,
  onNavigateNext,
  onOpen,
  onQuickReply,
  quickReplyDisabled = false,
}) {
  const [visible, setVisible] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const message = currentItem?.message;
  const receivedAt = currentItem?.receivedAt;
  const itemKey = currentItem?.key;

  useEffect(() => {
    if (!itemKey) return;
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [itemKey]);

  useEffect(() => {
    if (!message) {
      setReplyText('');
      setVisible(false);
      setSending(false);
    }
  }, [message]);

  useEffect(() => {
    setReplyText('');
  }, [itemKey]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismissCurrent();
        return;
      }
      if (position.total <= 1) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNavigatePrev();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNavigateNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, onDismissCurrent, onNavigatePrev, onNavigateNext, position.total]);

  const handleQuickSubmit = useCallback(async () => {
    const t = replyText.trim();
    if (!t || sending || quickReplyDisabled) return;
    setSending(true);
    try {
      await onQuickReply(t);
      setReplyText('');
    } finally {
      setSending(false);
    }
  }, [replyText, sending, quickReplyDisabled, onQuickReply]);

  if (!message || typeof document === 'undefined') return null;

  const { current, total } = position;
  const canNavigate = total > 1;
  const atStart = current <= 1;
  const atEnd = current >= total;

  const { tier, preview, label } = classifyIncomingUrgency(message);
  const styles = tierStyles[tier];
  const senderName = message.sender_name || 'Member';
  const subtitle = message.location_address?.trim() || '';
  const initials = getSenderInitials(senderName);
  const relative = formatShortRelativeTime(receivedAt ?? Date.now());

  const inputId = `in-app-quick-reply-${itemKey}`;

  return createPortal(
    <div
      className={`fixed inset-0 z-[1250] flex items-end justify-center p-3 pb-[max(0.75rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))] transition-opacity duration-200 sm:items-center sm:p-6 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-notify-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Dismiss this notification"
        onClick={onDismissCurrent}
      />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3 sm:items-center sm:p-6">
        <div
          className={`pointer-events-auto relative w-full max-w-md origin-bottom scale-100 rounded-2xl border bg-gray-950/85 px-4 py-4 shadow-2xl backdrop-blur-xl transition-transform duration-200 dark:bg-gray-950/90 sm:rounded-3xl sm:px-5 sm:py-5 ${styles.panel} ${
            visible ? 'translate-y-0' : 'translate-y-3'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`absolute left-1/2 top-2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${styles.dot}`}
            aria-hidden
          />

          {canNavigate && (
            <div className="mb-2 flex items-center justify-center gap-1 pt-1">
              <button
                type="button"
                onClick={onNavigatePrev}
                disabled={atStart}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                aria-label="Previous notification"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="min-w-[4.5rem] text-center font-mono text-[11px] font-semibold tabular-nums text-gray-400">
                {current} / {total}
              </span>
              <button
                type="button"
                onClick={onNavigateNext}
                disabled={atEnd}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                aria-label="Next notification"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          <div className="mb-3 flex items-start gap-3 pt-1">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-orange-400">
              <HexChatIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p
                id="in-app-notify-title"
                className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${styles.accent}`}
              >
                Neighborhood Watch
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                New message · {relative}
              </p>
            </div>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles.badge}`}
            >
              {label}
            </span>
          </div>

          <div className="flex gap-3 border-t border-white/10 pt-3">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                tier === 'critical'
                  ? 'border-red-400/60 bg-red-950/50 text-red-300'
                  : tier === 'elevated'
                    ? 'border-amber-400/50 bg-amber-950/40 text-amber-300'
                    : 'border-orange-400/40 bg-gray-900/80 text-orange-400'
              }`}
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{senderName}</p>
              {subtitle ? (
                <p className="truncate text-xs text-gray-500">{subtitle}</p>
              ) : null}
              <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-gray-200">
                {preview}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor={inputId} className="sr-only">
              Quick reply
            </label>
            <input
              id={inputId}
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleQuickSubmit();
                }
              }}
              placeholder="Quick reply…"
              disabled={quickReplyDisabled || sending}
              className="w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/30 disabled:opacity-50"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDismissCurrent}
              className="flex-1 min-w-[6rem] rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-white/10"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                onOpen();
              }}
              disabled={sending}
              className={`flex-1 min-w-[6rem] rounded-xl px-3 py-2.5 text-sm font-semibold text-white shadow-lg transition disabled:opacity-50 ${styles.primaryBtn}`}
            >
              Open
            </button>
          </div>
          {total > 1 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="mt-2 w-full text-center text-[11px] font-medium text-gray-500 transition hover:text-gray-300"
            >
              Clear all ({total})
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
