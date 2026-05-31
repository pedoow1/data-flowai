import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";

// ── API configuration ────────────────────────────────────────────────────────
// GitHub Models API (Free tier from GitHub)
// Text extraction: gpt-4o-mini (max 16,384 completion tokens)
// Vision extraction: gpt-4o (max 16,384 completion tokens)
const TEXT_MODEL = "gpt-4o-mini";              // max 16,384 tokens output
const VISION_MODEL = "gpt-4o";                 // max 16,384 tokens output
const GITHUB_MODELS_API = "https://models.inference.ai.azure.com";
const TIMEOUT_MS = 300_000;  // 5 minutes for large documents
const MAX_COMPLETION_TOKENS = 16384;           // Model's actual limit

// Safe limits to avoid hitting token limits
// Estimate input tokens conservatively (1 token ≈ 4 chars)
// Reserve budget for response, use ~60% of input budget
const SAFE_REQUEST_SIZE = 50_000;  // ~12.5K tokens input (conservative)
const CHUNK_OVERLAP = 2_000;  // Character overlap between chunks for context continuity

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

const TextInputSchema = z.object({
  text:     z.string().min(1).max(6_000_000),
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

const MINIMAL_PROMPT = `Extract invoice data. Return ONLY valid JSON with fields: invoiceNumber, client, date, amount, tax, total. Each field has "v" (value) and "c" (confidence 0-100). If not found, use "v": "—" and "c": 0.`;

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
        temperature: 0.0,  // Deterministic output (no top_p with temperature 0)
        max_tokens: MAX_COMPLETION_TOKENS,  // Respect model's actual limit
      }),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── Response parser for GitHub Models ─────────────────────────────────────────
function parseGitHubResponse(
  status: number,
  bodyText: string,
  model: string,
): { ok: true; row: z.infer<typeof RowSchema> } | { ok: false; error: string } | null {
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

  const validated = RowSchema.safeParse(parsed);
  if (!validated.success) {
    console.error(`[extract/${model}] schema mismatch:`, JSON.stringify(validated.error.issues).slice(0, 300));
    return { ok: false, error: "AI response missing required fields. Please retry." };
  }
  return { ok: true, row: validated.data };
}

// ── Merge results from multiple chunk extractions ─────────────────────────────
function mergeChunkResults(results: Array<{ ok: true; row: z.infer<typeof RowSchema> }>): z.infer<typeof RowSchema> {
  if (results.length === 0) {
    return {
      invoiceNumber: { v: "—", c: 0 },
      client: { v: "—", c: 0 },
      date: { v: "—", c: 0 },
      amount: { v: "—", c: 0 },
      tax: { v: "—", c: 0 },
      total: { v: "—", c: 0 },
    };
  }

  if (results.length === 1) {
    return results[0].row;
  }

  // For multiple chunks, prefer higher confidence scores and non-empty values
  const merge = (values: Array<{ v: string; c: number }>): { v: string; c: number } => {
    // Filter out placeholder "—" values and empty strings
    const meaningful = values.filter(x => x.v !== "—" && x.v.trim() !== "");
    
    if (meaningful.length === 0) {
      return { v: "—", c: 0 };
    }

    // Sort by confidence score descending
    meaningful.sort((a, b) => b.c - a.c);
    
    // Return the highest confidence result
    return meaningful[0];
  };

  return {
    invoiceNumber: merge(results.map(r => r.row.invoiceNumber)),
    client: merge(results.map(r => r.row.client)),
    date: merge(results.map(r => r.row.date)),
    amount: merge(results.map(r => r.row.amount)),
    tax: merge(results.map(r => r.row.tax)),
    total: merge(results.map(r => r.row.total)),
  };
}

// ── Retry wrapper for GitHub Models ──────────────────────────────────────────
async function runWithRetry(
  token: string,
  model: string,
  messages: any[],
): Promise<{ ok: true; row: z.infer<typeof RowSchema> } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGitHubModels(token, model, messages);

      if (status === 200) {
        const result = parseGitHubResponse(status, bodyText, model);
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

// ── Chunking helper with overlap for context continuity ───────────────────────
function chunkTextWithOverlap(text: string, chunkSize: number, overlap: number): Array<{ text: string; chunkNum: number; totalChunks: number }> {
  const chunks: Array<{ text: string; chunkNum: number; totalChunks: number }> = [];
  
  if (text.length <= chunkSize) {
    return [{ text, chunkNum: 1, totalChunks: 1 }];
  }

  let pos = 0;
  let chunkCount = 0;
  
  // Calculate total chunks first
  const totalChunks = Math.ceil((text.length - overlap) / (chunkSize - overlap));

  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    const chunkText = text.slice(pos, end);
    chunkCount++;

    chunks.push({
      text: chunkText,
      chunkNum: chunkCount,
      totalChunks,
    });

    // Move position forward with overlap for next iteration
    pos = end - overlap;

    // Ensure we don't get stuck at the end
    if (pos >= text.length) break;
  }

  return chunks;
}

// ── Process multiple chunks and merge results ────────────────────────────────
async function processTextInChunks(
  token: string,
  model: string,
  fullText: string,
  fileName: string,
): Promise<{ ok: true; row: z.infer<typeof RowSchema> } | { ok: false; error: string }> {
  const chunks = chunkTextWithOverlap(fullText, SAFE_REQUEST_SIZE, CHUNK_OVERLAP);

  if (chunks.length === 1) {
    // Single chunk - process normally with full prompt
    const messages = [
      {
        role: "user",
        content: `${SYSTEM_PROMPT}\n\nDocument filename: ${fileName}\n\n---\n${chunks[0].text}${USER_SUFFIX}`,
      },
    ];
    return runWithRetry(token, model, messages);
  }

  // Multiple chunks - use minimal prompt to save tokens
  const results: Array<{ ok: true; row: z.infer<typeof RowSchema> }> = [];
  let consecutiveFailures = 0;
  const maxFailures = 2;

  console.log(`[extract] Processing ${chunks.length} chunks for document: ${fileName} (${fullText.length} chars)`);

  for (const chunk of chunks) {
    const chunkPrompt = `${MINIMAL_PROMPT}

Document filename: ${fileName}
[Chunk ${chunk.chunkNum}/${chunk.totalChunks}]

${chunk.chunkNum === 1 ? "This is the BEGINNING of the document." : ""}
${chunk.chunkNum === chunk.totalChunks ? "This is the END of the document." : ""}

---
${chunk.text}
${USER_SUFFIX}`;

    const messages = [
      {
        role: "user",
        content: chunkPrompt,
      },
    ];

    const chunkResult = await runWithRetry(token, model, messages);

    if (!chunkResult.ok) {
      console.warn(`[extract] Chunk ${chunk.chunkNum}/${chunk.totalChunks} failed:`, chunkResult.error);
      consecutiveFailures++;

      if (consecutiveFailures >= maxFailures) {
        return { ok: false, error: `Processing failed on chunk ${chunk.chunkNum}. ${chunkResult.error}` };
      }

      // Continue with next chunk
      continue;
    }

    consecutiveFailures = 0; // Reset on success
    results.push(chunkResult as { ok: true; row: z.infer<typeof RowSchema> });
    
    console.log(`[extract] Chunk ${chunk.chunkNum}/${chunk.totalChunks} completed successfully`);

    // Add small delay between chunks to respect rate limits
    if (chunk.chunkNum < chunk.totalChunks) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (results.length === 0) {
    return { ok: false, error: "Failed to process any chunks of the document." };
  }

  // Merge all successful chunk results
  const mergedRow = mergeChunkResults(results);
  console.log(`[extract] Merged ${results.length}/${chunks.length} chunk results for ${fileName}`);

  return { ok: true, row: mergedRow };
}

// ── Server function: text extraction (gpt-4o-mini - 16384 tokens limit) ─────
// Automatically chunks large documents and merges results for safety
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

    try {
      // Automatic chunking + merge for any text larger than safe request size
      return await processTextInChunks(token, TEXT_MODEL, data.text, data.fileName);
    } catch (error: any) {
      console.error("[extract] Unexpected error during text extraction:", error);
      return { 
        ok: false as const, 
        error: error?.message || "An unexpected error occurred during extraction. Please try again." 
      };
    }
  });

// ── Server function: vision extraction (gpt-4o - 16384 tokens limit) ────
// Best for complex document images with high extraction accuracy + reasoning
export const extractFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImageInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing GITHUB_TOKEN)." };

    try {
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
              text: `${SYSTEM_PROMPT}\n\nDocument filename: ${data.fileName}\n\nExtract all relevant fields from this document image and return ONLY the JSON object.${USER_SUFFIX}`,
            },
          ],
        },
      ];

      return await runWithRetry(token, VISION_MODEL, messages);
    } catch (error: any) {
      console.error("[extract] Unexpected error during image extraction:", error);
      return { 
        ok: false as const, 
        error: error?.message || "An unexpected error occurred during extraction. Please try again." 
      };
    }
  });
