import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FaCheck, FaLock, FaSearch, FaUser } from "react-icons/fa";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import ThemeToggle from "../components/ThemeToggle";
import PageHeader from "../components/layout/PageHeader";
import BrandedLoader from "../components/layout/BrandedLoader";
import ResidentHouseholdCard from "../components/resident/ResidentHouseholdCard";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  RESIDENT_VOUCH_THRESHOLD,
  listResidentNeighbours,
  streetLabelForResident,
  verifiedByLabel,
  vouchForResident,
} from "../utils/residentVerification";
import { notifyResidentEvent } from "../utils/areaBroadcasts";

function VouchMeter({ count }) {
  const filled = Math.min(RESIDENT_VOUCH_THRESHOLD, Number(count) || 0);
  return (
    <div className="flex items-center gap-1.5" aria-label={`${filled} of ${RESIDENT_VOUCH_THRESHOLD} vouches`}>
      {Array.from({ length: RESIDENT_VOUCH_THRESHOLD }).map((_, index) => (
        <span
          key={index}
          className={`h-2 flex-1 rounded-full ${
            index < filled ? "bg-teal-500" : "bg-gray-200 dark:bg-gray-700"
          }`}
        />
      ))}
      <span className="ml-1 shrink-0 font-mono text-[10px] text-gray-500 dark:text-gray-400">
        {filled}/{RESIDENT_VOUCH_THRESHOLD}
      </span>
    </div>
  );
}

function matchesQuery(row, query) {
  const hay = `${row.full_name || ""} ${row.street_label || ""}`.toLowerCase();
  return hay.includes(query);
}

export default function ResidentNeighbours() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("unverified");
  const [vouchBusyId, setVouchBusyId] = useState(null);
  const [canVouch, setCanVouch] = useState(Boolean(user?.isVerifiedResident));

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data: profile } = await supabase
      .from("resident_profiles")
      .select("verification_date")
      .eq("user_id", user.id)
      .maybeSingle();
    const verified = Boolean(profile?.verification_date || user?.isVerifiedResident);
    setCanVouch(verified);
    const neighbours = await listResidentNeighbours();
    setRows((neighbours || []).filter((row) => !row.is_self));
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on user only
  }, [user?.id, user?.isVerifiedResident]);

  const q = query.trim().toLowerCase();
  const unverified = useMemo(
    () => rows.filter((row) => !row.verified && matchesQuery(row, q)),
    [rows, q]
  );
  const verifiedRows = useMemo(
    () => rows.filter((row) => row.verified && matchesQuery(row, q)),
    [rows, q]
  );
  const visible = tab === "verified" ? verifiedRows : unverified;

  const handleVouch = async (neighbourId) => {
    setVouchBusyId(neighbourId);
    try {
      const { data, error } = await vouchForResident(neighbourId);
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error("Apply the resident verification SQL on Supabase first.");
          return;
        }
        throw error;
      }
      void notifyResidentEvent({ type: "vouch", residentUserId: neighbourId });
      const myName = String(user?.fullName || "").trim() || "You";
      if (data?.method === "vouch" || data?.already_verified) {
        toast.success("Neighbour is now verified.");
        setRows((prev) =>
          prev.map((row) => {
            if (row.user_id !== neighbourId) return row;
            const names = Array.isArray(row.voucher_names) ? [...row.voucher_names] : [];
            if (!names.includes(myName)) names.push(myName);
            return {
              ...row,
              verified: true,
              verification_method: data?.method === "vouch" ? "vouch" : row.verification_method,
              voucher_names: names,
              vouch_count: data?.vouch_count || row.vouch_count,
              vouched_by_me: true,
            };
          })
        );
      } else {
        toast.success(`Vouch recorded (${data?.vouch_count || 1}/${RESIDENT_VOUCH_THRESHOLD}).`);
        setRows((prev) =>
          prev.map((row) => {
            if (row.user_id !== neighbourId) return row;
            const names = Array.isArray(row.voucher_names) ? [...row.voucher_names] : [];
            if (!names.includes(myName)) names.push(myName);
            return {
              ...row,
              voucher_names: names,
              vouch_count: data?.vouch_count || row.vouch_count,
              vouched_by_me: true,
            };
          })
        );
      }
    } catch (err) {
      toast.error(err.message || "Could not vouch for this neighbour.");
    } finally {
      setVouchBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            title="Verify neighbours"
            subtitle="Profile cards of registered households. Vouch only if you know them personally."
            backTo="/resident"
            backLabel="Back to resident home"
            className="flex-1 p-5"
            rightSlot={<ThemeToggle variant="toolbar" />}
          />
        </div>

        {!canVouch ? (
          <aside className="rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-950 dark:text-amber-100">
              <FaLock className="h-4 w-4 shrink-0" aria-hidden />
              Your household is not verified yet
            </p>
            <p className="mt-2 text-sm text-amber-900 dark:text-amber-100">
              You can browse neighbour cards. Vouching unlocks after you are verified.
            </p>
          </aside>
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

        <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setTab("unverified")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === "unverified"
                ? "bg-white text-amber-800 shadow-sm dark:bg-gray-700 dark:text-amber-100"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Unverified ({unverified.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("verified")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === "verified"
                ? "bg-white text-emerald-800 shadow-sm dark:bg-gray-700 dark:text-emerald-100"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            Verified ({verifiedRows.length})
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <BrandedLoader message="Loading households…" size="md" />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center dark:border-gray-700 dark:bg-gray-800">
            {tab === "verified" ? (
              <FaCheck className="mx-auto h-8 w-8 text-emerald-400" aria-hidden />
            ) : (
              <FaUser className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" aria-hidden />
            )}
            <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
              {query
                ? "No matching households."
                : tab === "verified"
                  ? "No verified neighbours in this area yet."
                  : "No unverified residents in this area."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visible.map((row) => {
              const name = row.full_name?.trim() || "Resident";
              return (
                <ResidentHouseholdCard
                  key={row.user_id}
                  name={name}
                  avatarUrl={row.avatar_url}
                  street={streetLabelForResident(row)}
                  verified={Boolean(row.verified)}
                  verifiedBy={verifiedByLabel(row)}
                  joinedAt={row.created_at}
                >
                  {!row.verified ? (
                    <>
                      <div>
                        <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                          Neighbour vouches
                        </p>
                        <VouchMeter count={row.vouch_count} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleVouch(row.user_id)}
                        disabled={!canVouch || row.vouched_by_me || vouchBusyId === row.user_id}
                        className="w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {!canVouch
                          ? "Verify your household to vouch"
                          : row.vouched_by_me
                            ? "You already vouched"
                            : vouchBusyId === row.user_id
                              ? "Saving…"
                              : "I know them personally — vouch"}
                      </button>
                      <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
                        Do not vouch for strangers.
                      </p>
                    </>
                  ) : null}
                </ResidentHouseholdCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
