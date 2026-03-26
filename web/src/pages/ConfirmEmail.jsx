import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';

export default function ConfirmEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  // Email passed via router state from the signup page: navigate('/confirm-email', { state: { email } })
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 max-w-md w-full text-center">

        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          Check your email
        </h1>

        <p className="text-gray-600 dark:text-gray-300 mb-2">
          We've sent a confirmation link to:
        </p>

        {/* Show email if available */}
        {email ? (
          <p className="font-semibold text-indigo-600 dark:text-indigo-400 mb-4 truncate">
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

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={() => navigate('/login')}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-3 rounded-xl transition"
          >
            Go to Login
          </button>

          {/* Resend — only shown if we have an email to resend to */}
          {email && (
            <button
              onClick={handleResend}
              disabled={resending || resent}
              className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium px-6 py-3 rounded-xl transition text-sm"
            >
              {resending ? 'Sending...' : resent ? 'Email resent!' : "Didn't receive it? Resend"}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
          Check your spam folder if you don't see it within a few minutes.
        </p>
      </div>
    </div>
  );
}