import { Capacitor } from '@capacitor/core';
import { supabase } from '../supabase/client';

let listenersAttached = false;

/**
 * Registers FCM (Android/iOS) and saves the token to user_push_tokens for the
 * notify-chat-message Edge Function. No-op on web until Firebase web push is wired.
 *
 * @param {string} userId
 * @param {{ requestPermission?: boolean }} [options] - If `requestPermission` is false, does not prompt; only registers when already granted.
 */
export async function registerEmergencyChatPush(userId, options = {}) {
  const requestPermission = options.requestPermission !== false;
  if (!userId || !Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      if (!requestPermission) return;
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    if (!listenersAttached) {
      listenersAttached = true;

      await PushNotifications.addListener('registration', async ({ value }) => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid || !value) return;
        const { error } = await supabase.from('user_push_tokens').upsert(
          {
            user_id: uid,
            token: value,
            platform: Capacitor.getPlatform(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,token' }
        );
        if (error) console.warn('user_push_tokens upsert:', error.message);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.warn('Push registration error:', err);
      });
    }

    await PushNotifications.register();
  } catch (e) {
    console.warn('Emergency chat push:', e?.message || e);
  }
}
