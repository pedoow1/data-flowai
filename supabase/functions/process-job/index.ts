import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = (Deno.env.get("GOOGLE_API_KEY") || "").trim();
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_MODEL = "gemini-3.5-flash";
const VISION_MODEL = "gemini-3.5-flash";
const MAX_OUTPUT_TOKENS = 250000;
const DEFAULT_CHUNK_SIZE = 20_000;
const LARGE_DOC_CHUNK_SIZE = 15_000;
const CHUNK_OVERLAP = 350;
const REQUEST_TIMEOUT_MS = 120_000;
const PROGRESS_START = 12;
const PROGRESS_END = 96;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Cell = { v: string; c: number };
type FlexibleRow = Record<string, Cell>;
type ExtractionSuccess = { ok: true; rows: FlexibleRow[]; warnings: string[]; totalChunks: number };
type ExtractionFailure = { ok: false; error: string };
type ExtractionResult = ExtractionSuccess | ExtractionFailure;

const FLEXIBLE_PROMPT = `You are an elite invoice data extraction agent. Your job is to extract every line item as a separate row.

CRITICAL RULES:
1. LINE ITEM SPLITTING: Every invoice may contain multiple line items (services, products). You MUST create a SEPARATE row for each line item. Never merge multiple items into one row.
2. For each line item row, duplicate the invoice metadata: invoice_number, client, date, dueDate, vendor.
3. Each row must contain invoice_number, client, date, dueDate, vendor, description, amount, quantity (if present), reference_id (if present).
4. After all line item rows for an invoice, add one final summary row with description="TOTAL" and amount equal to the grand total of that invoice.
5. Extract ALL invoices, ALL pages, ALL line items. Never skip or drop any.
6. If invoice numbers are sequential (e.g. INV-001 to INV-100), make sure ALL numbers are present with no gaps.
7. Copy every value EXACTLY as it appears — never truncate, round, or reformat.
8. Return ONLY a valid JSON array, no prose, no markdown, no code fences.`;

const USER_SUFFIX = `\n\nReturn a JSON ARRAY. Extract EVERY invoice and EVERY line item as separate rows, then add a TOTAL row per invoice. Do not drop rows, do not invent fields, and keep all strings exact.`;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function sanitizeText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chooseStrategy(textLength: number) {
  const large = textLength > 200_000;
  return {
    chunkSize: large ? LARGE_DOC_CHUNK_SIZE : DEFAULT_CHUNK_SIZE,
    parallelLimit: large ? 1 : 2,
    batchDelayMs: large ? 5_000 : 3_000,
  };
}

function computeProgress(processed: number, total: number) {
  if (total <= 0) return PROGRESS_START;
  return clamp(
    Math.round(PROGRESS_START + (processed / total) * (PROGRESS_END - PROGRESS_START)),
    PROGRESS_START,
    PROGRESS_END,
  );
}

function computeEtaSeconds(startedAtMs: number, processed: number, total: number) {
  if (processed <= 0 || total <= 0 || processed >= total) return 0;
  const avgPerChunk = (Date.now() - startedAtMs) / processed;
  return Math.max(1, Math.ceil((avgPerChunk * (total - processed)) / 1000));
}

async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const nextPatch = {
    ...patch,
    last_heartbeat: new Date().toISOString(),
  };
  const { error } = await admin.from("jobs").update(nextPatch).eq("id", jobId);
  if (error) console.error("[process-job] failed to update job", jobId, error.message);
}

async function callGoogleAI(
  model: string,
  messages: unknown[],
): Promise<{ status: number; bodyText: string; retryAfterMs?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const contents = (messages as any[]).map((msg: any) => {
    if (typeof msg.content === "string") {
      return { role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] };
    }
    const parts = msg.content.map((p: any) => {
      if (p.type === "text") return { text: p.text };
      if (p.type === "image_url") {
        const [header, base64] = p.image_url.url.split(",");
        const mimeType = header.match(/data:(.*);base64/)?.[1] || "image/jpeg";
        return { inlineData: { mimeType, data: base64 } };
      }
      return { text: "" };
    });
    return { role: "user", parts };
  });

  try {
    const res = await fetch(`${GOOGLE_API}/${model}:generateContent?key=${GOOGLE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
        },
      }),
    });

    // اقرأ retry-after header لو موجود
    const retryAfterSec = parseInt(res.headers.get("retry-after") ?? "0");
    const retryAfterMs = retryAfterSec > 0 ? retryAfterSec * 1000 : undefined;

    return { status: res.status, bodyText: await res.text(), retryAfterMs };
  } finally {
    clearTimeout(timer);
  }
}

function isValidCell(x: unknown): x is Cell {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Cell).v === "string" &&
    typeof (x as Cell).c === "number"
  );
}

function toCell(x: unknown): Cell | null {
  if (isValidCell(x)) return { v: String((x as Cell).v).trim(), c: (x as Cell).c };
  if (x && typeof x === "object" && "v" in (x as Record<string, unknown>)) {
    const v = (x as Record<string, unknown>).v;
    if (typeof v === "string" && v.trim()) return { v: v.trim(), c: 80 };
    if (typeof v === "number") return { v: String(v), c: 80 };
  }
  if (typeof x === "string" && x.trim()) return { v: x.trim(), c: 80 };
  if (typeof x === "number") return { v: String(x), c: 80 };
  return null;
}

const CANON: Record<string, string> = {
  "invoice number": "invoiceNumber",
  "invoice no": "invoiceNumber",
  "invoice #": "invoiceNumber",
  invoice: "invoiceNumber",
  invoicenumber: "invoiceNumber",
  invoiceno: "invoiceNumber",
  invoice_number: "invoiceNumber",
  "receipt number": "invoiceNumber",
  "order number": "invoiceNumber",
  receipt: "invoiceNumber",
  "receipt no": "invoiceNumber",
  "order no": "invoiceNumber",
  "bill number": "invoiceNumber",
  "doc number": "invoiceNumber",
  client: "client",
  customer: "client",
  "bill to": "client",
  billto: "client",
  "billed to": "client",
  buyer: "client",
  "client name": "client",
  "customer name": "client",
  company: "client",
  account: "client",
  to: "client",
  vendor: "vendor",
  seller: "vendor",
  supplier: "vendor",
  from: "vendor",
  date: "date",
  "invoice date": "date",
  "issue date": "date",
  issued: "date",
  "due date": "dueDate",
  duedate: "dueDate",
  "payment due": "dueDate",
  amount: "amount",
  subtotal: "amount",
  "sub total": "amount",
  "net amount": "amount",
  net: "amount",
  tax: "tax",
  vat: "tax",
  gst: "tax",
  "tax amount": "tax",
  "sales tax": "tax",
  total: "total",
  "grand total": "total",
  "amount due": "total",
  "total amount": "total",
  "balance due": "total",
  "po number": "poNumber",
  po: "poNumber",
  "purchase order": "poNumber",
  reference: "reference",
  ref: "reference",
  reference_id: "reference",
  description: "description",
  items: "description",
  item: "description",
  quantity: "quantity",
  qty: "quantity",
  "unit price": "unitPrice",
  price: "unitPrice",
  rate: "unitPrice",
  "payment terms": "paymentTerms",
  terms: "paymentTerms",
  currency: "currency",
  status: "status",
  notes: "notes",
  note: "notes",
};

function canonKey(k: string): string {
  const norm = k.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (CANON[norm]) return CANON[norm];
  if (CANON[norm.replace(/\s+/g, "")]) return CANON[norm.replace(/\s+/g, "")];
  return k.trim();
}

function normalizeRow(x: unknown): FlexibleRow | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const source = x as Record<string, unknown>;
  const out: FlexibleRow = {};
  for (const key of Object.keys(source)) {
    const cell = toCell(source[key]);
    if (!cell || !cell.v || cell.v === "—") continue;
    const normalizedKey = canonKey(key);
    if (!out[normalizedKey]) out[normalizedKey] = cell;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toRowArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["invoices", "rows", "records", "data", "results", "items", "documents"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [parsed];
  }
  return [];
}

function rowSig(r: FlexibleRow): string {
  const invoiceNumber = r.invoiceNumber?.v?.trim().toLowerCase() ?? "";
  const description = r.description?.v?.trim().toLowerCase() ?? "";
  const amount = r.amount?.v?.trim().toLowerCase() ?? "";
  const quantity = r.quantity?.v?.trim().toLowerCase() ?? "";
  const reference = r.reference?.v?.trim().toLowerCase() ?? "";
  const total = r.total?.v?.trim().toLowerCase() ?? "";
  if (invoiceNumber || description || amount || total) {
    return [invoiceNumber, description, quantity, amount, total, reference].join("|");
  }
  return Object.entries(r)
    .map(([k, c]) => `${k}=${c.v}`)
    .sort()
    .join("|")
    .toLowerCase();
}

function dedupeRows(rows: FlexibleRow[]) {
  const seen = new Set<string>();
  const out: FlexibleRow[] = [];
  for (const row of rows) {
    const sig = rowSig(row);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(row);
  }
  return out;
}

function parseResponse(
  status: number,
  bodyText: string,
): { ok: true; rows: FlexibleRow[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "Google AI returned invalid JSON." };
  }

  const content: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!content) return { ok: false, error: "Google AI returned an empty response." };

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "AI returned an unparseable response." };
  }

  const rows = toRowArray(parsed)
    .map(normalizeRow)
    .filter((row): row is FlexibleRow => row !== null);
  if (rows.length === 0) return { ok: false, error: "AI response contained no usable rows." };
  return { ok: true, rows };
}

async function runWithRetry(
  model: string,
  messages: unknown[],
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, bodyText, retryAfterMs } = await callGoogleAI(model, messages);

      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse AI response." };
      }

      if (status === 429) {
        lastError = "Google AI quota or rate limit was reached.";
        // احترم retry-after header لو موجود، غير كده استخدم exponential backoff
        const delay = retryAfterMs
          ? retryAfterMs + 1_000
          : Math.min(15_000 * attempt, 60_000);
        console.warn(`[process-job] 429 rate limit — waiting ${delay}ms before retry ${attempt}`);
        await wait(delay);
        continue;
      }

      if ([502, 503, 504, 524].includes(status)) {
        lastError = "Google AI is temporarily unavailable.";
        await wait(5_000 * attempt);
        continue;
      }

      if (status === 401 || status === 403) {
        return { ok: false, error: "Google AI authentication failed — check GOOGLE_API_KEY." };
      }

      if (status === 404) {
        return { ok: false, error: `Google model not found: ${model}.` };
      }

      return { ok: false, error: `Google AI error (${status}).` };
    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      lastError = aborted ? "Google AI request timed out." : (error?.message ?? "Network error");
      const delay = aborted ? 8_000 * attempt : 3_000 * attempt;
      await wait(delay);
    }
  }

  return { ok: false, error: `${lastError} Please try again.` };
}

function findChunkBoundary(text: string, start: number, desiredEnd: number) {
  if (desiredEnd >= text.length) return text.length;
  const minBoundary = start + Math.floor((desiredEnd - start) * 0.6);
  const window = text.slice(minBoundary, desiredEnd);
  const separators = ["\n=== PAGE", "\nInvoice", "\nINVOICE", "\n\n", "\n"];

  for (const separator of separators) {
    const idx = window.lastIndexOf(separator);
    if (idx > 0) return minBoundary + idx;
  }

  return desiredEnd;
}

function chunkText(text: string, size: number, overlap: number) {
  const sanitized = sanitizeText(text);
  const chunks: string[] = [];
  let start = 0;

  while (start < sanitized.length) {
    const desiredEnd = Math.min(sanitized.length, start + size);
    const end = findChunkBoundary(sanitized, start, desiredEnd);
    const chunk = sanitized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= sanitized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks.length > 0 ? chunks : [sanitized];
}

async function extractFromText(
  jobId: string,
  text: string,
  fileName: string,
): Promise<ExtractionResult> {
  const strategy = chooseStrategy(text.length);
  const chunks = chunkText(text, strategy.chunkSize, CHUNK_OVERLAP);
  const allRows: FlexibleRow[] = [];
  const warnings: string[] = [];
  const startedAt = Date.now();

  await updateJob(jobId, {
    current_stage: chunks.length === 1 ? "Scanning document" : `Preparing ${chunks.length} parts`,
    progress: PROGRESS_START,
    total_chunks: chunks.length,
    processed_chunks: 0,
    eta_seconds: null,
  });

  for (let start = 0; start < chunks.length; start += strategy.parallelLimit) {
    const end = Math.min(start + strategy.parallelLimit, chunks.length);
    const batch = chunks.slice(start, end);

    await updateJob(jobId, {
      current_stage: `Processing parts ${start + 1}-${end} of ${chunks.length}`,
      progress: computeProgress(start, chunks.length),
      processed_chunks: start,
      total_chunks: chunks.length,
      eta_seconds: computeEtaSeconds(startedAt, Math.max(1, start), chunks.length),
    });

    const results = await Promise.all(
      batch.map((chunk, index) => {
        const prompt = `${FLEXIBLE_PROMPT}\n\nDocument: ${fileName}\nPart ${start + index + 1}/${chunks.length}\n\n---\n${chunk}${USER_SUFFIX}`;
        return runWithRetry(TEXT_MODEL, [{ role: "user", content: prompt }]);
      }),
    );

    results.forEach((result, idx) => {
      if (result.ok) {
        allRows.push(...result.rows);
        return;
      }
      warnings.push(`Part ${start + idx + 1} failed: ${result.error}`);
    });

    await updateJob(jobId, {
      current_stage: `Processed ${end} of ${chunks.length} parts`,
      progress: computeProgress(end, chunks.length),
      processed_chunks: end,
      total_chunks: chunks.length,
      eta_seconds: computeEtaSeconds(startedAt, end, chunks.length),
    });

    if (end < chunks.length) await wait(strategy.batchDelayMs);
  }

  if (allRows.length === 0) {
    return { ok: false, error: warnings[0] ?? "Failed to extract data from the document." };
  }

  return {
    ok: true,
    rows: dedupeRows(allRows),
    warnings,
    totalChunks: chunks.length,
  };
}

async function extractFromImage(
  jobId: string,
  imageDataUrl: string,
  fileName: string,
): Promise<ExtractionResult> {
  await updateJob(jobId, {
    current_stage: "Scanning image",
    progress: 35,
    total_chunks: 1,
    processed_chunks: 0,
    eta_seconds: 45,
  });

  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        {
          type: "text",
          text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}${USER_SUFFIX}`,
        },
      ],
    },
  ];

  const result = await runWithRetry(VISION_MODEL, messages);
  if (!result.ok) return result;

  await updateJob(jobId, {
    current_stage: "Finalizing image extraction",
    progress: 90,
    total_chunks: 1,
    processed_chunks: 1,
    eta_seconds: 5,
  });

  return { ok: true, rows: dedupeRows(result.rows), warnings: [], totalChunks: 1 };
}

async function beat(jobId: string) {
  const { error } = await admin
    .from("jobs")
    .update({ last_heartbeat: new Date().toISOString() })
    .eq("id", jobId);
  if (error) console.error("[process-job] heartbeat failed", jobId, error.message);
}

async function processJob(jobId: string) {
  // Keep the heartbeat fresh for the ENTIRE lifetime of the worker, even while
  // a single AI chunk is taking minutes (timeouts + rate-limit retries). This
  // guarantees the client never sees a false "stopped responding" alarm while
  // the worker is genuinely still alive and processing.
  const heartbeat = setInterval(() => {
    void beat(jobId);
  }, 15_000);

  try {
    const { data: job, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error("Job not found.");
    if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY for background extraction.");

    await updateJob(jobId, {
      status: "processing",
      started_at: new Date().toISOString(),
      error: null,
      current_stage: "Starting extraction",
      progress: 4,
      processed_chunks: 0,
      total_chunks: 0,
      eta_seconds: null,
    });


    const input = job.input as {
      kind: "text" | "image";
      text?: string;
      imageDataUrl?: string;
      fileName: string;
    };
    const result =
      input.kind === "image"
        ? await extractFromImage(jobId, input.imageDataUrl ?? "", input.fileName)
        : await extractFromText(jobId, input.text ?? "", input.fileName);

    if (!result.ok) {
      await updateJob(jobId, {
        status: "failed",
        error: result.error,
        current_stage: "Failed",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    await updateJob(jobId, {
      status: "completed",
      output: { rows: result.rows, warnings: result.warnings },
      error: null,
      current_stage: result.warnings.length > 0 ? "Completed with warnings" : "Completed",
      progress: 100,
      processed_chunks: result.totalChunks,
      total_chunks: result.totalChunks,
      eta_seconds: 0,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    await updateJob(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      current_stage: "Failed",
      completed_at: new Date().toISOString(),
    });
  } finally {
    clearInterval(heartbeat);
  }

}

Deno.serve(async (req) => {
  try {
    const { jobId } = await req.json();
    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // @ts-ignore EdgeRuntime is available in the function runtime.
    EdgeRuntime.waitUntil(processJob(jobId));

    return new Response(JSON.stringify({ received: true, jobId }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
