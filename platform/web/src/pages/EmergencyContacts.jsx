import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FaAmbulance,
  FaBolt,
  FaBuilding,
  FaEnvelope,
  FaFire,
  FaImage,
  FaPen,
  FaPhone,
  FaPlus,
  FaShieldAlt,
  FaTimes,
  FaUpload,
  FaUserMd,
} from "react-icons/fa";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import CompanyCoverCard from "../components/security/CompanyCoverCard";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  listDirectorySecurityCompanies,
  listEmergencyDirectory,
  saveEmergencyDirectoryEntry,
  setEmergencyDirectoryActive,
  uploadEmergencyDirectoryImage,
} from "../utils/emergencyDirectory";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { canManageEmergencyDirectory, homeBackNav } from "../auth/roleMatrix";
import { useAuth } from "../auth/useAuth";

export const DIRECTORY_KINDS = [
  { value: "police", label: "Police" },
  { value: "ambulance", label: "Ambulance" },
  { value: "medical", label: "Medical / doctor" },
  { value: "fire", label: "Fire" },
  { value: "electrical", label: "Electrical" },
  { value: "metro", label: "Municipality" },
  { value: "other", label: "Other" },
];

const KIND_META = {
  police: { label: "Police", icon: FaShieldAlt, tone: "bg-blue-600" },
  ambulance: { label: "Medical", icon: FaAmbulance, tone: "bg-red-600" },
  medical: { label: "Doctor / clinic", icon: FaUserMd, tone: "bg-rose-600" },
  fire: { label: "Fire", icon: FaFire, tone: "bg-orange-600" },
  electrical: { label: "Electrical", icon: FaBolt, tone: "bg-amber-500" },
  metro: { label: "Municipality", icon: FaBuilding, tone: "bg-slate-700" },
  other: { label: "Other", icon: FaPhone, tone: "bg-teal-600" },
};

const EMPTY_FORM = {
  id: null,
  kind: "medical",
  name: "",
  phone: "",
  alt_phone: "",
  email: "",
  contact_person_name: "",
  notes: "",
  sort_order: 100,
  active: true,
  logo_url: "",
  banner_url: "",
};

function CivicCard({ row, canManage, onEdit, onToggleActive }) {
  const meta = KIND_META[row.kind] || KIND_META.other;
  const Icon = meta.icon;
  return (
    <article
      className={`flex gap-3 rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${
        row.active === false
          ? "border-dashed border-gray-300 opacity-70 dark:border-gray-600"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white ${row.logo_url ? "bg-white" : meta.tone}`}>
        {row.logo_url ? (
          <img src={row.logo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-5 w-5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wide text-gray-400">{meta.label}</p>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{row.name}</h3>
          </div>
          {row.active === false ? (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              Hidden
            </span>
          ) : null}
        </div>
        {row.contact_person_name ? (
          <p className="mt-0.5 text-sm text-gray-500">In charge: {row.contact_person_name}</p>
        ) : null}
        {row.phone ? (
          <a href={`tel:${row.phone}`} className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
            <FaPhone className="h-3.5 w-3.5" aria-hidden />
            {row.phone}
          </a>
        ) : null}
        {row.alt_phone ? (
          <p className="text-xs text-gray-500">Alt {row.alt_phone}</p>
        ) : null}
        {row.email ? (
          <a href={`mailto:${row.email}`} className="mt-1 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <FaEnvelope className="h-3 w-3" aria-hidden />
            {row.email}
          </a>
        ) : null}
        {row.notes ? <p className="mt-1 text-xs text-gray-500">{row.notes}</p> : null}
        {canManage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onEdit(row)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              <FaPen className="h-3 w-3" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onToggleActive(row)}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {row.active === false ? "Show on directory" : "Hide from directory"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ContactForm({ form, saving, uploading, onChange, onSave, onCancel, onUpload }) {
  const logoInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const usingCustomLogo = Boolean(form.logo_url);

  return (
    <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5 shadow-sm dark:border-teal-900 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {form.id ? "Edit contact" : "New emergency contact"}
          </h2>
          <p className="text-sm text-gray-500">
            Pick a system icon like Police or Fire, or upload your own logo and cover photo.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
          <FaTimes />
        </button>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-100">System icon</p>
        <div className="flex flex-wrap gap-2">
          {DIRECTORY_KINDS.map((kind) => {
            const meta = KIND_META[kind.value];
            const Icon = meta.icon;
            const selected = form.kind === kind.value && !usingCustomLogo;
            return (
              <button
                key={kind.value}
                type="button"
                onClick={() => onChange({ kind: kind.value, logo_url: "" })}
                className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold ring-1 transition ${
                  selected
                    ? "ring-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-100"
                    : "ring-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:ring-gray-700 dark:bg-gray-800 dark:text-gray-200"
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${meta.tone}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                {kind.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-100">Or upload your branding</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-gray-100 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
            {form.logo_url ? (
              <img src={form.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-mono text-[10px] text-gray-400">Logo</span>
            )}
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => logoInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            <FaUpload className="h-3.5 w-3.5" aria-hidden />
            {uploading ? "Uploading…" : "Upload logo"}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => bannerInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            <FaImage className="h-3.5 w-3.5" aria-hidden />
            Upload cover
          </button>
          {form.logo_url || form.banner_url ? (
            <button
              type="button"
              onClick={() => onChange({ logo_url: "", banner_url: "" })}
              className="text-sm font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Clear uploads
            </button>
          ) : null}
        </div>
        {form.banner_url ? (
          <div className="mt-3 overflow-hidden rounded-xl">
            <img src={form.banner_url} alt="" className="h-24 w-full object-cover" />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-gray-500">
          Cover: wide landscape, about {COVER_WIDTH}×{COVER_HEIGHT}. Logo: square works best. JPEG, PNG, or WebP up to 8MB.
        </p>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void onUpload("logo", file);
          }}
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void onUpload("banner", file);
          }}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          type="text"
          required
          placeholder="Name, e.g. Dr Naidoo — Theescombe"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="input border w-full md:col-span-2"
        />
        <input
          type="text"
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          className="input border w-full"
        />
        <input
          type="text"
          placeholder="Alt phone"
          value={form.alt_phone}
          onChange={(e) => onChange({ alt_phone: e.target.value })}
          className="input border w-full"
        />
        <input
          type="email"
          placeholder="Email (optional)"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          className="input border w-full"
        />
        <input
          type="text"
          placeholder="Person in charge (optional)"
          value={form.contact_person_name}
          onChange={(e) => onChange({ contact_person_name: e.target.value })}
          className="input border w-full"
        />
      </div>
      <textarea
        rows={3}
        placeholder="Notes residents should see, e.g. after-hours, practice hours, languages."
        value={form.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        className="input border w-full"
      />
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={form.active !== false}
          onChange={(e) => onChange({ active: e.target.checked })}
        />
        Visible on the public directory
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving || uploading} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {saving ? "Saving…" : form.id ? "Save contact" : "Add contact"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function EmergencyContacts() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const canManage = canManageEmergencyDirectory(user?.role, user?.platformRole);
  const residentView = pathname.startsWith("/resident");
  const adminView = pathname.startsWith("/admin");
  const intelligenceView = pathname.startsWith("/intelligence");
  const home = homeBackNav(user?.role, user?.platformRole);
  const backTo = residentView ? "/resident" : intelligenceView ? "/intelligence" : adminView ? "/admin" : home.backTo;
  const backLabel = residentView
    ? "Back to home"
    : intelligenceView
      ? "Back to intelligence"
      : adminView
        ? "Back to admin"
        : home.backLabel;

  const [civic, setCivic] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [civicRows, companyRows] = await Promise.all([
        listEmergencyDirectory(),
        listDirectorySecurityCompanies(),
      ]);
      setCivic(canManage ? civicRows : civicRows.filter((row) => row.active !== false));
      setCompanies(companyRows);
    } catch (err) {
      console.error(err);
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the emergency directory SQL in Supabase to load contacts."
          : err.message || "Could not load contacts."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [canManage]);

  const uploadMedia = async (kind, file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadEmergencyDirectoryImage(user?.id, kind, file);
      setForm((prev) => (prev ? { ...prev, [`${kind}_url`]: url } : prev));
    } catch (err) {
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the emergency directory media SQL in Supabase first."
          : err.message || "Could not upload image."
      );
    } finally {
      setUploading(false);
    }
  };

  const saveForm = async (event) => {
    event.preventDefault();
    if (!form?.name?.trim()) {
      toast.error("Name is required.");
      return;
    }
    setSaving(true);
    try {
      await saveEmergencyDirectoryEntry(form);
      toast.success(form.id ? "Contact updated." : "Contact added.");
      setForm(null);
      await load();
    } catch (err) {
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the latest emergency directory SQL in Supabase first."
          : err.message || "Could not save contact."
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    try {
      await setEmergencyDirectoryActive(row.id, row.active === false);
      toast.success(row.active === false ? "Contact is visible again." : "Contact hidden from the directory.");
      await load();
    } catch (err) {
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the latest emergency directory SQL in Supabase first."
          : err.message || "Could not update contact."
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Emergency contacts"
          subtitle={
            canManage
              ? "Civic numbers, local doctors or clinics, and registered security companies. Add a contact for residents and intelligence."
              : residentView
                ? "Police, ambulance, fire, electrical, local medical help, and security companies registered on this platform."
                : "Operational directory: civic emergency numbers, local medical help, and every registered security company."
          }
          backTo={backTo}
          backLabel={backLabel}
          rightSlot={
            <div className="flex items-center gap-2">
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setForm({ ...EMPTY_FORM })}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  <FaPlus className="h-3 w-3" aria-hidden />
                  Add contact
                </button>
              ) : null}
              <ThemeToggle variant="toolbar" />
            </div>
          }
        />

        {form ? (
          <ContactForm
            form={form}
            saving={saving}
            uploading={uploading}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            onSave={saveForm}
            onCancel={() => setForm(null)}
            onUpload={uploadMedia}
          />
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-500">Loading contacts…</p>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-500">
                Emergency & city services
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {civic.map((row) => {
                  const meta = KIND_META[row.kind] || KIND_META.other;
                  const manageFooter = canManage ? (
                    <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
                      <button
                        type="button"
                        onClick={() => setForm({ ...EMPTY_FORM, ...row })}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        <FaPen className="h-3 w-3" aria-hidden />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {row.active === false ? "Show on directory" : "Hide from directory"}
                      </button>
                    </div>
                  ) : null;
                  if (row.banner_url) {
                    return (
                      <CompanyCoverCard
                        key={row.id}
                        name={row.name}
                        logoUrl={row.logo_url}
                        bannerUrl={row.banner_url}
                        phone={row.phone}
                        email={row.email}
                        contactPerson={row.contact_person_name}
                        kicker={meta.label}
                        footer={manageFooter}
                      />
                    );
                  }
                  return (
                    <CivicCard
                      key={row.id}
                      row={row}
                      canManage={canManage}
                      onEdit={(item) => setForm({ ...EMPTY_FORM, ...item })}
                      onToggleActive={toggleActive}
                    />
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-500">
                Security companies
              </h2>
              {companies.length === 0 ? (
                <p className="text-sm text-gray-500">No security companies are listed yet.</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {companies.map((company) => (
                    <CompanyCoverCard
                      key={company.id}
                      name={company.name}
                      logoUrl={company.logo_url}
                      bannerUrl={company.banner_url}
                      phone={company.contact_phone}
                      email={company.contact_email}
                      contactPerson={company.contact_person_name}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
