import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "../utils/notify";
import {
  FaFire,
  FaBuilding,
  FaMapPin,
  FaPhone,
  FaSearch,
  FaTimes,
  FaUser,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import ThemeToggle from "../components/ThemeToggle";
import AppNotificationBell from "../components/layout/AppNotificationBell";
import PartnerRosterSchedule from "../components/security/PartnerRosterSchedule";
import PartnerResidentRoster from "../components/security/PartnerResidentRoster";
import PartnerClientClaims from "../components/security/PartnerClientClaims";
import PartnerSosBoard from "../components/security/PartnerSosBoard";
import { useUnreadCityHubCount } from "../hooks/useUnreadCityHubCount";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { adaptivePollIntervalMs, subscribeDataBudgetHints } from "../utils/dataSaverProfile";
import { getMySecurityBranding } from "../utils/emergencyDirectory";
import { fetchHotspotEvents } from "../utils/hotspotService";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import {
  readSecurityCompanyBrand,
  writeSecurityCompanyBrand,
} from "../utils/securityBrandCache";
import {
  listSecurityMembershipClaims,
} from "../utils/securityMembershipActions";
import {
  shortVolunteerName,
  toLocalDateStr,
} from "../utils/patrolScheduleSlots";
import { formatWatchDateTime } from "../utils/watchTime";
import {
  HOT_ZONE_ID,
  PANELS,
  areaId,
  areaKeyForIncident,
  areaLabelForIncident,
  areaSnapshot,
  initials,
  isResidentReport,
  isVisibleIncident,
  rowBelongsToArea,
  themeForIndex,
} from "../components/security/dashboard/dashboardHelpers";
import {
  AreaSection,
  CoverageTimeline,
  IncidentRow,
  PartnerMap,
  ResidentReportRow,
} from "../components/security/dashboard/DashboardWidgets";

export default function SecurityCompanyDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const unreadCityHubCount = useUnreadCityHubCount(!!(user?.id || user?.uid), user?.id || user?.uid);
  const cachedBrand = readSecurityCompanyBrand(user?.id);
  const [panel, setPanel] = useState("overview");
  const [areas, setAreas] = useState([]);
  const [residents, setResidents] = useState([]);
  const [patrols, setPatrols] = useState([]);
  const [slots, setSlots] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [areaCounts, setAreaCounts] = useState([]);
  const [pendingClaims, setPendingClaims] = useState([]);
  const [claimHistory, setClaimHistory] = useState([]);
  const [areaFilter, setAreaFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPatrol, setSelectedPatrol] = useState(null);
  const [companyName, setCompanyName] = useState(cachedBrand.name);
  const [companyLogoUrl, setCompanyLogoUrl] = useState(cachedBrand.logoUrl);
  const loadGen = useRef(0);
  const liveGen = useRef(0);
  const boardGen = useRef(0);

  const applyLivePatrols = useCallback((rows) => {
    const next = rows || [];
    setPatrols(next);
    setSelectedPatrol((prev) => {
      if (!prev?.user_id || prev.status === "scheduled") return prev;
      const live = next.find((row) => row.user_id === prev.user_id);
      return live ? { ...prev, ...live } : null;
    });
  }, []);

  const loadCompanyName = useCallback(async () => {
    if (!user?.id) return "";
    if (user.organizationId) {
      const { data } = await supabase
        .from("organizations")
        .select("name, type")
        .eq("id", user.organizationId)
        .maybeSingle();
      if (data?.type === "security_company" && data.name) return data.name;
    }
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("organizations(name, type)")
      .eq("user_id", user.id)
      .eq("status", "active");
    const company = (memberships || []).find((row) => row.organizations?.type === "security_company");
    return company?.organizations?.name || "";
  }, [user?.id, user?.organizationId]);

  const refreshLivePatrols = useCallback(async () => {
    const gen = ++liveGen.current;
    const { data, error } = await supabase.rpc("security_partner_live_patrols");
    if (gen !== liveGen.current) return;
    if (error) {
      if (!isRpcNotFoundError(error)) {
        console.warn("security_partner_live_patrols:", error.message);
      }
      return;
    }
    applyLivePatrols(data || []);
  }, [applyLivePatrols]);

  const refreshBoard = useCallback(async () => {
    const gen = ++boardGen.current;
    const [slotRes, incidentRes, hotspotRows, pendingClaimRes, historyClaimRes] = await Promise.all([
      supabase.rpc("security_partner_scheduled_patrols", { p_suburb_id: null }),
      supabase.rpc("security_partner_incidents"),
      fetchHotspotEvents().catch(() => []),
      listSecurityMembershipClaims("pending", true),
      listSecurityMembershipClaims("history", true),
    ]);
    if (gen !== boardGen.current) return;
    if (slotRes.error && !isRpcNotFoundError(slotRes.error)) {
      console.warn("security_partner_scheduled_patrols:", slotRes.error.message);
    } else if (!slotRes.error) {
      setSlots(slotRes.data || []);
    }
    if (incidentRes.error && !isRpcNotFoundError(incidentRes.error)) {
      console.warn("security_partner_incidents:", incidentRes.error.message);
    } else if (!incidentRes.error) {
      setIncidents(incidentRes.data || []);
    }
    setHotspots(hotspotRows || []);
    if (pendingClaimRes.error && !isRpcNotFoundError(pendingClaimRes.error)) {
      console.warn("list_security_membership_claims:", pendingClaimRes.error.message);
    }
    setPendingClaims(pendingClaimRes.error ? [] : pendingClaimRes.data || []);
    setClaimHistory(historyClaimRes.error ? [] : historyClaimRes.data || []);
  }, []);

  const load = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    const gen = ++loadGen.current;
    if (!silent) setLoading(true);
    try {
      const [areaRes, residentRes, patrolRes, slotRes, incidentRes, hotspotRows, resolvedCompanyName, countRes, branding, pendingClaimRes, historyClaimRes] = await Promise.all([
        supabase.rpc("security_partner_areas"),
        supabase.rpc("security_partner_residents"),
        supabase.rpc("security_partner_live_patrols"),
        supabase.rpc("security_partner_scheduled_patrols", {
          p_suburb_id: null,
        }),
        supabase.rpc("security_partner_incidents"),
        fetchHotspotEvents().catch(() => []),
        loadCompanyName(),
        supabase.rpc("security_partner_neighborhood_counts"),
        getMySecurityBranding().catch(() => null),
        listSecurityMembershipClaims("pending", true),
        listSecurityMembershipClaims("history", true),
      ]);

      if (gen !== loadGen.current) return;

      const firstError = [areaRes, residentRes, patrolRes, slotRes].find((r) => r.error)?.error;
      if (firstError && !isRpcNotFoundError(firstError)) throw firstError;
      if (firstError && isRpcNotFoundError(firstError) && !silent) {
        toast.error("Run the partner dashboard SQL in Supabase to load live partner data.");
      }
      if (incidentRes.error && !isRpcNotFoundError(incidentRes.error)) {
        console.warn("security_partner_incidents:", incidentRes.error.message);
      }
      if (countRes.error && !isRpcNotFoundError(countRes.error)) {
        console.warn("security_partner_neighborhood_counts:", countRes.error.message);
      }

      setAreas(areaRes.data || []);
      setResidents(residentRes.data || []);
      applyLivePatrols(patrolRes.data || []);
      setSlots(slotRes.data || []);
      setIncidents(incidentRes.data || []);
      setHotspots(hotspotRows || []);
      setAreaCounts(countRes.error ? [] : countRes.data || []);
      if (pendingClaimRes.error && !isRpcNotFoundError(pendingClaimRes.error)) {
        console.warn("list_security_membership_claims:", pendingClaimRes.error.message);
      }
      setPendingClaims(pendingClaimRes.error ? [] : pendingClaimRes.data || []);
      setClaimHistory(historyClaimRes.error ? [] : historyClaimRes.data || []);
      const nextName = resolvedCompanyName || branding?.company_name || residentRes.data?.[0]?.security_company_name || "";
      const nextLogo = branding?.logo_url || "";
      setCompanyName(nextName);
      setCompanyLogoUrl(nextLogo);
      writeSecurityCompanyBrand(user?.id, { name: nextName, logoUrl: nextLogo });
    } catch (err) {
      if (gen !== loadGen.current) return;
      console.error(err);
      if (!silent) toast.error(err.message || "Could not load the security dashboard.");
    } finally {
      if (gen === loadGen.current && !silent) setLoading(false);
    }
  }, [applyLivePatrols, loadCompanyName, user?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    void load();

    let liveRefreshTimer = 0;
    const scheduleLiveRefresh = (delayMs = 200) => {
      if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
      liveRefreshTimer = window.setTimeout(() => {
        liveRefreshTimer = 0;
        void refreshLivePatrols();
      }, delayMs);
    };

    let boardRefreshTimer = 0;
    const scheduleBoardRefresh = () => {
      if (boardRefreshTimer) window.clearTimeout(boardRefreshTimer);
      boardRefreshTimer = window.setTimeout(() => {
        boardRefreshTimer = 0;
        void refreshBoard();
      }, 400);
    };

    const channel = supabase
      .channel(`security-command-live-${user.id}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "active_patrols" }, (payload) => {
        const goneId = payload.old?.user_id;
        if (goneId) {
          setPatrols((prev) => prev.filter((row) => row.user_id !== goneId));
          setSelectedPatrol((prev) => (prev?.user_id === goneId && prev.status !== "scheduled" ? null : prev));
        }
        scheduleLiveRefresh(150);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "active_patrols" }, () => {
        scheduleLiveRefresh(150);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "active_patrols" }, () => {
        scheduleLiveRefresh(250);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "patrol_locations" }, (payload) => {
        const row = payload.new;
        if (!row || row.deleted_at != null || row.is_archived === true) return;
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        const patrolId = row.patrol_id || row.user_id;
        if (!patrolId || Number.isNaN(lat) || Number.isNaN(lng)) return;
        setPatrols((prev) =>
          prev.map((patrol) =>
            patrol.user_id === patrolId
              ? { ...patrol, latitude: lat, longitude: lng, last_gps_at: row.timestamp || row.created_at }
              : patrol
          )
        );
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => {
        scheduleBoardRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "patrol_slots" }, () => {
        scheduleBoardRefresh();
      })
      .subscribe();

    let livePollId = 0;
    const scheduleLivePoll = () => {
      if (livePollId) window.clearTimeout(livePollId);
      const ms = adaptivePollIntervalMs(15000, { maxMs: 120000 });
      livePollId = window.setTimeout(() => {
        void refreshLivePatrols();
        scheduleLivePoll();
      }, ms);
    };
    scheduleLivePoll();

    let boardPollId = 0;
    const scheduleBoardPoll = () => {
      if (boardPollId) window.clearTimeout(boardPollId);
      const ms = adaptivePollIntervalMs(60000, { maxMs: 180000 });
      boardPollId = window.setTimeout(() => {
        void refreshBoard();
        scheduleBoardPoll();
      }, ms);
    };
    scheduleBoardPoll();

    const unsubBudget = subscribeDataBudgetHints(() => {
      scheduleLivePoll();
      scheduleBoardPoll();
    });

    let resumeTimer = 0;
    const onResume = () => {
      if (document.visibilityState !== "visible") return;
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        resumeTimer = 0;
        void refreshLivePatrols();
        void refreshBoard();
      }, 80);
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
      if (boardRefreshTimer) window.clearTimeout(boardRefreshTimer);
      if (livePollId) window.clearTimeout(livePollId);
      if (boardPollId) window.clearTimeout(boardPollId);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      unsubBudget();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      supabase.removeChannel(channel);
    };
  }, [user?.id, load, refreshLivePatrols, refreshBoard]);

  const uniqueAreas = useMemo(() => {
    const map = new Map();
    for (const row of areas) {
      const key = areaId(row);
      if (!key || map.has(key)) continue;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) =>
      String(a.organization_name || a.suburb_name || "").localeCompare(
        String(b.organization_name || b.suburb_name || "")
      )
    );
  }, [areas]);

  const brandName = companyName || "";

  const q = search.trim().toLowerCase();
  const matchesQuery = (parts) => !q || parts.some((part) => String(part || "").toLowerCase().includes(q));

  const selectedArea = uniqueAreas.find((area) => areaId(area) === areaFilter) || null;
  const listedAreas = selectedArea ? [selectedArea] : uniqueAreas;
  const todayDate = toLocalDateStr(new Date());

  const filteredResidents = residents.filter((row) => {
    const areaOk = !areaFilter || areaFilter === HOT_ZONE_ID || rowBelongsToArea(row, selectedArea);
    return areaOk && matchesQuery([row.full_name, row.suburb_name, row.neighborhood_name, row.street_label]);
  });

  const filteredIncidents = incidents.filter((row) => {
    if (!isVisibleIncident(row)) return false;
    const areaOk = !areaFilter || areaFilter === HOT_ZONE_ID || rowBelongsToArea(row, selectedArea);
    return areaOk && matchesQuery([row.type, row.title, row.location, row.reporter_name, row.organization_name]);
  });

  const residentReports = filteredIncidents.filter(isResidentReport);
  const visibleIncidents = incidents.filter(isVisibleIncident);
  const coveredAreas = uniqueAreas.filter((area) => patrols.some((patrol) => rowBelongsToArea(patrol, area)));

  const incidentsByArea = useMemo(() => {
    const sourceAreas = selectedArea ? [selectedArea] : uniqueAreas;
    const groups = new Map();
    for (const area of sourceAreas) {
      groups.set(areaId(area), {
        id: areaId(area),
        label: area.organization_name || area.suburb_name,
        code: area.suburb_name,
        rows: [],
      });
    }
    for (const row of filteredIncidents) {
      let key = sourceAreas.find((area) => rowBelongsToArea(row, area));
      key = key ? areaId(key) : areaKeyForIncident(row);
      if (!groups.has(key)) {
        if (selectedArea) continue;
        groups.set(key, { id: key, label: areaLabelForIncident(row), code: row.suburb_name || "Area", rows: [] });
      }
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [filteredIncidents, uniqueAreas, selectedArea]);

  const reportsByArea = useMemo(() => {
    const sourceAreas = selectedArea ? [selectedArea] : uniqueAreas;
    return sourceAreas.map((area) => ({
      id: areaId(area),
      label: area.organization_name || area.suburb_name,
      code: area.suburb_name,
      themeIndex: uniqueAreas.findIndex((row) => areaId(row) === areaId(area)),
      rows: residentReports.filter((row) => rowBelongsToArea(row, area)),
    }));
  }, [residentReports, uniqueAreas, selectedArea]);

  const page = PANELS[panel] || PANELS.overview;

  const navItem = (key, label, count) => (
    <button
      type="button"
      onClick={() => {
        if ((key === "incidents" || key === "reports" || key === "schedule" || key === "areas" || key === "residents" || key === "claims") && areaFilter === HOT_ZONE_ID) setAreaFilter("");
        setPanel(key);
      }}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium ${
        panel === key
          ? "bg-teal-50 text-teal-900 ring-1 ring-teal-500/40 dark:bg-teal-950/50 dark:text-teal-100"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      <span className="flex-1">{label}</span>
      {count != null ? (
        <span className="rounded-md bg-gray-100 px-1.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {count}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-center gap-3">
            {companyLogoUrl ? (
              <img src={companyLogoUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-sm" />
            ) : brandName ? (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-500 text-xl font-bold text-teal-950">
                {brandName.slice(0, 2).toUpperCase()}
              </div>
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-2xl bg-gray-200 dark:bg-gray-800" />
            )}
            <div className="min-w-0">
              <p className="text-lg font-bold leading-snug text-gray-900 dark:text-white">
                {brandName || "\u00a0"}
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-400">Command · assigned areas</p>
            </div>
          </div>

          <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-400">Operations</p>
          <div className="space-y-1">
            {navItem("overview", "Overview")}
            {navItem("schedule", "Roster & schedule", patrols.length || slots.length)}
            {navItem("areas", "Areas", uniqueAreas.length)}
            {navItem("residents", "Residents", residents.length)}
            {navItem("claims", "Client claims", pendingClaims.length)}
          </div>

          <p className="mb-2 mt-5 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-gray-400">Records</p>
          <div className="space-y-1">
            {navItem("incidents", "Incidents by area", visibleIncidents.length)}
            {navItem("reports", "Resident reports", incidents.filter((row) => isVisibleIncident(row) && isResidentReport(row)).length)}
          </div>

          <button
            type="button"
            onClick={() => navigate("/city-hub")}
            className="mt-5 flex w-full items-center justify-between rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700"
          >
            <span className="inline-flex items-center gap-2">
              <FaMapPin /> City Hub
            </span>
            {unreadCityHubCount > 0 ? (
              <span className="rounded-md bg-white/20 px-1.5 font-mono text-[10px]">
                {unreadCityHubCount > 99 ? "99+" : unreadCityHubCount}
              </span>
            ) : null}
          </button>

          <PartnerSosBoard areas={uniqueAreas} />

          <button
            type="button"
            onClick={() => navigate("/hotspots")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700"
          >
            <FaFire /> Hot zones
          </button>

          <button
            type="button"
            onClick={() => navigate("/security/profile")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
          >
            <FaBuilding /> Company profile
          </button>

          <div className="mt-6 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 font-mono text-xs font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-200">
              {initials(user?.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-gray-900 dark:text-white">{user?.fullName || "Ops"}</p>
              <p className="text-[11px] text-gray-400">Security admin</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="shrink-0 text-[11px] text-gray-500 underline transition hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
            >
              Sign Out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-gray-200 bg-gray-100/95 px-4 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{page.title}</h1>
              <p className="font-mono text-[11px] uppercase tracking-wide text-gray-400">{page.sub}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">
                <FaSearch className="text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search patroller, resident, area…"
                  className="w-44 bg-transparent text-sm outline-none dark:text-white"
                />
              </label>
              <AppNotificationBell variant="surface" />
              <ThemeToggle variant="surface" />
              <button
                type="button"
                onClick={signOut}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-red-200 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-red-900 dark:hover:text-red-400"
              >
                Sign Out
              </button>
            </div>
          </header>

          <div className="space-y-5 p-4 sm:p-6">
            {uniqueAreas.length > 0 && panel !== "overview" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAreaFilter("")}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                    !areaFilter
                      ? "bg-slate-800 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-200"
                      : "bg-white text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600"
                  }`}
                >
                  All areas
                </button>
                {uniqueAreas.map((area, index) => {
                  const theme = themeForIndex(index);
                  const selected = areaFilter === areaId(area);
                  return (
                    <button
                      key={areaId(area)}
                      type="button"
                      onClick={() => setAreaFilter(selected ? "" : areaId(area))}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${selected ? theme.chipOn : theme.chipOff}`}
                    >
                      {area.organization_name || area.suburb_name}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {panel === "overview" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{patrols.length}</p>
                    <p className="text-xs text-gray-500">Patrollers on duty now</p>
                    <p className="mt-1 font-mono text-[11px] text-emerald-600">{slots.length} upcoming sign-ups</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {coveredAreas.length} / {uniqueAreas.length || 0}
                    </p>
                    <p className="text-xs text-gray-500">Areas under live coverage</p>
                    <p className="mt-1 font-mono text-[11px] text-amber-600">
                      {Math.max(uniqueAreas.length - coveredAreas.length, 0)} without a live patrol
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{visibleIncidents.length}</p>
                    <p className="text-xs text-gray-500">Approved incidents across assigned areas</p>
                    <p className="mt-1 font-mono text-[11px] text-amber-600">
                      {incidents.filter((row) => isVisibleIncident(row) && isResidentReport(row)).length} resident reports in view
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{hotspots.length}</p>
                    <p className="text-xs text-gray-500">City hot-zone pins</p>
                    <button type="button" onClick={() => navigate("/hotspots")} className="mt-1 font-mono text-[11px] text-orange-600">
                      Open hotspots map →
                    </button>
                  </div>
                </div>

                <CoverageTimeline areas={uniqueAreas} slots={slots} />

                <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                  <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between px-4 py-3">
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Patrollers on shift</h2>
                      <button type="button" onClick={() => setPanel("schedule")} className="text-xs font-medium text-teal-700 dark:text-teal-300">
                        Full roster →
                      </button>
                    </div>
                    {patrols.length === 0 ? (
                      <p className="px-4 pb-4 text-sm text-gray-500">No one is on patrol in your assigned areas.</p>
                    ) : (
                      patrols.slice(0, 6).map((patrol) => (
                        <button
                          key={patrol.user_id}
                          type="button"
                          onClick={() => setSelectedPatrol(patrol)}
                          className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50"
                        >
                          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 font-mono text-xs font-bold text-teal-700 dark:bg-teal-950/50 dark:text-teal-200">
                            {initials(patrol.full_name)}
                            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-gray-800" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{patrol.full_name}</p>
                            <p className="truncate text-xs text-gray-500">{patrol.organization_name || patrol.zone || "Area"}</p>
                          </div>
                          <span className="font-mono text-[10px] text-teal-700 dark:text-teal-300">
                            {patrol.start_time
                              ? formatWatchDateTime(patrol.start_time, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }) || "Live"
                              : "Live"}
                          </span>
                        </button>
                      ))
                    )}
                  </section>

                  <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Live map</h2>
                      <button type="button" onClick={() => navigate("/city-hub")} className="text-xs font-medium text-rose-600">
                        City Hub →
                      </button>
                    </div>
                    <PartnerMap patrols={patrols} />
                  </section>
                </div>
              </>
            )}

            {panel === "schedule" && (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                  <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                      <FaUser className="text-teal-600" /> Live coverage
                    </h2>
                  </div>
                  <PartnerMap
                    patrols={
                      selectedArea ? patrols.filter((patrol) => rowBelongsToArea(patrol, selectedArea)) : patrols
                    }
                  />
                </div>
                <PartnerRosterSchedule
                  areas={uniqueAreas}
                  areaFilter={areaFilter}
                  patrols={patrols}
                  onOpenPatrol={setSelectedPatrol}
                />
              </div>
            )}

            {panel === "areas" && (
              <div className="grid gap-4 md:grid-cols-2">
                {listedAreas.map((area) => {
                  const snap = areaSnapshot(area, {
                    patrols,
                    slots,
                    incidents,
                    residents,
                    counts: areaCounts,
                    todayDate,
                  });
                  const liveNow = snap.live.length > 0;
                  const theme = themeForIndex(uniqueAreas.findIndex((row) => areaId(row) === areaId(area)));
                  return (
                    <article key={areaId(area)} className={`rounded-2xl border bg-white p-4 dark:bg-gray-800 ${theme.article}`}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={`mt-1 h-10 w-1.5 shrink-0 rounded-full ${theme.bar}`} aria-hidden />
                          <div>
                            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                              {area.organization_name || area.suburb_name}
                            </h3>
                            <p className="font-mono text-[11px] uppercase text-gray-400">
                              {[area.suburb_name, area.organization_name && area.suburb_name !== area.organization_name ? "neighborhood watch" : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ${
                            liveNow
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200"
                          }`}
                        >
                          {liveNow ? "On duty" : "No live patrol"}
                        </span>
                      </div>
                      <div className="mb-3 grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{snap.live.length}</p>
                          <p className="text-[10px] text-gray-400">On duty now</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{snap.todaySlots.length}</p>
                          <p className="text-[10px] text-gray-400">Booked today</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{snap.open.length}</p>
                          <p className="text-[10px] text-gray-400">Open incidents</p>
                        </div>
                      </div>
                      <div className="mb-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {snap.residentCount || snap.memberCount || snap.linkedCount}
                          </p>
                          <p className="text-[10px] text-gray-400">Watch members</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{snap.reports.length}</p>
                          <p className="text-[10px] text-gray-400">Resident reports</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{snap.sos.length}</p>
                          <p className="text-[10px] text-gray-400">SOS</p>
                        </div>
                      </div>
                      <p className="mb-1 text-xs text-gray-600 dark:text-gray-300">
                        {snap.bookedNames.length > 0
                          ? `Today: ${snap.bookedNames.map(shortVolunteerName).join(", ")}`
                          : "No booked coverage today."}
                      </p>
                      <p className="mb-3 text-xs text-gray-500">
                        {snap.last
                          ? `Last incident: ${snap.last.type || snap.last.title || "Incident"} · ${
                              formatRelativeTime(snap.last.submitted_at || snap.last.incident_date) || "time unknown"
                            }`
                          : "No incidents recorded for this area."}
                      </p>
                      {snap.linkedCount > 0 ? (
                        <p className="mb-3 text-[11px] text-gray-400">
                          {snap.linkedCount} household{snap.linkedCount === 1 ? "" : "s"} linked to this company
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                        <button
                          type="button"
                          onClick={() => {
                            setAreaFilter(areaId(area));
                            setPanel("schedule");
                          }}
                          className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-200"
                        >
                          View roster
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAreaFilter(areaId(area));
                            setPanel("incidents");
                          }}
                          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                        >
                          View incidents
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAreaFilter(areaId(area));
                            setPanel("reports");
                          }}
                          className="rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                        >
                          Resident reports
                        </button>
                      </div>
                    </article>
                  );
                })}

                {uniqueAreas.length === 0 && !loading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 md:col-span-2">
                    No registered neighborhood watches to show yet.
                  </p>
                ) : null}
              </div>
            )}

            {panel === "incidents" && (
              <div className="space-y-4">
                {incidentsByArea.map((group) => {
                    const theme = themeForIndex(uniqueAreas.findIndex((area) => areaId(area) === group.id));
                    return (
                      <AreaSection
                        key={group.id}
                        theme={theme}
                        title={group.label}
                        subtitle={`${group.code || "Neighborhood"} · approved incidents`}
                        count={group.rows.length}
                        empty="No approved incidents in this neighborhood."
                        stacked
                        action={
                          areaFilter ? (
                            <button type="button" onClick={() => setAreaFilter("")} className="text-xs font-medium text-gray-600 dark:text-gray-300">
                              All areas
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAreaFilter(group.id)}
                              className="text-xs font-medium text-gray-600 dark:text-gray-300"
                            >
                              Focus
                            </button>
                          )
                        }
                      >
                        {group.rows.map((row) => (
                          <IncidentRow key={row.id} row={row} />
                        ))}
                      </AreaSection>
                    );
                  })}
                {!loading && incidentsByArea.length === 0 ? (
                  <p className="text-sm text-gray-500">No incidents in the assigned neighborhoods yet.</p>
                ) : null}
              </div>
            )}

            {panel === "reports" && (
              <div className="space-y-6">
                {reportsByArea.map((group) => {
                  const theme = themeForIndex(group.themeIndex < 0 ? 0 : group.themeIndex);
                  return (
                    <AreaSection
                      key={group.id}
                      theme={theme}
                      title={group.label}
                      subtitle={`${group.code || "Neighborhood"} · household SOS and reports`}
                      count={group.rows.length}
                      empty="No household SOS or activity reports in this neighborhood."
                      stacked
                      action={
                        areaFilter ? (
                          <button type="button" onClick={() => setAreaFilter("")} className="text-xs font-medium text-gray-600 dark:text-gray-300">
                            All areas
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAreaFilter(group.id)}
                            className="text-xs font-medium text-gray-600 dark:text-gray-300"
                          >
                            Focus
                          </button>
                        )
                      }
                    >
                      {group.rows.map((row) => (
                        <ResidentReportRow key={row.id} row={row} />
                      ))}
                    </AreaSection>
                  );
                })}
                {!loading && reportsByArea.length === 0 ? (
                  <p className="text-sm text-gray-500">No assigned neighborhoods to show yet.</p>
                ) : null}
              </div>
            )}

            {panel === "residents" && (
              <PartnerResidentRoster residents={filteredResidents} loading={loading} />
            )}

            {panel === "claims" && (
              <PartnerClientClaims
                claims={pendingClaims}
                history={claimHistory}
                loading={loading}
                onChanged={() => void load()}
              />
            )}
          </div>
        </div>
      </div>

      {selectedPatrol ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40"
            aria-label="Close patroller details"
            onClick={() => setSelectedPatrol(null)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto border-l border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => setSelectedPatrol(null)}
              className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 dark:border-gray-700"
            >
              <FaTimes />
            </button>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 font-mono font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-200">
                {initials(selectedPatrol.full_name)}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedPatrol.full_name}</h3>
                <p className="text-xs text-gray-500">
                  {selectedPatrol.status === "scheduled" ? "Scheduled" : "On duty now"}
                </p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between border-b border-gray-100 py-2 dark:border-gray-800">
                <span className="text-gray-500">Area</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {selectedPatrol.organization_name || selectedPatrol.zone || "—"}
                </span>
              </div>
              <div className="flex justify-between border-b border-gray-100 py-2 dark:border-gray-800">
                <span className="text-gray-500">{selectedPatrol.status === "scheduled" ? "Shift" : "Started"}</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {selectedPatrol.status === "scheduled"
                    ? [selectedPatrol.slot_date, selectedPatrol.slot_start && selectedPatrol.slot_end ? `${selectedPatrol.slot_start}–${selectedPatrol.slot_end}` : ""]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    : selectedPatrol.start_time
                      ? formatWatchDateTime(selectedPatrol.start_time, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }) || "—"
                      : "—"}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-500">Phone</span>
                <span className="font-medium text-gray-900 dark:text-white">{selectedPatrol.phone || "—"}</span>
              </div>
            </div>
            {selectedPatrol.phone ? (
              <a
                href={`tel:${selectedPatrol.phone}`}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white"
              >
                <FaPhone /> Call patroller
              </a>
            ) : null}
          </aside>
        </>
      ) : null}
    </div>
  );
}
