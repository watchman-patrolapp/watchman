import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../auth/useAuth";
import { canPostAreaBroadcast, homeBackNav } from "../auth/roleMatrix";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import { useOrgCapabilities } from "../hooks/useOrgCapabilities";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { formatWatchDateTime } from "../utils/watchTime";
import { useScopedOrganization } from "../utils/organizationScope";
import {
  areaBroadcastActionError,
  authorBadgeLabel,
  hideAreaBroadcast,
  listAreaBroadcasts,
  listHiddenAreaBroadcasts,
  restoreAreaBroadcast,
} from "../utils/areaBroadcasts";
import {
  listCommunityReports,
  moderationErrorMessage,
  resolveCommunityReport,
} from "../utils/communityReports";
import { REPORT_REASONS } from "../components/community/ReportContentButton";

const TABS = [
  { key: "reports", label: "Reports" },
  { key: "hidden", label: "Hidden" },
  { key: "notices", label: "Notices" },
];

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label]));

const CARD =
  "rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
const BTN =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
const BTN_PRIMARY =
  "rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50";

function BadgeChip({ badge }) {
  const label = authorBadgeLabel(badge);
  if (!label) return null;
  return (
    <span className="ml-1 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium normal-case text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
      {label}
    </span>
  );
}

export default function ResidentModeration() {
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const { has: hasCap } = useOrgCapabilities();
  const isStaff = canPostAreaBroadcast(user?.role, user?.platformRole);
  const isModerator = hasCap("resident_moderator");
  const back = homeBackNav(user?.role, user?.platformRole);

  const [tab, setTab] = useState("reports");
  const [reports, setReports] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schemaHint, setSchemaHint] = useState("");
  const [pendingKey, setPendingKey] = useState(null);

  const canActOnNotice = useCallback(
    (row) => isStaff || (isModerator && Boolean(row?.author_badge)),
    [isStaff, isModerator]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "reports") {
        const { data, error } = await listCommunityReports("open");
        if (error) {
          if (isRpcNotFoundError(error)) setSchemaHint("Run the P1 moderators SQL in Supabase first.");
          else toast.error(moderationErrorMessage(error, "Could not load reports."));
          setReports([]);
          return;
        }
        setSchemaHint("");
        setReports(data);
      } else if (tab === "hidden") {
        const { data, error } = await listHiddenAreaBroadcasts(30);
        if (error) {
          toast.error(areaBroadcastActionError(error, "Could not load hidden notices."));
          setHidden([]);
          return;
        }
        setHidden(data);
      } else {
        const { data, error } = await listAreaBroadcasts(30);
        if (error) {
          toast.error(areaBroadcastActionError(error, "Could not load notices."));
          setNotices([]);
          return;
        }
        setNotices(data);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load, activeOrganizationId]);

  const resolve = async (item, { status, hideContent }) => {
    const reportId = item.report_ids?.[0];
    if (!reportId || pendingKey) return;
    let note = null;
    if (hideContent) {
      note = window.prompt("Reason for hiding (optional, shown to the author):", "") ?? null;
      if (note === null) return;
    }
    setPendingKey(`${item.content_type}:${item.content_id}`);
    try {
      const { error } = await resolveCommunityReport(reportId, { status, note, hideContent });
      if (error) throw error;
      toast.success(hideContent ? "Hidden and report closed." : "Report dismissed.");
      await load();
    } catch (err) {
      toast.error(moderationErrorMessage(err, "Could not update the report."));
    } finally {
      setPendingKey(null);
    }
  };

  const hide = async (row) => {
    if (pendingKey) return;
    const reason = window.prompt("Reason for hiding (optional, shown to the author):", "");
    if (reason === null) return;
    setPendingKey(row.id);
    try {
      const { error } = await hideAreaBroadcast(row.id, reason);
      if (error) throw error;
      toast.success("Notice hidden.");
      await load();
    } catch (err) {
      toast.error(areaBroadcastActionError(err, "Could not hide notice."));
    } finally {
      setPendingKey(null);
    }
  };

  const restore = async (row) => {
    if (pendingKey) return;
    setPendingKey(row.id);
    try {
      const { error } = await restoreAreaBroadcast(row.id);
      if (error) throw error;
      toast.success("Notice restored.");
      await load();
    } catch (err) {
      toast.error(areaBroadcastActionError(err, "Could not restore notice."));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="Moderator tools"
          subtitle="Review reports and keep neighbourhood notices useful."
          backTo={back.backTo}
          backLabel={back.backLabel}
          rightSlot={<ThemeToggle variant="toolbar" />}
        />

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1 font-medium ${tab === t.key ? "bg-teal-600 text-white" : "text-gray-500 dark:text-gray-400"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {schemaHint ? <p className="text-sm text-amber-800 dark:text-amber-200">{schemaHint}</p> : null}
        {loading ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading.</p> : null}

        {!loading && tab === "reports" ? (
          reports.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No open reports.</p>
          ) : (
            reports.map((item) => {
              const key = `${item.content_type}:${item.content_id}`;
              const busy = pendingKey === key;
              return (
                <article key={key} className={CARD}>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {item.report_count} report{item.report_count === 1 ? "" : "s"} -{" "}
                    {(item.reasons || []).map((r) => REASON_LABELS[r] || r).join(", ")}
                    {item.last_reported_at ? ` - ${formatWatchDateTime(item.last_reported_at)}` : ""}
                  </p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {item.headline || "Reported item"}
                  </p>
                  {item.author_name ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      By {item.author_name}
                      <BadgeChip badge={item.author_badge} />
                      {item.content_hidden_at ? " - already hidden" : ""}
                    </p>
                  ) : null}
                  {item.body_preview ? <p className="mt-1 whitespace-pre-wrap">{item.body_preview}</p> : null}
                  {(item.details || []).length ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-gray-600 dark:text-gray-300">
                      {item.details.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.can_hide && !item.content_hidden_at ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resolve(item, { status: "actioned", hideContent: true })}
                        className={BTN_PRIMARY}
                      >
                        Hide
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => resolve(item, { status: "dismissed", hideContent: false })}
                      className={BTN}
                    >
                      Dismiss
                    </button>
                  </div>
                  {!item.can_hide ? (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Staff notices can only be hidden by the NW admin or committee.
                    </p>
                  ) : null}
                </article>
              );
            })
          )
        ) : null}

        {!loading && tab === "hidden" ? (
          hidden.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No hidden notices.</p>
          ) : (
            hidden.map((row) => (
              <article key={row.id} className={CARD}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {row.author_name}
                  <BadgeChip badge={row.author_badge} /> - hidden {formatWatchDateTime(row.hidden_at) || ""}
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">{row.headline}</p>
                <p className="whitespace-pre-wrap">{row.body}</p>
                {row.hidden_reason ? (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Reason: {row.hidden_reason}</p>
                ) : null}
                {canActOnNotice(row) ? (
                  <div className="mt-3">
                    <button type="button" disabled={pendingKey === row.id} onClick={() => restore(row)} className={BTN}>
                      Restore
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          )
        ) : null}

        {!loading && tab === "notices" ? (
          notices.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No live notices.</p>
          ) : (
            notices.map((row) => (
              <article key={row.id} className={CARD}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {row.author_name}
                  <BadgeChip badge={row.author_badge} /> - {formatWatchDateTime(row.created_at) || ""}
                </p>
                <p className="font-semibold text-gray-900 dark:text-white">{row.headline}</p>
                <p className="whitespace-pre-wrap">{row.body}</p>
                {canActOnNotice(row) || row.author_id === user?.id ? (
                  <div className="mt-3">
                    <button type="button" disabled={pendingKey === row.id} onClick={() => hide(row)} className={BTN}>
                      Hide
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          )
        ) : null}
      </div>
    </div>
  );
}