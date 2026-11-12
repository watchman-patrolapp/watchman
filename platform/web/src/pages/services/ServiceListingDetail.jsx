import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/layout/PageHeader";
import PrivateMediaImg from "../../components/media/PrivateMediaImg";
import ServiceContactButtons from "../../components/services/ServiceContactButtons";
import { COMMUNITY_MEDIA_BUCKET } from "../../utils/communityMedia";
import { getServiceListing, listMyOrgNeighbours } from "../../utils/localServicesApi";
import { LOAD_FALLBACK, friendlyServiceError, hoursFromJson } from "../../utils/localServices";
import { useAuth } from "../../auth/useAuth";

const BACK = "/resident/contacts?tab=services";

export default function ServiceListingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [row, setRow] = useState(null);
  const [suburb, setSuburb] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
            <p className="text-xs text-gray-500">Reviews are coming soon.</p>
            {row.owner_user_id === user?.id ? (
              <Link to={`/resident/services/${row.id}/edit`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">
                Edit this listing
              </Link>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}
