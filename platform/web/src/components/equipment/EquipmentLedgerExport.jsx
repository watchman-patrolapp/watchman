import { useState } from "react";
import Button from "../ui/Button";
import { downloadDomAsPdf } from "../../utils/downloadDomAsPdf";
import { equipmentErrorMessage } from "../../utils/equipment";
import { exportEquipmentLedger, verifyEquipmentLedger } from "../../utils/equipmentReporting";
import { LEDGER_EXPORT_COLUMNS, ledgerRowsToCsv } from "../../utils/equipmentReportingMeta";

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Admin ledger export (CSV, spreadsheet, PDF) and the hash-chain check. */
export default function EquipmentLedgerExport({ orgId, from, to }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadRows = async () => {
    const { data, error } = await exportEquipmentLedger(from, to);
    if (error) throw error;
    return data || [];
  };

  const run = async (kind, fn) => {
    setBusy(kind);
    setMessage("");
    try {
      await fn();
    } catch (error) {
      setMessage(equipmentErrorMessage(error, "The ledger export could not be prepared."));
    } finally {
      setBusy("");
    }
  };

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === "csv"} onClick={() => run("csv", async () => {
          const rows = await loadRows();
          downloadBlob(`equipment-ledger-${stamp}.csv`, new Blob([ledgerRowsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
          setMessage(`${rows.length} ledger rows exported.`);
        })}>CSV</Button>
        <Button variant="secondary" loading={busy === "xlsx"} onClick={() => run("xlsx", async () => {
          const rows = await loadRows();
          const ExcelJS = (await import("exceljs")).default;
          const book = new ExcelJS.Workbook();
          const sheet = book.addWorksheet("Ledger");
          sheet.addRow(LEDGER_EXPORT_COLUMNS);
          rows.forEach((row) => sheet.addRow(LEDGER_EXPORT_COLUMNS.map((key) => row[key] ?? "")));
          const buffer = await book.xlsx.writeBuffer();
          downloadBlob(`equipment-ledger-${stamp}.xlsx`, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          setMessage(`${rows.length} ledger rows exported.`);
        })}>Spreadsheet</Button>
        <Button variant="secondary" loading={busy === "pdf"} onClick={() => run("pdf", async () => {
          const rows = await loadRows();
          const host = document.createElement("div");
          host.innerHTML = `<h1 style="font:16px sans-serif">Equipment ledger</h1><p style="font:12px sans-serif">${rows.length} rows</p><table style="width:100%;font:11px sans-serif;border-collapse:collapse">${rows.slice(0, 400).map((row) => `<tr><td>${escapeHtml(row.occurred_at || "")}</td><td>${escapeHtml(row.event || "")}</td><td>${escapeHtml(row.asset_tag || "")}</td><td>${escapeHtml(row.actor_name || "")}</td></tr>`).join("")}</table>`;
          document.body.appendChild(host);
          try {
            await downloadDomAsPdf(host, `equipment-ledger-${stamp}.pdf`);
          } finally {
            host.remove();
          }
          setMessage(rows.length > 400 ? `${rows.length} rows. The PDF shows the first 400; use CSV for the full list.` : `${rows.length} ledger rows exported.`);
        })}>PDF</Button>
        <Button variant="ghost" loading={busy === "verify"} onClick={() => run("verify", async () => {
          if (!orgId) throw new Error("Choose a neighbourhood first.");
          const { data, error } = await verifyEquipmentLedger(orgId);
          if (error) throw error;
          setMessage(data == null ? "The ledger chain checks out." : "The ledger chain does not check out. Ask support to look at it before the AGM.");
        })}>Check the chain</Button>
      </div>
      {message ? <p className="text-sm text-text-secondary" role="status">{message}</p> : null}
    </div>
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
