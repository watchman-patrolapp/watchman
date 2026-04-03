import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaEnvelope, FaWhatsapp } from 'react-icons/fa';
import ThemeToggle from '../components/ThemeToggle';

const MAX_MESSAGE_LENGTH = 1000;
const EMPTY_FORM = { name: '', email: '', message: '' };

export default function About() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  // Functional update form — no stale closure on form state
  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    // Enforce message character limit silently
    if (name === 'message' && value.length > MAX_MESSAGE_LENGTH) return;
    setForm(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // double-submit guard

    // Trim and validate before touching Supabase
    const trimmed = {
      name: form.name.trim(),
      email: form.email.trim(),
      message: form.message.trim(),
    };

    if (!trimmed.name || !trimmed.email || !trimmed.message) {
      toast.error('Please fill in all fields.');
      return;
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      toast.error('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('feedback').insert({
        ...trimmed,
        submitter_user_id: user?.id ?? null,
      });
      if (error) throw error;
      toast.success('Thank you for your feedback!');
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error('Feedback error:', err);
      toast.error('Failed to send feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const charsLeft = MAX_MESSAGE_LENGTH - form.message.length;
  const charsNearLimit = charsLeft <= 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">About</h1>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" />
              Back
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="p-6 sm:p-8 space-y-6">

            {/* About text */}
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                <strong>Neighbourhood Watch Platform</strong> was created to help communities
                organise patrols, report incidents, and coordinate safety efforts.
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                <strong>Created by:</strong> Africuz Creative Hub<br />
                <strong>All rights reserved © 2026</strong>
              </p>

              {/* Contact links */}
              <div className="flex flex-col gap-2">
                <a
                  href="mailto:africuzprojects@gmail.com"
                  className="inline-flex items-center gap-2 text-teal-600 dark:text-teal-400 hover:underline text-sm"
                >
                  <FaEnvelope className="w-4 h-4 flex-shrink-0" />
                  africuzprojects@gmail.com
                </a>
                <a
                  href="https://wa.me/27814954910"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-green-600 dark:text-green-400 hover:underline text-sm"
                >
                  <FaWhatsapp className="w-4 h-4 flex-shrink-0" />
                  +27 81 495 4910
                </a>
              </div>
            </div>

            <hr className="border-gray-200 dark:border-gray-700" />

            {/* Feedback form */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Send us your feedback
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <input
                  type="text"
                  name="name"
                  placeholder="Your name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  autoComplete="name"
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                />
                <input
                  type="email"
                  name="email"
                  placeholder="Your email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                />
                <div>
                  <textarea
                    name="message"
                    placeholder="Your message"
                    value={form.message}
                    onChange={handleChange}
                    required
                    rows={4}
                    autoComplete="off"
                    className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition resize-none"
                  />
                  {/* Character counter — only visible when approaching limit */}
                  {charsNearLimit && (
                    <p className={`text-xs mt-1 text-right ${charsLeft <= 20 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                      {charsLeft} characters remaining
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-xl transition shadow-sm"
                >
                  {loading ? 'Sending...' : 'Send Feedback'}
                </button>
              </form>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
                Your feedback helps us improve the platform. Thank you!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}