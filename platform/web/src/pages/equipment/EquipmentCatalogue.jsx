import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { homeBackNav } from "../../auth/roleMatrix";
import { useScopedOrganization } from "../../utils/organizationScope";
import { useEquipmentPendingCounts } from "../../hooks/useEquipmentPendingCounts";
import { NeedsEmpty } from "../../components/needs/NeedCard";
import EquipmentCard from "../../components/equipment/EquipmentCard";
import {
  canManageEquipment,
  equipmentAdminBadgeCount,
  equipmentMyBadgeCount,
  runEquipmentSweep,
  equipmentCategoryChips,
  equipmentErrorMessage,
  filterEquipmentCatalogue,
  listEquipmentCatalogue,
} from "../../utils/equipment";
import EquipmentShell, { EquipmentBanner, EquipmentNotice, FilterPills, SEARCH_INPUT } from "./EquipmentShell";

/** /equipment: patrol members browse the Watch's gear (Needs-style card grid). */
export default function EquipmentCatalogue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const back = homeBackNav(user?.role, user?.platformRole);
  const isManager = canManageEquipment(user?.role, user?.platformRole);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const counts = useEquipmentPendingCounts(Boolean(user?.id), activeOrganizationId);
  const myBadge = equipmentMyBadgeCount(counts);
  const adminBadge = equipmentAdminBadgeCount(counts);

  const load = useCallback(async () => {
    setLoading(true);
    await runEquipmentSweep(); // flags overdue loans / expires stale requests; ignored on older DBs
    const { data, error } = await listEquipmentCatalogue();
    setLoading(false);
    if (error) {
      setItems([]);
      setHint(equipmentErrorMessage(error));
      return;
    }
    setHint("");
    setItems(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load, activeOrganizationId]);

  const chips = useMemo(() => equipmentCategoryChips(items), [items]);
  const shown = useMemo(() => filterEquipmentCatalogue(items, { categoryId: category, query }), [items, category, query]);
  const totals = useMemo(
    () => items.reduce((t, i) => ({ units: t.units + (Number(i.unit_count) || 0), free: t.free + (Number(i.available_count) || 0) }), { units: 0, free: 0 }),
    [items],
  );

  return (
    <EquipmentShell wide title="Equipment" subtitle="Watch gear you can borrow on patrol." backTo={back.backTo} backLabel={back.backLabel}>
      <EquipmentBanner
        title="Neighbourhood Watch equipment"
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"} in the catalogue`}
      >
        {totals.units ? (
          <div className="rounded-xl bg-white/15 px-3 py-2 text-right ring-1 ring-white/25 backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-50/90">Free right now</p>
            <p className="text-lg font-extrabold leading-tight">
              {totals.free} <span className="text-sm font-medium text-teal-50/90">of {totals.units} units</span>
            </p>
          </div>
        ) : null}
      </EquipmentBanner>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search gear..."
          aria-label="Search gear"
          className={SEARCH_INPUT}
        />
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => navigate("/equipment/mine")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 dark:border-teal-800 dark:bg-gray-800 dark:text-teal-200 dark:hover:bg-teal-900/30"
          >
            My gear
            <CountDot value={myBadge} />
          </button>
          {isManager ? (
            <button
              type="button"
              onClick={() => navigate("/equipment/admin/requests")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Loan desk
              <CountDot value={adminBadge} />
            </button>
          ) : null}
          {isManager ? (
            <button type="button" onClick={() => navigate("/equipment/admin/items")} className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
              Manage equipment
            </button>
          ) : null}
        </div>
      </div>
      {chips.length > 1 ? (
        <FilterPills options={[{ id: "all", label: "All" }, ...chips.map((c) => ({ id: c.id, label: c.name }))]} value={category} onChange={setCategory} />
      ) : null}
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {loading && !items.length ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading equipment...</p> : null}
      {!loading && !hint && shown.length === 0 ? (
        items.length ? (
          <NeedsEmpty title="No gear matches" body="Try another category or search." />
        ) : (
          <NeedsEmpty title="No equipment yet" body="Your NW admin adds gear to the catalogue." />
        )
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((item) => (
          <EquipmentCard key={item.item_id} item={item} onOpen={() => navigate(`/equipment/items/${item.item_id}`)} />
        ))}
      </div>
    </EquipmentShell>
  );
}

function CountDot({ value }) {
  if (!value) return null;
  return (
    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" aria-label={`${value} waiting`}>
      {value > 99 ? "99+" : value}
    </span>
  );
}
