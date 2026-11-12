import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import PrivateMediaImg from "../../components/media/PrivateMediaImg";
import ServiceContactButtons from "../../components/services/ServiceContactButtons";
import { COMMUNITY_MEDIA_BUCKET } from "../../utils/communityMedia";
import ReportContentButton from "../../components/community/ReportContentButton";
import ReviewForm from "../../components/services/ReviewForm";
import ReviewList from "../../components/services/ReviewList";
import StarRating from "../../components/services/StarRating";
import { getServiceListing, listListingReviews, listMyOrgNeighbours } from "../../utils/localServicesApi";
import { canPostAreaBroadcast } from "../../auth/roleMatrix";
import { useOrgCapabilities } from "../../hooks/useOrgCapabilities";
import {
  LOAD_FALLBACK,
  REVIEW_LOAD_FALLBACK,
  VERIFY_TO_RATE_MESSAGE,
  friendlyServiceError,
  hoursFromJson,
  ratingSummary,
  reviewViewerState,
} from "../../utils/localServices";
import { useAuth } from "../../auth/useAuth";

const BACK = "/resident/contacts?tab=services";

export default function ServiceListingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [row, setRow] = useState(null);
  const [suburb, setSuburb] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState([]);
  const [reviewError, setReviewError] = useState("");
  const { has: hasCap } = useOrgCapabilities();

  const loadReviews = useCallback(async () => {
    try {
      setReviews(await listListingReviews(id));
      setReviewError("");
    } catch (err) {
      setReviews([]);
      setReviewError(friendlyServiceError(err, REVIEW_LOAD_FALLBACK));
    }
  }, [id]);

  const reloadListing = useCallback(async () => {
    try {
      setRow(await getServiceListing(id));
    } catch {
      /* keep the current row */
    }
    await loadReviews();
  }, [id, loadReviews]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getServiceListing(id);
        if (!alive) return;
        setRow(data);
        const homeOrg = user?.activeOrganizationId ?? user?.organizationId ?? null;
        if (homeOrg && data.organization_id !== homeOrg) {
          const neighbours = await listMyOrgNeighbours().catch(() => []);
          const match = neighbours.find((n) => n.organization_id === data.organization_id);
          if (alive) setSuburb(match?.suburb_name || "Neighbouring suburb");
        }
      } catch (err) {
        if (alive) setError(friendlyServiceError(err, LOAD_FALLBACK));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, user?.activeOrganizationId, user?.organizationId]);

  const hours = row ? hoursFromJson(row.hours_json) : "";
  const isOwner = Boolean(row) && row.owner_user_id === user?.id;
  const homeOrgId = user?.activeOrganizationId ?? user?.organizationId ?? null;
  const isOwnOrgListing = Boolean(row) && Boolean(homeOrgId) && row.organization_id === homeOrgId;
  const canModerate =
    isOwnOrgListing && (canPostAreaBroadcast(user?.role, user?.platformRole) || hasCap("resident_moderator"));
  const viewerState = reviewViewerState({ isVerified: Boolean(user?.isVerifiedResident), isOwner });
  const myReview = reviews.find((r) => r.is_mine);

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={row?.title || "Local service"} backTo={BACK} backLabel="Back to services" />
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : row ? (
          <article className="space-y-4 rounded-xl bg-white p-5 shadow dark:bg-gray-800">
            <div className="flex flex-wrap items-center gap-2">
              {row.business_name ? <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{row.business_name}</p> : null}
              {suburb ? (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">{suburb}</span>
              ) : null}
            </div>
            {row.photo_paths?.length ? (
              <div className="flex flex-wrap gap-2">
                {row.photo_paths.map((p) => (
                  <PrivateMediaImg key={p} stored={p} bucket={COMMUNITY_MEDIA_BUCKET} alt="" className="h-32 w-32 rounded-lg object-cover" />
                ))}
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">{row.description}</p>
            <dl className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              {row.service_area ? <div><dt className="inline font-medium">Area: </dt><dd className="inline">{row.service_area}</dd></div> : null}
              {hours ? <div><dt className="inline font-medium">Hours: </dt><dd className="inline">{hours}</dd></div> : null}
              {row.price_note ? <div><dt className="inline font-medium">Price: </dt><dd className="inline">{row.price_note}</dd></div> : null}
            </dl>
            <ServiceContactButtons phone={row.phone} whatsapp={row.whatsapp} email={row.email} website={row.website} />
            <div className="flex items-center gap-3">
              <StarRating value={Math.round(Number(row.avg_rating) || 0)} size="text-base" />
              <span className="text-sm text-gray-600 dark:text-gray-300">{ratingSummary(row)}</span>
              {row.vouch_count ? (
                <span className="text-xs text-teal-700 dark:text-teal-300">{row.vouch_count} vouch{row.vouch_count === 1 ? "" : "es"}</span>
              ) : null}
            </div>
            {isOwner ? (
              <Link to={`/resident/services/${row.id}/edit`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">
                Edit this listing
              </Link>
            ) : (
              <ReportContentButton contentType="service_listing" contentId={row.id} />
            )}

            <section className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700" aria-label="Reviews">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Reviews</h2>
              {viewerState === "can_review" ? (
                <ReviewForm key={myReview?.id ?? "new"} listingId={row.id} existing={myReview} onSaved={reloadListing} />
              ) : viewerState === "needs_verification" ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">{VERIFY_TO_RATE_MESSAGE}</p>
              ) : null}
              {reviewError ? (
                <p className="text-sm text-red-600" role="alert">
                  {reviewError}
                </p>
              ) : (
                <ReviewList reviews={reviews} isOwner={isOwner} canModerate={canModerate} onChanged={reloadListing} />
              )}
            </section>
          </article>
        ) : null}
      </div>
    </div>
  );
}
