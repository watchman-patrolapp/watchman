import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaEllipsisH, FaInbox, FaList, FaThLarge, FaToolbox } from "react-icons/fa";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useActiveOrganization } from "../../auth/useActiveOrganization";
import PageHeader from "../../components/layout/PageHeader";
import ThemeToggle from "../../components/ThemeToggle";
import NeedItemEditor from "../../components/needs/NeedItemEditor";
import AcquiredDialog from "../../components/needs/AcquiredDialog";
import CancelItemDialog from "../../components/needs/CancelItemDialog";
import LedgerEntryDialog from "../../components/needs/LedgerEntryDialog";
import NeedLedger from "../../components/needs/NeedLedger";
import NeedsList from "../../components/needs/NeedsList";
import NeedCard, { NeedsBanner, NeedsEmpty, Segmented } from "../../components/needs/NeedCard";
import OfferInboxCard, { InfoTip, OFFER_KIND_VISUAL } from "../../components/needs/OfferInboxCard";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useAuth } from "../../auth/useAuth";
import {
  OPEN_OFFER_STATUSES,
  listWishlistItems,
  listWishlistOffers,
  setWishlistItemStatus,
  formatEstPrice,
  wishlistErrorMessage,
  setWishlistItemAcquired,
  wishlistItemPhotoPaths,
  wishlistPhotoUrl,
  wishlistStillNeededCents,
} from "../../utils/equipmentWishlist";
import { canManageEquipment, createEquipmentFromWishlist, equipmentErrorMessage, listEquipmentWishlistLinks } from "../../utils/equipment";

const BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
const BTN_PRIMARY =
  "rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50";

const CHIP = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium";
const CHIP_ON = "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-600";
const CHIP_OFF = "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
const VIEW_KEY = "needs-admin-view";
const EMPTY_FORM = {
  id: null,
  title: "",
  reason: "",
  quantityNeeded: "1",
  estRands: "",
  storeUrl: "",
  productCode: "",
  priority: "normal",
  categoryHint: "",
  photoPath: null,
  photoPaths: [],
};

const ITEM_FILTERS = ["needed", "acquired", "cancelled", "all"];
const ITEM_FILTER_LABELS = { needed: "Needed", acquired: "Acquired", cancelled: "Cancelled", all: "All" };

/** Offer groups: "new" = waiting for the committee, "open" = not closed yet. */
const OFFER_GROUPS = [
  { key: "new", label: "Pending", match: (o) => o.status === "new" },
  { key: "open", label: "Open", match: (o) => OPEN_OFFER_STATUSES.includes(o.status) },
  { key: "closed", label: "Closed", match: (o) => !OPEN_OFFER_STATUSES.includes(o.status) },
  { key: "all", label: "All", match: () => true },
];

function formFromItem(item) {
  return {
    id: item.id,
    title: item.title || "",
    reason: item.reason || "",
    quantityNeeded: String(item.quantity_needed ?? 1),
    estRands: item.est_unit_price_cents == null ? "" : String(Number(item.est_unit_price_cents) / 100),
    storeUrl: item.store_url || "",
    productCode: item.product_code || "",
    priority: item.priority || "normal",
    categoryHint: item.category_hint || "",
    photoPath: item.photo_path || null,
    photoPaths: wishlistItemPhotoPaths(item),
  };
}

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

function OverflowMenu({ children, placement = "up" }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <FaEllipsisH className="h-3.5 w-3.5" /> More
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div
            role="menu"
            onClick={() => setOpen(false)}
            className={`absolute right-0 z-30 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900 ${
              placement === "down" ? "top-full mt-1" : "bottom-full mb-1"
            }`}
          >
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

const MENU_ITEM =
  "block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800";
const MENU_LABEL = "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500";
const MENU_DIVIDER = "my-1 border-t border-gray-100 dark:border-gray-800";

/** /admin/needs: editor + offers inbox for NW admins, equipment custodians and global staff. */
export default function NeedsAdmin() {
  const navigate = useNavigate();
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") === "offers" ? "offers" : "items");
  const [itemFilter, setItemFilter] = useState("needed");
  const [view, setViewState] = useState(readView);
  const [offerGroup, setOfferGroup] = useState(null);
  const [kindFilter, setKindFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [offers, setOffers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [offerItemId, setOfferItemId] = useState(null);
  const [hint, setHint] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [acquiredFor, setAcquiredFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [ledgerFor, setLedgerFor] = useState(null);
  const [ledgerView, setLedgerView] = useState(null);
  const [ledgerKey, setLedgerKey] = useState(0);
  const { user } = useAuth();
  const isEquipmentManager = canManageEquipment(user?.role, user?.platformRole);
  const [inventoryLinks, setInventoryLinks] = useState(() => new Map());

  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode: preference just isn't kept */
    }
  };

  useEffect(() => {
    if (!isEquipmentManager) return undefined;
    let alive = true;
    listEquipmentWishlistLinks().then(({ data }) => {
      if (alive) setInventoryLinks(data);
    });
    return () => {
      alive = false;
    };
  }, [isEquipmentManager, activeOrganizationId]);

  const addToInventory = async (item) => {
    const existing = inventoryLinks.get(item.id);
    if (existing) {
      navigate(`/equipment/admin/items?edit=${existing}`);
      return;
    }
    setBusyId(item.id);
    const { data, error } = await createEquipmentFromWishlist(item.id);
    setBusyId(null);
    if (error || !data) {
      toast.error(equipmentErrorMessage(error, "Could not add it to the inventory."));
      return;
    }
    setInventoryLinks((m) => new Map(m).set(item.id, data));
    toast.success("Added to the equipment catalogue. Add its units next.");
    navigate(`/equipment/admin/items?edit=${data}`);
  };

  const loadItems = useCallback(async () => {
    const { data, error } = await listWishlistItems();
    if (error) {
      setItems([]);
      setHint(isRpcNotFoundError(error) ? "Run the needs board SQL (P2) in Supabase first." : wishlistErrorMessage(error));
      return;
    }
    setHint("");
    setItems(data);
  }, []);

  const newOfferCount = useMemo(() => offers.filter((o) => o.status === "new").length, [offers]);
  // Before the admin picks a group, open on "Pending" when anything is waiting.
  const effectiveGroup = offerGroup ?? (newOfferCount ? "new" : "open");
  const includeClosed = effectiveGroup === "closed" || effectiveGroup === "all";

  const loadOffers = useCallback(async () => {
    const { data, error } = await listWishlistOffers({ itemId: offerItemId, includeClosed });
    if (error) {
      setOffers([]);
      if (!isRpcNotFoundError(error)) toast.error(wishlistErrorMessage(error, "Could not load offers."));
      return;
    }
    setOffers(data);
  }, [offerItemId, includeClosed]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, activeOrganizationId]);

  // Offers load on both tabs: the banner shows the pending count.
  useEffect(() => {
    void loadOffers();
  }, [loadOffers, activeOrganizationId]);

  // Skip while the item editor is open so a poll never disturbs a half-typed form.
  const liveLoad = useCallback(async () => {
    await Promise.all([loadItems(), loadOffers()]);
    setLedgerKey((k) => k + 1);
  }, [loadItems, loadOffers]);
  useLiveRefresh(liveLoad, { userId: user?.id, enabled: !editing });

  const itemCounts = useMemo(() => {
    const c = { needed: 0, acquired: 0, cancelled: 0, all: items.length };
    for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [items]);
  const visibleItems = useMemo(
    () => (itemFilter === "all" ? items : items.filter((i) => i.status === itemFilter)),
    [items, itemFilter]
  );
  const stillNeeded = useMemo(() => wishlistStillNeededCents(items), [items]);
  const openOfferTotal = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.open_offer_count) || 0), 0),
    [items]
  );

  const groupCounts = useMemo(() => {
    const c = {};
    for (const g of OFFER_GROUPS) c[g.key] = offers.filter(g.match).length;
    return c;
  }, [offers]);
  const groupOffers = useMemo(() => {
    const g = OFFER_GROUPS.find((x) => x.key === effectiveGroup) || OFFER_GROUPS[1];
    return offers.filter(g.match);
  }, [offers, effectiveGroup]);
  const kindCounts = useMemo(() => {
    const c = {};
    for (const o of groupOffers) c[o.kind] = (c[o.kind] || 0) + 1;
    return c;
  }, [groupOffers]);
  const filteredOffers = useMemo(
    () => groupOffers.filter((o) => kindFilter === "all" || o.kind === kindFilter),
    [groupOffers, kindFilter]
  );
  const selectedItem = useMemo(() => items.find((i) => i.id === offerItemId) || null, [items, offerItemId]);
  const selectedThumb = selectedItem ? wishlistPhotoUrl(wishlistItemPhotoPaths(selectedItem)[0]) : null;

  const showItems = (filter) => {
    setTab("items");
    setItemFilter(filter);
  };
  const showOffers = (group, itemId = null) => {
    setTab("offers");
    setOfferGroup(group);
    setOfferItemId(itemId);
  };

  const changeStatus = async (item, status, quantityAcquired = null, note = null) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const { data, error } = await setWishlistItemStatus(item.id, { status, quantityAcquired, note });
      if (error) throw error;
      toast.success(data?.status === "acquired" && item.status !== "acquired" ? "Marked acquired. Offerers were thanked." : "Item updated.");
      setCancelFor(null);
      await loadItems();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not update the item."));
    } finally {
      setBusyId(null);
    }
  };

  const saveAcquired = async (item, qty) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const { data, error } = await setWishlistItemAcquired(item.id, qty);
      if (error) throw error;
      toast.success(
        data?.status === "acquired" && item.status !== "acquired"
          ? "All acquired. Offerers were thanked."
          : `${data?.quantity_acquired ?? qty} of ${item.quantity_needed} acquired.`
      );
      setAcquiredFor(null);
      await loadItems();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not update the item."));
    } finally {
      setBusyId(null);
    }
  };

  /** Context-aware actions: one primary button, the rest grouped in "More". */
  const renderActions = (item, placement = "up") => {
    const busy = busyId === item.id;
    const offersOpen = Number(item.open_offer_count) || 0;
    const canInventory = isEquipmentManager && (item.status === "acquired" || item.quantity_acquired > 0);
    const inInventory = inventoryLinks.has(item.id);
    const live = item.status !== "cancelled";

    let primary = null;
    let primaryIsAcquired = false;
    if (offersOpen && live) {
      primary = (
        <button type="button" className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`} onClick={() => showOffers("open", item.id)}>
          <FaInbox className="h-3.5 w-3.5" aria-hidden /> Review offers
          <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold leading-4">{offersOpen}</span>
        </button>
      );
    } else if (item.status === "acquired" && canInventory) {
      primary = (
        <button
          type="button"
          className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}
          disabled={busy}
          title={inInventory ? "Open it in the equipment catalogue" : "Create an equipment catalogue item from this need"}
          onClick={() => addToInventory(item)}
        >
          <FaToolbox className="h-3.5 w-3.5" aria-hidden /> {inInventory ? "In inventory" : "Add to inventory"}
        </button>
      );
    } else if (live) {
      primaryIsAcquired = true;
      primary = (
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => setAcquiredFor(item)}>
          Update acquired
        </button>
      );
    }
    const secondaryAcquired = live && !primaryIsAcquired ? (
      <button type="button" className={BTN} disabled={busy} onClick={() => setAcquiredFor(item)}>
        Update acquired
      </button>
    ) : null;

    return (
      <>
        {primary}
        {secondaryAcquired}
        <div className="ml-auto">
          <OverflowMenu placement={placement}>
            {item.status === "needed" ? (
              <>
                <p className={MENU_LABEL}>Quantity</p>
                {item.quantity_acquired < item.quantity_needed - 1 ? (
                  <button type="button" className={MENU_ITEM} disabled={busy} onClick={() => saveAcquired(item, item.quantity_acquired + 1)}>
                    +1 acquired
                  </button>
                ) : null}
                <button type="button" className={MENU_ITEM} disabled={busy} onClick={() => saveAcquired(item, item.quantity_needed)}>
                  Mark all acquired
                </button>
                <div className={MENU_DIVIDER} />
              </>
            ) : null}
            <p className={MENU_LABEL}>Money (ledger)</p>
            {live ? (
              <>
                <button type="button" className={MENU_ITEM} onClick={() => setLedgerFor({ item, mode: "contribution" })}>
                  Record money received
                </button>
                <button type="button" className={MENU_ITEM} onClick={() => setLedgerFor({ item, mode: "purchase" })}>
                  Record purchase
                </button>
              </>
            ) : null}
            <button type="button" className={MENU_ITEM} onClick={() => setLedgerView(item)}>
              View ledger
            </button>
            <div className={MENU_DIVIDER} />
            <p className={MENU_LABEL}>Item</p>
            <button type="button" className={MENU_ITEM} disabled={busy} onClick={() => setEditing(formFromItem(item))}>
              Edit
            </button>
            {canInventory && item.status !== "acquired" ? (
              <button type="button" className={MENU_ITEM} disabled={busy} onClick={() => addToInventory(item)}>
                {inInventory ? "Open in inventory" : "Add to inventory"}
              </button>
            ) : null}
            {item.status === "needed" ? (
              <button type="button" className={`${MENU_ITEM} text-rose-700 dark:text-rose-300`} disabled={busy} onClick={() => setCancelFor(item)}>
                Cancel item
              </button>
            ) : (
              <button
                type="button"
                className={MENU_ITEM}
                disabled={busy}
                title="Reopen as needed (lowers the acquired count by one if all were acquired)"
                onClick={() => changeStatus(item, "needed", item.status === "acquired" ? Math.min(item.quantity_acquired, item.quantity_needed - 1) : null)}
              >
                Reopen
              </button>
            )}
          </OverflowMenu>
        </div>
      </>
    );
  };

  const unpriced = stillNeeded.itemCount - stillNeeded.pricedCount;

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-4 lg:px-4 2xl:max-w-[100rem]">
        <PageHeader
          title="Neighbourhood Watch Needs"
          subtitle="List what your Neighbourhood Watch needs, follow up offers and record what came in. No money is collected in the app."
          backTo="/admin"
          backLabel="Back to Admin Dashboard"
          rightSlot={<ThemeToggle variant="toolbar" />}
        />
        <NeedsBanner
          title={activeOrganization?.name || "Overview"}
          subtitle={unpriced > 0 ? `${unpriced} needed item${unpriced === 1 ? "" : "s"} without a price (not in the estimate)` : null}
          stats={[
            { key: "needed", label: "Needed", value: itemCounts.needed, onClick: () => showItems("needed"), active: tab === "items" && itemFilter === "needed" },
            { key: "acquired", label: "Acquired", value: itemCounts.acquired, onClick: () => showItems("acquired"), active: tab === "items" && itemFilter === "acquired" },
            { key: "pending", label: "Pending offers", value: newOfferCount, onClick: () => showOffers("new"), active: tab === "offers" && effectiveGroup === "new" },
            { key: "cost", label: "Still needed (est.)", value: stillNeeded.pricedCount ? formatEstPrice(stillNeeded.cents) : "-" },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative">
            <Segmented
              label="Section"
              value={tab}
              onChange={setTab}
              options={[
                { key: "items", label: "Items" },
                { key: "offers", label: "Offers", count: openOfferTotal || null },
              ]}
            />
            {newOfferCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${newOfferCount} pending`}>
                {newOfferCount}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate("/resident/needs")} className={BTN}>
              Resident view
            </button>
            {tab === "items" ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setEditing({ ...EMPTY_FORM })}>
                Add item
              </button>
            ) : null}
          </div>
        </div>
        {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}

        {editing ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={editing.id ? "Edit item" : "New item"}>
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl">
              <NeedItemEditor
                key={editing.id || "new"}
                initial={editing}
                orgId={activeOrganizationId}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  void loadItems();
                }}
              />
            </div>
          </div>
        ) : null}
        {acquiredFor ? (
          <AcquiredDialog
            item={acquiredFor}
            busy={busyId === acquiredFor.id}
            onClose={() => setAcquiredFor(null)}
            onSubmit={(qty) => saveAcquired(acquiredFor, qty)}
          />
        ) : null}
        {cancelFor ? (
          <CancelItemDialog
            item={cancelFor}
            busy={busyId === cancelFor.id}
            onClose={() => setCancelFor(null)}
            onConfirm={(note) => changeStatus(cancelFor, "cancelled", null, note)}
          />
        ) : null}
        {ledgerFor ? (
          <LedgerEntryDialog
            key={`${ledgerFor.mode}-${ledgerFor.item.id}-${ledgerFor.entry?.id || ledgerFor.offerId || ""}`}
            item={ledgerFor.item}
            orgId={activeOrganizationId}
            mode={ledgerFor.mode}
            offerId={ledgerFor.offerId || null}
            pledgeCents={ledgerFor.pledgeCents || null}
            entry={ledgerFor.entry || null}
            maxCents={ledgerFor.maxCents ?? null}
            onClose={() => setLedgerFor(null)}
            onSaved={() => {
              setLedgerKey((k) => k + 1);
              void loadItems();
            }}
          />
        ) : null}
        {ledgerView && !ledgerFor ? (
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
            <div role="dialog" aria-modal="true" aria-label={`Ledger - ${ledgerView.title}`} className="max-h-[90vh] w-full max-w-lg space-y-2 overflow-y-auto">
              <NeedLedger
                itemId={ledgerView.id}
                refreshKey={ledgerKey}
                onCorrect={(entry, left) => setLedgerFor({ item: ledgerView, mode: "correction", entry, maxCents: left })}
              />
              <div className="flex justify-end">
                <button type="button" className={BTN} onClick={() => setLedgerView(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {tab === "items" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                label="Filter items"
                value={itemFilter}
                onChange={setItemFilter}
                options={ITEM_FILTERS.map((k) => ({ key: k, label: ITEM_FILTER_LABELS[k], count: itemCounts[k] || 0 }))}
              />
              <Segmented
                label="Layout"
                value={view}
                onChange={setView}
                options={[
                  { key: "cards", label: <FaThLarge className="h-3.5 w-3.5" aria-hidden />, ariaLabel: "Card view" },
                  { key: "list", label: <FaList className="h-3.5 w-3.5" aria-hidden />, ariaLabel: "List view" },
                ]}
              />
            </div>
            {!hint && visibleItems.length === 0 ? (
              items.length === 0 ? (
                <NeedsEmpty title="No items yet" body="Tap Add item to list what your Neighbourhood Watch needs." />
              ) : (
                <NeedsEmpty title={`No ${ITEM_FILTER_LABELS[itemFilter].toLowerCase()} items`} body="Try another filter." />
              )
            ) : null}
            {visibleItems.length > 0 && view === "list" ? (
              <NeedsList items={visibleItems} renderActions={(item) => renderActions(item, "down")} />
            ) : null}
            {visibleItems.length > 0 && view === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleItems.map((item) => (
                  <NeedCard key={item.id} item={item} showProductCode>
                    <div className="flex w-full flex-wrap items-center gap-2">{renderActions(item)}</div>
                  </NeedCard>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-900">
                {selectedThumb ? (
                  <img src={selectedThumb} alt="" className="h-full w-full object-contain" />
                ) : (
                  <FaInbox className="h-4 w-4 text-gray-400" aria-hidden="true" />
                )}
              </div>
              <select
                value={offerItemId || ""}
                onChange={(e) => setOfferItemId(e.target.value || null)}
                aria-label="Filter by item"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                <option value="">All items</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
              <InfoTip text="Contact details are for follow-up only. Do not share them outside the committee. Money is arranged privately; never share bank details in the app." />
            </div>
            <Segmented
              label="Filter offers"
              value={effectiveGroup}
              onChange={(g) => {
                setOfferGroup(g);
                setKindFilter("all");
              }}
              options={OFFER_GROUPS.map((g) => ({
                key: g.key,
                label: g.label,
                count: includeClosed || g.key === "new" || g.key === "open" ? groupCounts[g.key] : null,
              }))}
            />
            {groupOffers.length ? (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {["all", ...Object.keys(OFFER_KIND_VISUAL)].map((k) => {
                  const n = k === "all" ? groupOffers.length : kindCounts[k] || 0;
                  if (k !== "all" && !n) return null;
                  const v = OFFER_KIND_VISUAL[k];
                  const Icon = v?.Icon;
                  return (
                    <button key={k} type="button" onClick={() => setKindFilter(k)} className={`${CHIP} shrink-0 ${kindFilter === k ? CHIP_ON : CHIP_OFF}`}>
                      {Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
                      {k === "all" ? "All types" : v.label}
                      <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-bold dark:bg-white/15">{n}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {filteredOffers.length === 0 ? (
              <NeedsEmpty
                title={effectiveGroup === "new" ? "Nothing waiting for the committee" : offers.length ? "No offers match" : "No offers yet"}
                body={effectiveGroup === "new" ? "New offers from residents land here first." : offers.length ? "Try another filter." : "Offers from residents will appear here."}
              />
            ) : null}
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredOffers.map((o) => (
                <OfferInboxCard
                  key={o.id}
                  offer={o}
                  onRecord={(off) => {
                    const it = items.find((i) => i.id === off.wishlist_item_id);
                    if (it) setLedgerFor({ item: it, mode: "contribution", offerId: off.id, pledgeCents: off.pledged_amount_cents || null });
                    else toast.error("That item is no longer listed.");
                  }}
                  onChanged={() => {
                    void loadOffers();
                    void loadItems();
                  }}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
