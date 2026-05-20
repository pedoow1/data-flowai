import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { FileUploader } from "@/components/FileUploader";
import { AuditTable, ScanningSkeleton, mockExtract, type ExtractedRow } from "@/components/AuditTable";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useAuth, logEvent } from "@/lib/auth";
import { usePlan, useUsage } from "@/lib/usage";
import { PLAN_LIMITS } from "@/lib/config";
import { exportJSON, exportCSV, exportXLSX } from "@/lib/exporters";
import { History, Settings, Gauge, Zap, Sparkles, Check } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DataFlow AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { isAuthed, ready } = useAuth();
  const { plan } = usePlan();
  const { used, bump } = useUsage();
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [scanning, setScanning] = useState(0);
  const [upgrade, setUpgrade] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const limit = PLAN_LIMITS[plan];

  if (ready && !isAuthed) return <Navigate to="/login" />;

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const onFiles = async (files: File[]) => {
    const remaining = limit === Infinity ? files.length : Math.max(0, limit - used);
    if (remaining === 0) { setUpgrade(true); return; }
    const accepted = files.slice(0, remaining);
    if (accepted.length < files.length) {
      showToast(`Only ${accepted.length} of ${files.length} processed — plan limit reached.`);
    }
    setScanning(accepted.length);
    const results = await Promise.all(accepted.map(mockExtract));
    setRows(prev => [...results, ...prev]);
    setScanning(0);
    bump(accepted.length);
    logEvent("extract", `Extracted ${accepted.length} document(s)`);
    showToast(`Extracted ${accepted.length} document${accepted.length > 1 ? "s" : ""}`);
  };

  const onExport = (fmt: "json" | "csv" | "xlsx") => {
    const lockedByPlan = plan === "free";
    if (lockedByPlan) { setUpgrade(true); return; }
    if (fmt === "json") exportJSON(rows);
    if (fmt === "csv") exportCSV(rows);
    if (fmt === "xlsx") exportXLSX(rows);
    logEvent("export", `Exported ${rows.length} row(s) as ${fmt}`);
    showToast(`Export successful · ${fmt.toUpperCase()}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-8 w-full">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <Sidebar used={used} limit={limit} plan={plan} onUpgrade={() => setUpgrade(true)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Extract documents</h1>
                <p className="text-muted-foreground text-sm mt-1">Drop PDFs to begin. Output is editable and confidence-scored.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs glass rounded-full px-3 py-1.5">
                <Sparkles className="h-3 w-3 text-lime" /> Live · AI ready
              </span>
            </div>

            <FileUploader onFiles={onFiles} disabled={scanning > 0} />
            {scanning > 0 && <ScanningSkeleton count={scanning} />}
            <AuditTable rows={rows} setRows={setRows} onExport={onExport} locked={plan === "free"} />

            {rows.length === 0 && scanning === 0 && (
              <div className="mt-6 text-center text-xs text-muted-foreground">
                Try the demo — upload any PDF (up to 10MB). Your data never leaves this session.
              </div>
            )}
          </div>
        </div>
      </main>
      <UpgradeModal open={upgrade} onClose={() => setUpgrade(false)} />
      {toast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 glass-strong rounded-full px-4 py-2 text-sm flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          <Check className="h-4 w-4 text-lime" /> {toast}
        </div>
      )}
      <PrivacyBadge />
    </div>
  );
}

function Sidebar({ used, limit, plan, onUpgrade }: { used: number; limit: number; plan: string; onUpgrade: () => void }) {
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100);
  const remaining = limit === Infinity ? "∞" : Math.max(0, limit - used);
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 self-start">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider">
          <span>Usage</span>
          <span className="text-lime font-mono">{plan.toUpperCase()}</span>
        </div>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold">{used}</span>
          <span className="text-muted-foreground text-sm">/ {limit === Infinity ? "∞" : limit} docs</span>
        </div>
        <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-lime transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{remaining} remaining this cycle</p>
        {plan !== "team" && (
          <button onClick={onUpgrade} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-lime text-primary-foreground py-2 rounded-lg hover:opacity-90">
            <Zap className="h-3.5 w-3.5" /> Upgrade
          </button>
        )}
      </div>
      <nav className="glass rounded-2xl p-2 text-sm">
        {[
          { i: <Gauge className="h-4 w-4" />, t: "Extract" },
          { i: <History className="h-4 w-4" />, t: "History" },
          { i: <Settings className="h-4 w-4" />, t: "Settings" },
        ].map((it, idx) => (
          <div key={it.t} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer ${idx === 0 ? "bg-white/[0.04] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"}`}>
            {it.i} {it.t}
          </div>
        ))}
      </nav>
    </aside>
  );
}
