import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "../../utils/notify";
import PageHeader from "../../components/layout/PageHeader";
import PrivateMediaImg from "../../components/media/PrivateMediaImg";
import ServiceContactButtons from "../../components/services/ServiceContactButtons";
import { FALLBACK_SERVICE_CATEGORIES } from "../../data/serviceCategories";
import { COMMUNITY_MEDIA_BUCKET } from "../../utils/communityMedia";
import {
  getServiceListing,
  listServiceCategories,
  uploadServicePhotos,
  upsertServiceListing,
} from "../../utils/localServicesApi";
import {
  LOAD_FALLBACK,
  MAX_SERVICE_PHOTOS,
  PRICE_RANGES,
  SAVE_FALLBACK,
  buildListingPayload,
  friendlyServiceError,
  hoursFromJson,
  validateListingForm,
} from "../../utils/localServices";

const BACK = "/resident/contacts?tab=services";

const EMPTY = {
  title: "",
  business_name: "",
  description: "",
  category_slug: "",
  tags: "",
  contact_name: "",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  service_area: "",
  hours: "",
  price_range: "",
  price_note: "",
  show_to_neighbours: false,
  consent_publish_contact: false,
};

function formFromRow(row) {
  return {
    ...EMPTY,
    title: row.title ?? "",
    business_name: row.business_name ?? "",
    description: row.description ?? "",
    category_slug: row.category_slug ?? "",
    tags: (row.tags ?? []).join(", "),
    contact_name: row.contact_name ?? "",
    phone: row.phone ?? "",
    whatsapp: row.whatsapp ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    service_area: row.service_area ?? "",
    hours: hoursFromJson(row.hours_json),
    price_range: row.price_range ?? "",
    price_note: row.price_note ?? "",
    show_to_neighbours: Boolean(row.show_to_neighbours),
    consent_publish_contact: Boolean(row.consent_publish_contact),
  };
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</span>
      {children}
    </label>
  );
}

export default function ServiceListingForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [categories, setCategories] = useState(FALLBACK_SERVICE_CATEGORIES);
  const [existingPhotos, setExistingPhotos] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const previews = useMemo(() => newFiles.map((f) => URL.createObjectURL(f)), [newFiles]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  useEffect(() => {
    listServiceCategories()
      .then((list) => {
        if (list.length) setCategories(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    getServiceListing(id)
      .then((row) => {
        if (!alive) return;
        setForm(formFromRow(row));
        setExistingPhotos(row.photo_paths ?? []);
      })
      .catch((err) => alive && setLoadError(friendlyServiceError(err, LOAD_FALLBACK)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const photoCount = existingPhotos.length + newFiles.length;

  const addFiles = (fileList) => {
    const room = MAX_SERVICE_PHOTOS - photoCount;
    if (room <= 0) {
      toast.error(`You can add up to ${MAX_SERVICE_PHOTOS} photos.`);
      return;
    }
    setNewFiles((prev) => [...prev, ...Array.from(fileList).slice(0, room)]);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const problem = validateListingForm(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      let row = await upsertServiceListing(id ?? null, buildListingPayload(form, existingPhotos));
      if (newFiles.length) {
        // Photo paths must contain the listing id, so upload after the first save.
        try {
          const uploaded = await uploadServicePhotos({
            orgId: row.organization_id,
            listingId: row.id,
            files: newFiles,
          });
          row = await upsertServiceListing(row.id, buildListingPayload(form, [...existingPhotos, ...uploaded]));
        } catch (err) {
          console.warn("[local-services] photo upload failed", err?.code || "");
          toast.error("Your listing was saved, but the photos could not be added. Edit it to try again.");
          navigate("/resident/services/mine");
          return;
        }
      }
      toast.success(row.status === "pending" ? "Saved. A moderator will approve it soon." : "Listing saved.");
      navigate("/resident/services/mine");
    } catch (err) {
      toast.error(friendlyServiceError(err, SAVE_FALLBACK));
    } finally {
      setSaving(false);
    }
  };

  const input = "input border w-full";

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          title={id ? "Edit your service" : "Add your service"}
          subtitle="Neighbours in your Neighbourhood Watch can find you here."
          backTo={BACK}
          backLabel="Back to services"
        />
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : loadError ? (
          <p className="text-sm text-red-600" role="alert">
            {loadError}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-xl bg-white p-5 shadow dark:bg-gray-800">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Basics</legend>
              <Field label="Title">
                <input className={input} required maxLength={80} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Qualified plumber" />
              </Field>
              <Field label="Business name (optional)">
                <input className={input} maxLength={80} value={form.business_name} onChange={(e) => set({ business_name: e.target.value })} />
              </Field>
              <Field label="Category">
                <select className={input} required value={form.category_slug} onChange={(e) => set({ category_slug: e.target.value })}>
                  <option value="">Choose a category…</option>
                  {categories
                    .filter((c) => c.parent_slug || !categories.some((x) => x.parent_slug === c.slug))
                    .map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Description">
                <textarea className={input} rows={4} required maxLength={2000} value={form.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <Field label="Keywords (comma separated, optional)">
                <input className={input} value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="geyser, leaks, drains" />
              </Field>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Contact</legend>
              <Field label="Contact name (optional)">
                <input className={input} maxLength={80} value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  <input className={input} inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
                </Field>
                <Field label="WhatsApp">
                  <input className={input} inputMode="tel" value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input className={input} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                </Field>
                <Field label="Website">
                  <input className={input} type="url" placeholder="https://" value={form.website} onChange={(e) => set({ website: e.target.value })} />
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Area & hours</legend>
              <Field label="Area you serve (optional)">
                <input className={input} maxLength={120} value={form.service_area} onChange={(e) => set({ service_area: e.target.value })} placeholder="e.g. Theescombe and surrounds" />
              </Field>
              <Field label="Hours (optional)">
                <input className={input} maxLength={200} value={form.hours} onChange={(e) => set({ hours: e.target.value })} placeholder="Mon–Fri 8am–5pm" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price range">
                  <select className={input} value={form.price_range} onChange={(e) => set({ price_range: e.target.value })}>
                    {PRICE_RANGES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Price note (optional)">
                  <input className={input} maxLength={120} value={form.price_note} onChange={(e) => set({ price_note: e.target.value })} />
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Photos</legend>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Do not include house numbers or number plates in your photos. Up to {MAX_SERVICE_PHOTOS} photos.
              </p>
              <div className="flex flex-wrap gap-2">
                {existingPhotos.map((path) => (
                  <div key={path} className="relative">
                    <PrivateMediaImg stored={path} bucket={COMMUNITY_MEDIA_BUCKET} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => setExistingPhotos((prev) => prev.filter((p) => p !== path))}
                      className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {previews.map((src, i) => (
                  <div key={src} className="relative">
                    <img src={src} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {photoCount < MAX_SERVICE_PHOTOS ? (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                  className="text-sm"
                />
              ) : null}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Preview</legend>
              <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{form.title || "Your title"}</p>
                <p className="text-xs text-gray-500">{form.business_name}</p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{form.description || "Your description"}</p>
                <div className="mt-2">
                  <ServiceContactButtons phone={form.phone} whatsapp={form.whatsapp} email={form.email} website={form.website} />
                </div>
              </div>
            </fieldset>

            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  className="mt-1"
                  required
                  checked={form.consent_publish_contact}
                  onChange={(e) => set({ consent_publish_contact: e.target.checked })}
                />
                I agree that my contact details in this listing are shown to members of this Neighbourhood Watch.
              </label>
              <div>
                <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.show_to_neighbours}
                    onChange={(e) => set({ show_to_neighbours: e.target.checked })}
                  />
                  Also show me to neighbouring suburbs
                </label>
                <p className="ml-6 mt-1 text-xs text-gray-500">
                  If you tick this, members of Neighbourhood Watches that your area admin has marked as neighbours can also see this
                  listing and your contact details. You can turn this off later.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                {saving ? "Saving…" : id ? "Save changes" : "Publish listing"}
              </button>
              <button type="button" onClick={() => navigate(BACK)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
