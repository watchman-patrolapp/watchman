import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { homeBackNav } from "../auth/roleMatrix";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import NeedCard, { NeedsBanner, NeedsEmpty } from "../components/needs/NeedCard";
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
  wishlistStillNeededCents,
} from "../utils/equipmentWishlist";

const FILTERS = [
  { key: "needed", label: "Needed" },
  { key: "acquired", label: "Acquired" },
];

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState("");
  const [offerItem, setOfferItem] = useState(null);
  // Banner total always comes from the "needed" list, whichever filter is shown.
  const [neededItems, setNeededItems] = useState([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await listWishlistItems({ status: filter });
    setLoading(false);
    if (error) {
      setItems([]);
      setHint(isRpcNotFoundError(error) ? "Neighbourhood Watch Needs is not switched on yet (run the P2 SQL in Supabase first)." : wishlistErrorMessage(error));
      return;
    }
    setHint("");
    setItems(data);
    if (filter === "needed") setNeededItems(data);
    else {
      const res = await listWishlistItems({ status: "needed" });
      setNeededItems(res.error ? [] : res.data);
    }
  }, [filter]);
  const stillNeeded = wishlistStillNeededCents(neededItems);

  useEffect(() => {
    void load();
  }, [load, activeOrganizationId]);

  const liveLoad = useCallback(() => load(true), [load]);
  useLiveRefresh(liveLoad, { userId: user?.id });

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
        <NeedsBanner title="Help equip your Neighbourhood Watch" subtitle="Every radio, torch and first-aid kit makes patrols safer.">
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
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  filter === f.key ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm" : "text-gray-600 hover:text-teal-700 dark:text-gray-300 dark:hover:text-teal-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {isManager ? (
            <button
              type="button"
              onClick={() => navigate("/admin/needs")}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Manage Neighbourhood Watch Needs
            </button>
          ) : null}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Prices are estimates for information only. No money is collected in the app.
        </p>
        {hint ? <p className="text-sm text-amber-800 dark:text-amber-200">{hint}</p> : null}
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