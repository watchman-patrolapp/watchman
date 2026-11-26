import { useEffect, useState } from "react";
import toast from "../utils/notify";
import { FaPen, FaTrash, FaTimes, FaCheck } from "react-icons/fa";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { useActiveOrganization } from "../auth/useActiveOrganization";
import PageHeader from "../components/layout/PageHeader";
import { isGlobalAppRole } from "../auth/roleMatrix";
import { fetchParentCity } from "../utils/cityScope";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import OrganizationRequestsPanel from "../components/admin/OrganizationRequestsPanel";
import CommunityContactsPanel from "../components/admin/CommunityContactsPanel";
import CityPicker from "../components/places/CityPicker";
import { friendlyError } from "../utils/friendlyError";
import { orgCityError, orgCityValue, suburbAfterCityChange, suburbsForCity } from "../utils/orgCityForm";
import {
  DEFAULT_BILLING_CATALOG,
  annualFeeScheduleCopy,
  countLocalMembersByOrg,
  getOrganizationSubscriptionView,
  loadBillingCatalog,
  parseListPriceZar,
  subscriptionBadgeClass,
  suggestedAnnualFeeZar,
} from "../utils/organizationBilling";

const EMPTY_FORM = {
  name: "",
  type: "nw_group",
  primary_suburb_id: "",
  city: null,
  subscription_tier: "beta",
  status: "active",
  annual_fee_zar: "",
};

const TYPE_LABELS = {
  nw_group: "Neighborhood Watch",
  security_company: "Security Company",
};

function orgToForm(org, citiesById) {
  return {
    name: org.name || "",
    type: org.type || "nw_group",
    primary_suburb_id: org.primary_suburb_id || "",
    city: orgCityValue(org, citiesById),
    subscription_tier: org.subscription_tier || "beta",
    status: org.status || "active",
    annual_fee_zar: org.annual_fee_zar == null ? "" : String(org.annual_fee_zar),
  };
}

/** id -> { name, province } for the cities these organisations are in (empty map if unreadable). */
async function loadCityNames(orgs) {
  const ids = [...new Set(orgs.map((o) => o.city_id).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const { data, error } = await supabase.from("cities").select("id, name, province").in("id", ids);
  if (!error) for (const c of data || []) out.set(c.id, c);
  return out;
}

function OrganizationConsole() {
  const { user } = useAuth();
  const { activeOrganizationId, setActiveOrganizationId, refreshOrganizations } = useActiveOrganization();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [suburbs, setSuburbs] = useState([]);
  const [parentCity, setParentCity] = useState({ id: null, name: "" });
  const [citiesById, setCitiesById] = useState(() => new Map());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);
  const [editingOrg, setEditingOrg] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [billingCatalog, setBillingCatalog] = useState(DEFAULT_BILLING_CATALOG);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadOrganizations = () => {
    setReloadKey((k) => k + 1);
    void refreshOrganizations({ silent: true });
  };

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const [
          { data: organizations, error: orgErr },
          { data: suburbRows, error: suburbErr },
          { data: memberRows, error: memberErr },
          { data: globalRows, error: globalErr },
          cityRow,
          catalog,
        ] = await Promise.all([
          supabase.from("organizations").select("*").order("created_at", { ascending: false }),
          supabase.from("suburbs").select("id, name, active, city_id").eq("active", true).order("name"),
          supabase.from("organization_members").select("organization_id, user_id").eq("status", "active"),
          supabase.from("users").select("id").in("role", ["admin", "technical_support"]),
          fetchParentCity(),
          loadBillingCatalog(),
        ]);
        if (orgErr) throw orgErr;
        if (suburbErr) throw suburbErr;
        if (memberErr) throw memberErr;
        if (globalErr) throw globalErr;
        if (!ignore) {
          setOrgs(organizations || []);
          setSuburbs(suburbRows || []);
          setCitiesById(await loadCityNames(organizations || []));
          setParentCity(cityRow || { id: null, name: "" });
          // A new organisation starts in your city; change it with the city search.
          if (cityRow?.id) {
            setForm((prev) => (prev.city ? prev : { ...prev, city: { id: cityRow.id, name: cityRow.name, province: "", nearLabel: "" } }));
          }
          setBillingCatalog(catalog);
          setMemberCounts(
            countLocalMembersByOrg(
              memberRows || [],
              new Set((globalRows || []).map((row) => row.id))
            )
          );
        }
      } catch (err) {
        console.error(err);
        if (!ignore) toast.error("Could not load organizations.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const blankForm = () => ({
    ...EMPTY_FORM,
    city: parentCity?.id ? { id: parentCity.id, name: parentCity.name, province: "", nearLabel: "" } : null,
  });

  const chooseCity = (city) => {
    setForm((prev) => ({
      ...prev,
      city: city || null,
      primary_suburb_id: suburbAfterCityChange(suburbs, prev.primary_suburb_id, city?.id),
    }));
  };

  const cancelEdit = () => {
    setEditingOrg(null);
    setForm(blankForm());
  };

  const startEdit = (org) => {
    setEditingOrg(org);
    setForm(orgToForm(org, citiesById));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      toast.error("Organization name is required.");
      return;
    }
    const cityError = orgCityError(form, Boolean(editingOrg));
    if (cityError) {
      toast.error(cityError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        primary_suburb_id: form.primary_suburb_id || null,
        subscription_tier: form.subscription_tier,
        status: form.status,
        annual_fee_zar: parseListPriceZar(form.annual_fee_zar),
      };
      // Only send a city the form has; an edit without one keeps the organisation's own city.
      if (form.city?.id) payload.city_id = form.city.id;

      if (editingOrg) {
        const { data: updated, error: updateErr } = await supabase
          .from("organizations")
          .update(payload)
          .eq("id", editingOrg.id)
          .select("*")
          .single();
        if (updateErr) throw updateErr;
        setOrgs((prev) => prev.map((org) => (org.id === updated.id ? updated : org)));
        if (form.city?.id) setCitiesById((prev) => new Map(prev).set(form.city.id, { name: form.city.name, province: form.city.province }));
        setEditingOrg(null);
        setForm(blankForm());
        toast.success(
          updated.type === "security_company" && updated.status === "active"
            ? "Security company updated and listed as verified."
            : "Organization updated."
        );
      } else {
        const { data: inserted, error: createErr } = await supabase
          .from("organizations")
          .insert({ ...payload, status: payload.status || "active" })
          .select("*")
          .single();
        if (createErr) throw createErr;

        if (!isGlobalAppRole(user?.role)) {
          const { error: memberErr } = await supabase.from("organization_members").insert({
            organization_id: inserted.id,
            user_id: user.id,
            member_role: "nw_admin",
            status: "active",
          });
          if (memberErr) throw memberErr;
        }

        setOrgs((prev) => [inserted, ...prev]);
        setMemberCounts((prev) => ({ ...prev, [inserted.id]: isGlobalAppRole(user?.role) ? 0 : 1 }));
        setForm(blankForm());
        toast.success(
          inserted.type === "security_company"
            ? "Security company created. It now appears on the resident signup and Profile company lists."
            : isGlobalAppRole(user?.role)
              ? "Organization created. Assign a local NW admin for this area."
              : "Organization created and linked to your account."
        );
      }

      await refreshOrganizations({ silent: true });
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err, editingOrg ? "Could not update organization." : "Could not create organization."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (org) => {
    const memberCount = memberCounts[org.id] || 0;
    const memberNote =
      memberCount > 0
        ? ` It has ${memberCount} local member${memberCount === 1 ? "" : "s"}.`
        : "";
    if (
      !window.confirm(
        `Delete “${org.name}”?${memberNote} Memberships and billing for this organization will be removed. Neighborhood records stay, but they lose this area assignment. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingId(org.id);
    try {
      const { error } = await supabase.from("organizations").delete().eq("id", org.id);
      if (error) throw error;
      setOrgs((prev) => prev.filter((row) => row.id !== org.id));
      setMemberCounts((prev) => {
        const next = { ...prev };
        delete next[org.id];
        return next;
      });
      if (editingOrg?.id === org.id) cancelEdit();
      if (activeOrganizationId === org.id) {
        await setActiveOrganizationId("");
      }
      await refreshOrganizations({ silent: true });
      toast.success(`Deleted ${org.name}.`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not delete organization.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleVerifySecurityCompany = async (org) => {
    if (org?.type !== "security_company" || org.status === "active") return;
    setVerifyingId(org.id);
    try {
      const { data: updated, error } = await supabase
        .from("organizations")
        .update({ status: "active" })
        .eq("id", org.id)
        .select("*")
        .single();
      if (error) throw error;
      setOrgs((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      if (editingOrg?.id === org.id) {
        setEditingOrg(updated);
        setForm(orgToForm(updated, citiesById));
      }
      await refreshOrganizations({ silent: true });
      toast.success(`${org.name} is verified. It stays on the resident list without the pending label.`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not verify this company.");
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          title="Organization setup"
          subtitle="Every watch and security company belongs to a city or town. Neighborhood watches are areas; security companies are partners that cover them."
          backTo="/admin"
          backLabel="Back to admin"
        />

        <OrganizationRequestsPanel onChanged={reloadOrganizations} />
        <CommunityContactsPanel />

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingOrg ? `Edit ${editingOrg.name}` : "Create neighborhood or partner organization"}
            </h2>
            {editingOrg ? (
              <button type="button" onClick={cancelEdit} className="btn-ghost text-sm inline-flex items-center gap-1">
                <FaTimes className="w-3 h-3" /> Cancel
              </button>
            ) : null}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</span>
              <input
                type="text"
                placeholder="Organization name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="input border w-full"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                className="input border w-full"
              >
                <option value="nw_group">Neighborhood Watch (area)</option>
                <option value="security_company">Security Company (resident dropdown)</option>
              </select>
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                {form.type === "security_company"
                  ? "This is what residents pick when they link a company. Sample partners (Tacnet, Atlas, …) and companies you create here share that list."
                  : "This is a neighborhood area, not a security company. It will not appear on the resident company dropdown."}
              </span>
            </label>
            <div className="block md:col-span-2">
              <CityPicker
                id="org-city"
                label="City or town"
                value={form.city}
                onChange={chooseCity}
                required={!editingOrg}
                hint="The city this watch or company is in. The suburb list below follows it."
              />
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Primary suburb
              </span>
              <select
                value={form.primary_suburb_id}
                onChange={(e) => setForm((prev) => ({ ...prev, primary_suburb_id: e.target.value }))}
                className="input border w-full"
              >
                <option value="">Not pinned to a suburb yet</option>
                {suburbsForCity(suburbs, form.city?.id).map((suburb) => (
                  <option key={suburb.id} value={suburb.id}>
                    {suburb.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                {form.type === "security_company"
                  ? "Home suburb this company mainly covers. Leave blank if they work across several areas. Active and pending companies appear on the resident signup and Profile dropdowns; Suspended hides them."
                  : "The real suburb this neighborhood watch belongs to. Used for SOS place names and to place new residents in that suburb."}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Annual list price (ZAR)
              </span>
              <input
                type="number"
                min={0}
                step={1}
                placeholder={`Default R${suggestedAnnualFeeZar(0, form.type, billingCatalog)}`}
                value={form.annual_fee_zar}
                onChange={(e) => setForm((prev) => ({ ...prev, annual_fee_zar: e.target.value }))}
                className="input border w-full"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                Leave blank to use the default {form.type === "security_company" ? "security-company" : "neighborhood"} rate
                (currently R{suggestedAnnualFeeZar(0, form.type, billingCatalog)}). Change defaults on Admin → Billing.
              </span>
            </label>
            <select
              value={form.subscription_tier}
              onChange={(e) => setForm((prev) => ({ ...prev, subscription_tier: e.target.value }))}
              className="input border w-full"
            >
              <option value="beta">Beta</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
            </select>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="input border w-full"
              >
                <option value="active">Active</option>
                <option value="pending">Pending (still listed for residents)</option>
                <option value="suspended">Suspended (hidden from resident lists)</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {parentCity.name ? `New organisations start in ${parentCity.name}; pick another city above if needed. ` : ""}
            {annualFeeScheduleCopy("nw_group", billingCatalog)} {annualFeeScheduleCopy("security_company", billingCatalog)}{" "}
            Set a custom price above, or change the defaults on Billing. Residents stay free. Pending companies stay on the
            resident dropdown until you click Verify company. Suspend hides a neighborhood from the Area picker, or a company
            from the signup list, without deleting it.
          </p>
          <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
            {saving
              ? editingOrg
                ? "Saving..."
                : "Creating..."
              : editingOrg
                ? "Save changes"
                : "Create organization"}
          </button>
        </form>

        {loading && orgs.length === 0 ? (
          <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading organizations...</p>
          </section>
        ) : null}

        {["nw_group", "security_company"].map((type) => {
          const rows = orgs
            .filter((org) => org.type === type)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
          const titles = {
            nw_group: "Neighborhood areas",
            security_company: "Security companies",
          };
          const hints = {
            nw_group: "These are the working areas in the admin Area picker. Patrol and incident data stay per neighborhood.",
            security_company:
              "Partners that cover one or more areas. Pending means not yet verified — click Verify company after you confirm the business. Verified companies keep their place in the A–Z resident dropdown.",
          };
          if (loading && orgs.length === 0) return null;
          return (
            <section key={type} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {titles[type]}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{hints[type]}</p>
              {loading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading organizations...</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">None listed yet.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((org) => {
                    const subscription = getOrganizationSubscriptionView({
                      createdAt: org.created_at,
                      annualFeeStatus: org.annual_fee_status,
                      memberCount: memberCounts[org.id] || 0,
                      orgType: org.type,
                      catalog: billingCatalog,
                      customAnnualFeeZar: org.annual_fee_zar,
                    });
                    const isEditing = editingOrg?.id === org.id;
                    return (
                      <div
                        key={org.id}
                        className={`border rounded-lg p-3 dark:border-gray-700 ${
                          isEditing ? "ring-2 ring-teal-500/60" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{org.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {TYPE_LABELS[org.type] || org.type} · {org.status} · tier {org.subscription_tier}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subscription.detail}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {org.type === "security_company" ? (
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  org.status === "active"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                                    : org.status === "suspended"
                                      ? "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                }`}
                              >
                                {org.status === "active"
                                  ? "Verified"
                                  : org.status === "suspended"
                                    ? "Suspended"
                                    : "Pending verification"}
                              </span>
                            ) : null}
                            <span className={`text-xs px-2 py-1 rounded ${subscriptionBadgeClass(subscription.key)}`}>
                              {subscription.badge}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {org.type === "security_company" && org.status !== "active" ? (
                            <button
                              type="button"
                              onClick={() => void handleVerifySecurityCompany(org)}
                              disabled={verifyingId === org.id}
                              className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-teal-300 text-teal-800 dark:border-teal-700 dark:text-teal-200 disabled:opacity-50"
                            >
                              <FaCheck className="w-3 h-3" />
                              {verifyingId === org.id ? "Verifying..." : "Verify company"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => startEdit(org)}
                            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600"
                          >
                            <FaPen className="w-3 h-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(org)}
                            disabled={deletingId === org.id}
                            className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400 disabled:opacity-50"
                          >
                            <FaTrash className="w-3 h-3" />
                            {deletingId === org.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Global admins and technical support review requests only; the rest of setup stays with platform staff. */
function OrganizationRequestsOnly() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <PageHeader
          title="Organisation requests"
          subtitle="Approve or reject new neighbourhood watches and security companies. Creating and editing organisations stays in the Platform Console."
          backTo="/admin"
          backLabel="Back to admin"
        />
        <OrganizationRequestsPanel />
        <CommunityContactsPanel />
      </div>
    </div>
  );
}

export default function OrganizationOnboarding() {
  const { user } = useAuth();
  if (canAccessPlatformConsole(user?.platformRole)) return <OrganizationConsole />;
  return <OrganizationRequestsOnly />;
}
