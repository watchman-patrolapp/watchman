import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FaArrowLeft, FaArrowRight, FaCheckCircle, FaExclamationCircle, FaSpinner, FaStar, FaTimes } from "react-icons/fa";
import { uploadCommunityImageWithProgress } from "../../utils/uploadWithProgress";
import {
  MAX_WISHLIST_PHOTOS,
  randsToCents,
  setWishlistItemPhotos,
  upsertWishlistItem,
  wishlistErrorMessage,
  wishlistPhotoUrl,
} from "../../utils/equipmentWishlist";

const INPUT =
  "mt-1 w-full rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm font-normal text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-500 dark:bg-gray-900 dark:text-white";
const LABEL = "block text-sm font-medium text-gray-800 dark:text-gray-100";
const HELP = "mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400";
const BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
const BTN_PRIMARY =
  "rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50";
const REASON_MAX = 1000; // DB CHECK + RPC (20261031070000)
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PICK_BYTES = 24 * 1024 * 1024; // compressed to <= 8 MB before upload

let tmpSeq = 0;
const newKey = () => `tmp-${Date.now()}-${tmpSeq++}`;

/**
 * Photo entries: { key, path?, file?, preview?, state: saved|queued|uploading|done|error, pct, error }.
 * Order = display order; index 0 = cover.
 */
function photosFromPaths(paths) {
  return (paths || []).map((p) => ({ key: p, path: p, state: "saved", pct: 100 }));
}

export function PhotoTile({ photo, index, count, disabled, onMove, onRemove, onDragStart, onDrop }) {
  const src = photo.preview || wishlistPhotoUrl(photo.path);
  return (
    <li
      draggable={!disabled}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(index)}
      className="relative overflow-hidden rounded-lg border border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900"
    >
      <div className="relative aspect-square w-full">
        {src ? <img src={src} alt={`Photo ${index + 1}`} className="h-full w-full object-contain" /> : null}
        {index === 0 ? (
          <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
            <FaStar className="h-2.5 w-2.5" aria-hidden /> Cover
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onRemove(index)}
          disabled={disabled}
          aria-label={`Remove photo ${index + 1}`}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-red-600 disabled:opacity-40"
        >
          <FaTimes className="h-3 w-3" />
        </button>
        {photo.state === "uploading" ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] text-white">
            <div className="flex items-center gap-1">
              <FaSpinner className="animate-spin" aria-hidden /> Uploading {photo.pct || 0}%
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/30">
              <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-all" style={{ width: `${photo.pct || 0}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1 border-t border-gray-200 px-1 py-1 text-[10px] dark:border-gray-700" aria-live="polite">
        <button type="button" onClick={() => onMove(index, -1)} disabled={disabled || index === 0} aria-label="Move left" className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-700">
          <FaArrowLeft className="h-2.5 w-2.5" />
        </button>
        <span className="min-w-0 truncate text-center">
          {photo.state === "saved" ? <span className="text-gray-500 dark:text-gray-400">Saved</span> : null}
          {photo.state === "queued" ? <span className="text-gray-600 dark:text-gray-300">Ready</span> : null}
          {photo.state === "uploading" ? <span className="text-teal-700 dark:text-teal-300">{photo.pct || 0}%</span> : null}
          {photo.state === "done" ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400"><FaCheckCircle aria-hidden /> Done</span>
          ) : null}
          {photo.state === "error" ? (
            <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400" title={photo.error}><FaExclamationCircle aria-hidden /> Failed</span>
          ) : null}
        </span>
        <button type="button" onClick={() => onMove(index, 1)} disabled={disabled || index === count - 1} aria-label="Move right" className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-30 dark:text-gray-300 dark:hover:bg-gray-700">
          <FaArrowRight className="h-2.5 w-2.5" />
        </button>
      </div>
    </li>
  );
}

export default function NeedItemEditor({ initial, orgId, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [photos, setPhotos] = useState(() => photosFromPaths(initial.photoPaths));
  const [busy, setBusy] = useState(false);
  const [stepText, setStepText] = useState("");
  const [pickError, setPickError] = useState("");
  const dragFrom = useRef(null);
  const fileInput = useRef(null);
  const previews = useRef(new Set());
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const patchPhoto = (key, patch) => setPhotos((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const pickFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setPickError("");
    if (!files.length) return;
    const room = MAX_WISHLIST_PHOTOS - photos.length;
    const errors = [];
    const accepted = [];
    for (const f of files) {
      if (!TYPES.includes(f.type)) errors.push(`${f.name}: use JPG, PNG or WebP`);
      else if (f.size > MAX_PICK_BYTES) errors.push(`${f.name}: larger than 24 MB`);
      else if (accepted.length >= room) errors.push(`${f.name}: max ${MAX_WISHLIST_PHOTOS} photos per item`);
      else accepted.push(f);
    }
    if (errors.length) setPickError(errors.join(" | "));
    if (!accepted.length) return;
    setPhotos((list) => [
      ...list,
      ...accepted.map((file) => {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        return { key: newKey(), file, preview, state: "queued", pct: 0 };
      }),
    ]);
  };

  const move = (i, d) =>
    setPhotos((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i) => setPhotos((list) => list.filter((_, k) => k !== i));
  const dropAt = (to) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === to) return;
    setPhotos((list) => {
      const next = [...list];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    const qty = Number(form.quantityNeeded);
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
      toast.error("Quantity must be 1 to 500.");
      return;
    }
    const cents = randsToCents(form.estRands);
    if (Number.isNaN(cents)) {
      toast.error("Estimated price must be a number (or leave it blank).");
      return;
    }
    const url = form.storeUrl.trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) {
      toast.error("Store link must start with https://");
      return;
    }

    setBusy(true);
    setStepText("Saving item...");
    let itemId = form.id;
    try {
      // 1) Item fields. photo_path is left as it was; the gallery RPC sets the cover.
      const { data: saved, error } = await upsertWishlistItem({
        id: form.id,
        title: form.title,
        reason: form.reason,
        quantityNeeded: qty,
        estUnitPriceCents: cents,
        storeUrl: url,
        productCode: form.productCode,
        priority: form.priority,
        categoryHint: form.categoryHint,
        photoPath: form.photoPath,
      });
      if (error) throw error;
      itemId = saved.id;
      setForm((f) => ({ ...f, id: saved.id }));

      // 2) Upload new photos one by one (per-photo %); keep going on failures.
      const snapshot = photos;
      const finalPaths = [];
      let failed = 0;
      for (let i = 0; i < snapshot.length; i += 1) {
        const p = snapshot[i];
        if (p.path) {
          finalPaths.push(p.path);
          continue;
        }
        setStepText(`Uploading photo ${i + 1} of ${snapshot.length}...`);
        patchPhoto(p.key, { state: "uploading", pct: 0, error: "" });
        try {
          const { path } = await uploadCommunityImageWithProgress({
            orgId: saved.organization_id || orgId,
            feature: "needs",
            entityId: saved.id,
            file: p.file,
            index: i,
            onProgress: (pct) => patchPhoto(p.key, { pct }),
          });
          patchPhoto(p.key, { state: "done", pct: 100, path });
          finalPaths.push(path);
        } catch (upErr) {
          failed += 1;
          patchPhoto(p.key, { state: "error", error: upErr?.message || "Upload failed" });
        }
      }

      // 3) Gallery order (first = cover), validated server-side.
      setStepText("Saving photos...");
      const { data: withPhotos, error: photoErr } = await setWishlistItemPhotos(saved.id, finalPaths);
      if (photoErr) throw photoErr;

      if (failed) {
        toast.error(`Item saved, but ${failed} photo${failed === 1 ? "" : "s"} did not upload. Remove or retry them, then save again.`);
        return; // stay open so the user can retry
      }
      toast.success(initial.id ? "Item updated." : "Item added to Neighbourhood Watch Needs.");
      onSaved?.(withPhotos || saved);
    } catch (err) {
      toast.error(wishlistErrorMessage(err, itemId && !initial.id ? "Item saved, but finishing it failed. Save again." : "Could not save the item."));
    } finally {
      setBusy(false);
      setStepText("");
    }
  };

  const full = photos.length >= MAX_WISHLIST_PHOTOS;

  return (
    <form onSubmit={save} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{form.id ? "Edit item" : "New item"}</h2>
      <label className={LABEL}>
        Item name <span className="text-red-600">*</span>
        <input required maxLength={120} value={form.title} onChange={set("title")} placeholder="e.g. Two-way radio" className={INPUT} />
        <span className={HELP}>Short product name shown as the card title.</span>
      </label>
      <label className={LABEL}>
        Why we need it (description)
        <textarea
          maxLength={REASON_MAX}
          rows={5}
          value={form.reason}
          onChange={set("reason")}
          placeholder="What it is for, features, and how it helps patrols."
          className={`${INPUT} resize-y`}
        />
        <span className={`${HELP} flex justify-between`}>
          <span>Shown under &quot;Why we need it&quot; on the card.</span>
          <span className={form.reason.length > REASON_MAX * 0.9 ? "font-medium text-amber-700 dark:text-amber-300" : ""}>
            {form.reason.length} / {REASON_MAX}
          </span>
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Quantity needed
          <input type="number" min={1} max={500} value={form.quantityNeeded} onChange={set("quantityNeeded")} className={INPUT} />
        </label>
        <label className={LABEL}>
          Est. price each (R, optional)
          <input inputMode="decimal" value={form.estRands} onChange={set("estRands")} placeholder="e.g. 850" className={INPUT} />
        </label>
        <label className={LABEL}>
          Priority
          <select value={form.priority} onChange={set("priority")} className={INPUT}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className={LABEL}>
          Product code (optional)
          <input maxLength={80} value={form.productCode} onChange={set("productCode")} className={INPUT} />
        </label>
      </div>
      <label className={LABEL}>
        Store link (optional, https only)
        <input type="url" maxLength={500} value={form.storeUrl} onChange={set("storeUrl")} placeholder="https://" className={INPUT} />
      </label>
      <label className={LABEL}>
        Category hint (optional)
        <input maxLength={80} value={form.categoryHint} onChange={set("categoryHint")} placeholder="Radios, lights, first aid" className={INPUT} />
      </label>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={LABEL}>
            Photos ({photos.length}/{MAX_WISHLIST_PHOTOS})
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">First photo is the cover. Drag or use arrows to reorder.</span>
        </div>
        <div className="mt-1 rounded-lg border border-dashed border-gray-400 p-3 dark:border-gray-500">
          {photos.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((p, i) => (
                <PhotoTile
                  key={p.key}
                  photo={p}
                  index={i}
                  count={photos.length}
                  disabled={busy}
                  onMove={move}
                  onRemove={remove}
                  onDragStart={(k) => {
                    dragFrom.current = k;
                  }}
                  onDrop={dropAt}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">No photos yet.</p>
          )}
          <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={pickFiles} className="hidden" />
          <button type="button" className={`${BTN} mt-3`} disabled={busy || full} onClick={() => fileInput.current?.click()}>
            {full ? `Maximum ${MAX_WISHLIST_PHOTOS} photos` : "Add photos"}
          </button>
          {pickError ? (
            <p className="mt-2 flex items-start gap-1 text-xs text-red-600 dark:text-red-400" aria-live="polite">
              <FaExclamationCircle className="mt-0.5 shrink-0" aria-hidden /> {pickError}
            </p>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        The price is shown to residents as an estimate only. The app never collects money or payment details.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {stepText ? (
          <span className="mr-auto flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" aria-live="polite">
            <FaSpinner className="animate-spin" aria-hidden /> {stepText}
          </span>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className={BTN}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className={`${BTN_PRIMARY} inline-flex items-center gap-1`}>
          {busy ? <FaSpinner className="animate-spin" aria-hidden /> : null}
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
