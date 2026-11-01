import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FaPlus, FaPrint } from "react-icons/fa";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../auth/useAuth";
import { useScopedOrganization } from "../../../utils/organizationScope";
import { NeedsEmpty } from "../../../components/needs/NeedCard";
import EquipmentCard from "../../../components/equipment/EquipmentCard";
import EquipmentItemEditor, { BTN, BTN_PRIMARY, EMPTY_ITEM, itemFormFromDetail } from "../../../components/equipment/EquipmentItemEditor";
import EquipmentUnitsPanel from "../../../components/equipment/EquipmentUnitsPanel";
import {
  canManageEquipment,
  ensureEquipmentDefaults,
  equipmentCategoryChips,
  equipmentErrorMessage,
  filterEquipmentCatalogue,
  getEquipmentItem,
  listEquipmentCatalogue,
  listEquipmentCategories,
} from "../../../utils/equipment";
import EquipmentShell, { EquipmentBanner, EquipmentNotice, FilterPills, SEARCH_INPUT } from "../EquipmentShell";

/** /equipment/admin/items: NW admin catalogue grid + item editor + units. */
export default function EquipmentAdminItems() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const allowed = canManageEquipment(user?.role, user?.platformRole);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cat, cats] = await Promise.all([listEquipmentCatalogue({ includeArchived: true }), listEquipmentCategories(activeOrganizationId)]);
    setLoading(false);
    if (cat.error) {
      setHint(equipmentErrorMessage(cat.error));
      setItems([]);
      return;
    }
    setHint("");
    setItems(cat.data);
    if (!cats.error && cats.data.length === 0) {
      const { error } = await ensureEquipmentDefaults();
      if (!error) {
        const again = await listEquipmentCategories(activeOrganizationId);
        setCategories(again.data);
        return;
      }
    }
    setCategories(cats.data);
  }, [activeOrganizationId]);

  useEffect(() => {
    if (allowed) void load();
  }, [load, allowed]);

  // ?edit=<id> opens that item (deep link from the member pages).
  useEffect(() => {
    if (!editId || !allowed) return undefined;
    let alive = true;
    getEquipmentItem(editId).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) toast.error(equipmentErrorMessage(error || { message: "not found" }));
      else setEditing(itemFormFromDetail(data));
    });
    return () => {
      alive = false;
    };
  }, [editId, allowed]);

  const chips = useMemo(() => equipmentCategoryChips(items), [items]);
  const shown = useMemo(() => filterEquipmentCatalogue(items, { categoryId: category, query }), [items, category, query]);
  const unitTotal = items.reduce((n, i) => n + (Number(i.unit_count) || 0), 0);

  const closeEditor = () => {
    setEditing(null);
    if (editId) setSearchParams({}, { replace: true });
  };

  if (!allowed) {
    return (
      <EquipmentShell title="Manage equipment" backTo="/equipment" backLabel="Back to equipment">
        <EquipmentNotice>Only your NW admin can manage equipment.</EquipmentNotice>
      </EquipmentShell>
    );
  }

  return (
    <EquipmentShell
      wide
      title="Manage equipment"
      subtitle="Catalogue, units, QR labels and invoices."
      backTo="/admin"
      backLabel="Back to Admin Dashboard"
    >
      <EquipmentBanner title="Equipment catalogue" subtitle={`${items.length} item${items.length === 1 ? "" : "s"} · ${unitTotal} unit${unitTotal === 1 ? "" : "s"}`}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate("/equipment/admin/labels")} className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/25">
            <FaPrint aria-hidden /> Print labels
          </button>
          {!editing ? (
            <button type="button" onClick={() => setEditing({ ...EMPTY_ITEM })} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 shadow hover:bg-teal-50">
              <FaPlus aria-hidden /> Add item
            </button>
          ) : null}
        </div>
      </EquipmentBanner>
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}

      {editing ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <EquipmentItemEditor
            key={editing.id || "new"}
            initial={editing}
            orgId={activeOrganizationId}
            categories={categories}
            onCancel={closeEditor}
            onSaved={async (id) => {
              const { data } = await getEquipmentItem(id);
              if (data) setEditing(itemFormFromDetail(data));
              void load();
            }}
          />
          {editing.id ? (
            <EquipmentUnitsPanel itemId={editing.id} orgId={activeOrganizationId} />
          ) : (
            <p className="rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">Save the item first, then add its units.</p>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items..." aria-label="Search items" className={SEARCH_INPUT} />
        <button type="button" onClick={() => navigate("/equipment")} className="self-start text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 sm:self-auto">
          Member view
        </button>
      </div>
      {chips.length > 1 ? (
        <FilterPills options={[{ id: "all", label: "All" }, ...chips.map((c) => ({ id: c.id, label: c.name }))]} value={category} onChange={setCategory} />
      ) : null}
      {!loading && !hint && shown.length === 0 ? (
        <NeedsEmpty title={items.length ? "No items match" : "No equipment yet"} body={items.length ? "Try another category or search." : "Tap Add item, or add acquired Needs to the inventory from Neighbourhood Watch Needs."} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((item) => (
          <EquipmentCard key={item.item_id} item={item}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={async () => {
                  const { data, error } = await getEquipmentItem(item.item_id);
                  if (error || !data) {
                    toast.error(equipmentErrorMessage(error || { message: "not found" }));
                    return;
                  }
                  setEditing(itemFormFromDetail(data));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Edit & units
              </button>
              <button type="button" className={BTN} onClick={() => navigate(`/equipment/items/${item.item_id}`)}>
                View
              </button>
              {Number(item.unit_count) ? (
                <button type="button" className={BTN} onClick={() => navigate(`/equipment/admin/labels?item=${item.item_id}`)}>
                  Labels
                </button>
              ) : null}
            </div>
          </EquipmentCard>
        ))}
      </div>
    </EquipmentShell>
  );
}
