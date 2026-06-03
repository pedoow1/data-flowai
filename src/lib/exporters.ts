import type { ExtractedRow, Cell } from "@/components/AuditTable";

function isCell(x: unknown): x is Cell {
  return !!x && typeof x === "object" && "v" in (x as Record<string, unknown>);
}
function cellVal(r: ExtractedRow, key: string): string {
  const x = r[key];
  return isCell(x) ? x.v : "";
}

function sanitize(s: string) { return s.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60); }

export function autoName(rows: ExtractedRow[], ext: string) {
  if (rows.length === 1) {
    const r = rows[0];
    const base = cellVal(r, "invoiceNumber") || cellVal(r, "client") || "dataflow_export";
    return `${sanitize(base)}.${ext}`;
  }
  const clients = Array.from(new Set(rows.map(r => cellVal(r, "client")).filter(Boolean)));
  const base = clients.length === 1 ? `${clients[0]}_${rows.length}_invoices` : `dataflow_batch_${rows.length}`;
  return `${sanitize(base)}.${ext}`;
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Union of all field keys across rows so every column is exported.
function allKeys(rows: ExtractedRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k === "id" || k === "fileName") continue;
      if (isCell(r[k])) seen.add(k);
    }
  }
  return [...seen];
}

const flatten = (rows: ExtractedRow[]) => {
  const keys = allKeys(rows);
  return rows.map(r => {
    const flattened: Record<string, string> = { file: r.fileName };
    for (const k of keys) flattened[k] = cellVal(r, k);
    return flattened;
  });
};

export function exportJSON(rows: ExtractedRow[]) {
  download(autoName(rows, "json"), new Blob([JSON.stringify(flatten(rows), null, 2)], { type: "application/json" }));
}

export function exportCSV(rows: ExtractedRow[]) {
  const data = flatten(rows);
  if (data.length === 0) return;

  const headers = ["file", ...allKeys(rows)];
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
