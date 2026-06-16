import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ─────────────────────────────────────────────────────────────
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MISTRAL_API_KEY    = (Deno.env.get("MISTRAL_API_KEY") || "").trim();
const MISTRAL_API        = "https://api.mistral.ai/v1/chat/completions";
const TEXT_MODEL         = "mistral-small-2506";
const VISION_MODEL       = "pixtral-12b-2409";
const REQUEST_TIMEOUT_MS = 90_000;

// ── Batching ──────────────────────────────────────────────────────────────────
const INVOICES_PER_BATCH     = 10;
const PARALLEL_BATCH_SIZE    = 25;
const FALLBACK_CHUNK_SIZE    = 12_000;
const SINGLE_REQUEST_CHAR_LIMIT = 10_000;
const FALLBACK_CHUNK_OVERLAP = 350;
const BATCH_DELAY_MS         = 1_500;

// ── Pattern detection ─────────────────────────────────────────────────────────
const PATTERN_SAMPLE_CHARS = 20_000;
const PATTERN_MIN_MATCHES  = 2;

// ── Progress ──────────────────────────────────────────────────────────────────
const PROGRESS_START             = 12;
const PROGRESS_END               = 96;
const BASELINE_SECONDS_PER_BATCH = 8;

// ── Supabase client ───────────────────────────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Types ─────────────────────────────────────────────────────────────────────
type Cell        = { v: string; c: number };
type FlexibleRow = Record<string, Cell>;

// ── Summary row keywords (Arabic + English) ───────────────────────────────────
const SUMMARY_KEYWORDS_REGEX = /^(total|grand\s*total|sub\s*total|subtotal|إجمالي|الإجمالي|الإجمالي\s*الفرعي|الإجمالي\s*النهائي|مجموع|المجموع|ضريبة|الضريبة|vat|gst|tax|discount|خصم|shipping|شحن|delivery|توصيل)$/i;

// ── Prompts ───────────────────────────────────────────────────────────────────
const FLEXIBLE_PROMPT = `You are an elite invoice data extraction agent. Your job is to extract every line item as a separate row.

CRITICAL RULES:
1. LINE ITEM SPLITTING: Every invoice may contain multiple line items (services, products). You MUST create a SEPARATE row for each line item. Never merge multiple items into one row.
2. For each line item row, duplicate the invoice metadata: invoice_number, client, date, dueDate, vendor.
3. Each line item row must contain: invoice_number, client, date, dueDate, vendor, description, amount, quantity (if present), unit_price (if present), reference_id (if present).
4. LINE ITEMS ONLY: Do NOT include summary rows (subtotals, totals, taxes, discounts, shipping) as line items. These belong in the invoice summary fields below.
5. After all line item rows for an invoice, add ONE summary row with:
   - description = "INVOICE_SUMMARY"
   - invoice_number = (same as the invoice)
   - subtotal = the pre-tax total
   - tax = the tax amount (with the rate if shown, e.g. "161.70 (14%)")
   - total = the grand total / amount due
   - Leave all other fields empty in this summary row.
6. Extract ALL invoices, ALL pages, ALL line items. Never skip or drop any.
7. If invoice numbers are sequential (e.g. INV-001 to INV-100), make sure ALL numbers are present with no gaps.
8. Copy every value EXACTLY as it appears — never truncate, round, or reformat.
9. Return ONLY a valid JSON array, no prose, no markdown, no code fences.`;

const USER_SUFFIX = `\n\nReturn a JSON ARRAY. For each invoice: first output all real line item rows, then one INVOICE_SUMMARY row. Never include totals/taxes/discounts as regular line items. Do not drop rows, do not invent fields, and keep all strings exact.`;

// ── Utilities ─────────────────────────────────────────────────────────────────
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

function computeProgress(processedBatches: number, totalBatches: number) {
  if (totalBatches <= 0) return PROGRESS_START;
  return clamp(
    Math.round(PROGRESS_START + (processedBatches / totalBatches) * (PROGRESS_END - PROGRESS_START)),
    PROGRESS_START,
    PROGRESS_END,
  );
}

function computeEtaSeconds(processedBatches: number, totalBatches: number, startedAtMs: number) {
  if (totalBatches <= 0 || processedBatches >= totalBatches) return 0;
  const remaining   = totalBatches - processedBatches;
  const perBatchSec =
    processedBatches > 0
      ? (Date.now() - startedAtMs) / 1000 / processedBatches
      : BASELINE_SECONDS_PER_BATCH;
  return Math.max(1, Math.ceil(perBatchSec * remaining));
}

// ── Supabase job helpers ──────────────────────────────────────────────────────
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

// ── Mistral API call ──────────────────────────────────────────────────────────
async function callMistral(
  model: string,
  messages: unknown[],
  jsonMode = true,
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0,
      max_tokens:  16000,
    };
    if (jsonMode) body.response_format = { type: "json_object" };

    const res = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${MISTRAL_API_KEY}`,
      },
      signal: controller.signal,
      body:   JSON.stringify(body),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── استخراج الـ content من response Mistral ───────────────────────────────────
function extractContent(bodyText: string): string | null {
  try {
    const json = JSON.parse(bodyText);
    return json?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

// ── STEP 1: اكتشاف نمط بداية الفاتورة بذكاء ─────────────────────────────────
async function detectInvoicePattern(sampleText: string): Promise<RegExp | null> {
  console.log(`[process-job] detectInvoicePattern: analyzing ${sampleText.length} chars...`);

  const prompt = `You are analyzing a document that contains multiple invoices or records.

Here is a sample from the beginning of the document:
---
${sampleText}
---

Your task:
1. Study the text and identify the REPEATING PATTERN that marks the START of each new invoice/record.
2. Return a JSON object with exactly these fields:
   - "pattern": a JavaScript regex string (without delimiters or flags) that matches the first line or header of each invoice. The pattern must be general enough to match ALL invoices, not just the first one.
   - "explanation": one sentence explaining what you found.
   - "matches_found": how many invoice starts you can see in this sample.

Rules:
- The pattern must match the BEGINNING of each invoice, not content inside it.
- Make the pattern as simple and general as possible.
- Do NOT hardcode specific invoice numbers or dates — use \\d+ or [\\w-]+ for variable parts.
- If you cannot identify a clear repeating pattern, set "pattern" to null.

Return ONLY valid JSON, no prose.`;

  const { status, bodyText } = await callMistral(TEXT_MODEL, [
    { role: "user", content: prompt },
  ], true);

  if (status !== 200) {
    console.warn(`[process-job] detectInvoicePattern: Mistral returned ${status}`);
    return null;
  }

  const content = extractContent(bodyText);
  if (!content) return null;

  let parsed: any;
  try {
    const cleaned = content.trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[process-job] detectInvoicePattern: failed to parse response");
    return null;
  }

  const patternStr: string | null = parsed?.pattern ?? null;
  const matchesFound: number      = parsed?.matches_found ?? 0;

  console.log(
    `[process-job] detectInvoicePattern: pattern="${patternStr}", matches_in_sample=${matchesFound}, explanation="${parsed?.explanation}"`
  );

  if (!patternStr || matchesFound < PATTERN_MIN_MATCHES) {
    console.warn("[process-job] detectInvoicePattern: no reliable pattern found → fallback");
    return null;
  }

  try {
    const regex = new RegExp(patternStr, "gim");
    const testMatches = [...sampleText.matchAll(regex)];
    if (testMatches.length < PATTERN_MIN_MATCHES) {
      console.warn(
        `[process-job] detectInvoicePattern: pattern found only ${testMatches.length} match(es) in sample → fallback`
      );
      return null;
    }
    console.log(`[process-job] detectInvoicePattern: verified ✓ (${testMatches.length} matches in sample)`);
    return regex;
  } catch (e) {
    console.warn("[process-job] detectInvoicePattern: invalid regex →", e);
    return null;
  }
}

// ── STEP 2: تقسيم النص باستخدام النمط المكتشف ────────────────────────────────
function splitByPattern(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const matches = [...text.matchAll(pattern)];

  console.log(`[process-job] splitByPattern: found ${matches.length} invoice(s)`);

  if (matches.length < 2) return [text];

  const segments: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start   = matches[i].index!;
    const end     = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const segment = text.slice(start, end).trim();
    if (segment) segments.push(segment);
  }
  return segments.length > 0 ? segments : [text];
}

// ── Fallback: تقسيم بالحروف ───────────────────────────────────────────────────
function findChunkBoundary(text: string, start: number, desiredEnd: number) {
  if (desiredEnd >= text.length) return text.length;
  const minBoundary = start + Math.floor((desiredEnd - start) * 0.6);
  const window      = text.slice(minBoundary, desiredEnd);
  const separators  = ["\n\n", "\n"];
  for (const sep of separators) {
    const idx = window.lastIndexOf(sep);
    if (idx > 0) return minBoundary + idx;
  }
  return desiredEnd;
}

function fallbackChunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const desiredEnd = Math.min(text.length, start + size);
    const end        = findChunkBoundary(text, start, desiredEnd);
    const chunk      = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.length > 0 ? chunks : [text];
}

// ── buildInvoiceBatches ──────────────────────────────────────────────────────
async function buildInvoiceBatches(text: string): Promise<string[]> {
  const sanitized = sanitizeText(text);

  if (sanitized.length <= SINGLE_REQUEST_CHAR_LIMIT) {
    console.log(`[process-job] buildInvoiceBatches: small doc (${sanitized.length} chars) → single request`);
    return [sanitized];
  }

  const sample  = sanitized.slice(0, PATTERN_SAMPLE_CHARS);
  const pattern = await detectInvoicePattern(sample);

  let invoices: string[];

  if (pattern) {
    invoices = splitByPattern(sanitized, pattern);
  } else {
    console.log("[process-job] buildInvoiceBatches: no pattern found → char-based fallback");
    return fallbackChunkText(sanitized, FALLBACK_CHUNK_SIZE, FALLBACK_CHUNK_OVERLAP);
  }

  if (invoices.length <= 1) {
    console.log("[process-job] buildInvoiceBatches: 1 segment only → char-based fallback");
    return fallbackChunkText(sanitized, FALLBACK_CHUNK_SIZE, FALLBACK_CHUNK_OVERLAP);
  }

  const batches: string[] = [];
  for (let i = 0; i < invoices.length; i += INVOICES_PER_BATCH) {
    batches.push(invoices.slice(i, i + INVOICES_PER_BATCH).join("\n\n"));
  }

  console.log(
    `[process-job] buildInvoiceBatches: ${invoices.length} invoice(s) → ${batches.length} batch(es) of up to ${INVOICES_PER_BATCH}`
  );
  return batches;
}

// ── Row normalization ─────────────────────────────────────────────────────────
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
    if (typeof v === "number")             return { v: String(v),  c: 80 };
  }
  if (typeof x === "string" && x.trim()) return { v: x.trim(), c: 80 };
  if (typeof x === "number")             return { v: String(x),  c: 80 };
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
  if (CANON[norm])                      return CANON[norm];
  if (CANON[norm.replace(/\s+/g, "")]) return CANON[norm.replace(/\s+/g, "")];
  return k.trim();
}

function isSummaryRow(row: Record<string, unknown>): boolean {
  const desc = (row as any)?.description;
  const descValue = typeof desc === "string"
    ? desc
    : typeof desc?.v === "string"
    ? desc.v
    : "";

  if (descValue.trim().toUpperCase() === "INVOICE_SUMMARY") return true;
  if (SUMMARY_KEYWORDS_REGEX.test(descValue.trim())) return true;

  return false;
}

function normalizeRow(x: unknown): FlexibleRow | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;

  if (isSummaryRow(x as Record<string, unknown>)) {
    console.log(`[process-job] normalizeRow: skipping summary row →`, JSON.stringify(x).slice(0, 120));
    return null;
  }

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
  const description   = r.description?.v?.trim().toLowerCase()   ?? "";
  const amount        = r.amount?.v?.trim().toLowerCase()        ?? "";
  const quantity      = r.quantity?.v?.trim().toLowerCase()      ?? "";
  const reference     = r.reference?.v?.trim().toLowerCase()     ?? "";
  const total         = r.total?.v?.trim().toLowerCase()         ?? "";
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

// ── Mistral response parser ───────────────────────────────────────────────────
function parseResponse(
  status: number,
  bodyText: string,
): { ok: true; rows: FlexibleRow[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  const content = extractContent(bodyText);
  if (!content) return { ok: false, error: "Mistral returned an empty response." };

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return { ok: false, error: "Mistral returned an unparseable response." }; }

  const rows = toRowArray(parsed)
    .map(normalizeRow)
    .filter((row): row is FlexibleRow => row !== null);

  if (rows.length === 0) return { ok: false, error: "Mistral response contained no usable rows." };
  return { ok: true, rows };
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function runWithRetry(
  model: string,
  messages: unknown[],
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, bodyText } = await callMistral(model, messages);

      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse Mistral response." };
      }

      console.error(`[process-job] Mistral ${status}:`, bodyText.slice(0, 300));

      if (status === 429) {
        lastError     = "Mistral rate limit reached.";
        const delayMs = 10_000 * attempt;
        console.log(`[process-job] Rate limited — waiting ${delayMs}ms (attempt ${attempt})...`);
        await wait(delayMs);
        continue;
      }
      if ([502, 503, 504, 524].includes(status)) {
        lastError = "Mistral is temporarily unavailable.";
        await wait(4_000 * attempt);
        continue;
      }
      if (status === 401 || status === 403) {
        return { ok: false, error: "Mistral authentication failed — check MISTRAL_API_KEY." };
      }
      if (status === 404) {
        return { ok: false, error: `Mistral model not found: ${model}.` };
      }
      return { ok: false, error: `Mistral error (${status}).` };

    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      lastError     = aborted ? "Mistral request timed out." : (error?.message ?? "Network error");
      if (aborted) await wait(3_000 * attempt);
      else         await wait(2_000 * attempt);
    }
  }

  return { ok: false, error: `${lastError} Please try again.` };
}

// ── NEW: Self-review pass for image OCR correction ────────────────────────────
// بيبعت الصورة الأصلية + الـ draft المستخرج ويطلب تصحيح أخطاء OCR فقط
async function selfReviewImage(
  imageDataUrl: string,
  draft: FlexibleRow[],
): Promise<FlexibleRow[]> {
  console.log("[process-job] selfReviewImage: starting OCR correction pass...");

  const reviewPrompt = `You previously extracted this JSON from the invoice image:

${JSON.stringify(draft, null, 2)}

Look at the ORIGINAL IMAGE again carefully and fix ONLY clear OCR mistakes.

Examples of OCR mistakes to fix:
- Arabic: "طعم" → "طقم", "بدوي" → "يدوي", "مكتبة" → "مكيفة"
- English: "lnvoice" → "Invoice", "O" used instead of "0" in numbers

Rules:
- Fix ONLY visually obvious OCR errors where you are 100% certain.
- Do NOT change any numbers, dates, amounts, or totals.
- Do NOT add, remove, or reorder any rows or fields.
- Keep the EXACT same JSON structure, field names, and array length.
- Return ONLY the corrected JSON array, no prose, no markdown, no code fences.`;

  const { status, bodyText } = await callMistral(VISION_MODEL, [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: reviewPrompt },
      ],
    },
  ]);

  if (status !== 200) {
    console.warn(`[process-job] selfReviewImage: Mistral returned ${status} → skipping correction`);
    return draft;
  }

  const content = extractContent(bodyText);
  if (!content) {
    console.warn("[process-job] selfReviewImage: empty response → skipping correction");
    return draft;
  }

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn("[process-job] selfReviewImage: unparseable response → skipping correction");
    return draft;
  }

  const correctedRows = toRowArray(parsed)
    .map(normalizeRow)
    .filter((row): row is FlexibleRow => row !== null);

  if (correctedRows.length === 0) {
    console.warn("[process-job] selfReviewImage: no rows after parse → skipping correction");
    return draft;
  }

  console.log(`[process-job] selfReviewImage: ✓ corrected ${correctedRows.length} row(s)`);
  return correctedRows;
}

// ── NEW: Two-pass image extraction (extract → self-review) ────────────────────
async function extractImageWithReview(
  imageDataUrl: string,
  fileName: string,
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  // Pass 1: استخراج البيانات كالعادة
  console.log("[process-job] extractImageWithReview: Pass 1 — extraction...");

  const pass1Messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}${USER_SUFFIX}` },
      ],
    },
  ];

  const pass1 = await runWithRetry(VISION_MODEL, pass1Messages);

  if (!pass1.ok) {
    console.error("[process-job] extractImageWithReview: Pass 1 failed →", pass1.error);
    return pass1;
  }

  console.log(`[process-job] extractImageWithReview: Pass 1 ✓ — ${pass1.rows.length} row(s)`);

  // Pass 2: مراجعة وتصحيح أخطاء OCR
  console.log("[process-job] extractImageWithReview: Pass 2 — self-review...");
  const correctedRows = await selfReviewImage(imageDataUrl, pass1.rows);

  return { ok: true, rows: correctedRows };
}

// ── Process one batch ─────────────────────────────────────────────────────────
async function processChunk(
  chunk: string,
  fileName: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string; chunkIndex: number }> {
  console.log(`[process-job] Batch ${chunkIndex + 1}/${totalChunks} started (${chunk.length} chars)`);

  const prompt = `${FLEXIBLE_PROMPT}\n\nDocument: ${fileName}\nPart ${chunkIndex + 1}/${totalChunks} — this part contains a small batch of invoices. Focus carefully on extracting every field for each invoice in THIS batch with full accuracy before moving to the next.\n\n---\n${chunk}${USER_SUFFIX}`;

  const result = await runWithRetry(TEXT_MODEL, [
    { role: "user", content: prompt },
  ]);

  if (result.ok) {
    console.log(`[process-job] Batch ${chunkIndex + 1}/${totalChunks} ✓ — ${result.rows.length} row(s)`);
    return result;
  } else {
    console.error(`[process-job] Batch ${chunkIndex + 1}/${totalChunks} ✗ — ${result.error}`);
    return { ...result, chunkIndex };
  }
}

// ── Parallel batch runner ─────────────────────────────────────────────────────
async function processBatches(
  jobId: string,
  batches: string[],
  fileName: string,
  startedAtMs: number,
): Promise<{ rows: FlexibleRow[]; warnings: string[] }> {
  const totalChunks = batches.length;
  const totalGroups = Math.ceil(totalChunks / PARALLEL_BATCH_SIZE);

  const allRows: FlexibleRow[] = [];
  const warnings: string[]     = [];

  const heartbeat = setInterval(() => { void beat(jobId); }, 10_000);

  try {
    for (let groupIdx = 0; groupIdx < totalGroups; groupIdx++) {
      const groupStart   = groupIdx * PARALLEL_BATCH_SIZE;
      const groupEnd     = Math.min(groupStart + PARALLEL_BATCH_SIZE, totalChunks);
      const groupBatches = batches.slice(groupStart, groupEnd);

      console.log(
        `[process-job] Group ${groupIdx + 1}/${totalGroups}: ` +
        `batches ${groupStart + 1}–${groupEnd} of ${totalChunks} (parallel × ${groupBatches.length})`
      );

      await updateJob(jobId, {
        current_stage:    `Batch ${groupIdx + 1}/${totalGroups} — processing ${groupBatches.length} part(s) in parallel`,
        progress:         computeProgress(groupIdx, totalGroups),
        processed_chunks: groupStart,
        total_chunks:     totalChunks,
        eta_seconds:      computeEtaSeconds(groupIdx, totalGroups, startedAtMs),
      });

      const groupResults = await Promise.all(
        groupBatches.map((chunk, i) =>
          processChunk(chunk, fileName, groupStart + i, totalChunks)
        )
      );

      for (const result of groupResults) {
        if (result.ok) {
          allRows.push(...result.rows);
        } else {
          const ci = "chunkIndex" in result ? result.chunkIndex + 1 : "?";
          warnings.push(`Part ${ci} failed: ${result.error}`);
        }
      }

      await admin.from("jobs").update({
        output:           { rows: allRows, warnings },
        processed_chunks: groupEnd,
        progress:         computeProgress(groupIdx + 1, totalGroups),
        last_heartbeat:   new Date().toISOString(),
      }).eq("id", jobId);

      if (groupIdx + 1 < totalGroups) {
        console.log(`[process-job] Group ${groupIdx + 1} done — waiting ${BATCH_DELAY_MS}ms...`);
        await wait(BATCH_DELAY_MS);
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  return { rows: allRows, warnings };
}

// ── Finalize job ──────────────────────────────────────────────────────────────
async function finalizeJob(jobId: string) {
  const { data } = await admin.from("jobs").select("output").eq("id", jobId).single();
  const rows: FlexibleRow[] = (data?.output as any)?.rows     ?? [];
  const warnings: string[]  = (data?.output as any)?.warnings ?? [];

  if (rows.length === 0) {
    await updateJob(jobId, {
      status:        "failed",
      error:         warnings[0] ?? "Failed to extract data from the document.",
      current_stage: "Failed",
      completed_at:  new Date().toISOString(),
    });
    return;
  }

  await updateJob(jobId, {
    status:        "completed",
    output:        { rows: dedupeRows(rows), warnings },
    current_stage: warnings.length > 0 ? "Completed with warnings" : "Completed",
    progress:      100,
    eta_seconds:   0,
    completed_at:  new Date().toISOString(),
  });
}

// ── Main job processor ────────────────────────────────────────────────────────
async function processJob(jobId: string, job: any) {
  const input = job.input as {
    kind: "text" | "image";
    text?: string;
    imageDataUrl?: string;
    fileName: string;
  };

  const fileName  = input.fileName;
  const startedAt = Date.now();

  // ── Image ────────────────────────────────────────────────────────────────
  if (input.kind === "image") {
    await updateJob(jobId, {
      status:           "processing",
      started_at:       new Date().toISOString(),
      current_stage:    "Scanning image with Mistral Vision (Pass 1: extraction)",
      progress:         25,
      total_chunks:     1,
      processed_chunks: 0,
      eta_seconds:      60,
    });

    const pass1Result = await runWithRetry(VISION_MODEL, [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: input.imageDataUrl ?? "" } },
          { type: "text", text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}${USER_SUFFIX}` },
        ],
      },
    ]);

    if (!pass1Result.ok) {
      await updateJob(jobId, {
        status:        "failed",
        error:         pass1Result.error,
        current_stage: "Failed",
        completed_at:  new Date().toISOString(),
      });
      return;
    }

    // Pass 2: مراجعة وتصحيح أخطاء OCR
    await updateJob(jobId, {
      current_stage: "Reviewing OCR results (Pass 2: self-review)",
      progress:      65,
      eta_seconds:   30,
    });

    const correctedRows = await selfReviewImage(input.imageDataUrl ?? "", pass1Result.rows);

    await updateJob(jobId, {
      status:           "completed",
      output:           { rows: dedupeRows(correctedRows), warnings: [] },
      current_stage:    "Completed",
      progress:         100,
      processed_chunks: 1,
      total_chunks:     1,
      eta_seconds:      0,
      completed_at:     new Date().toISOString(),
    });
    return;
  }

  // ── Text ─────────────────────────────────────────────────────────────────
  const rawText = input.text ?? "";

  await updateJob(jobId, {
    status:         "processing",
    started_at:     new Date().toISOString(),
    current_stage:  "Analyzing document structure...",
    progress:       5,
    last_heartbeat: new Date().toISOString(),
  });

  const batches     = await buildInvoiceBatches(rawText);
  const totalGroups = Math.ceil(batches.length / PARALLEL_BATCH_SIZE);

  console.log(
    `[process-job] Job ${jobId}: ${batches.length} batch(es) → ` +
    `${totalGroups} group(s) × up to ${PARALLEL_BATCH_SIZE} parallel`
  );

  await updateJob(jobId, {
    current_stage:    `Prepared ${batches.length} batch(es)`,
    progress:         PROGRESS_START,
    total_chunks:     batches.length,
    processed_chunks: 0,
    eta_seconds:      totalGroups * BASELINE_SECONDS_PER_BATCH,
    last_heartbeat:   new Date().toISOString(),
  });

  const { rows, warnings } = await processBatches(jobId, batches, fileName, startedAt);

  await admin.from("jobs").update({
    output:         { rows, warnings },
    last_heartbeat: new Date().toISOString(),
  }).eq("id", jobId);

  await finalizeJob(jobId);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[process-job] Job ${jobId} done in ${elapsed}s — ${rows.length} row(s), ${warnings.length} warning(s)`
  );
}

// ── Edge Function entry point ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const body      = await req.json();
    const { jobId } = body;

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Missing jobId" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    if (!MISTRAL_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing MISTRAL_API_KEY" }), {
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
    EdgeRuntime.waitUntil(processJob(jobId, job));

    return new Response(JSON.stringify({ received: true, jobId }), {
      status: 202, headers: { "Content-Type": "application/json" },
    });

  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
});
