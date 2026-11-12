import { Link } from "react-router-dom";
import PrivateMediaImg from "../media/PrivateMediaImg";
import ServiceContactButtons from "./ServiceContactButtons";
import { COMMUNITY_MEDIA_BUCKET } from "../../utils/communityMedia";
import { firstNameOnly, neighbourBadge } from "../../utils/localServices";

export default function ServiceListingCard({ row, detailBase = "/resident/services" }) {
  const badge = neighbourBadge(row);
  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex gap-3 p-4">
        {row.photo_path ? (
          <PrivateMediaImg
            stored={row.photo_path}
            bucket={COMMUNITY_MEDIA_BUCKET}
            alt=""
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`${detailBase}/${row.id}`}
              className="text-sm font-semibold text-gray-900 hover:underline dark:text-white"
            >
              {row.title}
            </Link>
            {badge ? (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                {badge}
              </span>
            ) : null}
            {row.is_featured ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Featured</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {[row.business_name, row.category_label].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {[row.owner_name ? firstNameOnly(row.owner_name) : null, row.service_area].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-700">
        <ServiceContactButtons phone={row.phone} whatsapp={row.whatsapp} />
      </div>
    </article>
  );
}
