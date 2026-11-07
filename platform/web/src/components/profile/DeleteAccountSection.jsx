import { useEffect, useState } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import toast from '../../utils/notify';
import { formatAuthErrorMessage } from '../../utils/authErrorMessage';

export default function DeleteAccountSection({ user, signOut, navigate }) {
  const privacyContactEmail = (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL || '').trim();
  const [authIdentities, setAuthIdentities] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteAccountAck, setDeleteAccountAck] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setAuthIdentities(null);
      return;
    }
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setAuthIdentities(data.user?.identities ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const canDeleteWithPassword =
    Array.isArray(authIdentities) && authIdentities.some((i) => i.provider === 'email');

  const handleDeleteMyAccount = async () => {
    if (deleteBusy) return;
    const email = user?.email?.trim();
    if (!email) {
      toast.error('No email on this account.');
      return;
    }
    if (!deleteAccountAck) {
      toast.error('Confirm that you understand your account will be permanently deleted.');
      return;
    }
    if (!deletePassword) {
      toast.error('Enter your current password to confirm deletion.');
      return;
    }

    setDeleteBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: deletePassword,
      });
      if (signErr) {
        toast.error(formatAuthErrorMessage(signErr) || 'Password is incorrect.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('delete-my-account', {
        body: { confirm: true },
      });

      if (error) {
        let msg = error.message || 'Request failed';
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === 'function') {
            const bodyJson = await ctx.json();
            if (bodyJson?.error) msg = String(bodyJson.error);
          }
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }

      setDeletePassword('');
      setDeleteAccountAck(false);
      toast.success('Your account has been deleted.');
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('delete-my-account:', err);
      toast.error(err.message || 'Could not delete account. Deploy the delete-my-account Edge Function if this persists.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="mt-10 pt-6 border-t border-red-200 dark:border-red-900/50 rounded-lg border border-red-100 dark:border-red-900/40 bg-red-50/80 dark:bg-red-950/20 p-4 space-y-3">
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
        <FaExclamationTriangle className="shrink-0" aria-hidden />
        Delete account
      </h2>
      <p className="text-sm text-red-900/90 dark:text-red-200/90 leading-relaxed">
        Permanently delete your login, profile, patrol sign-ups, vehicles on file, chat messages you
        sent, and criminal-intelligence profiles you created. Incident reports you submitted may
        stay in the system with the submitter field cleared where the database allows. This cannot be
        undone.
      </p>
      {authIdentities === null ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">Checking account type…</p>
      ) : canDeleteWithPassword ? (
        <>
          <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-200 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteAccountAck}
              onChange={(e) => setDeleteAccountAck(e.target.checked)}
              className="mt-1 w-4 h-4 shrink-0"
            />
            <span>I understand my account and the data above will be permanently deleted.</span>
          </label>
          <div>
            <label className="block text-sm font-medium mb-1 text-red-900 dark:text-red-200">
              Current password
            </label>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
              className="w-full border border-red-200 dark:border-red-800 rounded px-3 py-2 dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Required to confirm it’s you"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleDeleteMyAccount()}
            disabled={deleteBusy || !deleteAccountAck || !deletePassword}
            className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition disabled:opacity-50 text-sm font-medium"
          >
            {deleteBusy ? 'Deleting…' : 'Delete my account permanently'}
          </button>
        </>
      ) : (
        <div className="text-sm text-red-900 dark:text-red-200 space-y-2">
          <p>
            This account signs in with a provider that does not use a password. To delete your data,
            send a request from your registered email
            {privacyContactEmail ? (
              <>
                {' '}
                to{' '}
                <a
                  href={`mailto:${privacyContactEmail}?subject=${encodeURIComponent('Account deletion request')}&body=${encodeURIComponent(`Please delete my Neighbourhood Watch account.\n\nRegistered email: ${user?.email || ''}\nUser ID: ${user?.id || ''}\n`)}`}
                  className="font-medium underline underline-offset-2"
                >
                  {privacyContactEmail}
                </a>
              </>
            ) : (
              <>
                {' '}
                (set <code className="text-xs bg-red-100 dark:bg-red-900/50 px-1 rounded">VITE_PRIVACY_CONTACT_EMAIL</code>{' '}
                in your app environment for a mailto link).
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
