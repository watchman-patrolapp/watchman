import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/client';
import AuthShell from '../components/layout/AuthShell';
import { formatAuthErrorMessage } from '../utils/authErrorMessage';
import { getAuthRedirectOrigin } from '../utils/authRedirectOrigin';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const redirectTo = `${getAuthRedirectOrigin()}/update-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (resetErr) throw resetErr;
      setSent(true);
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="card w-full max-w-md p-6 sm:p-8 space-y-4">
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">Reset password</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
          We’ll email you a link to choose a new password.
        </p>

        {sent ? (
          <p className="text-sm text-center text-teal-700 dark:text-teal-300" role="status">
            If an account exists for <strong>{email.trim()}</strong>, check your inbox (and spam) for the reset link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="sr-only">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input border w-full"
                required
              />
            </div>
            {error && (
              <p className="text-red-600 dark:text-red-400 text-sm text-center" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          <Link to="/login" className="text-teal-600 dark:text-teal-400 font-semibold hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
