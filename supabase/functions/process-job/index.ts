import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = (Deno.env.get("GOOGLE_API_KEY") || "").trim();
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models";
const TEXT_MODEL = "gemini-3.5-flash";
const VISION_MODEL = "gemini-3.5-flash";
const MAX_TOKENS = 250000;
const CHUNK_SIZE = 20000;
const CHUNK_OVERLAP = 500;
const PARALLEL_LIMIT = 10;      // ← غيّره لـ 8
const BATCH_DELAY_MS = 500;    // ← غيّره لـ 100
const TIMEOUT_MS = 1800000; // ✅ تم إضافة المتغير هنا لمنع ضرب الـ ReferenceError

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Cell = { v: string; c: number };
type FlexibleRow = Record<string, Cell>;

const FLEXIBLE_PROMPT = `You are an elite invoice data extraction agent. Your job is to extract every line item as a separate row.

CRITICAL RULES:
1. LINE ITEM SPLITTING: Every invoice may contain multiple line items (services, products). You MUST create a SEPARATE row for each line item. Never merge multiple items into one row.
2. For each line item row, duplicate the invoice metadata: invoice_number, client, date, dueDate, vendor.
3. Each row must contain: invoice_number, client, date, dueDate, vendor, description, amount, quantity (if present), reference_id (if present).
4. After all line item rows for an invoice, add one final summary row with description="TOTAL" and amount=the grand total of that invoice.
5. Extract ALL invoices, ALL pages, ALL line items. Never skip or drop any.
6. If invoice numbers are sequential (e.g. INV-001 to INV-100), make sure ALL numbers are present with no gaps.
7. Copy every value EXACTLY as it appears — never truncate, round, or reformat.
8. Return ONLY a valid JSON array, no prose, no markdown, no code fences.

EXAMPLE: An invoice with 3 services → 3 line item rows + 1 TOTAL row = 4 rows total, all with the same invoice_number/client/date.`;

const USER_SUFFIX = `\n\nReturn a JSON ARRAY. Extract EVERY line item as a separate row, plus a TOTAL summary row per invoice. Do not drop rows, do not invent fields, copy values character-by-character.`;

async function callGoogleAI(model: string, messages: unknown[]): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
    const res = await fetch(
      `${GOOGLE_API}/${model}:generateContent?key=${GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.0, maxOutputTokens: MAX_TOKENS },
        }),
      }
    );
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
} // ✅ تم تنظيف وحذف الأقواس الزائدة المكسورة من هنا بالظبط ليعمل الـ Compile بنجاح

function isValidCell(x: unknown): x is Cell {
  return !!x && typeof x === "object" && typeof (x as Cell).v === "string" && typeof (x as Cell).c === "number";
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
  "invoice": "invoiceNumber", "invoicenumber": "invoiceNumber", "invoiceno": "invoiceNumber",
  "invoice_number": "invoiceNumber", "receipt number": "invoiceNumber", "order number": "invoiceNumber",
  "receipt": "invoiceNumber", "receipt no": "invoiceNumber", "order no": "invoiceNumber",
  "bill number": "invoiceNumber", "doc number": "invoiceNumber",
  "client": "client", "customer": "client", "bill to": "client", "billto": "client", "billed to": "client",
  "buyer": "client", "client name": "client", "customer name": "client", "company": "client", "account": "client", "to": "client",
  "vendor": "vendor", "seller": "vendor", "supplier": "vendor", "from": "vendor",
  "date": "date", "invoice date": "date", "issue date": "date", "issued": "date",
  "due date": "dueDate", "duedate": "dueDate", "payment due": "dueDate",
  "amount": "amount", "subtotal": "amount", "sub total": "amount", "net amount": "amount", "net": "amount",
  "tax": "tax", "vat": "tax", "gst": "tax", "tax amount": "tax", "sales tax": "tax",
  "total": "total", "grand total": "total", "amount due": "total", "total amount": "total", "balance due": "total",
  "po number": "poNumber", "po": "poNumber", "purchase order": "poNumber",
  "reference": "reference", "ref": "reference", "reference_id": "reference",
  "description": "description", "items": "description", "item": "description",
  "quantity": "quantity", "qty": "quantity",
  "unit price": "unitPrice", "price": "unitPrice", "rate": "unitPrice",
  "payment terms": "paymentTerms", "terms": "paymentTerms",
  "currency": "currency", "status": "status", "notes": "notes", "note": "notes",
};

function canonKey(k: string): string {
  const norm = k.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (CANON[norm]) return CANON[norm];
  if (CANON[norm.replace(/\s+/g, "")]) return CANON[norm.replace(/\s+/g, "")];
  return k.trim();
}

function normalizeRow(x: unknown): FlexibleRow | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const out: FlexibleRow = {};
  for (const k of Object.keys(o)) {
    const cell = toCell(o[k]);
    if (!cell || !cell.v || cell.v === "—") continue;
    const key = canonKey(k);
    if (!out[key]) out[key] = cell;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toRowArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    for (const key of ["invoices", "rows", "records", "data", "results", "items", "documents"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
    return [parsed];
  }
  return [];
}

function rowSig(r: FlexibleRow): string {
  const inv = r.invoiceNumber?.v?.trim().toLowerCase();
  const desc = r.description?.v?.trim().toLowerCase();
  if (inv && desc) return `inv:${inv}|desc:${desc}`;
  if (inv) return "inv:" + inv;
  return "all:" + Object.entries(r).map(([k, c]) => `${k}=${c.v}`).sort().join("|").toLowerCase();
}

function dedupeRows(rows: FlexibleRow[]): FlexibleRow[] {
  const seen = new Set<string>();
  const out: FlexibleRow[] = [];
  for (const r of rows) {
    const sig = rowSig(r);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  return out;
}

function parseResponse(status: number, bodyText: string): { ok: true; rows: FlexibleRow[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;
  let json: any;
  try { json = JSON.parse(bodyText); } catch { return { ok: false, error: "GitHub Models returned invalid JSON." }; }
  const content: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!content) return { ok: false, error: "Google AI returned empty response." };
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { return { ok: false, error: "AI returned an unparseable response." }; }
  const rows = toRowArray(parsed).map(normalizeRow).filter((r): r is FlexibleRow => r !== null);
  if (rows.length === 0) return { ok: false, error: "AI response missing data. Please retry." };
  return { ok: true, rows };
}

async function runWithRetry(model: string, messages: unknown[]): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGoogleAI(model, messages);
      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse response." };
      }
      if (status === 503 || status === 502 || status === 524) {
        lastError = "GitHub Models is temporarily unavailable.";
        await new Promise((r) => setTimeout(r, 5_000 * attempt));
        continue;
      }
      if (status === 429) {
        lastError = "GitHub Models rate limit reached.";
        await new Promise((r) => setTimeout(r, 10_000 * attempt));
        continue;
      }
      if (status === 401 || status === 403) return { ok: false, error: "GitHub Models authentication failed — check GITHUB_TOKEN." };
      if (status === 404) return { ok: false, error: `GitHub model not found: ${model}.` };
      return { ok: false, error: `GitHub error (${status}).` };
    } catch (e: any) {
      const isAbort = e?.name === "AbortError";
      lastError = isAbort ? "Extraction timed out." : (e?.message ?? "Network error");
      if (isAbort) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return { ok: false, error: `${lastError} Please try again.` };
}

function chunkText(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < text.length; i += step) chunks.push(text.slice(i, i + size));
  return chunks.length > 0 ? chunks : [""];
}

async function extractFromText(text: string, fileName: string): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
  const allRows: FlexibleRow[] = [];
  let firstError: string | null = null;
  for (let start = 0; start < chunks.length; start += PARALLEL_LIMIT) {
    const end = Math.min(start + PARALLEL_LIMIT, chunks.length);
    const batch = chunks.slice(start, end);
    const results = await Promise.all(
      batch.map((chunk, i) => {
        const prompt = `${FLEXIBLE_PROMPT}\n\nDocument: ${fileName}\nPart ${start + i + 1}/${chunks.length}\n\n---\n${chunk}${USER_SUFFIX}`;
        return runWithRetry(TEXT_MODEL, [{ role: "user", content: prompt }]);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.ok) allRows.push(...r.rows);
      else if (firstError === null) firstError = r.error;
    }
    if (end < chunks.length) await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
  }
  if (allRows.length === 0) return { ok: false, error: firstError ?? "Failed to extract data from any chunk." };
  return { ok: true, rows: dedupeRows(allRows) };
}

async function extractFromImage(imageDataUrl: string, fileName: string): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${fileName}\n\nExtract ALL line items as separate rows.${USER_SUFFIX}` },
      ],
    },
  ];
  return runWithRetry(VISION_MODEL, messages);
}

async function processJob(jobId: string) {
  try {
    const { data: job, error } = await admin.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) throw new Error("Job not found");

    await admin.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId);

    const input = job.input as { kind: "text" | "image"; text?: string; imageDataUrl?: string; fileName: string };

    let result: { ok: true; rows: FlexibleRow[] } | { ok: false; error: string };
    if (input.kind === "image") {
      if (!input.imageDataUrl) throw new Error("No image provided");
      result = await extractFromImage(input.imageDataUrl, input.fileName);
    } else {
      if (!input.text) throw new Error("No text provided");
      result = await extractFromText(input.text, input.fileName);
    }

    if (result.ok) {
      await admin.from("jobs").update({
        status: "completed",
        output: { rows: result.rows },
        error: null,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    } else {
      await admin.from("jobs").update({
        status: "failed",
        error: result.error,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    }
  } catch (e) {
    await admin.from("jobs").update({
      status: "failed",
      error: e instanceof Error ? e.message : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
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
    // @ts-ignore
    EdgeRuntime.waitUntil(processJob(jobId));
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
