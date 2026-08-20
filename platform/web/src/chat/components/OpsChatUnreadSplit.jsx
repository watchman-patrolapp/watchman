import React from 'react';
import { FaShieldAlt, FaUserFriends } from 'react-icons/fa';

function formatCount(n) {
  if (!n || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/**
 * Intentional dual unread for ops: Patrol ops (amber) vs Neighbours (teal).
 * Never merges counts — each room stays visually distinct.
 */
export function OpsChatUnreadSplit({
  patrolUnread = 0,
  neighbourUnread = 0,
  size = 'md',
  layout = 'row',
  showZero = false,
  className = '',
  onPatrolClick,
  onNeighbourClick,
}) {
  const ops = formatCount(patrolUnread);
  const neighbours = formatCount(neighbourUnread);
  if (!showZero && !ops && !neighbours) return null;

  const compact = size === 'sm';
  const stack = layout === 'stack';

  const pillBase = compact
    ? 'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide'
    : 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none tracking-wide';

  const interactiveOps = typeof onPatrolClick === 'function';
  const interactiveNb = typeof onNeighbourClick === 'function';
  const OpsTag = interactiveOps ? 'button' : 'span';
  const NbTag = interactiveNb ? 'button' : 'span';

  return (
    <div
      className={`${stack ? 'flex flex-col items-end gap-0.5' : 'inline-flex items-center gap-1.5'} ${className}`}
      role="group"
      aria-label={[
        ops ? `${ops} unread in Patrol ops` : null,
        neighbours ? `${neighbours} unread in Neighbours` : null,
      ]
        .filter(Boolean)
        .join(', ') || 'No unread chat'}
    >
      {(showZero || ops) && (
        <OpsTag
          {...(interactiveOps
            ? {
                type: 'button',
                onClick: (e) => {
                  e.stopPropagation();
                  onPatrolClick();
                },
              }
            : {})}
          className={`${pillBase} bg-amber-500/95 text-white shadow-sm shadow-amber-900/20 ring-1 ring-amber-300/40 dark:bg-amber-500 dark:ring-amber-400/30 ${
            interactiveOps
              ? 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white'
              : ''
          }`}
          title="Unread in Patrol ops"
          aria-label={ops ? `${ops} unread in Patrol ops` : 'Patrol ops'}
        >
          <FaShieldAlt className={compact ? 'h-2 w-2' : 'h-2.5 w-2.5'} aria-hidden />
          <span>{ops || '0'}</span>
          {!compact ? <span className="font-medium opacity-90">Ops</span> : null}
        </OpsTag>
      )}
      {(showZero || neighbours) && (
        <NbTag
          {...(interactiveNb
            ? {
                type: 'button',
                onClick: (e) => {
                  e.stopPropagation();
                  onNeighbourClick();
                },
              }
            : {})}
          className={`${pillBase} bg-teal-600/95 text-white shadow-sm shadow-teal-900/20 ring-1 ring-teal-300/40 dark:bg-teal-600 dark:ring-teal-400/30 ${
            interactiveNb
              ? 'cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white'
              : ''
          }`}
          title="Unread in Neighbours"
          aria-label={neighbours ? `${neighbours} unread in Neighbours` : 'Neighbours'}
        >
          <FaUserFriends className={compact ? 'h-2 w-2' : 'h-2.5 w-2.5'} aria-hidden />
          <span>{neighbours || '0'}</span>
          {!compact ? <span className="font-medium opacity-90">Neighbours</span> : null}
        </NbTag>
      )}
    </div>
  );
}

export default OpsChatUnreadSplit;
