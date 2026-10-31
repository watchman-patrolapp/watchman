import { useCallback, useEffect, useMemo, useState } from "react";
import { FaCheckCircle, FaEllipsisH, FaExclamationCircle, FaInbox, FaSpinner } from "react-icons/fa";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useActiveOrganization } from "../../auth/useActiveOrganization";
import PageHeader from "../../components/layout/PageHeader";
import ThemeToggle from "../../components/ThemeToggle";
import NeedItemEditor from "../../components/needs/NeedItemEditor";
import AcquiredDialog from "../../components/needs/AcquiredDialog";
import LedgerEntryDialog from "../../components/needs/LedgerEntryDialog";
import NeedLedger from "../../components/needs/NeedLedger";
import NeedCard, { Chip, NeedsBanner, NeedsEmpty } from "../../components/needs/NeedCard";
import OfferInboxCard, { InfoTip, OFFER_KIND_VISUAL } from "../../components/needs/OfferInboxCard";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useAuth } from "../../auth/useAuth";
import {
  OFFER_STATUS_META,
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

const INPUT =
  "mt-1 w-full rounded-lg border border-gray-400 bg-white px-3 py-2 text-sm font-normal text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 dark:border-gray-500 dark:bg-gray-900 dark:text-white";
const LABEL = "block text-sm font-medium text-gray-800 dark:text-gray-100";
const HELP = "mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400";
const REASON_MAX = 1000; // matches the DB CHECK + RPC (20261031070000)
const BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
const BTN_PRIMARY =
  "rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-teal-700 hover:to-emerald-700 disabled:opacity-50";

const CHIP = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium";
const CHIP_ON = "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-600";
const CHIP_OFF = "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700";
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

function OverflowMenu({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
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
          <div role="menu" onClick={() => setOpen(false)} className="absolute bottom-full right-0 z-30 mb-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900">
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

const MENU_ITEM =
  "block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800";

/** /admin/needs: editor + offers inbox for NW admins, equipment custodians and global staff. */
export default function NeedsAdmin() {
  const navigate = useNavigate();
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") === "offers" ? "offers" : "items");
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [offers, setOffers] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [editing, setEditing] = useState(null);
  const [offerItemId, setOfferItemId] = useState(null);
  const [hint, setHint] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [acquiredFor, setAcquiredFor] = useState(null);
  const [ledgerFor, setLedgerFor] = useState(null);
  const [ledgerView, setLedgerView] = useState(null);
  const [ledgerKey, setLedgerKey] = useState(0);
  const { user } = useAuth();

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

  const loadOffers = useCallback(async () => {
    const { data, error } = await listWishlistOffers({ itemId: offerItemId, includeClosed: showClosed });
    if (error) {
      setOffers([]);
      if (!isRpcNotFoundError(error)) toast.error(wishlistErrorMessage(error, "Could not load offers."));
      return;
    }
    setOffers(data);
  }, [offerItemId, showClosed]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, activeOrganizationId]);

  useEffect(() => {
    if (tab === "offers") void loadOffers();
  }, [tab, loadOffers, activeOrganizationId]);

  // Live sync: items always; offers while that tab is open; ledger views refresh too.
  // Skip while the item editor is open so a poll never disturbs a half-typed form.
  const liveLoad = useCallback(async () => {
    await loadItems();
    if (tab === "offers") await loadOffers();
    setLedgerKey((k) => k + 1);
  }, [loadItems, loadOffers, tab]);
  useLiveRefresh(liveLoad, { userId: user?.id, enabled: !editing });

  const visibleItems = useMemo(
    () => items.filter((i) => showCancelled || i.status !== "cancelled"),
    [items, showCancelled]
  );
  const stillNeeded = useMemo(() => wishlistStillNeededCents(items), [items]);
  const openOfferTotal = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.open_offer_count) || 0), 0),
    [items]
  );

  const statusCounts = useMemo(() => {
    const c = {};
    for (const o of offers) c[o.status] = (c[o.status] || 0) + 1;
    return c;
  }, [offers]);
  const kindCounts = useMemo(() => {
    const c = {};
    for (const o of offers) c[o.kind] = (c[o.kind] || 0) + 1;
    return c;
  }, [offers]);
  const newOfferCount = statusCounts.new || 0;
  const filteredOffers = useMemo(
    () => offers.filter((o) => (statusFilter === "all" || o.status === statusFilter) && (kindFilter === "all" || o.kind === kindFilter)),
    [offers, statusFilter, kindFilter]
  );
  const selectedItem = useMemo(() => items.find((i) => i.id === offerItemId) || null, [items, offerItemId]);
  const selectedThumb = selectedItem ? wishlistPhotoUrl(wishlistItemPhotoPaths(selectedItem)[0]) : null;

  const changeStatus = async (item, status, quantityAcquired = null) => {
    if (busyId) return;
    let note = null;
    if (status === "cancelled") {
      note = window.prompt("Why is this no longer needed? (optional)", "");
      if (note === null) return;
    }
    setBusyId(item.id);
    try {
      const { data, error } = await setWishlistItemStatus(item.id, { status, quantityAcquired, note });
      if (error) throw error;
      toast.success(data?.status === "acquired" && item.status !== "acquired" ? "Marked acquired. Offerers were thanked." : "Item updated.");
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

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-4 lg:px-4 2xl:max-w-[100rem]">
        <PageHeader
          title="Neighbourhood Watch Needs"
          subtitle={`Equipment your Neighbourhood Watch needs${activeOrganization?.name ? ` - ${activeOrganization.name}` : ""}. No money is collected in the app.`}
          backTo="/admin"
          backLabel="Back to Admin Dashboard"
          rightSlot={<ThemeToggle variant="toolbar" />}
        />
        <NeedsBanner
          title="Neighbourhood Watch Needs"
          subtitle={`${items.filter((i) => i.status === "needed").length} needed - ${openOfferTotal} open offer${openOfferTotal === 1 ? "" : "s"}`}
        >
          {stillNeeded.pricedCount ? (
            <div className="rounded-xl bg-white/15 px-3 py-2 text-right ring-1 ring-white/25 backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-50/90">Still needed (est.)</p>
              <p className="text-lg font-extrabold leading-tight">{formatEstPrice(stillNeeded.cents)}</p>
              {stillNeeded.pricedCount < stillNeeded.itemCount ? (
                <p className="text-[11px] text-teal-50/80">{stillNeeded.itemCount - stillNeeded.pricedCount} item(s) without a price</p>
              ) : null}
            </div>
          ) : null}
        </NeedsBanner>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
            {[
              { key: "items", label: "Items" },
              { key: "offers", label: `Offers${openOfferTotal ? ` (${openOfferTotal})` : ""}` },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`relative rounded-md px-3 py-1.5 font-medium ${tab === t.key ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm" : "text-gray-600 hover:text-teal-700 dark:text-gray-300 dark:hover:text-teal-300"}`}
              >
                {t.label}
                {t.key === "offers" && newOfferCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white" aria-label={`${newOfferCount} new`}>
                    {newOfferCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate("/resident/needs")} className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
              Resident view
            </button>
            {tab === "items" && !editing ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setEditing({ ...EMPTY_FORM })}>
                Add item
              </button>
            ) : null}
          </div>
        </div>
        {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}

        {acquiredFor ? (
          <AcquiredDialog
            item={acquiredFor}
            busy={busyId === acquiredFor.id}
            onClose={() => setAcquiredFor(null)}
            onSubmit={(qty) => saveAcquired(acquiredFor, qty)}
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
            {editing ? (
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
            ) : null}
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              Show cancelled
            </label>
            {!hint && visibleItems.length === 0 ? (
              <NeedsEmpty title="No items yet" body="Tap Add item to list what your Neighbourhood Watch needs." />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleItems.map((item) => (
                <NeedCard key={item.id} item={item}>
                  <div className="flex w-full flex-wrap items-center gap-2">
                    {item.status !== "cancelled" ? (
                      <button type="button" className={BTN_PRIMARY} disabled={busyId === item.id} onClick={() => setAcquiredFor(item)}>
                        Update acquired
                      </button>
                    ) : null}
                    {item.status !== "cancelled" ? (
                      <button type="button" className={BTN} onClick={() => setLedgerFor({ item, mode: "contribution" })}>
                        Record contribution
                      </button>
                    ) : null}
                    {item.open_offer_count ? (
                      <button
                        type="button"
                        className={`${BTN} relative inline-flex items-center gap-1`}
                        onClick={() => {
                          setOfferItemId(item.id);
                          setTab("offers");
                        }}
                      >
                        <FaInbox className="h-3.5 w-3.5" /> Offers
                        <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-bold leading-4 text-white">{item.open_offer_count}</span>
                      </button>
                    ) : null}
                    <div className="ml-auto">
                      <OverflowMenu>
                        <button type="button" className={MENU_ITEM} disabled={busyId === item.id} onClick={() => setEditing(formFromItem(item))}>
                          Edit
                        </button>
                        {item.status === "needed" && item.quantity_acquired < item.quantity_needed - 1 ? (
                          <button type="button" className={MENU_ITEM} disabled={busyId === item.id} onClick={() => saveAcquired(item, item.quantity_acquired + 1)}>
                            +1 acquired
                          </button>
                        ) : null}
                        {item.status === "needed" ? (
                          <button type="button" className={MENU_ITEM} disabled={busyId === item.id} onClick={() => saveAcquired(item, item.quantity_needed)}>
                            Mark all acquired
                          </button>
                        ) : null}
                        {item.status !== "cancelled" ? (
                          <button type="button" className={MENU_ITEM} onClick={() => setLedgerFor({ item, mode: "purchase" })}>
                            Record purchase
                          </button>
                        ) : null}
                        <button type="button" className={MENU_ITEM} onClick={() => setLedgerView(item)}>
                          Ledger
                        </button>
                        {item.status === "needed" ? (
                          <button type="button" className={`${MENU_ITEM} text-rose-700 dark:text-rose-300`} disabled={busyId === item.id} onClick={() => changeStatus(item, "cancelled")}>
                            Cancel item
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={MENU_ITEM}
                            disabled={busyId === item.id}
                            title="Reopen as needed (lower the acquired count first if all were acquired)"
                            onClick={() => changeStatus(item, "needed", item.status === "acquired" ? Math.min(item.quantity_acquired, item.quantity_needed - 1) : null)}
                          >
                            Reopen
                          </button>
                        )}
                      </OverflowMenu>
                    </div>
                  </div>
                </NeedCard>
              ))}
            </div>
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
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                Closed
              </label>
              <InfoTip text="Contact details are for follow-up only. Do not share them outside the committee. Money is arranged privately; never share bank details in the app." />
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {["all", ...Object.keys(OFFER_STATUS_META)].map((s) => {
                const n = s === "all" ? offers.length : statusCounts[s] || 0;
                if (s !== "all" && !n) return null;
                return (
                  <button key={s} type="button" onClick={() => setStatusFilter(s)} className={`${CHIP} shrink-0 ${statusFilter === s ? CHIP_ON : CHIP_OFF}`}>
                    {s === "all" ? "All" : OFFER_STATUS_META[s].label}
                    <span className="rounded-full bg-black/10 px-1.5 text-[10px] font-bold dark:bg-white/15">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {["all", ...Object.keys(OFFER_KIND_VISUAL)].map((k) => {
                const n = k === "all" ? offers.length : kindCounts[k] || 0;
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
            {filteredOffers.length === 0 ? (
              <NeedsEmpty title={offers.length ? "No offers match" : "No offers yet"} body={offers.length ? "Try another filter." : "Offers from residents will appear here."} />
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