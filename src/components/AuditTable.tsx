import { Download, FileJson, FileSpreadsheet, Sparkles, Loader2, Lock } from "lucide-react";
import { isExportFormatAllowed, getExportFormatLabel, type ExportFormat } from "@/lib/exporters";
import { toast } from "sonner";

export type Cell = { v: string; c: number };

// Flexible row: `id` + `fileName` plus whatever fields the document contained.
export type ExtractedRow = {
  id: string;
  fileName: string;
  [key: string]: string | Cell;
};

function isCell(x: unknown): x is Cell {
  return !!x && typeof x === "object" && "v" in (x as Record<string, unknown>);
}

// Human-friendly labels for known canonical keys; unknown keys are prettified.
const LABELS: Record<string, string> = {
  invoiceNumber: "Invoice #", client: "Client", vendor: "Vendor", date: "Date",
  dueDate: "Due Date", amount: "Amount", tax: "Tax", total: "Total",
  poNumber: "PO #", reference: "Reference", description: "Description",
  quantity: "Qty", unitPrice: "Unit Price", paymentTerms: "Terms",
  currency: "Currency", status: "Status", notes: "Notes",
};
// Preferred column order; anything else is appended in first-seen order.
const PRIORITY = ["invoiceNumber", "client", "vendor", "date", "dueDate", "description", "quantity", "unitPrice", "amount", "tax", "total"];

function prettify(key: string): string {
  if (LABELS[key]) return LABELS[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build the union of all field keys across rows, ordered by PRIORITY then first-seen.
function columnKeys(rows: ExtractedRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (k === "id" || k === "fileName") continue;
      if (isCell(r[k])) seen.add(k);
    }
  }
  const ordered = PRIORITY.filter((k) => seen.has(k));
  const rest = [...seen].filter((k) => !PRIORITY.includes(k));
  return [...ordered, ...rest];
}

// Mock extractor — generates plausible data per uploaded file
export function mockExtract(file: File): Promise<ExtractedRow> {
  return new Promise((res) => {
    setTimeout(() => {
      const clients = ["Acme Corp", "Globex Inc", "Initech LLC", "Stark Industries", "Wayne Enterprises", "Umbrella Co"];
      const client = clients[Math.floor(Math.random() * clients.length)];
      const num = `INV-${Math.floor(10000 + Math.random() * 90000)}`;
      const amt = (Math.random() * 4000 + 200).toFixed(2);
      const tax = (Number(amt) * 0.2).toFixed(2);
      const total = (Number(amt) + Number(tax)).toFixed(2);
      const conf = () => 70 + Math.floor(Math.random() * 30);
      res({
        id: crypto.randomUUID(),
        fileName: file.name,
        invoiceNumber: { v: num, c: conf() },
        client: { v: client, c: conf() },
        date: { v: new Date(Date.now() - Math.random() * 1e10).toISOString().slice(0, 10), c: conf() },
        amount: { v: `$${amt}`, c: conf() },
        tax: { v: `$${tax}`, c: conf() },
        total: { v: `$${total}`, c: conf() },
      });
    }, 1200 + Math.random() * 1400);
  });
}

function ConfBadge({ c }: { c: number }) {
  const tone = c >= 90 ? "bg-lime/15 text-lime border-lime/30"
             : c >= 70 ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
             : "bg-red-500/10 text-red-400 border-red-500/30";
  return <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>{c}%</span>;
}

function EditableCell({ cell, onChange }: { cell: Cell; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center group">
      <input
        value={cell.v}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm outline-none focus:bg-white/5 rounded px-1.5 py-1 -mx-1.5 -my-1 min-w-0 w-full"
      />
      <ConfBadge c={cell.c} />
    </div>
  );
}

export function AuditTable({
  rows, setRows, onExport, locked, plan = "free",
}: {
  rows: ExtractedRow[];
  setRows: (r: ExtractedRow[]) => void;
  onExport: (fmt: "json" | "csv" | "xlsx") => void;
  locked: boolean;
  plan?: "free" | "pro" | "team";
}) {
  const update = (id: string, key: string, v: string) => {
    setRows(rows.map(r => {
      if (r.id !== id) return r;
      const prev = isCell(r[key]) ? (r[key] as Cell) : { v: "", c: 100 };
      return { ...r, [key]: { ...prev, v, c: 100 } };
    }));
  };

  const cols = columnKeys(rows);

  const EMPTY: Cell = { v: "—", c: 0 };

  if (rows.length === 0) return null;

  const handleExport = (fmt: ExportFormat) => {
    if (!isExportFormatAllowed(plan, fmt)) {
      toast.error(`${getExportFormatLabel(fmt)} export not available`, {
        description: `Upgrade to ${fmt === "json" ? "Team" : "Pro"} plan to export as ${getExportFormatLabel(fmt)}.`,
      });
      return;
    }
    onExport(fmt);
  };

  return (
    <div className="mt-6 glass rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-lime" />
          <h3 className="font-semibold text-sm">Extracted Data · <span className="text-muted-foreground font-normal">{rows.length} record{rows.length > 1 ? "s" : ""}</span></h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportBtn 
            label="JSON" 
            icon={<FileJson className="h-3.5 w-3.5" />} 
            onClick={() => handleExport("json")}
            disabled={!isExportFormatAllowed(plan, "json")}
            locked={!isExportFormatAllowed(plan, "json")}
          />
          <ExportBtn 
            label="CSV" 
            icon={<FileSpreadsheet className="h-3.5 w-3.5" />} 
            onClick={() => handleExport("csv")}
            disabled={!isExportFormatAllowed(plan, "csv")}
            locked={!isExportFormatAllowed(plan, "csv")}
          />
          <ExportBtn 
            label="Excel" 
            icon={<Download className="h-3.5 w-3.5" />} 
            onClick={() => handleExport("xlsx")}
            primary 
            disabled={!isExportFormatAllowed(plan, "xlsx")}
          />
        </div>
      </div>
      {!locked && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/70 bg-white/[0.02]">
          اضغط داخل أي خلية لتعديل البيانات يدويًا قبل التحميل.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.02] text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {["File", "Invoice #", "Client", "Date", "Amount", "Tax", "Total"].map(h => (
                <th key={h} className="text-left font-medium px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">{r.fileName}</td>
                <td className="px-4 py-2.5"><EditableCell cell={r.invoiceNumber} onChange={(v) => update(r.id, "invoiceNumber", v)} /></td>
                <td className="px-4 py-2.5"><EditableCell cell={r.client} onChange={(v) => update(r.id, "client", v)} /></td>
                <td className="px-4 py-2.5"><EditableCell cell={r.date} onChange={(v) => update(r.id, "date", v)} /></td>
                <td className="px-4 py-2.5"><EditableCell cell={r.amount} onChange={(v) => update(r.id, "amount", v)} /></td>
                <td className="px-4 py-2.5"><EditableCell cell={r.tax} onChange={(v) => update(r.id, "tax", v)} /></td>
                <td className="px-4 py-2.5"><EditableCell cell={r.total} onChange={(v) => update(r.id, "total", v)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExportBtn({ label, icon, onClick, primary, disabled, locked }: {
  label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; locked?: boolean;
}) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition relative
        ${disabled 
          ? "opacity-50 cursor-not-allowed border border-border/30" 
          : primary 
            ? "bg-lime text-primary-foreground hover:opacity-90" 
            : "border border-border hover:bg-white/5"}`}>
      {icon} {label}
      {locked && <Lock className="h-2.5 w-2.5 ml-0.5" />}
    </button>
  );
}

export function ScanningSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-6 glass rounded-2xl overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-lime" />
        <span>AI is scanning {count} document{count > 1 ? "s" : ""}…</span>
      </div>
      <div className="relative">
        <div className="absolute inset-x-0 h-px bg-lime shadow-[0_0_12px_2px_var(--lime-glow)] animate-scan z-10" />
        <div className="divide-y divide-border">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="px-4 py-4 flex gap-4">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="h-4 flex-1 rounded bg-gradient-to-r from-white/[0.03] via-white/[0.08] to-white/[0.03] bg-[length:1000px_100%] animate-shimmer" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
