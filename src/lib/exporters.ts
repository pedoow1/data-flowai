import type { ExtractedRow } from "@/components/AuditTable";

function sanitize(s: string) { return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60); }

export function autoName(rows: ExtractedRow[], ext: string) {
  if (rows.length === 1) {
    const r = rows[0];
    const invoiceNum = r.invoiceNumber?.v;
    const clientName = r.client?.v;
    const base = invoiceNum || clientName || "dataflow_export";
    return `${sanitize(base)}.${ext}`;
  }
  const clients = Array.from(new Set(rows.map(r => {
    const client = r.client?.v;
    return typeof client === "string" ? client : undefined;
  }).filter(Boolean)));
  const base = clients.length === 1 ? `${clients[0]}_${rows.length}_invoices` : `dataflow_batch_${rows.length}`;
  return `${sanitize(base)}.${ext}`;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const flatten = (rows: ExtractedRow[]) => rows.map(r => {
  const flattened: Record<string, any> = { file: r.fileName };
  
  // Flatten all cell values (skip id and fileName)
  for (const [key, val] of Object.entries(r)) {
    if (key !== "id" && key !== "fileName" && typeof val === "object" && val !== null && "v" in val) {
      flattened[key] = val.v;
    }
  }
  
  return flattened;
});

export function exportJSON(rows: ExtractedRow[]) {
  download(autoName(rows, "json"), new Blob([JSON.stringify(flatten(rows), null, 2)], { type: "application/json" }));
}

export function exportCSV(rows: ExtractedRow[]) {
  const data = flatten(rows);
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map(r =>
      headers.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
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

// ── Export format restrictions by plan ──────────────────────────────────────
export type ExportFormat = "json" | "csv" | "xlsx";

export function getAvailableExportFormats(plan: "free" | "pro" | "team"): ExportFormat[] {
  switch (plan) {
    case "free":
      return ["xlsx"];
    case "pro":
      return ["csv", "xlsx"];
    case "team":
      return ["json", "csv", "xlsx"];
  }
}

export function isExportFormatAllowed(plan: "free" | "pro" | "team", format: ExportFormat): boolean {
  return getAvailableExportFormats(plan).includes(format);
}

export function getExportFormatLabel(format: ExportFormat): string {
  switch (format) {
    case "json":
      return "JSON";
    case "csv":
      return "CSV";
    case "xlsx":
      return "Excel";
  }
}
