import { useState } from "react";
import toast from "../../utils/notify";
import StarRating from "./StarRating";
import { upsertServiceReview } from "../../utils/localServicesApi";
import {
  REVIEW_GUIDELINE,
  REVIEW_MAX_CHARS,
  REVIEW_SAVE_FALLBACK,
  buildReviewPayload,
  friendlyServiceError,
  validateReviewForm,
} from "../../utils/localServices";

export default function ReviewForm({ listingId, existing, onSaved }) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [used, setUsed] = useState(Boolean(existing?.used_service));
  const [vouch, setVouch] = useState(Boolean(existing?.vouch));
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const form = { rating, body, used_service: used, vouch };
    const problem = validateReviewForm(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await upsertServiceReview(buildReviewPayload(listingId, form));
      toast.success(existing ? "Review updated." : "Thanks for your review.");
      onSaved?.();
    } catch (err) {
      toast.error(friendlyServiceError(err, REVIEW_SAVE_FALLBACK));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
        {existing ? "Edit your review" : "Rate this service"}
      </p>
      <StarRating value={rating} onChange={setRating} />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, REVIEW_MAX_CHARS))}
        rows={3}
        placeholder="Optional: how was it?"
        aria-label="Your review"
        className="input border w-full"
      />
      <p className="text-xs text-gray-500">{REVIEW_GUIDELINE}</p>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={used}
          onChange={(e) => {
            setUsed(e.target.checked);
            if (!e.target.checked) setVouch(false);
          }}
        />
        I've used this service
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={vouch} disabled={!used} onChange={(e) => setVouch(e.target.checked)} />
        I vouch for this service
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
      >
        {busy ? "Saving…" : existing ? "Update review" : "Post review"}
      </button>
    </form>
  );
}
