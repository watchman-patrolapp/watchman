import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FaBullhorn } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import { canPostAreaBroadcast, homeBackNav } from "../auth/roleMatrix";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  formatClockTime,
  formatNoticeRemaining,
  isActivityAreaBroadcast,
  isPinnedAreaBroadcast,
  listAreaBroadcasts,
  noticeActivityUntil,
  noticePinnedUntil,
  notifyResidentEvent,
  postAreaBroadcast,
  subscribeAreaBroadcasts,
} from "../utils/areaBroadcasts";
import { useScopedOrganization } from "../utils/organizationScope";

export default function AreaBroadcast() {
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const allowed = canPostAreaBroadcast(user?.role, user?.platformRole);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const back = homeBackNav(user?.role);

  const load = async () => {
    const { data, error } = await listAreaBroadcasts(12);
    if (error && !isRpcNotFoundError(error)) {
      console.warn("broadcasts:", error.message);
      return;
    }
    setRows(data || []);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAreaBroadcasts(activeOrganizationId, () => {
      void load();
    });
    return unsubscribe;
  }, [activeOrganizationId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!allowed) return;
    setBusy(true);
    try {
      const { data, error } = await postAreaBroadcast({ headline, body });
      if (error) throw error;
      toast.success("Notice sent to this neighbourhood.");
      setHeadline("");
      setBody("");
      if (data?.id) {
        void notifyResidentEvent({ type: "broadcast", broadcastId: data.id });
      }
      await load();
    } catch (err) {
      toast.error(err.message || "Could not send notice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-900 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader
          title="Neighbourhood notice"
          subtitle="Paste a WhatsApp update — power, water, or anything households should know."
          backTo={back.backTo}
          backLabel={back.backLabel}
          rightSlot={<ThemeToggle variant="toolbar" />}
        />

        {allowed ? (
          <form
            onSubmit={submit}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5"
          >
            <label className="block text-sm font-semibold text-gray-900 dark:text-white" htmlFor="area-broadcast-headline">
              Headline
              <input
                id="area-broadcast-headline"
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={120}
                placeholder="Water shutdown Thursday"
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                required
              />
            </label>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{headline.length}/120</p>

            <div className="mt-4 flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-gray-900 dark:text-white" htmlFor="area-broadcast-body">
                Message
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (!text.trim()) {
                      toast.error("Clipboard is empty.");
                      return;
                    }
                    setBody(text.slice(0, 4000));
                  } catch {
                    toast.error("Paste into the message box instead.");
                  }
                }}
                className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
              >
                Paste from clipboard
              </button>
            </div>
            <textarea
              id="area-broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={4000}
              placeholder="Paste the WhatsApp notice here…"
              className="mt-2 w-full resize-y rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              required
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Households see the headline and message at the top of Home for 12 hours, then in Neighbourhood activity for 12 more hours. After 24 hours it disappears. The headline is the lock-screen title. {body.length}/4000
            </p>
            <button
              type="submit"
              disabled={busy || !headline.trim() || !body.trim()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <FaBullhorn className="h-3.5 w-3.5" aria-hidden />
              {busy ? "Sending…" : "Send notice"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">You cannot post neighbourhood notices.</p>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Recent notices</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No live notices.</p>
          ) : (
            rows.map((row) => (
              <article
                key={row.id}
                className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {row.author_name} · {new Date(row.created_at).toLocaleString()}
                  {isPinnedAreaBroadcast(row)
                    ? ` · on Home until ${formatClockTime(noticePinnedUntil(row))} (${formatNoticeRemaining(noticePinnedUntil(row))})`
                    : isActivityAreaBroadcast(row)
                      ? ` · in activity until ${formatClockTime(noticeActivityUntil(row))} (${formatNoticeRemaining(noticeActivityUntil(row))})`
                      : ""}
                </p>
                <p className="mb-1 font-semibold text-gray-900 dark:text-white">{row.headline}</p>
                {row.body}
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
