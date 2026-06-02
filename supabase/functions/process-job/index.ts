// Background job processor for invoice/document extraction.
// Runs on Supabase Edge Functions (no Vercel timeout). It is triggered
// fire-and-forget by the app; it responds immediately and keeps working in
// the background via EdgeRuntime.waitUntil.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = (Deno.env.get("GITHUB_TOKEN") || "").trim();

const GITHUB_MODELS_API = "https://models.inference.ai.azure.com";
const TEXT_MODEL = "gpt-4o-mini";
const VISION_MODEL = "gpt-4o";
const TIMEOUT_MS = 300_000;
const MAX_TOKENS = 8000;
const CHUNK_SIZE = 8000;
const PARALLEL_LIMIT = 2;
const BATCH_DELAY_MS = 300;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Cell = { v: string; c: number };
type Row = {
  invoiceNumber: Cell;
  client: Cell;
  date: Cell;
  amount: Cell;
  tax: Cell;
  total: Cell;
};

const MINIMAL_PROMPT = `You are an invoice data extraction engine. Extract these 6 fields from the document:
- invoiceNumber (invoice/receipt number)
- client (customer/buyer name)
- date (invoice date, use YYYY-MM-DD if possible)
- amount (subtotal before tax, with currency)
- tax (tax/VAT amount, with currency, or "—" if absent)
- total (grand total with tax, with currency)

For each field, provide: {v: "exact value from document", c: confidence 0-100}
If field missing: {v: "—", c: 0}

IMPORTANT: If this chunk contains MULTIPLE invoices, extract ALL of them and return a JSON ARRAY.
Otherwise return a single JSON object.
Return ONLY valid JSON, no explanation.`;

const USER_SUFFIX = `\n\nIMPORTANT: Do not truncate any text, numbers, or company names. Copy every value exactly as it appears in the document, character by character.`;

// ── GitHub Models API call ───────────────────────────────────────────────
async function callGitHubModels(model: string, messages: unknown[]): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GITHUB_MODELS_API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ model, messages, temperature: 0.0, max_tokens: MAX_TOKENS }),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function isValidCell(x: unknown): x is Cell {
  return !!x && typeof x === "object" && typeof (x as Cell).v === "string" && typeof (x as Cell).c === "number";
}
function isValidRow(x: unknown): x is Row {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return ["invoiceNumber", "client", "date", "amount", "tax", "total"].every((k) => isValidCell(r[k]));
}

function parseResponse(status: number, bodyText: string): { ok: true; rows: Row[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;
  let json: any;
  try { json = JSON.parse(bodyText); } catch { return { ok: false, error: "GitHub Models returned invalid JSON." }; }
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  if (!content) return { ok: false, error: "GitHub Models returned empty response." };
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { return { ok: false, error: "AI returned an unparseable response." }; }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const rows = arr.filter(isValidRow) as Row[];
  if (rows.length === 0) return { ok: false, error: "AI response missing required fields." };
  return { ok: true, rows };
}

async function runWithRetry(model: string, messages: unknown[]): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGitHubModels(model, messages);
      if (status === 200) {
        const result = parseResponse(status, bodyText);
        return result ?? { ok: false, error: "Failed to parse response." };
      }
      console.error(`[process-job/${model}] GitHub ${status}:`, bodyText.slice(0, 300));
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

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length > 0 ? chunks : [""];
}

async function extractFromText(text: string, fileName: string): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  const chunks = chunkText(text, CHUNK_SIZE);
  const allRows: Row[] = [];
  for (let start = 0; start < chunks.length; start += PARALLEL_LIMIT) {
    const end = Math.min(start + PARALLEL_LIMIT, chunks.length);
    const batch = chunks.slice(start, end);
    const results = await Promise.all(
      batch.map((chunk, i) => {
        const prompt = `${MINIMAL_PROMPT}\n\nDocument: ${fileName}\nPart ${start + i + 1}/${chunks.length}\n\n---\n${chunk}${USER_SUFFIX}`;
        return runWithRetry(TEXT_MODEL, [{ role: "user", content: prompt }]);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.ok) allRows.push(...r.rows);
      else if (start + i === 0) return { ok: false, error: r.error };
    }
    if (end < chunks.length) await new Promise((res) => setTimeout(res, BATCH_DELAY_MS));
  }
  if (allRows.length === 0) return { ok: false, error: "Failed to extract data from any chunk." };
  return { ok: true, rows: allRows };
}

async function extractFromImage(imageDataUrl: string, fileName: string): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  const messages = [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: `${MINIMAL_PROMPT}\n\nDocument filename: ${fileName}\n\nExtract data from this document image. Return ONLY the JSON object or array if multiple invoices.${USER_SUFFIX}` },
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

    let result: { ok: true; rows: Row[] } | { ok: false; error: string };
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
    // Keep processing alive after the response is sent.
    // @ts-ignore EdgeRuntime is available in the Supabase runtime
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
