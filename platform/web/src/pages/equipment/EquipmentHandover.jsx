import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/ui/Button";
import FormField from "../../components/ui/FormField";
import ErrorState from "../../components/ui/ErrorState";
import { FIELD, LABEL } from "../../components/equipment/EquipmentLoanDialogs";
import {
  EQUIPMENT_CONDITION_LABELS,
  cancelEquipmentTransfer,
  clearHandoverCode,
  confirmHandoverGiver,
  confirmHandoverReceiver,
  equipmentErrorMessage,
  forceCompleteHandover,
  getEquipmentHandover,
  handoverCodePayload,
  handoverResultError,
  parseHandoverCode,
  readHandoverCode,
  regenerateHandoverCode,
  rememberHandoverCode,
  runEquipmentSweep,
} from "../../utils/equipment";
import EquipmentShell, { EquipmentNotice, InfoSection } from "./EquipmentShell";

function when(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** /equipment/handover/:transferId — both patrollers confirm a 6-digit code. */
export default function EquipmentHandover() {
  const { transferId } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [hint, setHint] = useState("");
  const [flash, setFlash] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [qr, setQr] = useState("");
  const [entry, setEntry] = useState("");
  const [condition, setCondition] = useState("good");
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    await runEquipmentSweep();
    const { data, error } = await getEquipmentHandover(transferId);
    setLoading(false);
    if (error) {
      setRow(null);
      setHint(equipmentErrorMessage(error));
      return;
    }
    setRow(data);
    setHint("");
    if (data?.i_am_giver && data.status === "accepted") setCode(readHandoverCode(transferId));
  }, [transferId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    if (!code || !transferId) {
      setQr("");
      return undefined;
    }
    QRCode.toDataURL(handoverCodePayload(transferId, code), { margin: 1, width: 220 })
      .then((url) => {
        if (live) setQr(url);
      })
      .catch(() => {
        if (live) setQr("");
      });
    return () => {
      live = false;
    };
  }, [code, transferId]);

  const run = async (fn, done) => {
    setBusy(true);
    const { data, error } = await fn();
    setBusy(false);
    const soft = handoverResultError(data, error);
    if (error) return setFlash(equipmentErrorMessage(error));
    if (soft) return setFlash(soft);
    if (data?.code) {
      rememberHandoverCode(transferId, data.code);
      setCode(data.code);
    }
    if (data?.completed) clearHandoverCode(transferId);
    setFlash(done(data));
    void load();
  };

  const cancel = async () => {
    setBusy(true);
    const { error } = await cancelEquipmentTransfer(transferId);
    setBusy(false);
    if (error) return setFlash(equipmentErrorMessage(error));
    clearHandoverCode(transferId);
    navigate("/equipment/mine");
  };

  const open = row && (row.status === "requested" || row.status === "accepted");
  const showForce = Boolean(row?.can_manage && open && !row.i_am_giver && !row.i_am_receiver);

  return (
    <EquipmentShell title="Hand-over" subtitle={row ? `${row.item_name || "Gear"} · ${row.asset_tag || ""}` : ""} backTo="/equipment/mine" backLabel="Back to my gear">
      {hint ? <EquipmentNotice>{hint}</EquipmentNotice> : null}
      {flash ? <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">{flash}</p> : null}
      {loading ? <p className="text-sm text-text-secondary">Loading...</p> : null}
      {!loading && !row && !hint ? <ErrorState title="Hand-over not found" message="It may have expired or belong to another neighbourhood." onRetry={load} /> : null}
      {row ? (
        <div className="space-y-4">
          <InfoSection title={row.asset_tag || "Unit"}>
            <p className="text-sm text-text-secondary">
              {row.giver_name || "The holder"} → {row.receiver_name || "the next patroller"}
              {row.respond_by && row.status === "requested" ? ` · accept by ${when(row.respond_by)}` : ""}
              {row.handover_by && row.status === "accepted" ? ` · finish by ${when(row.handover_by)}` : ""}
            </p>
            {row.other_phone ? <p className="mt-1 text-sm text-text-primary">Phone for this hand-over: {row.other_phone}</p> : null}
            {row.note ? <p className="mt-2 text-sm text-text-primary">"{row.note}"</p> : null}
            <p className="mt-2 text-sm text-text-secondary">
              {row.giver_confirmed ? "Holder has confirmed. " : "Holder has not confirmed yet. "}
              {row.receiver_confirmed ? "Receiver has entered the code." : "Receiver has not entered the code yet."}
            </p>
          </InfoSection>

          {row.status === "requested" && row.i_am_giver ? (
            <p className="text-sm text-text-secondary">Accept this from My gear. You then have 6 hours to meet and show the code.</p>
          ) : null}
          {row.status === "requested" && row.i_am_receiver ? (
            <p className="text-sm text-text-secondary">Waiting for the holder to accept. They have 12 hours. You will get a notification.</p>
          ) : null}

          {row.i_am_giver && row.status === "accepted" ? (
            <InfoSection title="Show this code">
              {code ? (
                <>
                  <p className="text-center font-mono text-4xl font-bold tracking-[0.3em] text-text-primary" aria-label={`Hand-over code ${code.split("").join(" ")}`}>{code}</p>
                  {qr ? <img src={qr} alt="" className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-2" /> : null}
                  <p className="mt-2 text-center text-xs text-text-tertiary">The other patroller enters this code. It is not stored after you leave this screen.</p>
                </>
              ) : (
                <p className="text-sm text-text-secondary">The code is only shown once. Generate a new one if you closed the page.</p>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button type="button" loading={busy} onClick={() => run(() => confirmHandoverGiver(transferId), (d) => (d?.completed ? "Hand-over complete." : "Recorded. Waiting for them to enter the code."))}>
                  I have handed it over
                </Button>
                <Button type="button" variant="secondary" loading={busy} onClick={() => run(() => regenerateHandoverCode(transferId), () => "New code ready. The old one no longer works.")}>
                  New code
                </Button>
              </div>
            </InfoSection>
          ) : null}

          {row.i_am_receiver && row.status === "accepted" ? (
            <InfoSection title="Enter their code">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = parseHandoverCode(entry);
                  if (parsed.length !== 6 || !ack) return;
                  void run(
                    () => confirmHandoverReceiver(transferId, parsed, condition, true),
                    (d) => (d?.completed ? "You now hold this unit." : "Code accepted. Waiting for the holder to confirm."),
                  );
                }}
              >
                <FormField id="eq-code" label="6-digit code" required>
                  <input id="eq-code" inputMode="numeric" autoComplete="one-time-code" maxLength={48} value={entry} onChange={(e) => setEntry(e.target.value)} className={FIELD} />
                </FormField>
                <div>
                  <label htmlFor="eq-hcond" className={LABEL}>Condition</label>
                  <select id="eq-hcond" value={condition} onChange={(e) => setCondition(e.target.value)} className={FIELD}>
                    {Object.entries(EQUIPMENT_CONDITION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-start gap-2 text-sm text-text-primary">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                  <span>I accept responsibility for this unit until I return it or hand it on.</span>
                </label>
                <Button type="submit" loading={busy} disabled={parseHandoverCode(entry).length !== 6 || !ack}>
                  Confirm I have it
                </Button>
              </form>
            </InfoSection>
          ) : null}

          {showForce ? (
            <InfoSection title="Admin: complete without the code">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim().length < 10) return;
                  void run(() => forceCompleteHandover(transferId, reason.trim()), () => "Hand-over completed. No charge was created.");
                }}
              >
                <FormField id="eq-force" label="Why" required hint="At least 10 characters. Use this when a phone is dead or someone is not answering.">
                  <textarea id="eq-force" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} />
                </FormField>
                <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 10}>Complete hand-over</Button>
              </form>
            </InfoSection>
          ) : null}

          {open && (row.i_am_giver || row.i_am_receiver) ? (
            <Button type="button" variant="secondary" loading={busy} onClick={cancel}>Cancel hand-over</Button>
          ) : null}
          {!open ? <p className="text-sm text-text-secondary">This hand-over is {row.status}. The gear stays with whoever the ledger shows.</p> : null}
        </div>
      ) : null}
    </EquipmentShell>
  );
}
