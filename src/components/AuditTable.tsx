import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, Lock, Sparkles, Loader2 } from "lucide-react";

export type ExtractedRow = {
  id: string;
  fileName: string;
  invoiceNumber: { v: string; c: number };
  client: { v: string; c: number };
  date: { v: string; c: number };
  amount: { v: string; c: number };
  tax: { v: string; c: number };
  total: { v: string; c: number };
};

export type Cell = { v: string; c: number };

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
  rows, setRows, onExport, locked,
}: {
  rows: ExtractedRow[];
  setRows: (r: ExtractedRow[]) => void;
  onExport: (fmt: "json" | "csv" | "xlsx") => void;
  locked: boolean;
}) {
  const update = (id: string, key: keyof Omit<ExtractedRow, "id" | "fileName">, v: string) => {
    setRows(rows.map(r => r.id === id ? { ...r, [key]: { ...(r[key] as Cell), v, c: 100 } } : r));
  };

  if (rows.length === 0) return null;

  return (
    <div className="mt-6 glass rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-lime" />
          <h3 className="font-semibold text-sm">Extracted Data · <span className="text-muted-foreground font-normal">{rows.length} record{rows.length > 1 ? "s" : ""}</span></h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportBtn label="JSON" icon={<FileJson className="h-3.5 w-3.5" />} locked={locked} onClick={() => onExport("json")} />
          <ExportBtn label="CSV" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} locked={locked} onClick={() => onExport("csv")} />
          <ExportBtn label="Excel" icon={<Download className="h-3.5 w-3.5" />} locked={locked} onClick={() => onExport("xlsx")} primary />
        </div>
      </div>
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

function ExportBtn({ label, icon, onClick, locked, primary }: {
  label: string; icon: React.ReactNode; onClick: () => void; locked: boolean; primary?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition
        ${primary ? "bg-lime text-primary-foreground hover:opacity-90" : "border border-border hover:bg-white/5"}`}>
      {locked ? <Lock className="h-3.5 w-3.5" /> : icon} {label}
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
