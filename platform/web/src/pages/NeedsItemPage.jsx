import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import NeedCard, { Chip } from "../components/needs/NeedCard";
import OfferDialog from "../components/needs/OfferDialog";
import NeedLedger from "../components/needs/NeedLedger";
import { useScopedOrganization } from "../utils/organizationScope";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useAuth } from "../auth/useAuth";
import {
  OFFER_STATUS_META,
  OPEN_OFFER_STATUSES,
  contributionThanksText,
  formatEstPrice,
  getMyOffer,
  listContributionContacts,
  listWishlistItems,
  withdrawWishlistOffer,
  wishlistErrorMessage,
} from "../utils/equipmentWishlist";

/** One needs-board item with "My offer" status and withdraw. */
export default function NeedsItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.startsWith("/needs") ? "/needs" : "/resident/needs";
  const { activeOrganizationId } = useScopedOrganization();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const { user } = useAuth();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error: err } = await listWishlistItems({ itemId: id });
    setLoading(false);
    if (err) {
      setItem(null);
      setError(wishlistErrorMessage(err));
      return;
    }
    setError(data.length ? "" : "That item was not found.");
    setItem(data[0] || null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, activeOrganizationId]);

  const liveLoad = useCallback(async () => {
    await load(true);
    setLiveTick((t) => t + 1);
  }, [load]);
  useLiveRefresh(liveLoad, { userId: user?.id });

  const myMeta = item?.my_offer_status ? OFFER_STATUS_META[item.my_offer_status] : null;
  const myOpen = item?.my_offer_status && OPEN_OFFER_STATUSES.includes(item.my_offer_status);

  const myOfferId = item?.my_offer_id;
  const itemId = item?.id;
  const [contributeLine, setContributeLine] = useState("");
  const [myPledge, setMyPledge] = useState(null);
  useEffect(() => {
    if (!myOfferId || !myOpen) {
      setContributeLine("");
      setMyPledge(null);
      return undefined;
    }
    let live = true;
    (async () => {
      const mine = await getMyOffer(myOfferId);
      if (live) setMyPledge(mine?.pledged_amount_cents || null);
      if (mine?.kind !== "contribute_cost") {
        if (live) setContributeLine("");
        return;
      }
      const { names } = await listContributionContacts(itemId);
      if (live) setContributeLine(contributionThanksText(names));
    })();
    return () => {
      live = false;
    };
  }, [myOfferId, myOpen, itemId]);

  const withdraw = async () => {
    if (!item?.my_offer_id || busy) return;
    if (!window.confirm("Withdraw your offer? The committee won't follow up on it.")) return;
    setBusy(true);
    try {
      const { error: err } = await withdrawWishlistOffer(item.my_offer_id);
      if (err) throw err;
      toast.success("Offer withdrawn.");
      await load();
    } catch (err) {
      toast.error(wishlistErrorMessage(err, "Could not withdraw."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto w-full max-w-xl space-y-4 lg:max-w-4xl lg:px-4">
        <PageHeader
          title="Your Neighbourhood Watch Needs"
          backTo={base}
          backLabel="Back to Your Neighbourhood Watch Needs"
          rightSlot={<ThemeToggle variant="toolbar" />}
        />
        {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading.</p> : null}
        {!loading && error ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
            <button type="button" onClick={() => navigate(base)} className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400">
              Open Your Neighbourhood Watch Needs
            </button>
          </div>
        ) : null}
        {item ? (
          <>
            <NeedCard item={item} onOffer={() => setOfferOpen(true)} fullscreenPhotos showProductCode />
            {myMeta ? (
              <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <span className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
                  My offer <Chip tone={myMeta.tone}>{myMeta.label}</Chip>
                </span>
                {contributeLine ? (
                  <p className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                    {contributeLine} Never share bank details in the app.
                    {myPledge ? (
                      <span className="mt-1 block font-semibold">
                        Your pledge: {formatEstPrice(myPledge)} (only the NW admins see this; counted once they confirm receipt).
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {myOpen ? (
                  <button
                    type="button"
                    onClick={withdraw}
                    disabled={busy}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {busy ? "Withdrawing." : "Withdraw offer"}
                  </button>
                ) : null}
              </section>
            ) : null}
            <NeedLedger itemId={item.id} refreshKey={liveTick} />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Prices are estimates for information only. No money is collected in the app.
            </p>
          </>
        ) : null}
      </div>
      <OfferDialog item={offerOpen ? item : null} onClose={() => setOfferOpen(false)} onSent={() => void load()} />
    </div>
  );
}