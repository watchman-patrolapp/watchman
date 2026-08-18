import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../../supabase/client";
import { useAuth } from "../../auth/useAuth";
import { getWorkingOrganizationId } from "../../utils/organizationScope";

const MAX_MESSAGE_LENGTH = 1000;
const EMPTY_FORM = { name: "", email: "", message: "" };

export default function FeedbackForm() {
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    if (name === "message" && value.length > MAX_MESSAGE_LENGTH) return;
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    const trimmed = {
      name: form.name.trim(),
      email: form.email.trim(),
      message: form.message.trim(),
    };

    if (!trimmed.name || !trimmed.email || !trimmed.message) {
      toast.error("Please fill in all fields.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        ...trimmed,
        submitter_user_id: user?.id ?? null,
        organization_id: getWorkingOrganizationId() || user?.organizationId || null,
      });
      if (error) throw error;
      toast.success("Thank you for your feedback!");
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error("Feedback error:", err);
      toast.error("Failed to send feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const charsLeft = MAX_MESSAGE_LENGTH - form.message.length;
  const charsNearLimit = charsLeft <= 100;

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">Send us your feedback</h2>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <input
          type="text"
          name="name"
          placeholder="Your name"
          value={form.name}
          onChange={handleChange}
          required
          autoComplete="name"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <input
          type="email"
          name="email"
          placeholder="Your email"
          value={form.email}
          onChange={handleChange}
          required
          autoComplete="email"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
          {charsNearLimit ? (
            <p
              className={`mt-1 text-right text-xs ${
                charsLeft <= 20 ? "text-red-500" : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {charsLeft} characters remaining
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-teal-600 px-6 py-2 font-medium text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 sm:w-auto"
        >
          {loading ? "Sending..." : "Send Feedback"}
        </button>
      </form>
      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Your feedback helps us improve the platform. Thank you!
      </p>
    </div>
  );
}
