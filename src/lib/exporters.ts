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
export function exportXLSX(rows: ExtractedRow[]) {
  // Minimal SpreadsheetML 2003 XML — opens in Excel as .xls
  const data = flatten(rows);
  const headers = Object.keys(data[0]);
  const row = (cells: string[]) => `<Row>${cells.map(c => `<Cell><Data ss:Type="String">${String(c).replace(/[<>&]/g, m => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" } as Record<string, string>)[m])}</Data></Cell>`).join("")}</Row>`;
  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="DataFlow"><Table>${row(headers)}${data.map(d => row(headers.map(h => String(d[h as keyof typeof d])))).join("")}</Table></Worksheet>
</Workbook>`;
  download(autoName(rows, "xls"), new Blob([xml], { type: "application/vnd.ms-excel" }));
}
