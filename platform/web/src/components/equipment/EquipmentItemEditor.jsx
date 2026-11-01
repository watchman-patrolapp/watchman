import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FaExclamationCircle, FaSpinner } from "react-icons/fa";
import { PhotoTile } from "../needs/NeedItemEditor";
import { uploadCommunityImageWithProgress } from "../../utils/uploadWithProgress";
import {
  MAX_EQUIPMENT_PHOTOS,
  equipmentErrorMessage,
  setEquipmentItemDetails,
  setEquipmentItemPhotos,
  upsertEquipmentItem,
} from "../../utils/equipment";

export const INPUT =
  "mt-1 w-full rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm font-normal text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-500 dark:bg-gray-900 dark:text-white";
export const LABEL = "block text-sm font-medium text-gray-800 dark:text-gray-100";
export const HELP = "mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400";
export const BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
export const BTN_PRIMARY =
  "rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PICK_BYTES = 24 * 1024 * 1024;
let tmpSeq = 0;
const newKey = () => `tmp-${Date.now()}-${tmpSeq++}`;

export const EMPTY_ITEM = Object.freeze({
  id: null,
  name: "",
  categoryId: "",
  description: "",
  kitContents: "",
  maxLoanHours: "",
  requiresCertification: false,
  isArchived: false,
  photoPaths: [],
});

/** Build editor state from get_equipment_item jsonb. */
export function itemFormFromDetail(d) {
  return {
    id: d.id,
    name: d.name || "",
    categoryId: d.category_id || "",
    description: d.description || "",
    kitContents: d.kit_contents || "",
    maxLoanHours: d.max_loan_hours == null ? "" : String(d.max_loan_hours),
    requiresCertification: Boolean(d.requires_certification),
    isArchived: Boolean(d.is_archived),
    photoPaths: Array.isArray(d.photo_paths) && d.photo_paths.length ? d.photo_paths : d.photo_path ? [d.photo_path] : [],
  };
}

/** Item editor: details + up to 5 photos (community-media WebP, same flow as Needs). */
export default function EquipmentItemEditor({ initial, orgId, categories, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [photos, setPhotos] = useState(() => (initial.photoPaths || []).map((p) => ({ key: p, path: p, state: "saved", pct: 100 })));
  const [busy, setBusy] = useState(false);
  const [stepText, setStepText] = useState("");
  const [pickError, setPickError] = useState("");
  const dragFrom = useRef(null);
  const fileInput = useRef(null);
  const previews = useRef(new Set());
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

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
    const room = MAX_EQUIPMENT_PHOTOS - photos.length;
    const errors = [];
    const accepted = [];
    for (const f of files) {
      if (!TYPES.includes(f.type)) errors.push(`${f.name}: use JPG, PNG or WebP`);
      else if (f.size > MAX_PICK_BYTES) errors.push(`${f.name}: larger than 24 MB`);
      else if (accepted.length >= room) errors.push(`${f.name}: max ${MAX_EQUIPMENT_PHOTOS} photos per item`);
      else accepted.push(f);
    }
    if (errors.length) setPickError(errors.join(" | "));
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
    const hours = form.maxLoanHours === "" ? null : Number(form.maxLoanHours);
    if (hours != null && (!Number.isInteger(hours) || hours < 1 || hours > 720)) {
      toast.error("Max loan must be 1 to 720 hours (or blank).");
      return;
    }
    setBusy(true);
    setStepText("Saving item...");
    let itemId = form.id;
    try {
      const cover = photos.find((p) => p.path)?.path || null;
      const { data: savedId, error } = await upsertEquipmentItem({
        id: form.id,
        name: form.name,
        categoryId: form.categoryId || null,
        description: form.description,
        photoPath: cover,
        requiresCertification: form.requiresCertification,
        isArchived: form.isArchived,
      });
      if (error) throw error;
      itemId = savedId;
      setForm((f) => ({ ...f, id: savedId }));

      setStepText("Saving details...");
      const { error: detErr } = await setEquipmentItemDetails(savedId, { kitContents: form.kitContents, maxLoanHours: hours });
      if (detErr) throw detErr;

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
            orgId,
            feature: "equipment",
            entityId: savedId,
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
      setStepText("Saving photos...");
      const { error: photoErr } = await setEquipmentItemPhotos(savedId, finalPaths);
      if (photoErr) throw photoErr;
      if (failed) {
        toast.error(`Item saved, but ${failed} photo${failed === 1 ? "" : "s"} did not upload. Remove or retry them, then save again.`);
        return;
      }
      toast.success(initial.id ? "Item updated." : "Item added to the catalogue.");
      onSaved?.(savedId);
    } catch (err) {
      toast.error(equipmentErrorMessage(err, itemId && !initial.id ? "Item saved, but finishing it failed. Save again." : "Could not save the item."));
    } finally {
      setBusy(false);
      setStepText("");
    }
  };

  const full = photos.length >= MAX_EQUIPMENT_PHOTOS;

  return (
    <form onSubmit={save} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{form.id ? "Edit item" : "New item"}</h2>
      <label className={LABEL}>
        Item name <span className="text-red-600">*</span>
        <input required minLength={1} maxLength={120} value={form.name} onChange={set("name")} placeholder="e.g. Two-way radio kit" className={INPUT} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Category
          <select value={form.categoryId} onChange={set("categoryId")} className={INPUT}>
            <option value="">Other</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Max loan (hours)
          <input type="number" min={1} max={720} value={form.maxLoanHours} onChange={set("maxLoanHours")} placeholder="e.g. 12" className={INPUT} />
          <span className={HELP}>Blank = no limit. 24 = one day.</span>
        </label>
      </div>
      <label className={LABEL}>
        Description
        <textarea maxLength={2000} rows={4} value={form.description} onChange={set("description")} placeholder="What it is and how patrollers use it." className={`${INPUT} resize-y`} />
      </label>
      <label className={LABEL}>
        Kit contents
        <textarea maxLength={1000} rows={3} value={form.kitContents} onChange={set("kitContents")} placeholder={"One per line, e.g.\nRadio\nCharger\nEarpiece"} className={`${INPUT} resize-y`} />
        <span className={HELP}>Shown as a checklist on the item page.</span>
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input type="checkbox" checked={form.requiresCertification} onChange={set("requiresCertification")} /> Training recommended
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
          <input type="checkbox" checked={form.isArchived} onChange={set("isArchived")} /> Archived (hidden from members)
        </label>
      </div>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={LABEL}>
            Photos ({photos.length}/{MAX_EQUIPMENT_PHOTOS})
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
            {full ? `Maximum ${MAX_EQUIPMENT_PHOTOS} photos` : "Add photos"}
          </button>
          {pickError ? (
            <p className="mt-2 flex items-start gap-1 text-xs text-red-600 dark:text-red-400" aria-live="polite">
              <FaExclamationCircle className="mt-0.5 shrink-0" aria-hidden /> {pickError}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {stepText ? (
          <span className="mr-auto flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300" aria-live="polite">
            <FaSpinner className="animate-spin" aria-hidden /> {stepText}
          </span>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className={BTN}>
          {form.id && !initial.id ? "Close" : "Cancel"}
        </button>
        <button type="submit" disabled={busy} className={`${BTN_PRIMARY} inline-flex items-center gap-1`}>
          {busy ? <FaSpinner className="animate-spin" aria-hidden /> : null}
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
