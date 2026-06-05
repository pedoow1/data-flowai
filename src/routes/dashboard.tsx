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
import {
  createExtractionJob,
  getJobStatus,
  type ExtractionRow,
  type JobStatusResponse,
} from "@/lib/jobs.functions";
import { extractPdfText, pdfPageToImageDataUrl, imageFileToDataUrl } from "@/lib/pdf";
import { getMyUsage, recordUpload, setAdminPlan } from "@/lib/usage.functions";
import { exportJSON, exportCSV, exportXLSX } from "@/lib/exporters";
import { track, identify } from "@/lib/analytics";
import {
  History,
  Settings,
  Gauge,
  Zap,
  Sparkles,
  Trash2,
  FileText,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — DataFlow AI" }] }),
  component: Dashboard,
});

type Tab = "extract" | "history" | "settings";
const HISTORY_KEY = "dataflow_history";
type JobProgressState = {
  progress: number;
  currentStage: string | null;
  processedChunks: number;
  totalChunks: number;
  etaSeconds: number | null;
  lastHeartbeat: string | null;
};

// ── Token estimation constants ──────────────────────────────────────────────
// 1 token ≈ 4 characters (conservative estimate)
// Model limit: 16,384 tokens
// Reserve ~3,500 for output → safe input: ~12,800 tokens (~51,200 chars)
const SAFE_CHAR_LIMIT = 50_000; // ~12,500 tokens - safe for chunking
const WARN_CHAR_LIMIT = 100_000; // ~25,000 tokens - large document warning
const MAX_CHAR_LIMIT = 6_000_000; // ~1.5M tokens - absolute maximum

type Usage = {
  plan: "free" | "pro" | "team";
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  isAdmin?: boolean;
  cycle?: "lifetime" | "monthly" | "daily";
  label?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
};

function loadHistory(): ExtractedRow[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHistory(rows: ExtractedRow[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 200)));
}

function estimateTokens(text: string): number {
  // Conservative estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

// ── Client-side error extraction ────────────────────────────────────────────
function extractClientError(error: unknown): string {
  if (!error) return "Unknown error occurred";
  const maybeObject =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
  const maybeNestedData =
    maybeObject && typeof maybeObject.data === "object" && maybeObject.data !== null
      ? (maybeObject.data as Record<string, unknown>)
      : null;

  // Handle Error objects
  if (error instanceof Error) {
    return error.message;
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  // Handle Response/fetch errors
  if (typeof maybeObject?.message === "string") {
    return maybeObject.message;
  }

  // Handle JSON error responses
  if (typeof maybeObject?.error === "string") {
    return maybeObject.error;
  }

  // Handle nested error messages
  if (typeof maybeNestedData?.error === "string") {
    return maybeNestedData.error;
  }

  // Fallback to JSON stringification for debugging
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return String(error).slice(0, 300);
  }
}

function formatEtaLabel(etaSeconds: number | null): string {
  if (etaSeconds === null || etaSeconds < 0) return "Estimating time remaining…";
  if (etaSeconds <= 5) return "Less than 5 seconds left";
  if (etaSeconds < 60) return `About ${etaSeconds} seconds left`;
  const minutes = Math.ceil(etaSeconds / 60);
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

function Dashboard() {
  const { isAuthed, ready, email, isAdmin } = useAuth();
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [history, setHistory] = useState<ExtractedRow[]>([]);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  const [tab, setTab] = useState<Tab>("extract");
  const [usage, setUsage] = useState<Usage>({
    plan: "free",
    used: 0,
    limit: 2,
    remaining: 2,
    unlimited: false,
  });
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgressState>({
    progress: 0,
    currentStage: null,
    processedChunks: 0,
    totalChunks: 0,
    etaSeconds: null,
    lastHeartbeat: null,
  });
  const createJob = useServerFn(createExtractionJob);
  const pollJob = useServerFn(getJobStatus);
  const fetchUsage = useServerFn(getMyUsage);
  const logUpload = useServerFn(recordUpload);
  const changePlan = useServerFn(setAdminPlan);

  // Creates a background extraction job and polls until it finishes.
  // The heavy AI work runs in a Supabase Edge Function, so this never blocks
  // a Vercel request long enough to time out.
  const runJob = async (
    input:
      | { kind: "text"; text: string; fileName: string }
      | { kind: "image"; imageDataUrl: string; fileName: string },
  ): Promise<{ ok: false; error: string } | { ok: true; rows: ExtractionRow[] }> => {
    const created = (await createJob({ data: input })) as {
      ok: boolean;
      jobId?: string;
      error?: string;
    };
    if (!created.ok || !created.jobId) {
      return { ok: false, error: created.error || "Failed to start extraction." };
    }
    const jobId = created.jobId;
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      let s: JobStatusResponse;
      try {
        s = (await pollJob({ data: { jobId } })) as JobStatusResponse;
      } catch {
        continue; // transient poll error → keep trying
      }
      setJobProgress({
        progress: s.progress,
        currentStage: s.currentStage,
        processedChunks: s.processedChunks,
        totalChunks: s.totalChunks,
        etaSeconds: s.etaSeconds,
        lastHeartbeat: s.lastHeartbeat,
      });
      if (s.status === "completed") {
        if (!s.rows.length)
          return { ok: false, error: "No data could be extracted from this document." };
        return { ok: true, rows: s.rows };
      }
      if (s.status === "failed") return { ok: false, error: s.error || "Extraction failed." };
    }

    return {
      ok: false,
      error:
        "This document is taking too long to process in the background. Please retry with a smaller file or scan fewer pages.",
    };
  };

  const refreshUsage = useCallback(async () => {
    try {
      const u = (await fetchUsage()) as Usage;
      setUsage(u);
    } catch (e) {
      console.error("[dashboard] Failed to refresh usage:", extractClientError(e));
      /* noop */
    }
  }, [fetchUsage]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);
  useEffect(() => {
    if (!email) return;
    identify(email);
    void refreshUsage();
  }, [email, refreshUsage]);

  if (ready && !isAuthed) return <Navigate to="/login" />;

  const runExtraction = async (file: File) => {
    if (!email) return;

    if (!usage.unlimited && usage.remaining <= 0) {
      toast.error("Usage limit reached", {
        description: `You've used all ${usage.limit} uploads available on the ${usage.plan.toUpperCase()} plan.`,
        action: { label: "Upgrade", onClick: () => setUpgrade(true) },
      });
      return;
    }

    setRows([]);
    setCurrentFile(file);
    setLastFile(file);
    setScanning(true);
    setJobProgress({
      progress: 3,
      currentStage: "Preparing upload",
      processedChunks: 0,
      totalChunks: 0,
      etaSeconds: null,
      lastHeartbeat: null,
    });
    const started = Date.now();

    const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);

    try {
      type AIResult = { ok: false; error: string } | { ok: true; rows: ExtractionRow[] };
      let res: AIResult;
      let pages = 1;

      if (isImage) {
        // ── Image file → vision model directly ──
        toast.info("Processing image…");
        setJobProgress((prev) => ({ ...prev, currentStage: "Preparing image", progress: 8 }));
        try {
          const imageDataUrl = await imageFileToDataUrl(file);
          // ✅ Check if data URL is too large (estimate: 4/3 for base64 encoding)
          const estimatedDataUrlSize = imageDataUrl.length;
          if (estimatedDataUrlSize > 20_000_000) {
            throw new Error(
              "Image too large to process. Please use a smaller image (max ~15MB effective).",
            );
          }
          res = await runJob({ kind: "image", imageDataUrl, fileName: file.name });
        } catch (e) {
          const msg = extractClientError(e);
          console.error("[dashboard] Image extraction failed:", msg);
          throw new Error(msg || "Failed to process image");
        }
      } else {
        // ── PDF → try text first, fall back to vision if scanned ──
        toast.info("Extracting text from PDF…");
        setJobProgress((prev) => ({ ...prev, currentStage: "Reading PDF pages", progress: 10 }));
        let extracted: { text: string; pages: number };
        try {
          extracted = await extractPdfText(file);
        } catch (e) {
          const msg = extractClientError(e);
          console.error("[dashboard] PDF text extraction failed:", msg);
          throw new Error(
            msg || "Failed to extract PDF text. Try a simpler PDF or use the image mode.",
          );
        }

        pages = extracted.pages;
        const charCount = extracted.text.length;
        const tokenEstimate = estimateTokens(extracted.text);

        // ✅ Check if text content is reasonable (based on character/token count)
        if (charCount < 20) {
          toast.info("Scanned PDF detected — switching to vision model…");
          const imageDataUrl = await pdfPageToImageDataUrl(file, 1);
          res = await runJob({ kind: "image", imageDataUrl, fileName: file.name });
        } else if (charCount > MAX_CHAR_LIMIT) {
          throw new Error(
            `Document text too large (${charCount.toLocaleString()} characters, ~${tokenEstimate.toLocaleString()} tokens). Maximum is 6M characters (~1.5M tokens).`,
          );
        } else if (charCount > WARN_CHAR_LIMIT) {
          // ✅ Warn about large documents but allow processing (chunking will handle it)
          toast.warning(
            `Large document: ${charCount.toLocaleString()} chars (~${tokenEstimate.toLocaleString()} tokens). Processing in the background — this may take a little while.`,
          );
          res = await runJob({ kind: "text", text: extracted.text, fileName: file.name });

          if (!res.ok && res.error === "__NEEDS_VISION__") {
            toast.info("Scanned PDF detected — switching to vision model…");
            const imageDataUrl = await pdfPageToImageDataUrl(file, 1);
            res = await runJob({ kind: "image", imageDataUrl, fileName: file.name });
          }
        } else {
          res = await runJob({ kind: "text", text: extracted.text, fileName: file.name });

          if (!res.ok && res.error === "__NEEDS_VISION__") {
            toast.info("Scanned PDF detected — switching to vision model…");
            const imageDataUrl = await pdfPageToImageDataUrl(file, 1);
            res = await runJob({ kind: "image", imageDataUrl, fileName: file.name });
          }
        }
      }

      if (!res.ok) {
        track("file_upload_failure", {
          reason: res.error,
          pages,
          duration_ms: Date.now() - started,
        });
        toast.error("Extraction failed", {
          description: res.error,
          action: { label: "Retry", onClick: () => runExtraction(file) },
        });
        setScanning(false);
        setJobProgress((prev) => ({ ...prev, currentStage: "Failed" }));
        return;
      }

      const result = res;

      const extractedRows: ExtractedRow[] = result.rows.map((r) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        ...r,
      }));

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

      setRows(extractedRows);
      const newHistory = [...extractedRows, ...history];
      setHistory(newHistory);
      saveHistory(newHistory);

      track("file_upload_success", { pages, duration_ms: Date.now() - started });
      toast.success("Extraction complete", {
        description: `${file.name} processed in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      });
      setJobProgress({
        progress: 100,
        currentStage: "Completed",
        processedChunks: jobProgress.totalChunks || 0,
        totalChunks: jobProgress.totalChunks || 0,
        etaSeconds: 0,
        lastHeartbeat: new Date().toISOString(),
      });

      if (
        !recorded.usage.unlimited &&
        recorded.usage.remaining > 0 &&
        recorded.usage.remaining <= 10
      ) {
        toast.warning(
          `You have ${recorded.usage.remaining} upload${recorded.usage.remaining === 1 ? "" : "s"} remaining`,
        );
      }
    } catch (e: unknown) {
      const error = extractClientError(e);
      console.error("[dashboard] Extraction failed:", { file: file.name, error, rawError: e });
      track("file_upload_failure", { reason: error, duration_ms: Date.now() - started });
      toast.error("Could not process file", {
        description: error || "Unknown error occurred. Please try again.",
        action: { label: "Retry", onClick: () => runExtraction(file) },
      });
      setJobProgress((prev) => ({ ...prev, currentStage: "Failed" }));
    } finally {
      setScanning(false);
    }
  };

  const onFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      toast.info("Processing the most recent file", {
        description: "Side-by-side preview supports one document at a time.",
      });
    }
    await runExtraction(files[files.length - 1]);
  };

  const onExport = (fmt: "json" | "csv" | "xlsx", source: ExtractedRow[] = rows) => {
    if (source.length === 0) {
      toast.error("Nothing to export");
      return;
    }
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
          <Sidebar
            usage={usage}
            onUpgrade={() => setUpgrade(true)}
            tab={tab}
            setTab={setTab}
            isAdmin={isAdmin}
          />

          <div className="min-w-0">
            {tab === "extract" && (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                      Extract documents
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                      Drop a PDF — your data never leaves your browser unencrypted.
                    </p>
                  </div>
                </div>

                <FileUploader onFiles={onFiles} disabled={scanning} />

                <div className="mt-6 grid lg:grid-cols-2 gap-4">
                  <PdfPreview file={currentFile} />
                  <div>
                    {scanning ? (
                      <ScanningSkeleton
                        count={1}
                        progress={jobProgress.progress}
                        currentStage={jobProgress.currentStage}
                        etaLabel={formatEtaLabel(jobProgress.etaSeconds)}
                        processedChunks={jobProgress.processedChunks}
                        totalChunks={jobProgress.totalChunks}
                        fileName={currentFile?.name ?? null}
                      />
                    ) : rows.length > 0 ? (
                      <AuditTable
                        rows={rows}
                        setRows={setRows}
                        onExport={(f) => onExport(f, rows)}
                        locked={false}
                        plan={usage.plan}
                      />
                    ) : (
                      <div className="glass rounded-2xl h-[480px] lg:h-[640px] flex flex-col items-center justify-center text-center p-8">
                        <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">
                          Extracted data will appear here as an editable table.
                        </p>
                        {lastFile && !currentFile && (
                          <button
                            onClick={() => runExtraction(lastFile)}
                            className="mt-4 text-xs px-3 py-1.5 rounded-lg bg-lime text-primary-foreground font-medium"
                          >
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
              <HistoryView
                history={history}
                onClear={clearHistory}
                onExport={(f) => onExport(f, history)}
                plan={usage.plan}
              />
            )}

            {tab === "settings" && (
              <SettingsView
                email={email}
                isAdmin={isAdmin}
                usage={usage}
                onUpgrade={() => setUpgrade(true)}
                onPlanChange={async (plan) => {
                  const res = (await changePlan({ data: { plan } })) as {
                    ok: boolean;
                    error?: string;
                  };
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

function Sidebar({
  usage,
  onUpgrade,
  tab,
  setTab,
  isAdmin,
}: {
  usage: Usage;
  onUpgrade: () => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  isAdmin: boolean;
}) {
  const pct = usage.unlimited ? 0 : Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100);
  const usageHeading =
    usage.cycle === "monthly"
      ? "Monthly usage"
      : usage.cycle === "lifetime"
        ? "Plan usage"
        : "Daily usage";
  const remainingLabel =
    usage.cycle === "monthly"
      ? "this billing month"
      : usage.cycle === "lifetime"
        ? "on this free plan"
        : "today";
  const subtitle =
    usage.cycle === "monthly"
      ? `You have ${usage.remaining} upload${usage.remaining === 1 ? "" : "s"} remaining ${remainingLabel}`
      : usage.cycle === "lifetime"
        ? `You have ${usage.remaining} free extraction${usage.remaining === 1 ? "" : "s"} remaining`
        : `You have ${usage.remaining} upload${usage.remaining === 1 ? "" : "s"} remaining ${remainingLabel}`;
  const usageDenominator = usage.unlimited ? "∞" : String(usage.limit);
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
          <span>{usageHeading}</span>
          <span className="text-lime font-mono">{usage.plan.toUpperCase()}</span>
        </div>
        <>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold">{usage.used}</span>
            <span className="text-muted-foreground text-sm">/ {usageDenominator}</span>
          </div>
          <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${warning ? "bg-yellow-400" : "bg-lime"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p
            className={`mt-2 text-xs flex items-center gap-1 ${warning ? "text-yellow-400" : "text-muted-foreground"}`}
          >
            {warning && <AlertTriangle className="h-3 w-3" />}
            {subtitle}
          </p>
        </>
        {!isAdmin && usage.plan !== "team" && (
          <button
            onClick={onUpgrade}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-lime text-primary-foreground py-2 rounded-lg hover:opacity-90"
          >
            <Zap className="h-3.5 w-3.5" /> Upgrade
          </button>
        )}
      </div>
      <nav className="glass rounded-2xl p-2 text-sm">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg transition ${tab === it.id ? "bg-white/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {it.i} {it.t}
          </button>
        ))}
        {isAdmin && (
          <Link
            to="/admin"
            className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-lime hover:bg-white/[0.02]"
          >
            <Sparkles className="h-4 w-4" /> Admin Analytics
          </Link>
        )}
      </nav>
    </aside>
  );
}

function HistoryView({
  history,
  onClear,
  onExport,
  plan,
}: {
  history: ExtractedRow[];
  onClear: () => void;
  onExport: (f: "json" | "csv" | "xlsx") => void;
  plan: "free" | "pro" | "team";
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">History</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {history.length} record{history.length === 1 ? "" : "s"} stored locally on this device.
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-white/5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear history
          </button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No extractions yet. Process a document to populate your history.
          </p>
        </div>
      ) : (
        <AuditTable
          rows={history}
          setRows={() => {}}
          onExport={onExport}
          locked={false}
          plan={plan}
        />
      )}
    </>
  );
}

function SettingsView({
  email,
  isAdmin,
  usage,
  onUpgrade,
  onPlanChange,
}: {
  email: string | null;
  isAdmin: boolean;
  usage: Usage;
  onUpgrade: () => void;
  onPlanChange?: (plan: "free" | "pro" | "team") => Promise<void>;
}) {
  const [changingPlan, setChangingPlan] = useState(false);

  const handlePlanChange = async (plan: "free" | "pro" | "team") => {
    if (!onPlanChange || plan === usage.plan) return;
    setChangingPlan(true);
    try {
      await onPlanChange(plan);
      toast.success(`Plan switched to ${plan.toUpperCase()}`);
    } catch (error) {
      toast.error("Failed to switch plan", {
        description: error instanceof Error ? error.message : "Unknown server error",
      });
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
            <p className="text-xs text-muted-foreground mb-3">
              Switch your active plan to simulate each customer tier exactly as it behaves.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

        <Card
          title={
            usage.cycle === "monthly"
              ? "Usage (current month)"
              : usage.cycle === "lifetime"
                ? "Usage (free plan)"
                : "Usage (last 24 hours)"
          }
        >
          <Row label="Uploads used" value={String(usage.used)} />
          <Row label="Remaining" value={String(usage.remaining)} />
          <Row
            label={
              usage.cycle === "monthly"
                ? "Monthly limit"
                : usage.cycle === "lifetime"
                  ? "Free plan limit"
                  : "Daily limit"
            }
            value={usage.unlimited ? "Unlimited" : String(usage.limit)}
          />
          {!isAdmin && usage.plan !== "team" && (
            <button
              onClick={onUpgrade}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-lime text-primary-foreground px-3 py-1.5 rounded-lg hover:opacity-90"
            >
              <Zap className="h-3.5 w-3.5" /> Upgrade for higher limits
            </button>
          )}
        </Card>

        <Card title="Data & Privacy">
          <p className="text-sm text-muted-foreground">
            Your files are processed instantly and are never stored on our servers. We do not use
            your data to train our AI models. Extraction history is saved only in your browser.
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
