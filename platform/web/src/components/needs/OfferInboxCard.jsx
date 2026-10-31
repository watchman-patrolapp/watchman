import { useState } from "react";
import toast from "react-hot-toast";
import {
  FaBan,
  FaBoxOpen,
  FaCheck,
  FaCheckCircle,
  FaCopy,
  FaDonate,
  FaEye,
  FaHandHoldingHeart,
  FaHandsHelping,
  FaInfoCircle,
  FaMapMarkerAlt,
  FaPhoneAlt,
  FaReceipt,
  FaShoppingCart,
  FaTrophy,
} from "react-icons/fa";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import { OFFER_STATUS_META, formatEstPrice, respondWishlistOffer, wishlistErrorMessage } from "../../utils/equipmentWishlist";

/** Visual meta per offer kind: icon tile + short label. */
export const OFFER_KIND_VISUAL = Object.freeze({
  contribute_item: { label: "Give item", Icon: FaHandHoldingHeart, tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" },
  lend_item: { label: "Lend", Icon: FaHandsHelping, tile: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300" },
  source_at_cost: { label: "Source at cost", Icon: FaShoppingCart, tile: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" },
  contribute_cost: { label: "Contribute", Icon: FaDonate, tile: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300" },
  other_help: { label: "Other help", Icon: FaBoxOpen, tile: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
});

const AVATAR_TONES = [
  "bg-teal-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-sky-600",
  "bg-rose-600",
  "bg-emerald-600",
];

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function toneFor(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Small (i) with a hover / tap tooltip. */
export function InfoTip({ text, className = "" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={text}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="rounded-full p-0.5 text-gray-400 hover:text-teal-600 dark:text-gray-500 dark:hover:text-teal-300"
      >
        <FaInfoCircle className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute bottom-full right-0 z-30 mb-1 w-56 rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-lg dark:bg-gray-700"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

const ICON_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium disabled:opacity-50";

/** One offer in the admin inbox, as a card. */
export default function OfferInboxCard({ offer, onChanged, onRecord }) {
  const [busy, setBusy] = useState(false);
  const meta = OFFER_STATUS_META[offer.status] || OFFER_STATUS_META.new;
  const kind = OFFER_KIND_VISUAL[offer.kind] || OFFER_KIND_VISUAL.other_help;
  const KindIcon = kind.Icon;
  const closed = ["declined", "withdrawn", "fulfilled"].includes(offer.status);
  const name = offer.full_name || "Former member";
  const isCost = offer.kind === "contribute_cost";

  const respond = async (status) => {
    if (busy) return;
    let note = null;
    if (status === "declined" || status === "fulfilled") {
      note = window.prompt("Optional note for the resident", "");
      if (note === null) return;
    }
    setBusy(true);
    try {
      const { error } = await respondWishlistOffer(offer.id, status, note);
      if (error) throw error;
      toast.success("Offer updated. The resident has been notified.");
      onChanged?.();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not update the offer."));
    } finally {
      setBusy(false);
    }
  };

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(offer.phone);
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <li
      className={`rounded-2xl border bg-white p-3 shadow-sm dark:bg-gray-800 sm:p-4 ${
        offer.status === "new" ? "border-amber-300 ring-1 ring-amber-200 dark:border-amber-700 dark:ring-amber-900/60" : "border-gray-200 dark:border-gray-700"
      } ${closed ? "opacity-75" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${toneFor(name)}`} aria-hidden="true">
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate font-semibold text-gray-900 dark:text-white">{name}</span>
            {offer.verified ? <FaCheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" title="Verified resident" aria-label="Verified resident" /> : null}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400" title={offer.created_at}>
            {formatRelativeTime(offer.created_at)}
          </p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${kind.tile}`} title={kind.label}>
          <KindIcon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${kind.tile}`}>{kind.label}</span>
        <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">{offer.item_title}</span>
        {offer.quantity && !isCost ? <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">x{offer.quantity}</span> : null}
      </div>

      {isCost && offer.pledged_amount_cents ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-xl font-extrabold tracking-tight text-white shadow-sm">
            {formatEstPrice(offer.pledged_amount_cents)}
          </span>
          <span className="text-xs font-medium text-violet-700 dark:text-violet-300">pledged</span>
          <InfoTip text="Not counted until you record it as received on the ledger. Arrange and collect privately; never share bank details in the app." />
        </div>
      ) : null}

      {offer.street_label || offer.phone ? (
        <div className="mt-3 space-y-1.5 text-sm">
          {offer.street_label ? (
            <p className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
              <FaMapMarkerAlt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
              <span className="min-w-0 break-words">{offer.street_label}</span>
            </p>
          ) : null}
          {offer.phone ? (
            <div className="flex items-center gap-2">
              <FaPhoneAlt className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <a href={`tel:${offer.phone}`} className="font-medium text-teal-700 hover:underline dark:text-teal-300">
                {offer.phone}
              </a>
              <button type="button" onClick={() => void copyPhone()} aria-label="Copy number" title="Copy number" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200">
                <FaCopy className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {offer.note ? (
        <blockquote className="relative mt-3 rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm italic text-gray-700 dark:bg-gray-900/70 dark:text-gray-200">
          <span className="whitespace-pre-line">“{offer.note}”</span>
        </blockquote>
      ) : null}

      {offer.handled_at && offer.status !== "new" ? (
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          {offer.handled_by_name ? `${offer.handled_by_name} · ` : ""}
          {formatRelativeTime(offer.handled_at)}
          {offer.handled_note ? ` · ${offer.handled_note}` : ""}
        </p>
      ) : null}

      {!closed || (isCost && onRecord) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {isCost && onRecord ? (
            <button
              type="button"
              onClick={() => onRecord(offer)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm hover:from-violet-700 hover:to-fuchsia-700"
            >
              <FaReceipt className="h-3.5 w-3.5" /> Record contribution received
            </button>
          ) : null}
          {!closed && offer.status === "new" ? (
            <button type="button" disabled={busy} onClick={() => respond("acknowledged")} title="Acknowledge" className={`${ICON_BTN} border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40`}>
              <FaEye className="h-3.5 w-3.5" /> <span className="hidden min-[400px]:inline">Seen</span>
            </button>
          ) : null}
          {!closed && offer.status !== "accepted" ? (
            <button type="button" disabled={busy} onClick={() => respond("accepted")} title="Accept" className={`${ICON_BTN} border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40`}>
              <FaCheck className="h-3.5 w-3.5" /> Accept
            </button>
          ) : null}
          {!closed ? (
            <button type="button" disabled={busy} onClick={() => respond("fulfilled")} title="Fulfilled" className={`${ICON_BTN} border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-950/40`}>
              <FaTrophy className="h-3.5 w-3.5" /> <span className="hidden min-[400px]:inline">Fulfilled</span>
            </button>
          ) : null}
          {!closed ? (
            <button type="button" disabled={busy} onClick={() => respond("declined")} title="Decline" aria-label="Decline" className={`${ICON_BTN} border-rose-300 px-2.5 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40`}>
              <FaBan className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
