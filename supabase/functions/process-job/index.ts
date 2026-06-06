import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = (Deno.env.get("GOOGLE_API_KEY") || "").trim();
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_MODEL = "gemini-2.5-flash";
const VISION_MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 250000;
const DEFAULT_CHUNK_SIZE = 12_000;
const LARGE_DOC_CHUNK_SIZE = 9_000;
const CHUNK_OVERLAP = 350;
const REQUEST_TIMEOUT_MS = 90_000;
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

function computeProgress(processed: number, total: number) {
  if (total <= 0) return PROGRESS_START;
  return clamp(
    Math.round(PROGRESS_START + (processed / total) * (PROGRESS_END - PROGRESS_START)),
    PROGRESS_START,
    PROGRESS_END,
  );
}

const BASELINE_SECONDS_PER_CHUNK = 25;

function computeEtaSeconds(startedAtMs: number, processed: number, total: number) {
  if (total <= 0 || processed >= total) return 0;
  const remaining = total - processed;
  const perChunkSec =
    processed > 0
      ? (Date.now() - startedAtMs) / 1000 / processed
      : BASELINE_SECONDS_PER_CHUNK;
  return Math.max(1, Math.ceil(perChunkSec * remaining));
}

async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("jobs").update({
    ...patch,
    last_heartbeat: new Date().toISOString(),
  }).eq("id", jobId);
  if (error) console.error("[process-job] failed to update job", jobId, error.message);
}

async function beat(jobId: string) {
  const { error } = await admin
    .from("jobs")
    .update({ last_heartbeat: new Date().toISOString() })
    .eq("id", jobId);
  if (error) console.error("[process-job] heartbeat failed", jobId, error.message);
}

async function callGoogleAI(
  model: string,
  messages: unknown[],
): Promise<{ status: number; bodyText: string }> {
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
    return { status: res.status, bodyText: await res.text() };
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
  "invoice number": "invoiceNumber", "invoice no": "invoiceNumber", "invoice #": "invoiceNumber",
  invoice: "invoiceNumber", invoicenumber: "invoiceNumber", invoiceno: "invoiceNumber",
  invoice_number: "invoiceNumber", "receipt number": "invoiceNumber", "order number": "invoiceNumber",
  receipt: "invoiceNumber", "receipt no": "invoiceNumber", "order no": "invoiceNumber",
  "bill number": "invoiceNumber", "doc number": "invoiceNumber",
  client: "client", customer: "client", "bill to": "client", billto: "client",
  "billed to": "client", buyer: "client", "client name": "client", "customer name": "client",
  company: "client", account: "client", to: "client",
  vendor: "vendor", seller: "vendor", supplier: "vendor", from: "vendor",
  date: "date", "invoice date": "date", "issue date": "date", issued: "date",
  "due date": "dueDate", duedate: "dueDate", "payment due": "dueDate",
  amount: "amount", subtotal: "amount", "sub total": "amount", "net amount": "amount", net: "amount",
  tax: "tax", vat: "tax", gst: "tax", "tax amount": "tax", "sales tax": "tax",
  total: "total", "grand total": "total", "amount due": "total", "total amount": "total", "balance due": "total",
  "po number": "poNumber", po: "poNumber", "purchase order": "poNumber",
  reference: "reference", ref: "reference", reference_id: "reference",
  description: "description", items: "description", item: "description",
  quantity: "quantity", qty: "quantity",
  "unit price": "unitPrice", price: "unitPrice", rate: "unitPrice",
  "payment terms": "paymentTerms", terms: "paymentTerms",
  currency: "currency", status: "status", notes: "notes", note: "notes",
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
  return Object.entries(r).map(([k, c]) => `${k}=${c.v}`).sort().join("|").toLowerCase();
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
  try { json = JSON.parse(bodyText); }
  catch { return { ok: false, error: "Google AI returned invalid JSON." }; }

  const content: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!content) return { ok: false, error: "Google AI returned an empty response." };

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return { ok: false, error: "AI returned an unparseable response." }; }

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

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGoogleAI(model, messages);
      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse AI response." };
      }

      if ([429, 502, 503, 504, 524].includes(status)) {
        lastError = status === 429
          ? "Google AI quota or rate limit was reached."
          : "Google AI is temporarily unavailable.";
        const delayMs = status === 429 ? 15_000 * attempt : 4_000 * attempt;
        console.log(`[process-job] status ${status}, waiting ${delayMs}ms (attempt ${attempt})...`);
        await wait(delayMs);
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
      if (aborted) await wait(2_000 * attempt);
      else await wait(1_500 * attempt);
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

// ── Self-invoke: trigger the next chunk as a separate Edge Function call ──
async function triggerNextChunk(jobId: string, chunkIndex: number) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/process-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ jobId, chunkIndex }),
    });
  } catch (e) {
    console.error("[process-job] failed to trigger next chunk", e);
  }
}

// ── Process a single chunk and save partial rows into output ──────────────
async function processSingleChunk(jobId: string, job: any, chunkIndex: number) {
  const heartbeat = setInterval(() => { void beat(jobId); }, 10_000);

  try {
    const input = job.input as {
      kind: "text" | "image";
      text?: string;
      imageDataUrl?: string;
      fileName: string;
      chunks?: string[];      // مخزن في الـ input بعد أول invocation
      totalChunks?: number;
    };

    const fileName = input.fileName;

    // ── Image: معالجة مباشرة في invocation واحدة ──
    if (input.kind === "image") {
      await updateJob(jobId, {
        status: "processing",
        started_at: new Date().toISOString(),
        current_stage: "Scanning image",
        progress: 35,
        total_chunks: 1,
        processed_chunks: 0,
        eta_seconds: 45,
      });

      const messages = [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: input.imageDataUrl ?? "" } },
          { type: "text", text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}${USER_SUFFIX}` },
        ],
      }];

      const result = await runWithRetry(VISION_MODEL, messages);

      if (!result.ok) {
        await updateJob(jobId, {
          status: "failed", error: result.error,
          current_stage: "Failed", completed_at: new Date().toISOString(),
        });
        return;
      }

      await updateJob(jobId, {
        status: "completed",
        output: { rows: dedupeRows(result.rows), warnings: [] },
        current_stage: "Completed",
        progress: 100, processed_chunks: 1, total_chunks: 1,
        eta_seconds: 0, completed_at: new Date().toISOString(),
      });
      return;
    }

    // ── Text: chunk واحد في كل invocation ──
    const rawText = input.text ?? "";

    // أول invocation: نعمل الـ chunks ونحفظهم في الـ input
    let chunks: string[] = input.chunks ?? [];
    if (chunks.length === 0) {
      const large = rawText.length > 200_000;
      const chunkSize = large ? LARGE_DOC_CHUNK_SIZE : DEFAULT_CHUNK_SIZE;
      chunks = chunkText(rawText, chunkSize, CHUNK_OVERLAP);

      // نحفظ الـ chunks في الـ job input عشان الـ invocations الجاية تعرفهم
      await admin.from("jobs").update({
        input: { ...input, chunks, totalChunks: chunks.length, text: undefined }, // نشيل الـ text الكبيرة
        status: "processing",
        started_at: new Date().toISOString(),
        current_stage: `Preparing ${chunks.length} parts`,
        progress: PROGRESS_START,
        total_chunks: chunks.length,
        processed_chunks: 0,
        eta_seconds: chunks.length * BASELINE_SECONDS_PER_CHUNK,
        last_heartbeat: new Date().toISOString(),
      }).eq("id", jobId);
    }

    const totalChunks = chunks.length;
    const chunk = chunks[chunkIndex];

    if (!chunk) {
      // مفيش chunk — يعني خلصنا
      await finalizeJob(jobId);
      return;
    }

    console.log(`[process-job] Processing chunk ${chunkIndex + 1}/${totalChunks} for job ${jobId}`);

    await updateJob(jobId, {
      current_stage: `Processing part ${chunkIndex + 1} of ${totalChunks}`,
      progress: computeProgress(chunkIndex, totalChunks),
      processed_chunks: chunkIndex,
      total_chunks: totalChunks,
      eta_seconds: (totalChunks - chunkIndex) * BASELINE_SECONDS_PER_CHUNK,
    });

    const prompt = `${FLEXIBLE_PROMPT}\n\nDocument: ${fileName}\nPart ${chunkIndex + 1}/${totalChunks}\n\n---\n${chunk}${USER_SUFFIX}`;
    const result = await runWithRetry(TEXT_MODEL, [{ role: "user", content: prompt }]);

    // نجيب الـ partial rows الموجودة من قبل
    const { data: currentJob } = await admin.from("jobs").select("output").eq("id", jobId).single();
    const existingRows: FlexibleRow[] = (currentJob?.output as any)?.rows ?? [];
    const existingWarnings: string[] = (currentJob?.output as any)?.warnings ?? [];

    if (result.ok) {
      const newRows = [...existingRows, ...result.rows];
      await admin.from("jobs").update({
        output: { rows: newRows, warnings: existingWarnings },
        processed_chunks: chunkIndex + 1,
        progress: computeProgress(chunkIndex + 1, totalChunks),
        last_heartbeat: new Date().toISOString(),
      }).eq("id", jobId);
    } else {
      const newWarnings = [...existingWarnings, `Part ${chunkIndex + 1} failed: ${result.error}`];
      await admin.from("jobs").update({
        output: { rows: existingRows, warnings: newWarnings },
        last_heartbeat: new Date().toISOString(),
      }).eq("id", jobId);
    }

    // آخر chunk؟ نـ finalize، غير كده نـ trigger الـ chunk الجاي
    if (chunkIndex + 1 >= totalChunks) {
      await finalizeJob(jobId);
    } else {
      // delay بسيط قبل الـ chunk الجاي عشان منحرقش الـ rate limit
      await wait(2_500);
      await triggerNextChunk(jobId, chunkIndex + 1);
    }

  } finally {
    clearInterval(heartbeat);
  }
}

const BASELINE_SECONDS_PER_CHUNK = 25;

async function finalizeJob(jobId: string) {
  const { data } = await admin.from("jobs").select("output").eq("id", jobId).single();
  const rows: FlexibleRow[] = (data?.output as any)?.rows ?? [];
  const warnings: string[] = (data?.output as any)?.warnings ?? [];

  if (rows.length === 0) {
    await updateJob(jobId, {
      status: "failed",
      error: warnings[0] ?? "Failed to extract data from the document.",
      current_stage: "Failed",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  await updateJob(jobId, {
    status: "completed",
    output: { rows: dedupeRows(rows), warnings },
    current_stage: warnings.length > 0 ? "Completed with warnings" : "Completed",
    progress: 100,
    eta_seconds: 0,
    completed_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { jobId, chunkIndex = 0 } = body;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing GOOGLE_API_KEY" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const { data: job, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    // @ts-ignore
    EdgeRuntime.waitUntil(processSingleChunk(jobId, job, chunkIndex));

    return new Response(JSON.stringify({ received: true, jobId, chunkIndex }), {
      status: 202, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
});
