import { NavLink } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { useEquipmentPendingCounts } from "../../hooks/useEquipmentPendingCounts";
import { useScopedOrganization } from "../../utils/organizationScope";
import { equipmentAdminBadgeCount } from "../../utils/equipment";

const LINKS = [
  { to: "/equipment/admin/items", label: "Catalogue" },
  { to: "/equipment/admin/requests", label: "Loan desk", badge: true },
  { to: "/equipment/admin/certifications", label: "Training sign-offs" },
  { to: "/equipment/admin/labels", label: "QR labels" },
];

/** Section nav shared by the equipment admin pages; the desk shows its open-work count. */
export default function EquipmentAdminNav({ refreshKey = 0 }) {
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const counts = useEquipmentPendingCounts(Boolean(user?.id), activeOrganizationId, refreshKey);
  const badge = equipmentAdminBadgeCount(counts);
  return (
    <nav aria-label="Equipment admin" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-max rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium ${
                isActive
                  ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-50 hover:text-teal-700 dark:text-gray-300 dark:hover:bg-gray-700/60 dark:hover:text-teal-300"
              }`
            }
          >
            {l.label}
            {l.badge && badge ? (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" aria-label={`${badge} waiting`}>
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
