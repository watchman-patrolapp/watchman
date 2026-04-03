// src/chat/components/common/Avatar.jsx
import React, { useState, useCallback } from 'react';
import { getInitials } from '../../utils/formatters';

/** Chat variant: five-stop ring — teal → amber → emerald → orange → yellow. */
const CHAT_RING =
  'rounded-full p-[2.5px] shadow-md ring-1 ring-black/[0.12] dark:ring-white/15 ' +
  'bg-[linear-gradient(145deg,#0f766e_0%,#fbbf24_25%,#10b981_50%,#f97316_75%,#fde047_100%)] ' +
  'shadow-[0_1px_10px_rgba(15,118,110,0.22)] dark:shadow-[0_0_18px_-4px_rgba(16,185,129,0.35)]';

export const Avatar = React.memo(function Avatar({
  name,
  avatarUrl,
  size = 'md',
  isOnline = false,
  variant = 'default',
}) {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => setHasError(true), []);

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  const sizeClass = sizeClasses[size] || sizeClasses.md;
  const isChat = variant === 'chat';

  const imgBorderClass = isChat
    ? 'border-0 shadow-none'
    : 'border-2 border-white dark:border-gray-800 shadow-sm';

  const onlineDotBorder = isChat
    ? 'border-2 border-white dark:border-gray-950'
    : 'border-2 border-white dark:border-gray-800';

  const inner = (
    <div
      className={`relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full ${sizeClass}`}
    >
      {avatarUrl && !hasError && (
        <img
          src={avatarUrl}
          alt={`${name}'s avatar`}
          className={`${sizeClass} block rounded-full object-cover ${imgBorderClass}`}
          onError={handleError}
          loading="lazy"
          decoding="async"
        />
      )}

      {(hasError || !avatarUrl) && (
        <div
          className={`${sizeClass} flex items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-purple-600 font-bold text-white`}
        >
          {getInitials(name)}
        </div>
      )}

      {isOnline && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 bg-green-500 ${onlineDotBorder}`}
        />
      )}
    </div>
  );

  if (isChat) {
    return <div className={`inline-flex shrink-0 ${CHAT_RING}`}>{inner}</div>;
  }

  return inner;
});