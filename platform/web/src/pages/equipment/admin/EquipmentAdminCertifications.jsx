import { useCallback, useEffect, useMemo, useState } from "react";
import { FaGraduationCap } from "react-icons/fa";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NeedsEmpty } from "../../../components/needs/NeedCard";
import EquipmentAdminNav from "../../../components/equipment/EquipmentAdminNav";
import { FIELD, LABEL, PRIMARY_BTN, SECONDARY_BTN } from "../../../components/equipment/EquipmentLoanDialogs";
import {
  equipmentErrorMessage,
  grantEquipmentCertification,
  listEquipmentCatalogue,
  listEquipmentCertificationsAdmin,
  listEquipmentPatrollers,
  revokeEquipmentCertification,
} from "../../../utils/equipment";
import EquipmentShell, { EquipmentBanner, EquipmentNotice, FilterPills, InfoSection, SEARCH_INPUT } from "../EquipmentShell";

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return String(iso);
  }
}

/** /equipment/admin/certifications: training sign-offs that unlock items marked "training required". */
export default function EquipmentAdminCertifications() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [patrollers, setPatrollers] = useState([]);
  const [certs, setCerts] = useState([]);
  const [itemId, setItemId] = useState(() => searchParams.get("item") || "");
  const [query, setQuery] = useState("");
  const [expires, setExpires] = useState("");
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [i, p, c] = await Promise.all([listEquipmentCatalogue(), listEquipmentPatrollers(), listEquipmentCertificationsAdmin()]);
    setLoading(false);
    const err = i.error || p.error || c.error;
    setHint(err ? equipmentErrorMessage(err) : "");
    const gated = (i.data || []).filter((x) => x.requires_certification && !x.is_archived);
    setItems(gated);
    setItemId((cur) => (cur && gated.some((g) => g.item_id === cur) ? cur : gated[0]?.item_id || ""));
    setPatrollers(p.data || []);
    setCerts(c.data || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => {
    const m = new Map();
    for (const c of certs) if (c.is_active && c.item_id === itemId) m.set(c.user_id, c);
    return m;
  }, [certs, itemId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return patrollers
      .filter((p) => !q || String(p.full_name || "").toLowerCase().includes(q))
      .sort((a, b) => Number(active.has(b.user_id)) - Number(active.has(a.user_id)) || String(a.full_name).localeCompare(String(b.full_name)));
  }, [patrollers, query, active]);

  const act = async (userId, fn, message) => {
    setBusyId(userId);
    const { error } = await fn();
    setBusyId(null);
    setFlash(error ? equipmentErrorMessage(error) : message);
    if (!error) void load();
  };

  const item = items.find((i) => i.item_id === itemId);

  return (
    <EquipmentShell wide title="Training sign-offs" subtitle="Who may borrow gear that needs training." backTo="/admin" backLabel="Back to Admin Dashboard">
      <EquipmentAdminNav />
      <EquipmentBanner title="Training sign-offs" subtitle={item ? `${active.size} signed off for ${item.name}` : "Mark an item as training required to use this"}>
        <button type="button" onClick={() => navigate("/equipment/admin/items")} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/25">
          Manage items
        </button>
      </EquipmentBanner>
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {flash ? (
        <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
          {flash}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p> : null}
      {!loading && !hint && items.length === 0 ? (
        <NeedsEmpty title="No items need training" body="Edit an item and tick Training required to gate borrowing behind a sign-off." />
      ) : null}
      {items.length ? (
        <>
          <FilterPills options={items.map((i) => ({ id: i.item_id, label: i.name }))} value={itemId} onChange={setItemId} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patrollers..." aria-label="Search patrollers" className={SEARCH_INPUT} />
            <div className="sm:w-56">
              <label htmlFor="eq-exp" className={LABEL}>
                New sign-offs expire (optional)
              </label>
              <input id="eq-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={FIELD} />
            </div>
          </div>
          <InfoSection title={`Patrollers (${shown.length})`}>
            {shown.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">No patrol members found.</p> : null}
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {shown.map((p) => {
                const c = active.get(p.user_id);
                return (
                  <li key={p.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.full_name || "Member"}</p>
                      <p className={`flex items-center gap-1 text-xs ${c ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500 dark:text-gray-400"}`}>
                        {c ? <FaGraduationCap className="h-3 w-3" aria-hidden /> : null}
                        {c ? `Signed off ${formatDate(c.granted_at)}${c.expires_at ? ` · expires ${formatDate(c.expires_at)}` : ""}` : "Not signed off"}
                      </p>
                    </div>
                    {c ? (
                      <button
                        type="button"
                        disabled={busyId === p.user_id}
                        onClick={() => act(p.user_id, () => revokeEquipmentCertification(p.user_id, itemId), `Sign-off removed for ${p.full_name}.`)}
                        className={`${SECONDARY_BTN} px-3 py-1.5 text-xs`}
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === p.user_id}
                        onClick={() =>
                          act(
                            p.user_id,
                            () => grantEquipmentCertification(p.user_id, itemId, { expiresAt: expires ? `${expires}T23:59:00` : null }),
                            `${p.full_name} signed off on ${item?.name}.`,
                          )
                        }
                        className={`${PRIMARY_BTN} px-3 py-1.5 text-xs`}
                      >
                        Sign off
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </InfoSection>
        </>
      ) : null}
    </EquipmentShell>
  );
}
