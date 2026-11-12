import { useState } from "react";
import toast from "../../utils/notify";
import ReportContentButton from "../community/ReportContentButton";
import StarRating from "./StarRating";
import {
  deleteMyServiceReview,
  hideServiceReview,
  replyToServiceReview,
} from "../../utils/localServicesApi";
import {
  REPLY_MAX_CHARS,
  friendlyServiceError,
  reviewerLabel,
} from "../../utils/localServices";

const LINK_BTN = "text-xs font-medium text-gray-500 hover:text-teal-700 dark:text-gray-400";

function ReviewItem({ review, isOwner, canModerate, onChanged }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState(review.owner_reply ?? "");
  const [busy, setBusy] = useState(false);

  async function run(action, okMessage) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(okMessage);
      setReplying(false);
      onChanged?.();
    } catch (err) {
      toast.error(friendlyServiceError(err));
    } finally {
      setBusy(false);
    }
  }

  function hide() {
    const reason = window.prompt("Reason for hiding this review (shown to the reviewer):", "");
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("Please give a reason.");
      return;
    }
    void run(() => hideServiceReview(review.id, reason.trim()), "Review hidden.");
  }

  function remove() {
    if (!window.confirm("Delete your review?")) return;
    void run(() => deleteMyServiceReview(review.id), "Review deleted.");
  }

  return (
    <li className="space-y-1 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <StarRating value={review.rating} size="text-base" />
        <span className="text-xs text-gray-500 dark:text-gray-400">{reviewerLabel(review)}</span>
        {review.vouch ? (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800">Vouches</span>
        ) : review.used_service ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">Used this service</span>
        ) : null}
      </div>
      {review.body ? <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">{review.body}</p> : null}
      {review.owner_reply && !replying ? (
        <p className="rounded-lg bg-gray-50 p-2 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-200">
          <span className="font-medium">Owner reply: </span>
          {review.owner_reply}
        </p>
      ) : null}

      {replying ? (
        <div className="space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value.slice(0, REPLY_MAX_CHARS))}
            rows={2}
            aria-label="Your reply"
            className="input border w-full"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => replyToServiceReview(review.id, reply), "Reply saved.")}
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Save reply
            </button>
            <button type="button" onClick={() => setReplying(false)} className={LINK_BTN}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {isOwner && !replying ? (
          <button type="button" onClick={() => setReplying(true)} className={LINK_BTN}>
            {review.owner_reply ? "Edit reply" : "Reply"}
          </button>
        ) : null}
        {review.is_mine ? (
          <button type="button" disabled={busy} onClick={remove} className={LINK_BTN}>
            Delete my review
          </button>
        ) : (
          <ReportContentButton contentType="service_review" contentId={review.id} />
        )}
        {canModerate && !review.is_mine ? (
          <button type="button" disabled={busy} onClick={hide} className={LINK_BTN}>
            Hide
          </button>
        ) : null}
      </div>
    </li>
  );
}

export default function ReviewList({ reviews, isOwner = false, canModerate = false, onChanged }) {
  if (!reviews.length) {
    return <p className="text-sm text-gray-500">No reviews yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {reviews.map((r) => (
        <ReviewItem key={r.id} review={r} isOwner={isOwner} canModerate={canModerate} onChanged={onChanged} />
      ))}
    </ul>
  );
}
