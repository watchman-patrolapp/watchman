import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FaClipboardList,
  FaComment,
  FaExclamationTriangle,
  FaBell,
  FaUserFriends,
  FaMapMarkedAlt,
  FaArrowLeft,
  FaPhone,
  FaLightbulb,
} from "react-icons/fa";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { canPreviewResidentHome, canUseHouseholdMode, isHouseholdModeRole } from "../auth/roleMatrix";
import SosHoldButton from "../components/resident/SosHoldButton";
import ResidentHomeHero from "../components/resident/ResidentHomeHero";
import ActiveSosBanner from "../components/patrol/ActiveSosBanner";
import { useScopedOrganization } from "../utils/organizationScope";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { triggerResidentSos } from "../utils/residentSos";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import {
  filterDashboardNeighbourhoodActivity,
  listPendingResidentsForVouch,
  listResidentNeighbourhoodActivity,
} from "../utils/residentVerification";
import {
  areaBroadcastAsActivityRow,
  formatClockTime,
  formatNoticeRemaining,
  isActivityAreaBroadcast,
  isPinnedAreaBroadcast,
  listAreaBroadcasts,
  noticeActivityUntil,
  noticePinnedUntil,
  subscribeAreaBroadcasts,
} from "../utils/areaBroadcasts";
import { formatAwayRange, getMyAway, isAwayNow } from "../utils/residentAway";
import { getMyHouseholdCivic, pingResidentPresence } from "../utils/householdCivic";
import { ensureMyHouseholdProfile } from "../utils/householdProfile";
import { hasHomePin } from "../utils/homePin";
import { parsePatrolTime } from "../utils/watchTime";
import {
  HOUSEHOLD_MODE_INTRO,
  householdIntroWasSeen,
  markHouseholdIntroSeen,
} from "../utils/householdModeIntro";
import HouseholdCivicRow from "../components/resident/HouseholdCivicRow";

function firstNameFrom(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) return "there";
  return raw.split(/\s+/)[0];
}

function reportStatusMeta(row) {
  if (row?.is_notice) {
    return {
      label: "Notice",
      dot: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.22)]",
      tag: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    };
  }
  if (row?.is_sos) {
    if (row.resolved_at) {
      return {
        label: "Cleared",
        dot: "bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.22)]",
        tag: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
      };
    }
    return {
      label: "SOS",
      dot: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
      tag: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
    };
  }
  const s = String(row?.status || "").toLowerCase();
  if (s === "approved") {
    return {
      label: "Logged for patrol",
      dot: "bg-teal-500 shadow-[0_0_0_3px_rgba(20,184,166,0.22)]",
      tag: "bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
    };
  }
  if (s === "rejected") {
    return {
      label: "Not accepted",
      dot: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]",
      tag: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
    };
  }
  return {
    label: "Pending review",
    dot: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.22)]",
    tag: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  };
}

function ActionCard({ icon: Icon, tone, title, subtitle, onClick }) {
  const tones = {
    watch: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    safe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    patrol: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    chat: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    sos: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    neighbours: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
    sector: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
    help: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    guide: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
    >
      <span className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
    </button>
  );
}

export default function ResidentDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { activeOrganization, activeOrganizationId } = useScopedOrganization();
  const householdUser = canUseHouseholdMode(user?.role);
  const watchHousehold = isHouseholdModeRole(user?.role);
  const staffPreview = canPreviewResidentHome(user?.role) && !householdUser;
  const [activity, setActivity] = useState([]);
  const [verification, setVerification] = useState("unknown");
  const [pendingCount, setPendingCount] = useState(0);
  const [homeAddress, setHomeAddress] = useState("");
  const [sosBusy, setSosBusy] = useState(false);
  const [broadcasts, setBroadcasts] = useState([]);
  const [civic, setCivic] = useState(null);
  const [awayRow, setAwayRow] = useState(null);
  const [showHouseholdIntro, setShowHouseholdIntro] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let ignore = false;
    const loadProfile = async () => {
      if (householdUser && !staffPreview) {
        const ensured = await ensureMyHouseholdProfile();
        if (!ignore && ensured.data?.home_address) {
          setHomeAddress(String(ensured.data.home_address).trim());
        }
        if (!ignore && watchHousehold && ensured.data?.verified) {
          setVerification("verified");
        }
      }
      const { data: residentProfile } = await supabase
        .from("resident_profiles")
        .select("verification_date, verification_method, home_address")
        .eq("user_id", user.id)
        .maybeSingle();
      const verified =
        Boolean(residentProfile?.verification_date) ||
        residentProfile?.verification_method === "watch_member" ||
        watchHousehold;
      if (!ignore) {
        setVerification(verified ? "verified" : "pending");
        setHomeAddress(String(residentProfile?.home_address || user?.address || "").trim());
      }
      if (verified) {
        const pending = await listPendingResidentsForVouch();
        if (!ignore) setPendingCount(pending.length);
      } else if (!ignore) {
        setPendingCount(0);
      }
    };
    const loadActivity = async ({ notifyError = false } = {}) => {
      const { data: feedRows, error: feedError } = await listResidentNeighbourhoodActivity(50);
      if (feedError && !isRpcNotFoundError(feedError) && notifyError && !ignore) {
        toast.error("Could not load neighbourhood activity.");
      }
      if (!ignore && !feedError) {
        setActivity(feedRows || []);
      }
    };
    const loadBroadcasts = async () => {
      const notices = await listAreaBroadcasts(20);
      if (!ignore && !notices.error) setBroadcasts(notices.data || []);
    };
    void loadProfile();
    void loadActivity({ notifyError: true });
    void (async () => {
      await pingResidentPresence();
      const [civicRow, away] = await Promise.all([getMyHouseholdCivic(), getMyAway(user.id)]);
      if (ignore) return;
      setCivic(civicRow);
      if (!away.error) setAwayRow(away.data || null);
    })();
    void loadBroadcasts();
    const refresh = setInterval(() => {
      setActivity((prev) => filterDashboardNeighbourhoodActivity(prev));
      void loadActivity();
      void loadBroadcasts();
    }, 30000);
    return () => {
      ignore = true;
      clearInterval(refresh);
    };
  }, [user?.id, user?.role, user?.address, householdUser, staffPreview, watchHousehold, activeOrganizationId]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const unsubscribe = subscribeAreaBroadcasts(activeOrganizationId, () => {
      void (async () => {
        const notices = await listAreaBroadcasts(20);
        if (!notices.error) setBroadcasts(notices.data || []);
      })();
    });
    return unsubscribe;
  }, [user?.id, activeOrganizationId]);

  useEffect(() => {
    if (!watchHousehold || !user?.id) {
      setShowHouseholdIntro(false);
      return;
    }
    setShowHouseholdIntro(!householdIntroWasSeen(user.id));
  }, [watchHousehold, user?.id]);

  const dismissHouseholdIntro = () => {
    if (user?.id) markHouseholdIntroSeen(user.id);
    setShowHouseholdIntro(false);
  };

  const handleSos = async () => {
    if (!user?.id || sosBusy) return;
    const organizationId = activeOrganizationId || user.organizationId;
    if (!organizationId) {
      toast.error("Select or join a neighbourhood before sending an SOS.");
      return;
    }
    setSosBusy(true);
    try {
      await triggerResidentSos({
        user,
        organizationId,
        triggerType: "hold",
      });
      toast.success("SOS sent. Patrol has been notified with your location.");
      navigate("/chat");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not trigger SOS.");
    } finally {
      setSosBusy(false);
    }
  };

  const pinnedBroadcasts = broadcasts.filter((row) => isPinnedAreaBroadcast(row));
  const activityFeed = filterDashboardNeighbourhoodActivity([
    ...activity,
    ...broadcasts.filter((row) => isActivityAreaBroadcast(row)).map(areaBroadcastAsActivityRow),
  ]);
  const areaName = activeOrganization?.name || "Your neighborhood";
  const verified = verification === "verified";
  const lastActivityAt = activityFeed[0]?.submitted_at || null;
  const hasActiveSos = activity.some((row) => row?.is_sos && !row?.resolved_at);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <ActiveSosBanner />
      <div className="mx-auto max-w-lg space-y-4 p-4 sm:max-w-2xl sm:p-6">
        {staffPreview ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
            >
              <FaArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to admin
            </button>
          </div>
        ) : null}
        {watchHousehold ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (showHouseholdIntro) dismissHouseholdIntro();
                navigate("/dashboard");
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
            >
              <FaArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to patrol
            </button>
          </div>
        ) : null}
        <header>
          <ResidentHomeHero
            firstName={firstNameFrom(user?.fullName)}
            fullName={user?.fullName || user?.email || "Resident"}
            avatarUrl={user?.avatarUrl}
            street={homeAddress || user?.address || "Add your home address on Profile"}
            neighborhood={areaName}
            verified={householdUser && verification === "verified"}
            showBadge={householdUser && verification !== "unknown"}
            lastActivityAt={lastActivityAt}
            hasActiveSos={hasActiveSos}
            organizationId={activeOrganizationId}
            awayLabel={
              householdUser && awayRow && isAwayNow(awayRow)
                ? `You're marked away ${formatAwayRange(awayRow)}`
                : ""
            }
            onOpenProfile={() => navigate("/profile")}
          />
        </header>

        {householdUser && civic ? (
          <HouseholdCivicRow civic={civic} compact />
        ) : null}

        {pinnedBroadcasts.length ? (
          <section className="space-y-2">
            {pinnedBroadcasts.map((row) => {
              const until = noticePinnedUntil(row);
              return (
                <article
                  key={row.id}
                  className="whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Neighbourhood notice
                    </p>
                    <p className="font-mono text-[10px] uppercase text-amber-700/80 dark:text-amber-300/80">
                      {formatNoticeRemaining(until)}
                      {until ? ` · until ${formatClockTime(until)}` : ""}
                    </p>
                  </div>
                  <p className="mb-1 text-base font-semibold text-amber-950 dark:text-white">
                    {row.headline || "Neighbourhood notice"}
                  </p>
                  <p className="text-sm leading-relaxed text-amber-800/90 dark:text-amber-200/85">
                    {row.body}
                  </p>
                </article>
              );
            })}
          </section>
        ) : null}

        {!householdUser ? (
          <aside
            className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-4 py-3 text-sm text-fuchsia-950 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-100"
            role="status"
          >
            <p>
              Previewing the resident home. Households see this screen; use it to check layout and moderate reports.
            </p>
            <button
              type="button"
              onClick={() => navigate("/admin")}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-fuchsia-900 underline dark:text-fuchsia-100"
            >
              <FaArrowLeft className="h-3 w-3" aria-hidden />
              Back to admin dashboard
            </button>
          </aside>
        ) : null}

        {watchHousehold && showHouseholdIntro ? (
          <aside
            className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100"
            role="status"
          >
            <p className="font-semibold">{HOUSEHOLD_MODE_INTRO.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-teal-900/90 dark:text-teal-200/90">
              {HOUSEHOLD_MODE_INTRO.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  dismissHouseholdIntro();
                  navigate("/profile");
                }}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
              >
                Open Profile
              </button>
              <button
                type="button"
                onClick={dismissHouseholdIntro}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-teal-900 underline dark:text-teal-100"
              >
                Got it
              </button>
            </div>
          </aside>
        ) : null}

        {householdUser && !hasHomePin(user) ? (
          <aside
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            <p className="font-semibold">Pin your home on the map</p>
            <p className="mt-1 leading-relaxed">
              My sector uses the pin, not the typed address. Open Profile and tap your roof.
            </p>
            <button
              type="button"
              onClick={() => navigate("/profile#home-pin")}
              className="mt-2 text-sm font-semibold text-amber-900 underline dark:text-amber-100"
            >
              Open Profile to set pin
            </button>
          </aside>
        ) : null}

        {householdUser && !watchHousehold && verification === "pending" ? (
          <aside
            className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 dark:border-amber-400 dark:bg-amber-950/40"
            role="status"
          >
            <p className="flex items-start gap-2 text-sm font-bold text-amber-950 dark:text-amber-100">
              <FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              This account is not verified
            </p>
            <p className="mt-2 text-sm font-medium text-amber-950 dark:text-amber-50">
              Patrol can still receive your SOS. You stay pending until an admin, NW admin, or
              patroller verifies you, or two neighbours who know you personally vouch.
            </p>
            <p className="mt-2 text-sm text-amber-900 dark:text-amber-100">
              If a neighbour already knows you, ask them to open Verify neighbours and vouch. Do not
              ask strangers.
            </p>
          </aside>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white px-4 py-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:px-6">
          <SosHoldButton onTrigger={handleSos} busy={sosBusy} />
          <p className="mt-2 text-center text-[11px] text-gray-400 dark:text-gray-500">
            Immediate danger only. For anything else, report activity below.
          </p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <ActionCard
            icon={FaExclamationTriangle}
            tone="watch"
            title="Report incident"
            subtitle="Non-urgent, logged for patrol"
            onClick={() => navigate("/resident/activity/new")}
          />
          <ActionCard
            icon={FaClipboardList}
            tone="safe"
            title="Your reports"
            subtitle="Status of what you sent"
            onClick={() => navigate("/resident/activity")}
          />
          <ActionCard
            icon={FaBell}
            tone="sos"
            title="SOS board"
            subtitle="Live alerts in this neighborhood"
            onClick={() => navigate("/sos")}
          />
          <ActionCard
            icon={FaComment}
            tone="chat"
            title="Chat with patrol"
            subtitle="Ask the duty team in your neighborhood"
            onClick={() => navigate("/chat")}
          />
          <ActionCard
            icon={FaUserFriends}
            tone="neighbours"
            title="Verify neighbours"
            subtitle={
              verification === "unknown"
                ? "Households in your neighborhood"
                : verified
                  ? pendingCount
                    ? `${pendingCount} waiting for a vouch`
                    : "Help confirm households you know"
                  : "Available after you are verified"
            }
            onClick={() => navigate("/resident/neighbours")}
          />
          <ActionCard
            icon={FaMapMarkedAlt}
            tone="sector"
            title="My sector"
            subtitle="Up to 10 homes within 1.2 km"
            onClick={() => navigate("/resident/sector")}
          />
          <ActionCard
            icon={FaPhone}
            tone="help"
            title="Emergency contacts"
            subtitle="Police, fire, electrical, security companies"
            onClick={() => navigate("/resident/contacts")}
          />
          <ActionCard
            icon={FaLightbulb}
            tone="guide"
            title="How to use"
            subtitle="Guide, about & feedback"
            onClick={() => navigate("/resident/guide")}
          />
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
              Neighbourhood activity
            </h2>
            <button
              type="button"
              onClick={() => navigate("/resident/activity")}
              className="text-xs font-medium text-teal-700 dark:text-teal-400"
            >
              Your reports
            </button>
          </div>
          {activityFeed.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
              No recent neighbourhood activity.
            </div>
          ) : (
            <ul className="space-y-2">
              {activityFeed.map((row, index) => {
                const meta = reportStatusMeta(row);
                const last = index === activityFeed.length - 1;
                return (
                  <li key={row.id}>
                    <div className="flex w-full gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                      <div className="flex w-3 shrink-0 flex-col items-center pt-1">
                        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                        {!last ? <span className="mt-1 w-px flex-1 bg-gray-200 dark:bg-gray-700" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                            {row.incident_type || "Activity"}
                          </p>
                          <span className="shrink-0 font-mono text-[10px] uppercase text-gray-400">
                            {formatRelativeTime(row.submitted_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                          {row.reporter_label || "A neighbour"}
                          {row.location_label ? ` · ${row.location_label}` : ""}
                          {row.is_notice && noticeActivityUntil(row)
                            ? ` · until ${formatClockTime(noticeActivityUntil(row))}`
                            : ""}
                        </p>
                        {row.description ? (
                          <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
                            {row.description}
                          </p>
                        ) : null}
                        <span
                          className={`mt-2 inline-flex rounded-md px-2 py-0.5 font-mono text-[10px] font-medium ${meta.tag}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <span>
            Neighbourhood Watch Platform
            {user?.createdAt
              ? ` • Member since ${parsePatrolTime(user.createdAt)?.toLocaleDateString("en-ZA") || ""}`
              : ""}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="shrink-0 text-gray-500 underline transition hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
