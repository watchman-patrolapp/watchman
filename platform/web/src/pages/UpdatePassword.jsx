import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import AuthShell from '../components/layout/AuthShell';
import { formatAuthErrorMessage } from '../utils/authErrorMessage';

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setRecoveryReady(true);
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      // Do not await — missing/undeployed Edge Function causes long CORS/preflight hangs.
      void supabase.functions.invoke('notify-password-changed', { body: {} }).then(({ error: notifyErr }) => {
        if (notifyErr) console.warn('Password change notification email:', notifyErr.message);
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!recoveryReady) {
    return (
      <AuthShell>
        <div className="card w-full max-w-md p-6 sm:p-8 space-y-4 text-center">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Open your reset link</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use the link from your email. If it has expired, request a new one from the sign-in page.
          </p>
          <Link to="/forgot-password" className="text-teal-600 dark:text-teal-400 font-semibold hover:underline text-sm">
            Request reset link
          </Link>
          <p>
            <Link to="/login" className="text-sm text-gray-600 dark:text-gray-400 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-md p-6 sm:p-8 space-y-4"
      >
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">Choose new password</h2>
        <div>
          <label htmlFor="new-pw" className="sr-only">
            New password
          </label>
          <input
            id="new-pw"
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input border w-full"
            required
            minLength={6}
          />
        </div>
        <div>
          <label htmlFor="confirm-pw" className="sr-only">
            Confirm password
          </label>
          <input
            id="confirm-pw"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input border w-full"
            required
            minLength={6}
          />
        </div>
        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm text-center" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Saving…' : 'Update password'}
        </button>
        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          <Link to="/login" className="text-teal-600 dark:text-teal-400 font-semibold hover:underline">
            Cancel
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
