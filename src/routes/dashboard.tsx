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
import { History, Settings, Gauge, Zap, Sparkles, Check, Trash2, RotateCcw, FileText } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DataFlow AI" }] }),
  component: Dashboard,
});

type Tab = "extract" | "history" | "settings";
const HISTORY_KEY = "dataflow_history";

function loadHistory(): ExtractedRow[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(rows: ExtractedRow[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 200)));
}

function Dashboard() {
  const { isAuthed, ready, email } = useAuth();
  const { plan, setPlan } = usePlan();
  const { used, bump, reset: resetUsage } = useUsage();
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [history, setHistory] = useState<ExtractedRow[]>([]);
  const [scanning, setScanning] = useState(0);
  const [upgrade, setUpgrade] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("extract");
  const limit = PLAN_LIMITS[plan];

  useEffect(() => { setHistory(loadHistory()); }, []);

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
    const next = [...results, ...rows];
    setRows(next);
    const newHistory = [...results, ...history];
    setHistory(newHistory);
    saveHistory(newHistory);
    setScanning(0);
    bump(accepted.length);
    logEvent("extract", `Extracted ${accepted.length} document(s)`);
    showToast(`Extracted ${accepted.length} document${accepted.length > 1 ? "s" : ""}`);
  };

  const onExport = (fmt: "json" | "csv" | "xlsx", source: ExtractedRow[] = rows) => {
    const lockedByPlan = plan === "free";
    if (lockedByPlan) { setUpgrade(true); return; }
    if (source.length === 0) { showToast("Nothing to export"); return; }
    if (fmt === "json") exportJSON(source);
    if (fmt === "csv") exportCSV(source);
    if (fmt === "xlsx") exportXLSX(source);
    logEvent("export", `Exported ${source.length} row(s) as ${fmt}`);
    showToast(`Export successful · ${fmt.toUpperCase()}`);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
    showToast("History cleared");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-8 w-full">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <Sidebar used={used} limit={limit} plan={plan} onUpgrade={() => setUpgrade(true)} tab={tab} setTab={setTab} />
          <div className="min-w-0">
            {tab === "extract" && (
              <>
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
                <AuditTable rows={rows} setRows={setRows} onExport={(f) => onExport(f, rows)} locked={plan === "free"} />
                {rows.length === 0 && scanning === 0 && (
                  <div className="mt-6 text-center text-xs text-muted-foreground">
                    Try the demo — upload any PDF (up to 10MB). Your data never leaves this session.
                  </div>
                )}
              </>
            )}

            {tab === "history" && (
              <HistoryView history={history} onClear={clearHistory} onExport={(f) => onExport(f, history)} locked={plan === "free"} />
            )}

            {tab === "settings" && (
              <SettingsView
                email={email}
                plan={plan}
                setPlan={(p) => { setPlan(p); showToast(`Plan set to ${p.toUpperCase()}`); }}
                used={used}
                resetUsage={() => { resetUsage(); showToast("Usage reset"); }}
                onUpgrade={() => setUpgrade(true)}
              />
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

function Sidebar({ used, limit, plan, onUpgrade, tab, setTab }: {
  used: number; limit: number; plan: string; onUpgrade: () => void; tab: Tab; setTab: (t: Tab) => void;
}) {
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100);
  const remaining = limit === Infinity ? "∞" : Math.max(0, limit - used);
  const items: { id: Tab; i: React.ReactNode; t: string }[] = [
    { id: "extract", i: <Gauge className="h-4 w-4" />, t: "Extract" },
    { id: "history", i: <History className="h-4 w-4" />, t: "History" },
    { id: "settings", i: <Settings className="h-4 w-4" />, t: "Settings" },
  ];
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
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg transition ${tab === it.id ? "bg-white/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"}`}
          >
            {it.i} {it.t}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function HistoryView({ history, onClear, onExport, locked }: {
  history: ExtractedRow[]; onClear: () => void; onExport: (f: "json" | "csv" | "xlsx") => void; locked: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">History</h1>
          <p className="text-muted-foreground text-sm mt-1">{history.length} record{history.length === 1 ? "" : "s"} stored locally on this device.</p>
        </div>
        {history.length > 0 && (
          <button onClick={onClear} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-white/5">
            <Trash2 className="h-3.5 w-3.5" /> Clear history
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No extractions yet. Process a document to populate your history.</p>
        </div>
      ) : (
        <AuditTable rows={history} setRows={() => {}} onExport={onExport} locked={locked} />
      )}
    </>
  );
}

function SettingsView({ email, plan, setPlan, used, resetUsage, onUpgrade }: {
  email: string | null; plan: "free" | "pro" | "team"; setPlan: (p: "free" | "pro" | "team") => void;
  used: number; resetUsage: () => void; onUpgrade: () => void;
}) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account, plan and usage.</p>
      </div>
      <div className="space-y-4">
        <Card title="Account">
          <Row label="Email" value={email || "—"} />
          <Row label="Plan" value={plan.toUpperCase()} />
          <Row label="Documents used" value={String(used)} />
        </Card>

        <Card title="Plan">
          <p className="text-sm text-muted-foreground mb-3">Switch plans (demo). Use Upgrade for real checkout.</p>
          <div className="flex flex-wrap gap-2">
            {(["free", "pro", "team"] as const).map(p => (
              <button key={p} onClick={() => setPlan(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${plan === p ? "bg-lime text-primary-foreground border-lime" : "border-border hover:bg-white/5"}`}>
                {p.toUpperCase()}
              </button>
            ))}
            <button onClick={onUpgrade} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold bg-lime text-primary-foreground px-3 py-1.5 rounded-lg hover:opacity-90">
              <Zap className="h-3.5 w-3.5" /> Upgrade
            </button>
          </div>
        </Card>

        <Card title="Usage">
          <p className="text-sm text-muted-foreground mb-3">Reset your usage counter for this billing cycle.</p>
          <button onClick={resetUsage} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-white/5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset usage
          </button>
        </Card>

        <Card title="Privacy">
          <p className="text-sm text-muted-foreground">
            DataFlow AI uses ephemeral memory processing. We do not store or train AI on your documents.
            History entries are saved locally in your browser only.
          </p>
        </Card>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
