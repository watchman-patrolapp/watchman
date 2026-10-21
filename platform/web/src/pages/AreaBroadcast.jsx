import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FaBullhorn } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import { canPostAreaBroadcast, homeBackNav } from "../auth/roleMatrix";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  applyAreaBroadcastChange,
  areaBroadcastActionError,
  editAreaBroadcast,
  formatClockTime,
  formatNoticeRemaining,
  hideAreaBroadcast,
  isActivityAreaBroadcast,
  isMissingAreaBroadcastHideSchema,
  isPinnedAreaBroadcast,
  listAreaBroadcasts,
  listHiddenAreaBroadcasts,
  noticeActivityUntil,
  noticePinnedUntil,
  notifyResidentEvent,
  postAreaBroadcast,
  restoreAreaBroadcast,
  subscribeAreaBroadcasts,
} from "../utils/areaBroadcasts";
import { formatWatchDateTime } from "../utils/watchTime";
import { useScopedOrganization } from "../utils/organizationScope";

export default function AreaBroadcast() {
  const { user } = useAuth();
  const { activeOrganizationId } = useScopedOrganization();
  const allowed = canPostAreaBroadcast(user?.role, user?.platformRole);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [rows, setRows] = useState([]);
  const [hiddenRows, setHiddenRows] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editHeadline, setEditHeadline] = useState("");
  const [editBody, setEditBody] = useState("");
  const [hideTarget, setHideTarget] = useState(null);
  const [hideReason, setHideReason] = useState("");
  const [schemaHint, setSchemaHint] = useState("");
  const loadGen = useRef(0);
  const showHiddenRef = useRef(false);
  const back = homeBackNav(user?.role);

  useEffect(() => {
    showHiddenRef.current = showHidden;
  }, [showHidden]);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const wantHidden = showHiddenRef.current;
    const { data, error } = await listAreaBroadcasts(12);
    if (gen !== loadGen.current) return;
    if (error && !isRpcNotFoundError(error)) {
      console.warn("broadcasts:", error.message);
    } else if (!error) {
      setRows(data || []);
    }
    if (!wantHidden) return;
    const hidden = await listHiddenAreaBroadcasts(30);
    if (gen !== loadGen.current) return;
    if (hidden.error) {
      if (isMissingAreaBroadcastHideSchema(hidden.error)) {
        setHiddenRows([]);
        setSchemaHint("Run the area broadcast hide SQL in Supabase first.");
        return;
      }
      console.warn("hidden broadcasts:", hidden.error.message);
      return;
    }
    setSchemaHint("");
    setHiddenRows(hidden.data || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load, showHidden, activeOrganizationId]);

  useEffect(() => {
    const unsubscribe = subscribeAreaBroadcasts(activeOrganizationId, (payload) => {
      if (!showHiddenRef.current) {
        setRows((prev) => applyAreaBroadcastChange(prev, payload));
      }
      void load();
    });
    return unsubscribe;
  }, [activeOrganizationId, load]);

  const submit = async (event) => {
    event.preventDefault();
    if (!allowed || busy) return;
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

  const confirmHide = async (event) => {
    event.preventDefault();
    if (!hideTarget?.id || pendingId) return;
    setPendingId(hideTarget.id);
    try {
      const { error } = await hideAreaBroadcast(hideTarget.id, hideReason);
      if (error) throw error;
      toast.success("Notice hidden.");
      setHideTarget(null);
      setHideReason("");
      if (editingId === hideTarget.id) setEditingId(null);
      await load();
    } catch (err) {
      toast.error(areaBroadcastActionError(err, "Could not hide notice."));
    } finally {
      setPendingId(null);
    }
  };

  const restore = async (row) => {
    if (!row?.id || pendingId) return;
    setPendingId(row.id);
    try {
      const { error } = await restoreAreaBroadcast(row.id);
      if (error) throw error;
      toast.success("Notice restored.");
      await load();
    } catch (err) {
      toast.error(areaBroadcastActionError(err, "Could not restore notice."));
    } finally {
      setPendingId(null);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditHeadline(row.headline || "");
    setEditBody(row.body || "");
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingId || pendingId) return;
    setPendingId(editingId);
    try {
      const { error } = await editAreaBroadcast(editingId, {
        headline: editHeadline,
        body: editBody,
      });
      if (error) throw error;
      toast.success("Notice updated.");
      setEditingId(null);
      await load();
    } catch (err) {
      toast.error(areaBroadcastActionError(err, "Could not update notice."));
    } finally {
      setPendingId(null);
    }
  };

  const visibleRows = showHidden ? hiddenRows : rows;

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
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {showHidden ? "Hidden notices" : "Recent notices"}
            </h2>
            {allowed ? (
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs dark:border-gray-700 dark:bg-gray-800">
                <button
                  type="button"
                  onClick={() => setShowHidden(false)}
                  className={`rounded-md px-2.5 py-1 font-medium ${showHidden ? "text-gray-500 dark:text-gray-400" : "bg-teal-600 text-white"}`}
                >
                  Live
                </button>
                <button
                  type="button"
                  onClick={() => setShowHidden(true)}
                  className={`rounded-md px-2.5 py-1 font-medium ${showHidden ? "bg-teal-600 text-white" : "text-gray-500 dark:text-gray-400"}`}
                >
                  Hidden
                </button>
              </div>
            ) : null}
          </div>
          {schemaHint && showHidden ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">{schemaHint}</p>
          ) : null}
          {visibleRows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {showHidden ? "No hidden notices." : "No live notices."}
            </p>
          ) : (
            visibleRows.map((row) => {
              const mine = Boolean(user?.id) && row.author_id === user.id;
              const editing = editingId === row.id;
              return (
                <article
                  key={row.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {row.author_name} · {formatWatchDateTime(row.created_at) || "—"}
                    {row.edited_at ? " · edited" : ""}
                    {showHidden
                      ? ""
                      : isPinnedAreaBroadcast(row)
                        ? ` · on Home until ${formatClockTime(noticePinnedUntil(row))} (${formatNoticeRemaining(noticePinnedUntil(row))})`
                        : isActivityAreaBroadcast(row)
                          ? ` · in activity until ${formatClockTime(noticeActivityUntil(row))} (${formatNoticeRemaining(noticeActivityUntil(row))})`
                          : ""}
                  </p>
                  {editing ? (
                    <form onSubmit={saveEdit} className="space-y-2">
                      <input
                        type="text"
                        value={editHeadline}
                        onChange={(e) => setEditHeadline(e.target.value)}
                        maxLength={120}
                        aria-label="Headline"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                        required
                      />
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={5}
                        maxLength={4000}
                        aria-label="Message"
                        className="w-full resize-y rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                        required
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Corrections are saved on the same notice. Households are not notified again.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={pendingId === row.id || !editHeadline.trim() || !editBody.trim()}
                          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                          {pendingId === row.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:underline dark:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="mb-1 font-semibold text-gray-900 dark:text-white">{row.headline}</p>
                      <p className="whitespace-pre-wrap">{row.body}</p>
                      {showHidden && row.hidden_reason ? (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                          Hidden · {row.hidden_reason}
                        </p>
                      ) : null}
                      {allowed || mine ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {showHidden && allowed ? (
                            <button
                              type="button"
                              onClick={() => restore(row)}
                              disabled={pendingId === row.id}
                              className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
                            >
                              {pendingId === row.id ? "Restoring…" : "Restore"}
                            </button>
                          ) : null}
                          {!showHidden && (allowed || mine) ? (
                            <button
                              type="button"
                              onClick={() => {
                                setHideTarget(row);
                                setHideReason("");
                              }}
                              disabled={pendingId === row.id}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              Hide
                            </button>
                          ) : null}
                          {!showHidden && mine ? (
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                            >
                              Edit
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>

      {hideTarget ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
          <form
            onSubmit={confirmHide}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hide-notice-title"
            className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <h3 id="hide-notice-title" className="text-sm font-semibold text-gray-900 dark:text-white">
              Hide this notice?
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              It leaves Home and the live list. Staff can restore it. The author is told when someone else hides it.
            </p>
            <label className="mt-3 block text-sm font-medium text-gray-800 dark:text-gray-100" htmlFor="hide-notice-reason">
              Reason (optional)
              <textarea
                id="hide-notice-reason"
                value={hideReason}
                onChange={(e) => setHideReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Wrong street, or already resolved"
                className="mt-2 w-full resize-y rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
            </label>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hideReason.length}/300</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setHideTarget(null);
                  setHideReason("");
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:underline dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pendingId === hideTarget.id}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {pendingId === hideTarget.id ? "Hiding…" : "Hide notice"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
