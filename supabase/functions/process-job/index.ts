import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ─────────────────────────────────────────────────────────────
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MISTRAL_API_KEY    = (Deno.env.get("MISTRAL_API_KEY") || "").trim();
const MISTRAL_API        = "https://api.mistral.ai/v1/chat/completions";
const GITHUB_TOKEN       = (Deno.env.get("GITHUB_TOKEN") || "").trim();
const GITHUB_API         = "https://models.inference.ai.azure.com/chat/completions";
const TEXT_MODEL         = "mistral-small-2506";
const VISION_MODEL       = "gpt-4.1";
const REQUEST_TIMEOUT_MS = 90_000;

// ── Batching ──────────────────────────────────────────────────────────────────
const INVOICES_PER_BATCH        = 10;
const PARALLEL_BATCH_SIZE       = 25;
const FALLBACK_CHUNK_SIZE       = 12_000;
const SINGLE_REQUEST_CHAR_LIMIT = 10_000;
const FALLBACK_CHUNK_OVERLAP    = 350;
const BATCH_DELAY_MS            = 1_500;
const PAGE_BREAK                = "\f";
const PAGES_PER_BATCH           = 10;

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
type CellType = "string" | "number" | "integer" | "date";
type Cell     = { v: string; c: number; _type?: CellType };
type FlexibleRow = Record<string, Cell>;

// ── Semantic field classification ─────────────────────────────────────────────
//
// Coercion is opt-in, not opt-out.
//
// Only fields whose semantic purpose is measurement, counting, aggregation, or
// calculation are converted to numeric types. Everything else — identifiers,
// references, codes, labels, addresses, names, notes — stays as text and its
// original representation is preserved exactly (including leading zeros,
// separators, prefixes, and alphanumeric patterns).
//
// The guard is applied against BOTH the raw field name as it appears in the
// document AND its canonicalized equivalent, so it works regardless of how a
// vendor labels the field.

/** Fields whose value is a monetary amount used in arithmetic. */
const MONETARY_FIELDS = new Set([
  // Common raw labels (English)
  "AMOUNT (USD)", "UNIT PRICE (USD)", "SUBTOTAL", "DISCOUNT (5%)",
  "TAXABLE AMOUNT", "SALES TAX (8.25%)", "TOTAL DUE (USD)",
  "Amount", "Unit Price", "Subtotal", "Discount", "Total Due",
  "Sub Total", "Net Amount", "Grand Total", "Amount Due", "Balance Due",
  "Tax Amount", "VAT Amount", "GST Amount", "Sales Tax",
  // Canonicalized keys
  "amount", "unitPrice", "subtotal", "tax", "total",
]);

/** Fields whose value is a countable whole-number quantity used in arithmetic. */
const INTEGER_FIELDS = new Set([
  "QTY", "Qty", "Quantity", "quantity",
]);

/** Fields whose value is a calendar date to be normalized to ISO 8601. */
const DATE_FIELDS = new Set([
  "Invoice Date", "Due Date", "Issue Date", "Issued", "Payment Due",
  // Canonicalized keys
  "date", "dueDate", "invoiceDate",
]);

//
// No IDENTIFIER_FIELDS blocklist. The model below is:
//   1. Is this field explicitly known to be calculative? → coerce.
//   2. Otherwise → preserve as text, unconditionally.
//
// This means a field like "Zip Code", "Phone", "Account Number",
// "Routing Number", "SWIFT Code", "Serial Number", or any future
// vendor-specific code that isn't pre-listed will always be kept as text,
// without needing to enumerate every possible identifier in advance.

// ── Prompts ───────────────────────────────────────────────────────────────────
const FLEXIBLE_PROMPT = `You are a document understanding and data extraction system. Your task is to read the document provided and extract all of its information as structured data.

APPROACH — SEMANTIC, NOT TEMPLATE-BASED:
Do not apply fixed templates, assumed field names, or positional rules. Instead, read the document as a whole, understand what it contains, and extract every piece of information based on its meaning, role, and relationships within the document. The document may be an invoice, receipt, purchase order, statement, contract, form, or any other business document. Adapt completely to whatever you find.

━━━ DOCUMENT STRUCTURE ━━━

1. UNDERSTAND THE DOCUMENT BEFORE EXTRACTING.
   Read the entire document first. Identify:
   - What type of document this is.
   - Who the parties are and what their roles are (issuer, recipient, shipper, payer, etc.).
   - What sections the document contains (header, line items, summary, notes, terms, etc.).
   - What tables or lists are present, and what each column or field represents semantically.

2. DISTINGUISH STRUCTURAL LEVELS.
   Not all fields have the same scope. Classify each piece of information by its role:
   - DOCUMENT-LEVEL: applies to the whole document (e.g. invoice number, issue date, parties, payment terms, currency, totals, notes).
   - LINE-ITEM-LEVEL: specific to one product, service, or entry in a table (e.g. description, quantity, unit price, line total).
   Do not confuse these levels. A document total is not a line-item field. A line-item description is not a document field.

3. PRODUCE ONE ROW PER LINE ITEM.
   If the document contains a table of line items, produce one output row per line item.
   - Repeat document-level fields in every row (so each row is self-contained and can be processed independently).
   - Place summary fields (totals, discounts, taxes, subtotals) ONLY in the FIRST line item row. Leave them empty in all subsequent rows of the same document.
   - If the document has no line items, produce a single row containing all document fields.

━━━ FIELD NAMES ━━━

4. USE THE DOCUMENT'S OWN LABELS.
   Use the exact field label as it appears in the document — in whatever language and script the document uses. Do not translate, rename, invent, merge, or split field names.
   - If the document is in Arabic, use Arabic field names.
   - If the document is in English, use English field names exactly as written.
   - If a label is ambiguous or absent, describe the field's meaning concisely using the document's own language.

5. NORMALIZE ONLY THESE TWO FIELDS, regardless of how they appear in the document:
   - The document's unique identifier (Invoice #, Invoice Number, رقم الفاتورة, Folio, No., etc.) → always use key: "Invoice #"
   - The recipient/customer/client (Billing To, Bill To, Client, Customer, المستلم, etc.) → always use key: "Billing To"
   All other field names must be taken verbatim from the document.

━━━ VALUES ━━━

6. COPY VALUES EXACTLY.
   Preserve every value exactly as it appears. Do not reformat, round, abbreviate, translate, or correct values.

7. CLASSIFY VALUES BY SEMANTIC PURPOSE.
   Determine the type of each value based on what it represents, not how it looks:
   - Quantities, amounts, rates, prices, taxes, totals, percentages → numeric (these will be coerced by the system).
   - Dates → preserve as-is (the system will normalize to ISO 8601).
   - Identifiers, codes, reference numbers, account numbers, phone numbers, postal codes, serial numbers, model numbers, SKUs, SWIFT codes, routing numbers, and any other label or key → preserve as text, exactly as shown, including leading zeros, separators, and formatting.
   Never convert an identifier to a number even if it contains only digits.

━━━ ACCURACY ━━━

8. MAINTAIN ROW INTEGRITY IN TABLES.
   When reading a table, process one row at a time. For each row, read every column left to right before writing anything. Confirm that each value belongs to the current row — do not mix values across rows. If a table row spans multiple visual lines, treat it as a single logical row.

9. VERIFY LINE-ITEM ARITHMETIC.
   After reading each line item, check: quantity × unit price = line total. If they do not match, re-read the entire row from the source before writing. Do not silently correct mismatches — extract what the document states.

━━━ UNCERTAINTY & QUALITY ━━━

10. FLAG UNCERTAINTY EXPLICITLY.
    If a value is unclear, partially visible, ambiguous, or could be read multiple ways, extract your best reading and append " [uncertain]" to that value. Do not guess silently.

11. FLAG STRUCTURAL ANOMALIES.
    If you detect a possible row-shift, column-shift, merged cell misread, or other table alignment issue, note it in a "_extraction_notes" field on the affected row. Be specific about what was observed.

12. DO NOT SKIP ANYTHING.
    Extract every piece of information visible in the document: all pages, all sections, all tables, all line items, all footer text, all notes, all terms, all metadata. Never omit a field because it seems unimportant.

13. DO NOT ADD ANYTHING.
    Do not infer, compute, or insert values that are not present in the document. Do not fill in assumed defaults. Only output what is explicitly present.

━━━ OUTPUT ━━━

Return ONLY a valid JSON array of objects. No prose, no markdown, no code fences, no commentary.`;

const USER_SUFFIX = `\n\nReturn a JSON ARRAY. Each object represents one line item row (or a single row if the document has no line items). Use field names taken verbatim from the document in its original language and script. Apply the semantic classification rules above for field names and values.`;

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

/**
 * Collapse OCR-introduced intra-cell line breaks within a single field value.
 * A \n is replaced with a space unless it precedes a numbered list marker
 * (e.g. "2. Late payments…"), which indicates intentional structure.
 */
function collapseInlineLF(value: string): string {
  return value
    .replace(/([^\n])\n(?!\d+\.\s)([^\n])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
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

// ── Type coercion helpers ─────────────────────────────────────────────────────

/**
 * Parse a monetary string like "4,505.00" or "-225.25" into a number.
 * Returns null if the value cannot be parsed.
 */
function tryParseMonetary(v: string): number | null {
  const cleaned = v.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Parse common date formats into ISO 8601 (YYYY-MM-DD).
 * Handles: "June 19, 2024", "Jun 19, 2024", "2024-06-19".
 * Returns null if the format is not recognised.
 */
function tryParseDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  const MONTHS: Record<string, string> = {
    january: "01", february: "02", march: "03",    april: "04",
    may:     "05", june:     "06", july:  "07",    august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };

  const m = v.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
  }
  return null;
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

// ── Fallback: تقسيم بالصفحات (form-feed \f) ──────────────────────────────────
function splitIntoPages(text: string): string[] {
  if (!text.includes(PAGE_BREAK)) return [text];
  return text.split(PAGE_BREAK).map((p) => p.trim()).filter((p) => p.length > 0);
}

function fallbackChunkByPages(text: string, pagesPerBatch: number): string[] {
  const pages = splitIntoPages(text);

  if (pages.length <= 1) {
    console.log("[process-job] fallbackChunkByPages: no \\f page breaks found → char-based fallback");
    return fallbackChunkText(text, FALLBACK_CHUNK_SIZE, FALLBACK_CHUNK_OVERLAP);
  }

  console.log(`[process-job] fallbackChunkByPages: ${pages.length} page(s) → batches of ${pagesPerBatch}`);

  const batches: string[] = [];
  for (let i = 0; i < pages.length; i += pagesPerBatch) {
    batches.push(pages.slice(i, i + pagesPerBatch).join("\n\n"));
  }
  return batches;
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
    console.log("[process-job] buildInvoiceBatches: no pattern found → page-based fallback");
    return fallbackChunkByPages(sanitized, PAGES_PER_BATCH);
  }

  if (invoices.length <= 1) {
    console.log("[process-job] buildInvoiceBatches: 1 segment only → page-based fallback");
    return fallbackChunkByPages(sanitized, PAGES_PER_BATCH);
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

function normalizeRow(x: unknown): FlexibleRow | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;

  const source = x as Record<string, unknown>;
  const out: FlexibleRow = {};

  for (const key of Object.keys(source)) {
    let cell = toCell(source[key]);
    if (!cell || !cell.v || cell.v === "—") continue;

    const canonized = canonKey(key);

    // ── Collapse OCR-introduced intra-cell line breaks ────────────────────────
    cell = { ...cell, v: collapseInlineLF(cell.v) };

    // ── Semantic type coercion — opt-in only ──────────────────────────────────
    //
    // Coercion is applied exclusively to fields whose semantic purpose is
    // calculative (measurement, counting, aggregation). Any field not
    // explicitly recognized as calculative is preserved as text, retaining
    // its original representation exactly — including leading zeros,
    // separators, prefixes, and alphanumeric patterns.
    //
    // Check both the raw document label and its canonicalized equivalent so
    // the logic works regardless of vendor-specific naming.

    if (MONETARY_FIELDS.has(key) || MONETARY_FIELDS.has(canonized)) {
      const n = tryParseMonetary(cell.v);
      if (n !== null) {
        cell = { v: String(n), c: cell.c, _type: "number" };
      }

    } else if (INTEGER_FIELDS.has(key) || INTEGER_FIELDS.has(canonized)) {
      const n = parseInt(cell.v, 10);
      if (!isNaN(n)) {
        cell = { v: String(n), c: cell.c, _type: "integer" };
      }

    } else if (DATE_FIELDS.has(key) || DATE_FIELDS.has(canonized)) {
      const iso = tryParseDate(cell.v);
      if (iso) {
        cell = { v: iso, c: cell.c, _type: "date" };
      }

    }
    // All other fields: _type remains undefined → treated as "string" by
    // downstream consumers. No transformation is applied.

    if (!out[key]) out[key] = cell;
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

function clearDuplicateSummaryFields(rows: FlexibleRow[]): FlexibleRow[] {
  if (rows.length <= 1) return rows;

  const invoiceKey = "Invoice #";
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const inv = row[invoiceKey]?.v ?? "__no_invoice__";
    if (!groups.has(inv)) groups.set(inv, []);
    groups.get(inv)!.push(i);
  });

  const result = rows.map((r) => ({ ...r }));

  for (const indices of groups.values()) {
    if (indices.length <= 1) continue;
    const firstRow = result[indices[0]];
    const summaryFields = Object.keys(firstRow).filter((key) => {
      const firstVal = firstRow[key]?.v;
      if (!firstVal || firstVal.trim() === "") return false;
      return indices.slice(1).every((i) => result[i][key]?.v === firstVal);
    });
    for (const i of indices.slice(1)) {
      for (const key of summaryFields) {
        delete result[i][key];
      }
    }
  }

  return result;
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

function isRedundantRow(row: FlexibleRow, prev: FlexibleRow | null): boolean {
  if (!prev) return false;
  const newEntries = Object.entries(row).filter(([, c]) => c?.v && c.v.trim() !== "");
  if (newEntries.length === 0) return true;
  return newEntries.every(([k, c]) => prev[k]?.v === c.v);
}

// ── Math validation & flagging ────────────────────────────────────────────────

/**
 * Resolves a numeric value from a row by trying every key whose canonicalized
 * form matches one of the provided canonical names. Returns NaN if not found
 * or not parseable. This makes validation work regardless of how a vendor
 * labels a field (e.g. "QTY", "Qty", "Quantity", "الكمية" all resolve to "quantity").
 */
function resolveNumeric(row: FlexibleRow, ...canonNames: string[]): number {
  for (const [key, cell] of Object.entries(row)) {
    if (canonNames.includes(canonKey(key))) {
      const n = parseFloat(cell.v);
      if (!isNaN(n)) return n;
    }
  }
  return NaN;
}

/**
 * Validates internal mathematical consistency for each row using canonicalized
 * field resolution — no hardcoded field name strings. Attaches a
 * `_validation_flags` cell listing any detected discrepancies.
 * Values are never silently modified — only flagged.
 *
 * Checks performed:
 *   1. Line-item integrity:  quantity × unitPrice = amount
 *   2. Tax composition:      taxableAmount + tax = total  (when all three present)
 *   3. Subtotal composition: subtotal - discount = taxableAmount (when all three present)
 *   4. Flags " [uncertain]" values that arrived from the model's own uncertainty markers.
 */
function validateAndFlagRows(rows: FlexibleRow[]): FlexibleRow[] {
  return rows.map((row) => {
    const flags: string[] = [];

    // ── 1. Line-item: quantity × unitPrice = amount ───────────────────────────
    const qty       = resolveNumeric(row, "quantity");
    const unitPrice = resolveNumeric(row, "unitPrice");
    const amount    = resolveNumeric(row, "amount");

    if (!isNaN(qty) && !isNaN(unitPrice) && !isNaN(amount)) {
      const expected = Math.round(qty * unitPrice * 100) / 100;
      if (Math.abs(expected - amount) > 0.02) {
        flags.push(`LINE_AMOUNT_MISMATCH: ${qty} × ${unitPrice} = ${expected}, stated ${amount}`);
      }
    }

    // ── 2. Summary: taxableAmount + tax = total ───────────────────────────────
    const taxable = resolveNumeric(row, "subtotal");   // taxable base after discount
    const tax     = resolveNumeric(row, "tax");
    const total   = resolveNumeric(row, "total");

    if (!isNaN(taxable) && !isNaN(tax) && !isNaN(total)) {
      const expectedTotal = Math.round((taxable + tax) * 100) / 100;
      if (Math.abs(expectedTotal - total) > 0.02) {
        flags.push(`TOTAL_MISMATCH: ${taxable} + ${tax} = ${expectedTotal}, stated ${total}`);
      }
    }

    // ── 3. Uncertainty markers passed through from the model ──────────────────
    const uncertainFields = Object.entries(row)
      .filter(([, cell]) => cell.v.includes("[uncertain]"))
      .map(([key]) => key);
    if (uncertainFields.length > 0) {
      flags.push(`UNCERTAIN_VALUES: ${uncertainFields.join(", ")}`);
    }

    if (flags.length === 0) return row;

    return {
      ...row,
      _validation_flags: { v: flags.join(" | "), c: 50, _type: "string" as CellType },
    };
  });
}

// ── Response parser ───────────────────────────────────────────────────────────
function parseResponse(
  status: number,
  bodyText: string,
): { ok: true; rows: FlexibleRow[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  const content = extractContent(bodyText);
  if (!content) return { ok: false, error: "Model returned an empty response." };

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return { ok: false, error: "Model returned an unparseable response." }; }

  const rawRows = toRowArray(parsed)
    .map(normalizeRow)
    .filter((row): row is FlexibleRow => row !== null);

  const rows = rawRows.filter((row, i) =>
    !isRedundantRow(row, i > 0 ? rawRows[i - 1] : null)
  );

  if (rows.length === 0) return { ok: false, error: "Model response contained no usable rows." };
  return { ok: true, rows };
}

// ── Mistral retry wrapper ─────────────────────────────────────────────────────
async function runWithRetry(
  model: string,
  messages: unknown[],
  jsonMode = true,
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, bodyText } = await callMistral(model, messages, jsonMode);

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

// ── GitHub Models API call (vision) ──────────────────────────────────────────
async function callGitHub(
  messages: unknown[],
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model:       VISION_MODEL,
      messages,
      temperature: 0,
      max_tokens:  32000,
    };

    const res = await fetch(GITHUB_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${GITHUB_TOKEN}`,
      },
      signal: controller.signal,
      body:   JSON.stringify(body),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function runGitHubWithRetry(
  messages: unknown[],
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, bodyText } = await callGitHub(messages);

      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse vision response." };
      }

      console.error(`[process-job] Vision API ${status}:`, bodyText.slice(0, 300));

      if (status === 429) {
        lastError     = "Vision API rate limit reached.";
        const delayMs = 10_000 * attempt;
        await wait(delayMs);
        continue;
      }
      if ([502, 503, 504, 524].includes(status)) {
        lastError = "Vision API is temporarily unavailable.";
        await wait(4_000 * attempt);
        continue;
      }
      if (status === 401 || status === 403) {
        return { ok: false, error: "Vision API authentication failed — check GITHUB_TOKEN." };
      }
      return { ok: false, error: `Vision API error (${status}).` };

    } catch (error: any) {
      const aborted = error?.name === "AbortError";
      lastError     = aborted ? "Vision API request timed out." : (error?.message ?? "Network error");
      if (aborted) await wait(3_000 * attempt);
      else         await wait(2_000 * attempt);
    }
  }

  return { ok: false, error: `${lastError} Please try again.` };
}

// ── Merge two extraction passes — always prefer pass2 ────────────────────────
function mergePassRows(pass1: FlexibleRow[], pass2: FlexibleRow[]): FlexibleRow[] {
  if (pass2.length === 0) return pass1;
  if (pass1.length !== pass2.length) {
    console.log(
      `[process-job] mergePassRows: row count mismatch (${pass1.length} vs ${pass2.length}) → using pass2`
    );
    return pass2;
  }

  return pass2.map((row2, i) => {
    const row1   = pass1[i];
    const merged: FlexibleRow = { ...row2 };
    for (const key of Object.keys(row1)) {
      if (!merged[key]?.v) merged[key] = row1[key];
    }
    return merged;
  });
}

// ── Pass 2: fresh re-extraction from scratch (no draft shown) ─────────────────
async function pass2ExtractImage(
  imageDataUrl: string,
): Promise<FlexibleRow[]> {
  console.log("[process-job] pass2ExtractImage: fresh re-extraction from scratch...");

  const { status, bodyText } = await callGitHub([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        {
          type: "text",
          text: `${FLEXIBLE_PROMPT}

VERIFICATION PASS — ADDITIONAL INSTRUCTIONS:
- Treat this as an independent, fresh read. Do not assume anything about the document's structure before examining it.
- Read every table cell character by character, digit by digit.
- For every row in every table: read all columns left to right as a unit before writing any value. Confirm each value belongs to the current row.
- Verify arithmetic where possible (e.g. quantity × unit price = line total). If the numbers do not agree, extract what the document states and add " [uncertain]" to the affected values.
- If any value is partially obscured, ambiguous, or difficult to read, extract your best reading and append " [uncertain]".
- Do not guess, interpolate, or infer any value. Only output what is explicitly visible.

${USER_SUFFIX.trim()}`,
        },
      ],
    },
  ]);

  if (status !== 200) {
    console.warn(`[process-job] pass2ExtractImage: vision API returned ${status} → skipping`);
    return [];
  }

  const content = extractContent(bodyText);
  if (!content) return [];

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return []; }

  return toRowArray(parsed)
    .map(normalizeRow)
    .filter((r): r is FlexibleRow => r !== null);
}

async function pass2ExtractImageBatch(
  imageDataUrls: string[],
): Promise<FlexibleRow[]> {
  console.log(`[process-job] pass2ExtractImageBatch: fresh re-extraction (${imageDataUrls.length} page(s))...`);

  const content: unknown[] = imageDataUrls.map((url) => ({
    type: "image_url",
    image_url: { url, detail: "high" },
  }));

  content.push({
    type: "text",
    text: `${FLEXIBLE_PROMPT}

VERIFICATION PASS — ADDITIONAL INSTRUCTIONS:
- Treat this as an independent, fresh read across all pages provided. Do not assume anything about the document's structure before examining it.
- Read every table cell on every page character by character, digit by digit.
- For every row in every table: read all columns left to right as a unit before writing any value. Confirm each value belongs to the current row.
- Verify arithmetic where possible (e.g. quantity × unit price = line total). If the numbers do not agree, extract what the document states and add " [uncertain]" to the affected values.
- If any value is partially obscured, ambiguous, or difficult to read, extract your best reading and append " [uncertain]".
- Do not guess, interpolate, or infer any value. Only output what is explicitly visible.

${USER_SUFFIX.trim()}`,
  });

  const { status, bodyText } = await callGitHub([{ role: "user", content }]);

  if (status !== 200) {
    console.warn(`[process-job] pass2ExtractImageBatch: vision API returned ${status} → skipping`);
    return [];
  }

  const text = extractContent(bodyText);
  if (!text) return [];

  const cleaned = text.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { return []; }

  return toRowArray(parsed)
    .map(normalizeRow)
    .filter((r): r is FlexibleRow => r !== null);
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
        current_stage:    `Processing part ${groupIdx + 1} of ${totalGroups}...`,
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

  const cleaned   = clearDuplicateSummaryFields(rows);
  const validated = validateAndFlagRows(cleaned);
  const deduped   = dedupeRows(validated);

  // Surface validation warnings so callers are aware of flagged rows.
  const flaggedCount = deduped.filter((r) => r._validation_flags?.v).length;
  if (flaggedCount > 0) {
    warnings.push(
      `${flaggedCount} row(s) have validation flags — check the _validation_flags field for details.`
    );
  }

  await updateJob(jobId, {
    status:        "completed",
    output:        { rows: deduped, warnings },
    current_stage: warnings.length > 0 ? "Completed with warnings" : "Completed",
    progress:      100,
    eta_seconds:   0,
    completed_at:  new Date().toISOString(),
  });
}

// ── Image-pages batch processor ───────────────────────────────────────────────
const IMAGES_PER_BATCH = 4;

async function processImageBatch(
  imageDataUrls: string[],
  fileName: string,
  batchIndex: number,
  totalBatches: number,
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string; batchIndex: number }> {
  console.log(`[process-job] Image batch ${batchIndex + 1}/${totalBatches} (${imageDataUrls.length} page(s))`);

  const content: unknown[] = imageDataUrls.map((url) => ({
    type: "image_url",
    image_url: { url, detail: "high" },
  }));
  content.push({
    type: "text",
    text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}\nBatch ${batchIndex + 1}/${totalBatches}${USER_SUFFIX}`,
  });

  const result = await runGitHubWithRetry([{ role: "user", content }]);
  if (result.ok) {
    console.log(`[process-job] Image batch ${batchIndex + 1}/${totalBatches} ✓ — ${result.rows.length} row(s)`);
    return result;
  }
  return { ...result, batchIndex };
}

// ── Main job processor ────────────────────────────────────────────────────────
async function processJob(jobId: string, job: any) {
  const input = job.input as {
    kind: "text" | "image" | "image_pages";
    text?: string;
    imageDataUrl?: string;
    imageDataUrls?: string[];
    fileName: string;
  };

  const fileName  = input.fileName;
  const startedAt = Date.now();

  // ── Single image ─────────────────────────────────────────────────────────
  if (input.kind === "image") {
    await updateJob(jobId, {
      status:           "processing",
      started_at:       new Date().toISOString(),
      current_stage:    "Scanning document... (Pass 1)",
      progress:         20,
      total_chunks:     1,
      processed_chunks: 0,
      eta_seconds:      90,
    });

    const imageDataUrl = input.imageDataUrl ?? "";

    // Pass 1
    const pass1Result = await runGitHubWithRetry([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
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

    // Pass 2: fresh re-extraction
    await updateJob(jobId, {
      current_stage: "Verifying extracted data... (Pass 2)",
      progress:      55,
      eta_seconds:   45,
    });

    const pass2Rows = await pass2ExtractImage(imageDataUrl);

    // Merge
    await updateJob(jobId, {
      current_stage: "Finalizing results...",
      progress:      85,
      eta_seconds:   10,
    });

    const merged    = pass2Rows.length > 0 ? mergePassRows(pass1Result.rows, pass2Rows) : pass1Result.rows;
    const validated = validateAndFlagRows(merged);
    const deduped   = dedupeRows(clearDuplicateSummaryFields(validated));

    const flaggedCount = deduped.filter((r) => r._validation_flags?.v).length;
    const warnings     = flaggedCount > 0
      ? [`${flaggedCount} row(s) have validation flags — check the _validation_flags field for details.`]
      : [];

    await updateJob(jobId, {
      status:           "completed",
      output:           { rows: deduped, warnings },
      current_stage:    warnings.length > 0 ? "Completed with warnings" : "Completed",
      progress:         100,
      processed_chunks: 1,
      total_chunks:     1,
      eta_seconds:      0,
      completed_at:     new Date().toISOString(),
    });
    return;
  }

  // ── Multi-page images (PDF rendered as images) ────────────────────────────
  if (input.kind === "image_pages") {
    const pages = input.imageDataUrls ?? [];
    if (pages.length === 0) {
      await updateJob(jobId, {
        status:        "failed",
        error:         "No image pages provided.",
        current_stage: "Failed",
        completed_at:  new Date().toISOString(),
      });
      return;
    }

    const batches: string[][] = [];
    for (let i = 0; i < pages.length; i += IMAGES_PER_BATCH) {
      batches.push(pages.slice(i, i + IMAGES_PER_BATCH));
    }
    const totalBatches = batches.length;

    await updateJob(jobId, {
      status:           "processing",
      started_at:       new Date().toISOString(),
      current_stage:    `Scanning ${pages.length} page(s)...`,
      progress:         10,
      total_chunks:     totalBatches,
      processed_chunks: 0,
      eta_seconds:      totalBatches * 90,
    });

    const allRows: FlexibleRow[] = [];
    const warnings: string[]     = [];
    const heartbeat = setInterval(() => { void beat(jobId); }, 10_000);

    try {
      for (let i = 0; i < totalBatches; i++) {
        const batch = batches[i];

        // Pass 1
        await updateJob(jobId, {
          current_stage:    `Extracting data (part ${i + 1} of ${totalBatches})...`,
          progress:         clamp(Math.round(10 + (i / totalBatches) * 40), 10, 50),
          processed_chunks: i,
          eta_seconds:      (totalBatches - i) * 90,
        });

        const result = await processImageBatch(batch, fileName, i, totalBatches);

        if (result.ok) {
          // Pass 2: fresh re-extraction
          await updateJob(jobId, {
            current_stage: `Verifying data (part ${i + 1} of ${totalBatches})...`,
            progress:      clamp(Math.round(50 + (i / totalBatches) * 40), 50, 90),
          });

          const pass2Rows = await pass2ExtractImageBatch(batch);

          const finalRows = pass2Rows.length > 0
            ? mergePassRows(result.rows, pass2Rows)
            : result.rows;

          allRows.push(...finalRows);
        } else {
          warnings.push(`Part ${i + 1} failed: ${result.error}`);
        }

        if (i + 1 < totalBatches) await wait(BATCH_DELAY_MS);
      }
    } finally {
      clearInterval(heartbeat);
    }

    if (allRows.length === 0) {
      await updateJob(jobId, {
        status:        "failed",
        error:         warnings[0] ?? "Failed to extract data from image pages.",
        current_stage: "Failed",
        completed_at:  new Date().toISOString(),
      });
      return;
    }

    const validated    = validateAndFlagRows(allRows);
    const deduped      = dedupeRows(clearDuplicateSummaryFields(validated));
    const flaggedCount = deduped.filter((r) => r._validation_flags?.v).length;
    if (flaggedCount > 0) {
      warnings.push(
        `${flaggedCount} row(s) have validation flags — check the _validation_flags field for details.`
      );
    }

    await updateJob(jobId, {
      status:           "completed",
      output:           { rows: deduped, warnings },
      current_stage:    warnings.length > 0 ? "Completed with warnings" : "Completed",
      progress:         100,
      processed_chunks: totalBatches,
      total_chunks:     totalBatches,
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
    current_stage:    `Prepared ${batches.length} part(s) for processing`,
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
