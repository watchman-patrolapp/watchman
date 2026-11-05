import { lazy, Suspense } from 'react';
import BrandedLoader from '../components/layout/BrandedLoader';

const ChatContainer = lazy(() => import('../chat/components/ChatContainer'));

/**
 * Patrol chat. The container (and its map picker) load on this route, not with the app shell.
 */
export default function EmergencyChatNew() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <BrandedLoader message="Loading chat…" size="lg" />
        </div>
      }
    >
      <ChatContainer />
    </Suspense>
  );
}