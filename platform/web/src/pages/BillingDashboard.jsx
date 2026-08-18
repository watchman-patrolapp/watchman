import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import PageHeader from "../components/layout/PageHeader";
import {
  DEFAULT_BILLING_CATALOG,
  annualFeeScheduleCopy,
  countLocalMembersByOrg,
  feeUserNoun,
  getOrganizationSubscriptionView,
  loadBillingCatalog,
  parseListPriceZar,
  suggestedAnnualFeeZar,
} from "../utils/organizationBilling";

export default function BillingDashboard() {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [organizations, setOrganizations] = useState([]);
  const [memberCounts, setMemberCounts] = useState({});
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [catalog, setCatalog] = useState(DEFAULT_BILLING_CATALOG);
  const [catalogForm, setCatalogForm] = useState(DEFAULT_BILLING_CATALOG);
  const [listPrice, setListPrice] = useState("");
  const [form, setForm] = useState({
    tier: "standard",
    amount_zar: suggestedAnnualFeeZar(0, "nw_group"),
    payment_status: "pending",
    notes: "",
  });

  const loadSubscriptions = async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("organization_id", selectedOrgId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      setSubscriptions(data || []);
    } catch (err) {
      console.error(err);
      toast.error("Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedOrgId) return;
    void loadSubscriptions();
  }, [selectedOrgId]);

  useEffect(() => {
    if (!canAccessPlatformConsole(user?.platformRole)) return;
    let cancelled = false;
    void (async () => {
      try {
        const orgColumns =
          "id, name, type, status, created_at, annual_fee_status, subscription_tier, annual_fee_zar";
        let orgResult = await supabase
          .from("organizations")
          .select(orgColumns)
          .in("type", ["nw_group", "security_company"])
          .order("name", { ascending: true });
        if (orgResult.error && String(orgResult.error.message || "").includes("annual_fee_zar")) {
          orgResult = await supabase
            .from("organizations")
            .select("id, name, type, status, created_at, annual_fee_status, subscription_tier")
            .in("type", ["nw_group", "security_company"])
            .order("name", { ascending: true });
        }
        const [memberResult, globalResult, loadedCatalog] = await Promise.all([
          supabase.from("organization_members").select("organization_id, user_id").eq("status", "active"),
          supabase.from("users").select("id").in("role", ["admin", "technical_support"]),
          loadBillingCatalog(),
        ]);
        if (orgResult.error) throw orgResult.error;
        if (memberResult.error) throw memberResult.error;
        if (globalResult.error) throw globalResult.error;
        if (cancelled) return;
        const activeOrgs = (orgResult.data || []).filter((org) => org.status !== "suspended");
        const counts = countLocalMembersByOrg(
          memberResult.data || [],
          new Set((globalResult.data || []).map((row) => row.id))
        );
        setOrganizations(activeOrgs);
        setMemberCounts(counts);
        setCatalog(loadedCatalog);
        setCatalogForm(loadedCatalog);
        if (!selectedOrgId && activeOrgs.length > 0) {
          setSelectedOrgId(activeOrgs[0].id);
        }
      } catch (err) {
        console.error(err);
        toast.error("Could not load organizations.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.platformRole, selectedOrgId]);

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId);
  const selectedMemberCount = memberCounts[selectedOrgId] || 0;
  const selectedSubscription = useMemo(
    () =>
      getOrganizationSubscriptionView({
        createdAt: selectedOrg?.created_at,
        annualFeeStatus: selectedOrg?.annual_fee_status,
        memberCount: selectedMemberCount,
        orgType: selectedOrg?.type,
        catalog,
        customAnnualFeeZar: selectedOrg?.annual_fee_zar,
      }),
    [
      selectedOrg?.created_at,
      selectedOrg?.annual_fee_status,
      selectedOrg?.type,
      selectedOrg?.annual_fee_zar,
      selectedMemberCount,
      catalog,
    ]
  );

  useEffect(() => {
    if (!selectedOrgId) return;
    setListPrice(selectedOrg?.annual_fee_zar == null ? "" : String(selectedOrg.annual_fee_zar));
    setForm((prev) => ({
      ...prev,
      amount_zar: suggestedAnnualFeeZar(
        memberCounts[selectedOrgId] || 0,
        selectedOrg?.type,
        catalog,
        selectedOrg?.annual_fee_zar
      ),
    }));
  }, [selectedOrgId, memberCounts, selectedOrg?.type, selectedOrg?.annual_fee_zar, catalog]);

  const createOrUpdateSubscription = async (event) => {
    event.preventDefault();
    if (!selectedOrgId) {
      toast.error("Select an organization first.");
      return;
    }
    setSaving(true);
    try {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const payload = {
        organization_id: selectedOrgId,
        tier: form.tier,
        amount_zar: Number(form.amount_zar) || 0,
        payment_status: form.payment_status,
        started_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        notes: form.notes.trim() || null,
      };
      const { error } = await supabase.from("subscriptions").insert(payload);
      if (error) throw error;

      const { error: orgErr } = await supabase
        .from("organizations")
        .update({
          subscription_tier: form.tier,
          annual_fee_status: form.payment_status,
          subscription_expires_at: expiresAt.toISOString(),
        })
        .eq("id", selectedOrgId);
      if (orgErr) throw orgErr;

      setOrganizations((prev) =>
        prev.map((org) =>
          org.id === selectedOrgId
            ? {
                ...org,
                subscription_tier: form.tier,
                annual_fee_status: form.payment_status,
              }
            : org
        )
      );

      toast.success("Subscription record saved.");
      setForm({
        tier: "standard",
        amount_zar: suggestedAnnualFeeZar(
          memberCounts[selectedOrgId] || 0,
          selectedOrg?.type,
          catalog,
          selectedOrg?.annual_fee_zar
        ),
        payment_status: "pending",
        notes: "",
      });
      await loadSubscriptions();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not save subscription.");
    } finally {
      setSaving(false);
    }
  };

  const saveCatalog = async (event) => {
    event.preventDefault();
    setSavingCatalog(true);
    try {
      const payload = {
        nw_under_limit_zar: Number(catalogForm.nw_under_limit_zar) || 0,
        nw_at_or_above_limit_zar: Number(catalogForm.nw_at_or_above_limit_zar) || 0,
        security_under_limit_zar: Number(catalogForm.security_under_limit_zar) || 0,
        security_at_or_above_limit_zar: Number(catalogForm.security_at_or_above_limit_zar) || 0,
        small_org_user_limit: Math.max(1, Number(catalogForm.small_org_user_limit) || 10),
        trial_months: Math.max(0, Number(catalogForm.trial_months) || 0),
        updated_at: new Date().toISOString(),
        updated_by_user_id: user?.id || null,
      };
      const { data, error } = await supabase
        .from("platform_billing_catalog")
        .update(payload)
        .eq("id", "default")
        .select("*")
        .single();
      if (error) throw error;
      const next = {
        ...DEFAULT_BILLING_CATALOG,
        ...data,
      };
      setCatalog(next);
      setCatalogForm(next);
      toast.success("Default prices saved. Organizations without a custom price use these rates.");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not save default prices. Run the latest billing SQL in Supabase.");
    } finally {
      setSavingCatalog(false);
    }
  };

  const saveListPrice = async (event) => {
    event.preventDefault();
    if (!selectedOrgId) {
      toast.error("Select an organization first.");
      return;
    }
    setSavingPrice(true);
    try {
      const annualFeeZar = parseListPriceZar(listPrice);
      const { data, error } = await supabase
        .from("organizations")
        .update({ annual_fee_zar: annualFeeZar })
        .eq("id", selectedOrgId)
        .select("id, annual_fee_zar")
        .single();
      if (error) throw error;
      setOrganizations((prev) =>
        prev.map((org) => (org.id === selectedOrgId ? { ...org, annual_fee_zar: data.annual_fee_zar } : org))
      );
      toast.success(
        annualFeeZar == null
          ? "Custom price cleared. This organization now uses the default rate."
          : `List price set to R${annualFeeZar}/year.`
      );
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not save this price. Run the latest billing SQL in Supabase.");
    } finally {
      setSavingPrice(false);
    }
  };

  const active = subscriptions.find((sub) => sub.payment_status === "paid") || subscriptions[0];

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <PageHeader
          title="Billing"
          subtitle={`${annualFeeScheduleCopy("nw_group", catalog)} ${annualFeeScheduleCopy("security_company", catalog)} Residents remain free.`}
          backTo="/admin"
          backLabel="Back to admin"
        />

        <form onSubmit={saveCatalog} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Default prices</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            These rates apply to every organization that does not have its own set price. Change 15000 here without editing
            code.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Neighborhood watch under {catalogForm.small_org_user_limit} users
              </span>
              <input
                type="number"
                min={0}
                value={catalogForm.nw_under_limit_zar}
                onChange={(e) => setCatalogForm((prev) => ({ ...prev, nw_under_limit_zar: e.target.value }))}
                className="input border w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Neighborhood watch {catalogForm.small_org_user_limit}+ users
              </span>
              <input
                type="number"
                min={0}
                value={catalogForm.nw_at_or_above_limit_zar}
                onChange={(e) => setCatalogForm((prev) => ({ ...prev, nw_at_or_above_limit_zar: e.target.value }))}
                className="input border w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Security company under {catalogForm.small_org_user_limit} operators
              </span>
              <input
                type="number"
                min={0}
                value={catalogForm.security_under_limit_zar}
                onChange={(e) => setCatalogForm((prev) => ({ ...prev, security_under_limit_zar: e.target.value }))}
                className="input border w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Security company {catalogForm.small_org_user_limit}+ operators
              </span>
              <input
                type="number"
                min={0}
                value={catalogForm.security_at_or_above_limit_zar}
                onChange={(e) => setCatalogForm((prev) => ({ ...prev, security_at_or_above_limit_zar: e.target.value }))}
                className="input border w-full"
              />
            </label>
          </div>
          <button disabled={savingCatalog} className="btn-primary disabled:opacity-50">
            {savingCatalog ? "Saving..." : "Save default prices"}
          </button>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          {selectedOrg ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {selectedSubscription.badge} · {selectedSubscription.detail}
            </p>
          ) : null}
          {active ? (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              Last recorded: <span className="font-semibold capitalize">{active.tier}</span> · status{" "}
              <span className="font-semibold capitalize">{active.payment_status}</span>
            </p>
          ) : null}
          <div className="mt-4 max-w-sm">
            <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">
              Organization
            </label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="input border w-full"
            >
              <option value="">Select organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                  {org.type === "security_company" ? " · security company" : " · neighborhood watch"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={saveListPrice} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Set price for this organization</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Override the default for one company. Leave blank and save to go back to the default rate.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                Annual list price (ZAR)
              </span>
              <input
                type="number"
                min={0}
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                className="input border w-full"
                placeholder={`Default R${suggestedAnnualFeeZar(selectedMemberCount, selectedOrg?.type, catalog)}`}
              />
            </label>
            <button disabled={savingPrice || !selectedOrgId} className="btn-primary disabled:opacity-50">
              {savingPrice ? "Saving..." : "Save this price"}
            </button>
          </div>
        </form>

        <form onSubmit={createOrUpdateSubscription} className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Record annual fee</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <select
              value={form.tier}
              onChange={(e) => setForm((prev) => ({ ...prev, tier: e.target.value }))}
              className="input border w-full"
            >
              <option value="beta">Beta</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
            </select>
            <input
              type="number"
              min={0}
              value={form.amount_zar}
              onChange={(e) => setForm((prev) => ({ ...prev, amount_zar: e.target.value }))}
              className="input border w-full"
              placeholder="Amount (ZAR)"
              aria-label="Annual fee in rand"
            />
            <select
              value={form.payment_status}
              onChange={(e) => setForm((prev) => ({ ...prev, payment_status: e.target.value }))}
              className="input border w-full"
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="waived">Waived</option>
            </select>
          </div>
          {selectedOrg ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Suggested amount is R{selectedSubscription.amountZar} based on {selectedMemberCount} active{" "}
              {feeUserNoun(selectedOrg.type, selectedMemberCount)} in this organization.
            </p>
          ) : null}
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            className="w-full border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 dark:text-white"
            placeholder="Optional notes (discount reason, invoice ref, etc)"
          />
          <button disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? "Saving..." : "Save annual subscription"}
          </button>
        </form>

        <section className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Subscription history</h2>
          {!selectedOrgId ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Select an organization to load billing history.</p>
          ) : loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading billing history...</p>
          ) : subscriptions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No subscriptions recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {subscriptions.map((sub) => (
                <div key={sub.id} className="rounded-lg border dark:border-gray-700 p-3">
                  <p className="font-medium text-gray-900 dark:text-white capitalize">
                    {sub.tier} · R{sub.amount_zar}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(sub.started_at).toLocaleDateString()} -{" "}
                    {sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : "No expiry"} ·{" "}
                    {sub.payment_status}
                  </p>
                  {sub.notes ? (
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{sub.notes}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
