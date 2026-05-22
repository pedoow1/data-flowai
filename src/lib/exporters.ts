import type { ExtractedRow } from "@/components/AuditTable";

function sanitize(s: string) { return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60); }

export function autoName(rows: ExtractedRow[], ext: string) {
  if (rows.length === 1) {
    const r = rows[0];
    const base = r.invoiceNumber?.v || r.client?.v || "dataflow_export";
    return `${sanitize(base)}.${ext}`;
  }
  const clients = Array.from(new Set(rows.map(r => r.client?.v).filter(Boolean)));
  const base = clients.length === 1 ? `${clients[0]}_${rows.length}_invoices` : `dataflow_batch_${rows.length}`;
  return `${sanitize(base)}.${ext}`;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const flatten = (rows: ExtractedRow[]) => rows.map(r => ({
  file: r.fileName,
  invoice_number: r.invoiceNumber.v,
  client: r.client.v,
  date: r.date.v,
  amount: r.amount.v,
  tax: r.tax.v,
  total: r.total.v,
}));

export function exportJSON(rows: ExtractedRow[]) {
  download(autoName(rows, "json"), new Blob([JSON.stringify(flatten(rows), null, 2)], { type: "application/json" }));
}
export function exportCSV(rows: ExtractedRow[]) {
  const data = flatten(rows);
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(r => headers.map(h => `"${String(r[h as keyof typeof r]).replace(/"/g, '""')}"`).join(","))].join("\n");
  download(autoName(rows, "csv"), new Blob([csv], { type: "text/csv" }));
}
export async function exportXLSX(rows: ExtractedRow[]) {
  const XLSX = await import("xlsx");
  const data = flatten(rows);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DataFlow");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  download(autoName(rows, "xlsx"), new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
