import { useCallback, useEffect, useMemo, useState } from "react";
import { FaHeart } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { homeBackNav } from "../auth/roleMatrix";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import NeedCard, { NeedsBanner, NeedsEmpty, Segmented } from "../components/needs/NeedCard";
import OfferDialog from "../components/needs/OfferDialog";
import { useOrgCapabilities } from "../hooks/useOrgCapabilities";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useScopedOrganization } from "../utils/organizationScope";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  canManageWishlist,
  formatEstPrice,
  listWishlistItems,
  wishlistErrorMessage,
  wishlistNeededProgressCents,
  wishlistStillNeededCents,
} from "../utils/equipmentWishlist";

/** Needs board for org members (/resident/needs, /needs). Information only: no money is collected. */
export default function NeedsBoard() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.startsWith("/needs") ? "/needs" : "/resident/needs";
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const { capabilities } = useOrgCapabilities();
  const isManager = canManageWishlist(user?.role, user?.platformRole, capabilities);
  const back = homeBackNav(user?.role, user?.platformRole);

  const [filter, setFilter] = useState("needed");
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [offerItem, setOfferItem] = useState(null);

  // One request for both tabs; managers also get cancelled rows, which this board never shows.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await listWishlistItems();
    setLoading(false);
    if (error) {
      setAllItems([]);
      setHint(isRpcNotFoundError(error) ? "Neighbourhood Watch Needs is not switched on yet (run the P2 SQL in Supabase first)." : wishlistErrorMessage(error));
      return;
    }
    setHint("");
    setAllItems(data.filter((i) => i.status !== "cancelled"));
  }, []);

  useEffect(() => {
    void load();
  }, [load, activeOrganizationId]);

  const liveLoad = useCallback(() => load(true), [load]);
  useLiveRefresh(liveLoad, { userId: user?.id });

  const neededItems = useMemo(() => allItems.filter((i) => i.status === "needed"), [allItems]);
  const acquiredItems = useMemo(() => allItems.filter((i) => i.status === "acquired"), [allItems]);
  const items = filter === "needed" ? neededItems : acquiredItems;
  const stillNeeded = wishlistStillNeededCents(neededItems);
  const progress = wishlistNeededProgressCents(neededItems);
  const unpriced = stillNeeded.itemCount - stillNeeded.pricedCount;

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-4 lg:px-4 2xl:max-w-[100rem]">
        <PageHeader
          title="Your Neighbourhood Watch Needs"
          subtitle="Equipment your Neighbourhood Watch needs. Offer to help and the committee will contact you."
          backTo={back.backTo}
          backLabel={back.backLabel}
          rightSlot={<ThemeToggle variant="toolbar" />}
        />
        <NeedsBanner
          title="Help equip your Neighbourhood Watch"
          subtitle="Every radio, torch and first-aid kit makes patrols safer. Prices are estimates; no money is collected in the app."
          stats={[
            { key: "needed", label: "Items needed", value: neededItems.length, onClick: () => setFilter("needed"), active: filter === "needed" },
            { key: "acquired", label: "Acquired so far", value: acquiredItems.length, onClick: () => setFilter("acquired"), active: filter === "acquired" },
            { key: "cost", label: "Still needed (est.)", value: stillNeeded.pricedCount ? formatEstPrice(stillNeeded.cents) : "-" },
          ]}
        >
          {progress.targetCents ? (
            <div className="w-full">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-white/25"
                role="progressbar"
                aria-label="Estimated value of current needs already in hand"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.pct}
              >
                <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${progress.pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-teal-50/90">
                {progress.pct}% in hand: {formatEstPrice(progress.inHandCents)} of {formatEstPrice(progress.targetCents)} (est.)
                {unpriced > 0 ? ` - ${unpriced} item${unpriced === 1 ? "" : "s"} without a price` : ""}
              </p>
            </div>
          ) : null}
        </NeedsBanner>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label="Filter needs"
            value={filter}
            onChange={setFilter}
            options={[
              { key: "needed", label: "Needed", count: neededItems.length },
              { key: "acquired", label: "Acquired", count: acquiredItems.length },
            ]}
          />
          {isManager ? (
            <button
              type="button"
              onClick={() => navigate("/admin/needs")}
              className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950/40"
            >
              Manage needs
            </button>
          ) : null}
        </div>
        {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}
        {filter === "acquired" && acquiredItems.length > 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            <FaHeart className="shrink-0 text-rose-500" aria-hidden />
            Thank you, neighbours! {acquiredItems.length} item{acquiredItems.length === 1 ? " is" : "s are"} now helping keep patrols safe.
          </p>
        ) : null}
        {!loading && !hint && items.length === 0 ? (
          <NeedsEmpty
            title={filter === "needed" ? "Nothing needed right now" : "Nothing acquired yet"}
            body={filter === "needed" ? "Thanks, neighbours! Check back when the committee adds new needs." : "Acquired items will show here."}
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <NeedCard
              key={item.id}
              item={item}
              onOpen={() => navigate(`${base}/${item.id}`)}
              onOffer={() => setOfferItem(item)}
            />
          ))}
        </div>
      </div>
      <OfferDialog item={offerItem} onClose={() => setOfferItem(null)} onSent={() => void load()} />
    </div>
  );
}
