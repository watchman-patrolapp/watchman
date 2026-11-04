import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import SosHoldButton from "./SosHoldButton";
import {
  EMERGENCY_CALL_NAME,
  EMERGENCY_CALL_NUMBER,
  emergencyCallHref,
} from "../../config/emergency";
import { installChatQueueRunner, retryQueuedItem } from "../../chat/utils/chatQueueRunner";
import {
  CHAT_QUEUE_CHANGED_EVENT,
  readChatQueue,
  readSosPendingSent,
} from "../../chat/utils/chatQueueStorage";
import {
  queueResidentSosForLater,
  retrySosChatNow,
  triggerResidentSos,
} from "../../utils/residentSos";
import {
  canUseOfflineSosQueue,
  classifySosDelivery,
  countdownLabel,
  initialSosSendState,
  isNavigatorOffline,
  reduceSosSend,
} from "../../utils/sosDelivery";

function EmergencyCallLink({ prominent = false }) {
  const className = prominent
    ? "flex min-h-[44px] w-full items-center justify-center rounded-xl bg-red-700 px-4 text-base font-bold text-white hover:bg-red-800"
    : "inline-flex min-h-[44px] items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800";
  return (
    <a href={emergencyCallHref()} className={className}>
      Call {EMERGENCY_CALL_NAME} {EMERGENCY_CALL_NUMBER}
    </a>
  );
}

export default function ResidentSosControl({ user, organizationId, notes = "" }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reduceSosSend, null, initialSosSendState);
  const [offline, setOffline] = useState(() => isNavigatorOffline());
  const [errorMessage, setErrorMessage] = useState("");
  const [chatLocalId, setChatLocalId] = useState(null);
  const [chatQueued, setChatQueued] = useState(false);
  const [pendingLocalId, setPendingLocalId] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState("");
  const [canQueueOffline] = useState(() => canUseOfflineSosQueue());
  const startedRef = useRef(false);
  const notesRef = useRef(notes);
  const userRef = useRef(user);
  const orgRef = useRef(organizationId);
  const chatArgsRef = useRef(null);

  notesRef.current = notes;
  userRef.current = user;
  orgRef.current = organizationId;

  useEffect(() => {
    installChatQueueRunner();
  }, []);

  useEffect(() => {
    const sync = () => setOffline(isNavigatorOffline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (state.phase !== "confirming") return undefined;
    const id = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "cancel" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "sending") {
      startedRef.current = false;
      return undefined;
    }
    if (startedRef.current) return undefined;
    startedRef.current = true;

    const currentUser = userRef.current;
    const currentOrg = orgRef.current || currentUser?.organizationId;
    const currentNotes = notesRef.current;

    void (async () => {
      if (!currentOrg) {
        setErrorMessage("Select or join a neighbourhood before sending an SOS.");
        dispatch({ type: "failed" });
        return;
      }
      if (isNavigatorOffline()) {
        if (!canUseOfflineSosQueue()) {
          setErrorMessage("You are offline, and this device cannot queue the SOS.");
          dispatch({ type: "failed" });
          return;
        }
        const queued = await queueResidentSosForLater({
          user: currentUser,
          organizationId: currentOrg,
          notes: currentNotes,
          triggerType: "hold",
        });
        if (queued.ok) {
          setPendingLocalId(queued.localId);
          dispatch({ type: "offline_queued" });
          return;
        }
        setErrorMessage(queued.error || "You are offline. The SOS was not queued.");
        dispatch({ type: "failed" });
        return;
      }

      try {
        const result = await triggerResidentSos({
          user: currentUser,
          organizationId: currentOrg,
          notes: currentNotes,
          triggerType: "hold",
        });
        const delivery = classifySosDelivery({ recorded: true, chatOk: result.chat?.ok === true });
        if (delivery === "success") {
          dispatch({ type: "success" });
          return;
        }
        chatArgsRef.current = {
          user: currentUser,
          coords: result.coords,
          description: result.description,
          orgId: result.orgId || currentOrg,
          homeAddress: result.homeAddress,
          card: result.card,
          localId: result.chat?.localId,
        };
        setChatLocalId(result.chat?.localId || null);
        setChatQueued(result.chat?.queued === true);
        setErrorMessage(result.chat?.error || "Patrol chat did not get the SOS.");
        dispatch({ type: "chat_failed" });
      } catch (err) {
        console.error(err);
        setErrorMessage(err?.message || "Could not send the SOS.");
        dispatch({ type: "failed" });
      }
    })();
    return undefined;
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "chat_failed" || !chatQueued || !chatLocalId) return undefined;
    const sync = () => {
      const stillQueued = readChatQueue().some((row) => row.localId === chatLocalId);
      if (!stillQueued) dispatch({ type: "success" });
    };
    sync();
    window.addEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
    const id = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
      window.clearInterval(id);
    };
  }, [state.phase, chatQueued, chatLocalId]);

  useEffect(() => {
    if (state.phase !== "offline_queued" || !pendingLocalId) return undefined;
    const sync = () => {
      const sent = readSosPendingSent(pendingLocalId);
      if (!sent) return;
      if (sent.chatOk) {
        dispatch({ type: "success" });
        return;
      }
      setChatLocalId(sent.chatLocalId);
      setChatQueued(Boolean(sent.chatLocalId));
      setErrorMessage("Your SOS is recorded, but patrol chat did not get it.");
      dispatch({ type: "chat_failed" });
    };
    sync();
    window.addEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
    const id = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(CHAT_QUEUE_CHANGED_EVENT, sync);
      window.clearInterval(id);
    };
  }, [state.phase, pendingLocalId]);

  const onArm = () => {
    if (!user?.id || state.phase === "sending") return;
    const org = organizationId || user.organizationId;
    if (!org) {
      toast.error("Select or join a neighbourhood before sending an SOS.");
      return;
    }
    setRetryNote("");
    dispatch({ type: "arm" });
  };

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryNote("");
    try {
      if (chatQueued && chatLocalId) {
        const result = await retryQueuedItem(chatLocalId);
        if (result.ok || result.missing) {
          dispatch({ type: "success" });
          return;
        }
        if (result.skipped) {
          setRetryNote("Automatic retry is already running.");
          return;
        }
        setRetryNote(result.error?.message || "Patrol chat still did not get it.");
        return;
      }
      if (chatArgsRef.current) {
        const chat = await retrySosChatNow(chatArgsRef.current);
        setChatQueued(chat.queued === true);
        setChatLocalId(chat.localId || chatLocalId);
        if (chat.ok) {
          dispatch({ type: "success" });
          return;
        }
        setRetryNote(chat.error || "Patrol chat still did not get it.");
      }
    } catch (err) {
      setRetryNote(err?.message || "Patrol chat still did not get it.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-3">
      {offline ? (
        <div
          role="status"
          className="rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <p className="font-semibold">You are offline.</p>
          {canQueueOffline ? (
            <p className="mt-1">
              Patrol cannot see an SOS until you reconnect. If you send one, it is queued and will
              send when you are back online.
            </p>
          ) : (
            <>
              <p className="mt-1">
                Patrol cannot see an SOS until you reconnect, and this device cannot queue it.
              </p>
              <div className="mt-3">
                <EmergencyCallLink prominent />
              </div>
            </>
          )}
        </div>
      ) : null}

      {state.phase === "confirming" ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-4 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-50">
          <p aria-live="assertive" className="text-center text-lg font-bold">
            {countdownLabel(state.secondsLeft)}
          </p>
          <p className="mt-1 text-center text-sm">Press SOS again to send now.</p>
          {offline ? (
            <p className="mt-2 text-center text-sm">
              You are offline. This SOS will send when you reconnect. Call {EMERGENCY_CALL_NUMBER} if
              you need help now.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => dispatch({ type: "cancel" })}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-base font-semibold text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {state.phase === "sending" ? (
        <p aria-live="assertive" className="text-center text-sm font-semibold text-red-700 dark:text-red-300">
          Sending SOS…
        </p>
      ) : null}

      {state.phase === "success" ? (
        <div
          role="status"
          className="rounded-xl border border-green-600 bg-green-50 px-4 py-3 text-sm text-green-950 dark:border-green-700 dark:bg-green-950/40 dark:text-green-50"
        >
          <p className="font-semibold">SOS sent. Patrollers and admins have been notified.</p>
          <button
            type="button"
            onClick={() => navigate("/chat")}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-800"
          >
            Open patrol chat
          </button>
        </div>
      ) : null}

      {state.phase === "chat_failed" ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <p className="font-semibold">Your SOS is recorded, but patrol chat did not get it.</p>
          <p className="mt-1">
            {chatQueued
              ? "It is queued and will be retried automatically."
              : "The retry could not be queued on this device."}
          </p>
          {errorMessage ? <p className="mt-1 text-xs opacity-80">{errorMessage}</p> : null}
          {retryNote ? <p className="mt-1">{retryNote}</p> : null}
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={retrying}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <div
          role="alert"
          className="rounded-xl border border-red-600 bg-red-50 px-4 py-4 text-red-950 dark:border-red-700 dark:bg-red-950/30 dark:text-red-50"
        >
          <p className="text-base font-bold">SOS was not sent.</p>
          <p className="mt-1 text-sm">
            {errorMessage || "Patrol did not get this SOS."} Call {EMERGENCY_CALL_NUMBER} now.
          </p>
          <div className="mt-3">
            <EmergencyCallLink prominent />
          </div>
        </div>
      ) : null}

      {state.phase === "offline_queued" ? (
        <div
          role="status"
          className="rounded-xl border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-50"
        >
          <p className="font-semibold">You are offline. This SOS is queued.</p>
          <p className="mt-1">It will send when you reconnect. If you need help right now, call.</p>
          <div className="mt-3">
            <EmergencyCallLink prominent />
          </div>
        </div>
      ) : null}

      <SosHoldButton
        onTrigger={onArm}
        busy={state.phase === "sending"}
        confirming={state.phase === "confirming"}
      />
    </div>
  );
}
