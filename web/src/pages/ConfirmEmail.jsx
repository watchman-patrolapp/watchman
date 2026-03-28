import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import AuthShell from '../components/layout/AuthShell';

export default function ConfirmEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || null;

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    if (!email) {
      toast.error("No email address found. Please sign up again.");
      return;
    }
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) throw error;
      setResent(true);
      toast.success("Confirmation email resent!");
    } catch (err) {
      console.error("Resend failed:", err);
      toast.error("Failed to resend email. Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell title="Confirm email">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          Check your email
        </h1>

        <p className="text-gray-600 dark:text-gray-300 mb-2">
          We&apos;ve sent a confirmation link to:
        </p>

        {email ? (
          <p className="font-semibold text-teal-600 dark:text-teal-400 mb-4 truncate">
            {email}
          </p>
        ) : (
          <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm italic">
            your email address
          </p>
        )}

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Click the link in the email to verify your account, then sign in.
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="btn-primary w-full"
          >
            Go to login
          </button>

          {email && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || resent}
              className="w-full btn-secondary py-3 text-sm disabled:opacity-50"
            >
              {resending ? 'Sending…' : resent ? 'Email resent!' : "Didn't receive it? Resend"}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
          Check your spam folder if you don&apos;t see it within a few minutes.
        </p>
      </div>
    </AuthShell>
  );
}
