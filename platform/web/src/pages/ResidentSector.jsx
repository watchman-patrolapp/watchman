import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaSearch, FaUserFriends } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import ThemeToggle from "../components/ThemeToggle";
import PageHeader from "../components/layout/PageHeader";
import BrandedLoader from "../components/layout/BrandedLoader";
import ResidentHouseholdCard from "../components/resident/ResidentHouseholdCard";
import { useScopedOrganization } from "../utils/organizationScope";
import {
  listResidentNeighbours,
  streetLabelForResident,
  verifiedByLabel,
} from "../utils/residentVerification";
import { formatDistanceM, listResidentSector } from "../utils/homePin";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";

function matchesQuery(row, query) {
  const hay = `${row.full_name || ""} ${row.street_label || ""}`.toLowerCase();
  return hay.includes(query);
}

export default function ResidentSector() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganization } = useScopedOrganization();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [needsPin, setNeedsPin] = useState(false);
  const [query, setQuery] = useState("");
  const areaName = activeOrganization?.name || "your neighborhood";

  useEffect(() => {
    if (!user?.id) return;
    let ignore = false;
    const load = async () => {
      setLoading(true);
      const sector = await listResidentSector(10);
      if (ignore) return;
      if (sector.error) {
        if (!isRpcNotFoundError(sector.error)) {
          console.warn("list_resident_sector:", sector.error.message);
        }
        const neighbours = await listResidentNeighbours();
        setNeedsPin(false);
        setRows(neighbours || []);
        setLoading(false);
        return;
      }
      setNeedsPin(Boolean(sector.needsPin));
      setRows(sector.data || []);
      setLoading(false);
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [user?.id]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => rows.filter((row) => matchesQuery(row, q)),
    [rows, q]
  );

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="My sector"
          subtitle={`Up to 10 closest pinned households within 1.2 km in ${areaName}. Street names only — house numbers stay private. Distance uses your home pin, not the typed address.`}
          backTo="/resident"
          backLabel="Back to resident home"
          className="p-5"
          rightSlot={<ThemeToggle variant="toolbar" />}
        />

        {needsPin ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Set your home pin first</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/90 dark:text-amber-200/90">
              Your address is not detected automatically. Open Profile, tap the correct place on the
              map, then come back. Until you pin home, My sector cannot tell who is next door.
            </p>
            <button
              type="button"
              onClick={() => navigate("/profile#home-pin")}
              className="mt-3 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Open Profile to set pin
            </button>
          </div>
        ) : null}

        <div className="relative">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or street"
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <BrandedLoader message="Loading your sector…" size="md" />
          </div>
        ) : needsPin ? null : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-gray-700 dark:bg-gray-800">
            <FaUserFriends className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" aria-hidden />
            <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
              {query
                ? "No matching households."
                : "No pinned homes within 1.2 km yet. Neighbours appear here after they set a pin on Profile."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((row) => (
              <ResidentHouseholdCard
                key={row.user_id}
                name={row.full_name?.trim() || "Resident"}
                avatarUrl={row.avatar_url}
                street={streetLabelForResident(row)}
                neighborhood={areaName}
                verified={Boolean(row.verified)}
                verifiedBy={verifiedByLabel(row)}
                joinedAt={row.created_at}
                isSelf={Boolean(row.is_self)}
                distanceLabel={row.is_self ? "Your home pin" : formatDistanceM(row.distance_m)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
