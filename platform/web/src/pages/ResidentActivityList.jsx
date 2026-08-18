import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import PageHeader from "../components/layout/PageHeader";
import { useScopedOrganization } from "../utils/organizationScope";

function activityTypeStyle(type) {
  const raw = String(type || "Activity").trim();
  const key = raw.toLowerCase();
  if (key.includes("sos")) {
    return {
      label: raw,
      pill: "bg-red-100 text-red-800 ring-1 ring-red-300/80 dark:bg-red-950/75 dark:text-red-200 dark:ring-red-500/45",
      accent: "border-l-red-500 dark:border-l-red-400",
    };
  }
  if (key.includes("vehicle")) {
    return {
      label: raw,
      pill: "bg-sky-100 text-sky-900 ring-1 ring-sky-300/80 dark:bg-sky-950/70 dark:text-sky-200 dark:ring-sky-500/40",
      accent: "border-l-sky-500 dark:border-l-sky-400",
    };
  }
  if (key.includes("noise")) {
    return {
      label: raw,
      pill: "bg-violet-100 text-violet-900 ring-1 ring-violet-300/80 dark:bg-violet-950/70 dark:text-violet-200 dark:ring-violet-500/40",
      accent: "border-l-violet-500 dark:border-l-violet-400",
    };
  }
  if (key.includes("suspicious")) {
    return {
      label: raw,
      pill: "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-500/40",
      accent: "border-l-amber-500 dark:border-l-amber-400",
    };
  }
  return {
    label: raw,
    pill: "bg-slate-100 text-slate-800 ring-1 ring-slate-300/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/40",
    accent: "border-l-slate-400 dark:border-l-slate-500",
  };
}

function statusMeta(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "approved") {
    return {
      label: "Logged for patrol",
      className:
        "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300/80 dark:bg-emerald-950/70 dark:text-emerald-200 dark:ring-emerald-500/40",
    };
  }
  if (s === "rejected") {
    return {
      label: "Not accepted",
      className:
        "bg-red-100 text-red-800 ring-1 ring-red-300/80 dark:bg-red-950/75 dark:text-red-200 dark:ring-red-500/45",
    };
  }
  return {
    label: "Pending review",
    className:
      "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-500/40",
  };
}

function timelineForReport(row, dbEvents) {
  const events = [...(dbEvents || [])];
  const status = String(row.status || "").toLowerCase();
  const receivedAt = row.incident_date || row.submitted_at || row.created_at;
  const resolvedAt = row.approved_at || row.rejected_at || receivedAt;
  const hasReceived = events.some(
    (event) => event.event_type === "received" || /received/i.test(event.title || "")
  );
  const hasResolved = events.some(
    (event) => event.event_type === "resolved" || /approved|rejected|logged for patrol/i.test(event.title || "")
  );

  if (!hasReceived && receivedAt) {
    events.unshift({
      id: `${row.id}-received`,
      created_at: receivedAt,
      title: "Report received",
      details: "Your report was submitted to patrol.",
    });
  }
  if (status === "approved" && !hasResolved) {
    events.push({
      id: `${row.id}-approved`,
      created_at: resolvedAt,
      title: "Logged for patrol",
      details: "Your report was reviewed and approved.",
    });
  } else if (status === "rejected" && !hasResolved) {
    events.push({
      id: `${row.id}-rejected`,
      created_at: resolvedAt,
      title: "Not accepted",
      details: "Your report was reviewed and closed.",
    });
  } else if (status === "pending" && !hasResolved) {
    events.push({
      id: `${row.id}-pending`,
      created_at: receivedAt,
      title: "Awaiting review",
      details: "Patrol has not finished reviewing this report yet.",
    });
  }
  return events;
}

export default function ResidentActivityList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsByIncidentId, setEventsByIncidentId] = useState({});

  const hydrateEvents = async (incidentIds) => {
    if (!incidentIds.length) {
      setEventsByIncidentId({});
      return;
    }
    const { data: eventRows, error: eventErr } = await supabase
      .from("resident_report_events")
      .select("id, incident_id, event_type, title, details, created_at")
      .in("incident_id", incidentIds)
      .order("created_at", { ascending: true });
    if (eventErr) {
      console.warn("resident_report_events:", eventErr.message);
      setEventsByIncidentId({});
      return;
    }
    const grouped = {};
    for (const eventRow of eventRows || []) {
      if (!grouped[eventRow.incident_id]) grouped[eventRow.incident_id] = [];
      grouped[eventRow.incident_id].push(eventRow);
    }
    setEventsByIncidentId(grouped);
  };

  useEffect(() => {
    if (!user?.id) return;
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from("incidents")
          .select("id, incident_date, type, description, location, status, reporter_id, submitted_by, organization_id")
          .or(`reporter_id.eq.${user.id},submitted_by.eq.${user.id}`)
          .order("incident_date", { ascending: false })
          .limit(100);
        if (error && /reporter_id|submitted_by/i.test(error.message || "")) {
          ({ data, error } = await supabase
            .from("incidents")
            .select("id, incident_date, type, description, location, status, organization_id")
            .eq("submitted_by", user.id)
            .order("incident_date", { ascending: false })
            .limit(100));
        }
        if (error) throw error;
        const nextRows = (data || []).filter(
          (row) =>
            !activeOrganizationId ||
            !row.organization_id ||
            row.organization_id === activeOrganizationId
        );
        if (!ignore) {
          setRows(nextRows);
          await hydrateEvents(nextRows.map((row) => row.id));
        }
      } catch (err) {
        console.error(err);
        toast.error(err.message || "Could not load your activity reports.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [user?.id, activeOrganizationId]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase
      .channel(`resident-incident-updates-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "incidents",
          filter: `reporter_id=eq.${user.id}`,
        },
        (payload) => {
          const oldStatus = String(payload.old?.status || "").toLowerCase();
          const newStatus = String(payload.new?.status || "").toLowerCase();
          if (!newStatus || newStatus === oldStatus) return;
          const pretty = newStatus.toUpperCase();
          toast(`Update: your report is now ${pretty}.`, { icon: "🔔" });
          setRows((prev) =>
            prev.map((row) => (row.id === payload.new.id ? { ...row, status: payload.new.status } : row))
          );
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification("Report status updated", {
                body: `Your report status is now ${pretty}.`,
              });
            } catch {
              // Ignore browser notification errors.
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <PageHeader
          title="Your activity reports"
          subtitle="Resident-submitted suspicious activity and their review status."
          backTo="/resident"
          backLabel="Back to resident home"
        />

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow">
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading your reports...</p>
          ) : rows.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">No reports submitted yet.</p>
              <button onClick={() => navigate("/resident/activity/new")} className="btn-secondary">
                Report suspicious activity
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {rows.map((row) => {
                const typeStyle = activityTypeStyle(row.type);
                const status = statusMeta(row.status);
                return (
                <article
                  key={row.id}
                  className={`rounded-xl border-y border-r border-l-4 border-y-gray-200 border-r-gray-200 bg-gray-50 p-4 shadow-sm ring-1 ring-gray-200/90 sm:p-5 dark:border-y-gray-600 dark:border-r-gray-600 dark:bg-gray-900/50 dark:ring-white/10 ${typeStyle.accent}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${typeStyle.pill}`}
                    >
                      {typeStyle.label}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(row.incident_date || row.submitted_at).toLocaleString()}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${status.className}`}
                    >
                      {status.label}
                    </span>
                    {row.is_anonymous_tip ? (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 ring-1 ring-slate-300/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/40">
                        Anonymous tip
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-gray-800 dark:text-gray-200">{row.description}</p>
                  {row.location ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Location: {row.location}</p>
                  ) : null}
                  <div className="mt-3 rounded-lg border border-gray-200/80 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/60">
                    <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Acknowledgement timeline</p>
                    <ol className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                      {timelineForReport(row, eventsByIncidentId[row.id]).map((timelineEvent) => (
                        <li key={timelineEvent.id}>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {timelineEvent.created_at
                              ? `${new Date(timelineEvent.created_at).toLocaleString()}:`
                              : ""}
                          </span>{" "}
                          {timelineEvent.title}
                          {timelineEvent.details ? ` — ${timelineEvent.details}` : ""}
                        </li>
                      ))}
                    </ol>
                  </div>
                </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
