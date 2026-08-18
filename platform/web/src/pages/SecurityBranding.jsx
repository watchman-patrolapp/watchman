import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FaCog, FaImage, FaUpload } from "react-icons/fa";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import CompanyCoverCard from "../components/security/CompanyCoverCard";
import {
  COVER_HEIGHT,
  COVER_WIDTH,
  getMySecurityBranding,
  saveMySecurityBranding,
  uploadSecurityBrandingImage,
} from "../utils/emergencyDirectory";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { writeSecurityCompanyBrand } from "../utils/securityBrandCache";
import { useAuth } from "../auth/useAuth";

export default function SecurityBranding() {
  const { user, signOut } = useAuth();
  const logoInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPersonName, setContactPersonName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const row = await getMySecurityBranding();
      if (!row) {
        toast.error("No security company is linked to this account.");
        return;
      }
      setCompanyId(row.security_company_id || "");
      setCompanyName(row.company_name || "");
      setLogoUrl(row.logo_url || "");
      setBannerUrl(row.banner_url || "");
      setContactPhone(row.contact_phone || "");
      setContactEmail(row.contact_email || "");
      setContactPersonName(row.contact_person_name || "");
      writeSecurityCompanyBrand(user?.id, {
        name: row.company_name || "",
        logoUrl: row.logo_url || "",
      });
    } catch (err) {
      console.error(err);
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the branding SQL in Supabase to enable logo and banner uploads."
          : err.message || "Could not load branding."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (kind, file) => {
    if (!file || !companyId) return;
    try {
      const url = await uploadSecurityBrandingImage(companyId, kind, file);
      const nextLogo = kind === "logo" ? url : logoUrl;
      const nextBanner = kind === "banner" ? url : bannerUrl;
      if (kind === "logo") setLogoUrl(url);
      else setBannerUrl(url);
      await saveMySecurityBranding({
        logoUrl: nextLogo,
        bannerUrl: nextBanner,
        contactPhone,
        contactEmail,
        contactPersonName,
      });
      writeSecurityCompanyBrand(user?.id, { name: companyName, logoUrl: nextLogo });
      toast.success(kind === "logo" ? "Logo updated." : "Cover photo updated.");
    } catch (err) {
      toast.error(err.message || "Could not upload image.");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveMySecurityBranding({
        logoUrl,
        bannerUrl,
        contactPhone,
        contactEmail,
        contactPersonName,
      });
      toast.success("Branding saved. Residents and intelligence will see this.");
      await load();
    } catch (err) {
      toast.error(
        isRpcNotFoundError(err)
          ? "Run the branding SQL in Supabase first."
          : err.message || "Could not save branding."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader
          title="Company profile"
          subtitle="This is how residents and intelligence see your company. Use Settings to change the cover, logo, and contact details."
          backTo="/security"
          backLabel="Back to command"
          rightSlot={
            <div className="flex items-center gap-3">
              <ThemeToggle variant="toolbar" />
              <button
                type="button"
                onClick={signOut}
                className="text-xs text-gray-500 underline transition hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
              >
                Sign Out
              </button>
            </div>
          }
        />

        {loading ? (
          <p className="text-sm text-gray-500">Loading profile…</p>
        ) : (
          <>
            <section className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-400">Public view</p>
              <CompanyCoverCard
                name={companyName}
                logoUrl={logoUrl}
                bannerUrl={bannerUrl}
                phone={contactPhone}
                email={contactEmail}
                contactPerson={contactPersonName}
              />
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <FaCog className="h-4 w-4 text-gray-500" aria-hidden />
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Settings</h2>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-gray-400">
                    Cover {COVER_WIDTH}×{COVER_HEIGHT} · Facebook size
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => bannerInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
                >
                  <FaImage /> Update cover
                </button>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white"
                >
                  <FaUpload /> Update logo
                </button>
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void upload("banner", file);
                }}
              />
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void upload("logo", file);
                }}
              />
              <p className="text-xs text-gray-500">
                Cover: wide landscape, about 820×312. Logo: square works best. JPEG, PNG, or WebP up to 8MB.
              </p>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">Phone</span>
                <input
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  placeholder="Control room number"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">Email</span>
                <input
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  placeholder="ops@company.co.za"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">
                  Person in charge <span className="font-normal text-gray-400">(optional)</span>
                </span>
                <input
                  value={contactPersonName}
                  onChange={(event) => setContactPersonName(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  placeholder="Ops manager name"
                />
              </label>

              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="w-full rounded-xl bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save contact details"}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
