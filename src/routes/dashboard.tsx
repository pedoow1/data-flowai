import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { FileUploader } from "@/components/FileUploader";
import { AuditTable, ScanningSkeleton, type ExtractedRow } from "@/components/AuditTable";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PdfPreview } from "@/components/PdfPreview";
import { HelpButton } from "@/components/HelpButton";
import { useAuth } from "@/lib/auth";
import { extractFromText, extractFromImage } from "@/lib/extract.functions";
import { extractPdfText, pdfPageToImageDataUrl, imageFileToDataUrl } from "@/lib/pdf";
import { getMyUsage, recordUpload, setAdminPlan } from "@/lib/usage.functions";
import { exportJSON, exportCSV, exportXLSX } from "@/lib/exporters";
import { track, identify } from "@/lib/analytics";
import { History, Settings, Gauge, Zap, Sparkles, Trash2, FileText, AlertTriangle, Infinity as InfinityIcon } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DataFlow AI" }] }),
  component: Dashboard,
});

type Tab = "extract" | "history" | "settings";
const HISTORY_KEY = "dataflow_history";

type Usage = { plan: "free" | "pro" | "team"; used: number; limit: number; remaining: number; unlimited: boolean; isAdmin?: boolean };

function loadHistory(): ExtractedRow[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(rows: ExtractedRow[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 200)));
}

function Dashboard() {
  const { isAuthed, ready, email, isAdmin } = useAuth();
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [history, setHistory] = useState<ExtractedRow[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [tab, setTab] = useState<Tab>("extract");
  const [usage, setUsage] = useState<Usage>({ plan: "free", used: 0, limit: 2, remaining: 2, unlimited: false });
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [debugError, setDebugError] = useState<{ error: string; detail?: string; file: string; ts: string } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const extract       = useServerFn(extractFromText);
  const extractVision = useServerFn(extractFromImage);
  const fetchUsage    = useServerFn(getMyUsage);
  const logUpload     = useServerFn(recordUpload);
  const changePlan    = useServerFn(setAdminPlan);

  const refreshUsage = useCallback(async () => {
    try {
      const u = (await fetchUsage()) as Usage;
      setUsage(u);
    } catch { /* noop */ }
  }, [fetchUsage]);

  useEffect(() => { setHistory(loadHistory()); }, []);
  useEffect(() => {
    if (!email) return;
    identify(email);
    void refreshUsage();
  }, [email, refreshUsage]);

  if (ready && !isAuthed) return <Navigate to="/login" />;

  const runExtraction = async (file: File) => {
    if (!email) return;

    if (!usage.unlimited && usage.remaining <= 0) {
      toast.error("Daily limit reached", {
        description: `You've used all ${usage.limit} uploads today on the ${usage.plan.toUpperCase()} plan.`,
        action: { label: "Upgrade", onClick: () => setUpgrade(true) },
      });
      return;
    }

    setRows([]);
    setCurrentFile(file);
    setLastFile(file);
    setScanning(true);
    const started = Date.now();

    const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);

    try {
      type AIResult = { ok: false; error: string } | { ok: true; row: Omit<ExtractedRow, "id" | "fileName"> };
      let res: AIResult;
      let pages = 1;

      if (isImage) {
        // ── Image file → vision model directly ──
        toast.info("Using vision model for image…");
        const imageDataUrl = await imageFileToDataUrl(file);
        res = (await extractVision({ data: { imageDataUrl, fileName: file.name } })) as AIResult;
      } else {
        // ── PDF → try text first, fall back to vision if scanned or encrypted ──
        let pdfText = "";
        let usedVisionFallback = false;
        try {
          const extracted = await extractPdfText(file);
          pages = extracted.pages;
          pdfText = extracted.text;
        } catch (pdfErr: unknown) {
          // Encrypted / password-protected PDF or crypto mismatch → use vision model
          const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
          console.warn("[pdf] text extraction failed, falling back to vision:", msg);
          usedVisionFallback = true;
        }

        if (usedVisionFallback || pdfText.length < 20) {
          if (usedVisionFallback) toast.info("Encrypted PDF detected — switching to vision model…");
          else toast.info("Scanned PDF detected — switching to vision model…");
          const imageDataUrl = await pdfPageToImageDataUrl(file, 1);
          res = (await extractVision({ data: { imageDataUrl, fileName: file.name } })) as AIResult;
        } else {
          res = (await extract({ data: { text: pdfText, fileName: file.name } })) as AIResult;
          if (!res.ok && res.error === "__NEEDS_VISION__") {
            toast.info("Scanned PDF detected — switching to vision model…");
            const imageDataUrl = await pdfPageToImageDataUrl(file, 1);
            res = (await extractVision({ data: { imageDataUrl, fileName: file.name } })) as AIResult;
          }
        }
      }

      if (!res.ok) {
        track("file_upload_failure", { reason: res.error, pages, duration_ms: Date.now() - started });
        if (isAdmin) {
          const d = res as { ok: false; error: string; debugDetail?: string };
          setDebugError({ error: d.error, detail: d.debugDetail, file: file.name, ts: new Date().toLocaleTimeString() });
          setDebugOpen(true);
        }
        toast.error("Extraction failed", {
          description: res.error,
          action: { label: "Retry", onClick: () => runExtraction(file) },
        });
        setScanning(false);
        return;
      }

      const result = res;

      const extracted: ExtractedRow = { id: crypto.randomUUID(), fileName: file.name, ...result.row };

      // Record successful upload server-side (atomic: enforces plan limit too)
      const recorded = (await logUpload({ data: { fileName: file.name } })) as
        | { ok: true; usage: Usage }
        | { ok: false; error: string; usage: Usage };
      if (!recorded.ok) {
        setUsage(recorded.usage);
        toast.error(recorded.error);
        setScanning(false);
        return;
      }
      setUsage(recorded.usage);

      setRows([extracted]);
      const newHistory = [extracted, ...history];
      setHistory(newHistory);
      saveHistory(newHistory);

      track("file_upload_success", { pages, duration_ms: Date.now() - started });
      toast.success("Extraction complete", { description: `${file.name} processed in ${((Date.now() - started) / 1000).toFixed(1)}s` });

      if (!recorded.usage.unlimited && recorded.usage.remaining > 0 && recorded.usage.remaining <= 10) {
        toast.warning(`You have ${recorded.usage.remaining} upload${recorded.usage.remaining === 1 ? "" : "s"} remaining today`);
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : "Unknown error";
      track("file_upload_failure", { reason: error, duration_ms: Date.now() - started });
      toast.error("Could not process file", {
        description: error,
        action: { label: "Retry", onClick: () => runExtraction(file) },
      });
    } finally {
      setScanning(false);
    }
  };

  const onFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      toast.info("Processing the most recent file", { description: "Side-by-side preview supports one document at a time." });
    }
    await runExtraction(files[files.length - 1]);
  };

  const onExport = (fmt: "json" | "csv" | "xlsx", source: ExtractedRow[] = rows) => {
    if (source.length === 0) { toast.error("Nothing to export"); return; }
    if (fmt === "json") exportJSON(source);
    if (fmt === "csv") exportCSV(source);
    if (fmt === "xlsx") exportXLSX(source);
    toast.success(`Export successful · ${fmt.toUpperCase()}`);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
    toast.success("History cleared");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 w-full">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          <Sidebar usage={usage} onUpgrade={() => setUpgrade(true)} tab={tab} setTab={setTab} isAdmin={isAdmin} />

          <div className="min-w-0">
            {tab === "extract" && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Extract documents</h1>
                    <p className="text-muted-foreground text-sm mt-1">Drop a PDF — your data never leaves your browser unencrypted.</p>
                  </div>
                </div>

                <FileUploader onFiles={onFiles} disabled={scanning} />

                {isAdmin && debugError && (
                  <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/30 text-xs font-mono overflow-hidden">
                    <button
                      onClick={() => setDebugOpen((o) => !o)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-red-400 hover:bg-red-950/50 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-semibold">Admin Debug · {debugError.file} · {debugError.ts}</span>
                      </span>
                      <span className="text-red-500/70">{debugOpen ? "▲ hide" : "▼ show"}</span>
                    </button>
                    {debugOpen && (
                      <div className="px-4 pb-4 space-y-2 border-t border-red-500/20 pt-3">
                        <div>
                          <span className="text-red-400/60 uppercase tracking-widest text-[10px]">Error</span>
                          <p className="text-red-300 mt-0.5 break-all">{debugError.error}</p>
                        </div>
                        {debugError.detail && (
                          <div>
                            <span className="text-red-400/60 uppercase tracking-widest text-[10px]">Groq Raw Response</span>
                            <pre className="text-red-200/80 mt-0.5 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">{debugError.detail}</pre>
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => navigator.clipboard?.writeText(JSON.stringify(debugError, null, 2))}
                            className="px-2.5 py-1 rounded bg-red-800/50 text-red-300 hover:bg-red-800 text-[11px]"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => { setDebugError(null); setDebugOpen(false); }}
                            className="px-2.5 py-1 rounded bg-red-800/50 text-red-300 hover:bg-red-800 text-[11px]"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 grid lg:grid-cols-2 gap-4">
                  <PdfPreview file={currentFile} />
                  <div>
                    {scanning ? (
                      <ScanningSkeleton count={1} />
                    ) : rows.length > 0 ? (
                      <AuditTable rows={rows} setRows={setRows} onExport={(f) => onExport(f, rows)} locked={false} />
                    ) : (
                      <div className="glass rounded-2xl h-[480px] lg:h-[640px] flex flex-col items-center justify-center text-center p-8">
                        <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">Extracted data will appear here as an editable table.</p>
                        {lastFile && !currentFile && (
                          <button onClick={() => runExtraction(lastFile)} className="mt-4 text-xs px-3 py-1.5 rounded-lg bg-lime text-primary-foreground font-medium">
                            Retry last file
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === "history" && (
              <HistoryView history={history} onClear={clearHistory} onExport={(f) => onExport(f, history)} />
            )}

            {tab === "settings" && (
              <SettingsView
                email={email}
                isAdmin={isAdmin}
                usage={usage}
                onUpgrade={() => setUpgrade(true)}
                onPlanChange={async (plan) => {
                  const res = await changePlan({ data: { plan } }) as { ok: boolean; error?: string };
                  if (!res.ok) throw new Error(res.error ?? "Server error");
                  await refreshUsage();
                }}
              />
            )}
          </div>
        </div>
      </main>

      <UpgradeModal open={upgrade} onClose={() => setUpgrade(false)} />
      <HelpButton defaultEmail={email || ""} />
      <PrivacyBadge />
    </div>
  );
}

function Sidebar({ usage, onUpgrade, tab, setTab, isAdmin }: {
  usage: Usage; onUpgrade: () => void; tab: Tab; setTab: (t: Tab) => void; isAdmin: boolean;
}) {
  const pct = usage.unlimited ? 0 : Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  const items: { id: Tab; i: React.ReactNode; t: string }[] = [
    { id: "extract", i: <Gauge className="h-4 w-4" />, t: "Extract" },
    { id: "history", i: <History className="h-4 w-4" />, t: "History" },
    { id: "settings", i: <Settings className="h-4 w-4" />, t: "Settings" },
  ];
  const warning = !usage.unlimited && usage.remaining <= 10;
  return (
    <aside className="space-y-4 lg:sticky lg:top-20 self-start">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider">
          <span>Daily usage</span>
          <span className="text-lime font-mono">{usage.plan.toUpperCase()}</span>
        </div>
        {usage.unlimited ? (
          <>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold">{usage.used}</span>
              <span className="text-muted-foreground text-sm inline-flex items-center gap-1">/ <InfinityIcon className="h-4 w-4" /></span>
            </div>
            <p className="mt-3 text-xs text-lime">Unlimited uploads on Team plan</p>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold">{usage.used}</span>
              <span className="text-muted-foreground text-sm">/ {usage.limit}</span>
            </div>
            <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full transition-all ${warning ? "bg-yellow-400" : "bg-lime"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className={`mt-2 text-xs flex items-center gap-1 ${warning ? "text-yellow-400" : "text-muted-foreground"}`}>
              {warning && <AlertTriangle className="h-3 w-3" />}
              You have {usage.remaining} upload{usage.remaining === 1 ? "" : "s"} remaining today
            </p>
          </>
        )}
        {usage.plan !== "team" && (
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
        {isAdmin && (
          <Link to="/admin" className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-lime hover:bg-white/[0.02]">
            <Sparkles className="h-4 w-4" /> Admin Analytics
          </Link>
        )}
      </nav>
    </aside>
  );
}

function HistoryView({ history, onClear, onExport }: {
  history: ExtractedRow[]; onClear: () => void; onExport: (f: "json" | "csv" | "xlsx") => void;
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
        <AuditTable rows={history} setRows={() => {}} onExport={onExport} locked={false} />
      )}
    </>
  );
}

function SettingsView({ email, isAdmin, usage, onUpgrade, onPlanChange }: {
  email: string | null; isAdmin: boolean; usage: Usage; onUpgrade: () => void;
  onPlanChange?: (plan: "free" | "pro" | "team") => Promise<void>;
}) {
  const [changingPlan, setChangingPlan] = useState(false);

  const handlePlanChange = async (plan: "free" | "pro" | "team") => {
    if (!onPlanChange || plan === usage.plan) return;
    setChangingPlan(true);
    try {
      await onPlanChange(plan);
      toast.success(`Plan switched to ${plan.toUpperCase()}`);
    } catch {
      toast.error("Failed to switch plan");
    } finally {
      setChangingPlan(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and usage.</p>
      </div>
      <div className="space-y-4">
        <Card title="Account">
          <Row label="Email" value={email || "—"} />
          <Row label="Role" value={isAdmin ? "Admin" : "Member"} />
          <Row label="Plan" value={usage.plan.toUpperCase()} />
        </Card>

        {isAdmin && (
          <Card title="Admin — Switch Plan">
            <p className="text-xs text-muted-foreground mb-3">Switch your active plan (you stay unlimited regardless).</p>
            <div className="flex gap-2">
              {(["free", "pro", "team"] as const).map((p) => (
                <button
                  key={p}
                  disabled={changingPlan || p === usage.plan}
                  onClick={() => handlePlanChange(p)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition disabled:opacity-50 ${
                    p === usage.plan
                      ? "bg-lime text-primary-foreground border-lime"
                      : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card title="Usage (last 24 hours)">
          <Row label="Uploads used" value={String(usage.used)} />
          <Row label="Remaining" value={usage.unlimited ? "Unlimited" : String(usage.remaining)} />
          <Row label="Daily limit" value={usage.unlimited ? "Unlimited" : String(usage.limit)} />
          {!isAdmin && usage.plan !== "team" && (
            <button onClick={onUpgrade} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-lime text-primary-foreground px-3 py-1.5 rounded-lg hover:opacity-90">
              <Zap className="h-3.5 w-3.5" /> Upgrade for higher limits
            </button>
          )}
        </Card>

        <Card title="Data & Privacy">
          <p className="text-sm text-muted-foreground">
            Your files are processed instantly and are never stored on our servers. We do not use your data to train our AI models. Extraction history is saved only in your browser.
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
