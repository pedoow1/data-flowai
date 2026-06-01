import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";

// ── API configuration ────────────────────────────────────────────────────────
// GitHub Models API (Free tier from GitHub)
// Text extraction: gpt-4o-mini (fast + accurate for text)
// Vision extraction: gpt-4o (best vision understanding)
const TEXT_MODEL = "gpt-4o-mini";      // Fast text extraction
const VISION_MODEL = "gpt-4o";         // Best vision model
const GITHUB_MODELS_API = "https://models.inference.ai.azure.com";
const TIMEOUT_MS = 300_000;  // 5 minutes for large documents
const MAX_TOKENS = 8000;   // 8000 tokens max for output (GitHub Models limit)
const CHUNK_SIZE = 8000;    // 8K chars per chunk for faster processing
const CHUNK_DELAY_MS = 1000;  // 1 second delay between chunks to respect Vercel timeout

async function assertWithinQuota(context: { supabase: unknown; userId: string; claims: { email: string | null } }) {
  const isAdminEmail =
    typeof context.claims?.email === "string" &&
    context.claims.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const usage = await getPlanAndUsage(context.supabase, context.userId, isAdminEmail);
  if (!usage.unlimited && usage.remaining <= 0) {
    return "Daily limit reached for your plan. Upgrade to extract more documents.";
  }
  return null;
}

// ── Shared schemas ─────────────────────────────────────────────────────────
const CellSchema = z.object({ v: z.string(), c: z.number().min(0).max(100) });
export const RowSchema = z.object({
  invoiceNumber: CellSchema,
  client:        CellSchema,
  date:          CellSchema,
  amount:        CellSchema,
  tax:           CellSchema,
  total:         CellSchema,
});

// Multi-row schema for extracting multiple invoices at once
export const MultiRowSchema = z.array(RowSchema);

const TextInputSchema = z.object({
  text:     z.string().min(1).max(5_000_000),
  fileName: z.string().min(1).max(255),
});

const ImageInputSchema = z.object({
  imageDataUrl: z.string().min(50).max(6_000_000),
  fileName:     z.string().min(1).max(255),
});

// ── System / user prompts ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a precise invoice and document data extraction engine.

Your task: Extract structured fields from the document and return ONLY valid JSON matching this exact TypeScript type:

type Row = {
  invoiceNumber: { v: string; c: number };
  client:        { v: string; c: number };
  date:          { v: string; c: number };
  amount:        { v: string; c: number };
  tax:           { v: string; c: number };
  total:         { v: string; c: number };
};

Extraction rules:
- "v" is the FULL exact string value as it appears in the document. NEVER truncate, shorten, abbreviate, or paraphrase any text, number, or company name.
- "c" is your confidence score 0-100 for that field.
- invoiceNumber: the invoice/receipt/order number (e.g. "INV-2024-00123").
- client: the full legal name of the buyer/customer/bill-to party exactly as written.
- date: the invoice date in ISO YYYY-MM-DD format when possible; otherwise copy the exact date string from the document.
- amount: the subtotal/net amount before tax, including the currency symbol if present (e.g. "$1,250.00").
- tax: the tax/VAT/GST amount including currency symbol if present; use "—" only if truly absent.
- total: the grand total including tax, including the currency symbol if present.
- If a field is genuinely not found in the document, set "v" to "—" and "c" to 0.
- Output ONLY the raw JSON object. No prose, no markdown, no code fences, no explanation.`;

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

// ── GitHub Models API helper ─────────────────────────────────────────────────
async function callGitHubModels(
  token: string,
  model: string,
  messages: any[],
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const res = await fetch(`${GITHUB_MODELS_API}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.0,
        max_tokens: MAX_TOKENS,
      }),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── Flexible response parser (handles both single row and array) ─────────────
function parseFlexibleResponse(
  status: number,
  bodyText: string,
  model: string,
): { ok: true; rows: Array<z.infer<typeof RowSchema>> } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  let json: any;
  try { json = JSON.parse(bodyText); }
  catch { return { ok: false, error: "GitHub Models returned invalid JSON." }; }

  const content: string = json?.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return { ok: false, error: "GitHub Models returned empty response." };
  }

  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch {
    console.error(`[extract/${model}] unparseable content:`, content.slice(0, 300));
    return { ok: false, error: "AI returned an unparseable response. Please retry." };
  }

  // Handle both single object and array
  let rows: Array<z.infer<typeof RowSchema>> = [];

  if (Array.isArray(parsed)) {
    // Response is already an array
    const validated = MultiRowSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(`[extract/${model}] array schema mismatch:`, JSON.stringify(validated.error.issues).slice(0, 300));
      return { ok: false, error: "AI response array missing required fields. Please retry." };
    }
    rows = validated.data;
  } else {
    // Response is a single object, wrap it
    const validated = RowSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(`[extract/${model}] schema mismatch:`, JSON.stringify(validated.error.issues).slice(0, 300));
      return { ok: false, error: "AI response missing required fields. Please retry." };
    }
    rows = [validated.data];
  }

  return { ok: true, rows };
}

// ── Retry wrapper ──────────────────────────────────────────────────────────
async function runWithRetry(
  token: string,
  model: string,
  messages: any[],
): Promise<{ ok: true; rows: Array<z.infer<typeof RowSchema>> } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGitHubModels(token, model, messages);

      if (status === 200) {
        const result = parseFlexibleResponse(status, bodyText, model);
        return result ?? { ok: false, error: "Failed to parse response." };
      }

      console.error(`[extract/${model}] GitHub ${status}:`, bodyText.slice(0, 400));

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
      if (status === 401 || status === 403) {
        return { ok: false, error: "GitHub Models authentication failed — check your GITHUB_TOKEN in Vercel." };
      }
      if (status === 404) {
        return { ok: false, error: `GitHub model not found: ${model}.` };
      }
      try {
        const parsed = JSON.parse(bodyText);
        const msg = parsed?.error?.message || parsed?.message;
        if (msg) return { ok: false, error: `GitHub: ${msg}` };
      } catch { /* plain text body */ }
      return { ok: false, error: `GitHub error (${status}): ${bodyText.slice(0, 200)}` };
    } catch (e: any) {
      const isAbort = e?.name === "AbortError";
      lastError = isAbort ? "Extraction timed out." : (e?.message ?? "Network error");
      console.error(`[extract/${model}] fetch failed:`, lastError);
      if (isAbort) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  return { ok: false, error: `${lastError} Please try again.` };
}

// ── Chunking helper ────────────────────────────────────────────────────────
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

// ── Merge results from multiple chunks ───────────────────────────────────────
// Takes highest confidence for each field across all chunks
function mergeResults(results: Array<z.infer<typeof RowSchema>>): z.infer<typeof RowSchema> {
  const merged: z.infer<typeof RowSchema> = {
    invoiceNumber: { v: "—", c: 0 },
    client:        { v: "—", c: 0 },
    date:          { v: "—", c: 0 },
    amount:        { v: "—", c: 0 },
    tax:           { v: "—", c: 0 },
    total:         { v: "—", c: 0 },
  };

  const fields = ["invoiceNumber", "client", "date", "amount", "tax", "total"] as const;

  for (const field of fields) {
    // Find result with highest confidence for this field
    let bestResult = merged[field];
    for (const result of results) {
      if (result[field].c > bestResult.c) {
        bestResult = result[field];
      }
    }
    merged[field] = bestResult;
  }

  return merged;
}

// ── Server function: text extraction (gpt-4o-mini) ─────
// Processes large documents in sequential 8K char chunks with minimal prompt
// Each chunk may contain multiple invoices - model extracts all
export const extractFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TextInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing GITHUB_TOKEN)." };

    if (data.text.length < 20) {
      return { ok: false as const, error: "__NEEDS_VISION__" };
    }

    // Split into 8K char chunks for faster processing
    const chunks = chunkText(data.text, CHUNK_SIZE);
    console.log(`[extract] Processing ${chunks.length} chunk(s) for: ${data.fileName}`);

    const allResults: Array<z.infer<typeof RowSchema>> = [];

    // Process each chunk sequentially with minimal prompt to save tokens
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[extract] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);

      const chunkPrompt = `${MINIMAL_PROMPT}\n\nDocument: ${data.fileName}\nPart ${i + 1}/${chunks.length}\n\n---\n${chunk}${USER_SUFFIX}`;

      const messages = [
        {
          role: "user",
          content: chunkPrompt,
        },
      ];

      const result = await runWithRetry(token, TEXT_MODEL, messages);
      
      if (result.ok) {
        allResults.push(...result.rows);
        console.log(`[extract] Chunk ${i + 1}: extracted ${result.rows.length} invoice(s)`);
      } else {
        // If any chunk fails significantly, return error
        console.error(`[extract] Chunk ${i + 1} failed: ${result.error}`);
        if (i === 0) {
          // First chunk is critical
          return { ok: false as const, error: result.error };
        }
        // For subsequent chunks, continue with what we have
      }

      // Delay between chunks to respect Vercel timeout (except after last chunk)
      if (i < chunks.length - 1) {
        console.log(`[extract] Waiting ${CHUNK_DELAY_MS}ms before next chunk...`);
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      }
    }

    if (allResults.length === 0) {
      return { ok: false as const, error: "Failed to extract data from any chunk." };
    }

    console.log(`[extract] Successfully processed all ${chunks.length} chunk(s), extracted ${allResults.length} total invoice(s)`);
    
    // Return single row if only one, or rows array if multiple
    if (allResults.length === 1) {
      return { ok: true as const, row: allResults[0] };
    } else {
      return { ok: true as const, rows: allResults };
    }
  });

// ── Server function: vision extraction (gpt-4o) ────
export const extractFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImageInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing GITHUB_TOKEN)." };

    const messages = [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: data.imageDataUrl,
            },
          },
          {
            type: "text",
            text: `${MINIMAL_PROMPT}\n\nDocument filename: ${data.fileName}\n\nExtract data from this document image. Return ONLY the JSON object or array if multiple invoices.${USER_SUFFIX}`,
          },
        ],
      },
    ];

    const result = await runWithRetry(token, VISION_MODEL, messages);
    
    if (result.ok) {
      // For images, typically single invoice
      if (result.rows.length === 1) {
        return { ok: true as const, row: result.rows[0] };
      } else {
        return { ok: true as const, rows: result.rows };
      }
    } else {
      return result;
    }
  });
