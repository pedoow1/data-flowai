import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";
import { FlexibleRowSchema, FlexibleMultiRowSchema, normalizeRow } from "./flexible-schema";

// ── API configuration ────────────────────────────────────────────────────────
const TEXT_MODEL   = "mistral-small-2506";
const VISION_MODEL = "pixtral-12b-2409";
const MISTRAL_API  = "https://api.mistral.ai/v1/chat/completions";
const TIMEOUT_MS   = 90_000;
const MAX_TOKENS   = 16_000;
const CHUNK_SIZE   = 12_000;

// Mistral paid tier: 500 RPM — sequential مع delay بسيط
const SEQUENTIAL_DELAY_MS = 1_500; // 1.5 ثانية بين كل chunk = max 40 RPM آمنة

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
export type FlexibleRow = z.infer<typeof FlexibleRowSchema>;
export const MultiRowSchema = z.array(FlexibleRowSchema);

const TextInputSchema = z.object({
  text:     z.string().min(1).max(5_000_000),
  fileName: z.string().min(1).max(255),
});

const ImageInputSchema = z.object({
  imageDataUrl: z.string().min(50).max(6_000_000),
  fileName:     z.string().min(1).max(255),
});

// ── FLEXIBLE PROMPT ──────────────────────────────────────────────────────────
const FLEXIBLE_PROMPT = `You are a precision invoice and document data extraction engine.

Your task: Extract ALL structured fields from the document and return ONLY valid JSON.

For each invoice found, return an object with these fields (include as many as are present):
- invoiceNumber: the invoice/receipt/order/transaction number
- client OR vendor OR billTo OR seller: the company/person name
- date OR invoiceDate: the date (ISO YYYY-MM-DD if possible)
- amount OR subtotal OR netAmount: subtotal before tax
- tax OR vat OR gst: tax amount (or "—" if absent)
- total OR grandTotal: final amount with tax
- dueDate (if present)
- reference OR poNumber OR orderNumber (if present)
- description OR items (if present)
- paymentTerms (if present)
- notes (if present)

For EACH field:
- "v": the EXACT value from the document (never truncate, abbreviate, or paraphrase)
- "c": confidence score 0-100

If a field is missing: don't include it (don't use "—" as placeholder unless it explicitly appears).

CRITICAL RULES:
- Extract ALL invoices in the document (return JSON ARRAY if multiple, single OBJECT if one)
- Never lose data due to missing fields
- Copy numbers/dates/company names EXACTLY as they appear
- If this chunk has multiple invoices, extract ALL
- Return ONLY valid JSON, no prose, no markdown, no code fences`;

const USER_SUFFIX = `\n\nIMPORTANT: Do not truncate any text, numbers, or company names. Copy every value exactly as it appears in the document, character by character. Extract ALL invoices present, even if some fields are missing.`;

// ── Mistral API helper ────────────────────────────────────────────────────────
async function callMistral(
  token: string,
  model: string,
  messages: any[],
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(MISTRAL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── Flexible response parser ────────────────────────────────────────────────
function parseFlexibleResponse(
  status: number,
  bodyText: string,
  model: string,
): { ok: true; rows: FlexibleRow[] } | { ok: false; error: string } | null {
  if (status !== 200) return null;

  let json: any;
  try { json = JSON.parse(bodyText); }
  catch { return { ok: false, error: "Mistral returned invalid JSON." }; }

  // Mistral response shape: choices[0].message.content
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  if (!content) {
    return { ok: false, error: "Mistral returned empty response." };
  }

  const cleaned = content.trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch {
    console.error(`[extract/${model}] unparseable content:`, content.slice(0, 300));
    return { ok: false, error: "AI returned an unparseable response. Please retry." };
  }

  let rows: FlexibleRow[] = [];

  if (Array.isArray(parsed)) {
    const validated = MultiRowSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(`[extract/${model}] array schema mismatch:`, JSON.stringify(validated.error.issues).slice(0, 300));
      return { ok: false, error: "AI response array has invalid structure. Please retry." };
    }
    rows = validated.data.map(normalizeRow);
  } else {
    const validated = FlexibleRowSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(`[extract/${model}] schema mismatch:`, JSON.stringify(validated.error.issues).slice(0, 300));
      return { ok: false, error: "AI response has invalid structure. Please retry." };
    }
    rows = [normalizeRow(validated.data)];
  }

  return { ok: true, rows };
}

// ── Retry wrapper with exponential backoff ─────────────────────────────────
async function runWithRetry(
  token: string,
  model: string,
  messages: any[],
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { status, bodyText } = await callMistral(token, model, messages);

      if (status === 200) {
        const result = parseFlexibleResponse(status, bodyText, model);
        return result ?? { ok: false, error: "Failed to parse response." };
      }

      console.error(`[extract/${model}] Mistral ${status}:`, bodyText.slice(0, 400));

      if (status === 429) {
        lastError = "Mistral rate limit reached.";
        const waitMs = 10_000 * attempt; // 10s, 20s, 30s, 40s
        console.log(`[extract] Rate limited, waiting ${waitMs}ms before retry ${attempt}...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if ([502, 503, 504, 524].includes(status)) {
        lastError = "Mistral is temporarily unavailable.";
        await new Promise((r) => setTimeout(r, 4_000 * attempt));
        continue;
      }

      if (status === 401 || status === 403) {
        return { ok: false, error: "Mistral authentication failed — check your MISTRAL_API_KEY." };
      }

      if (status === 404) {
        return { ok: false, error: `Mistral model not found: ${model}.` };
      }

      try {
        const parsed = JSON.parse(bodyText);
        const msg = parsed?.error?.message || parsed?.message;
        if (msg) return { ok: false, error: `Mistral: ${msg}` };
      } catch { /* plain text body */ }

      return { ok: false, error: `Mistral error (${status}): ${bodyText.slice(0, 200)}` };
    } catch (e: any) {
      const isAbort = e?.name === "AbortError";
      lastError = isAbort ? "Extraction timed out." : (e?.message ?? "Network error");
      console.error(`[extract/${model}] fetch failed:`, lastError);
      if (isAbort) await new Promise((r) => setTimeout(r, 3_000 * attempt));
      else         await new Promise((r) => setTimeout(r, 2_000 * attempt));
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

// ── Process single chunk ──────────────────────────────────────────────────
async function processChunk(
  token: string,
  model: string,
  chunk: string,
  fileName: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  console.log(`[extract] Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} chars)`);

  const chunkPrompt = `${FLEXIBLE_PROMPT}\n\nDocument: ${fileName}\nPart ${chunkIndex + 1}/${totalChunks}\n\n---\n${chunk}${USER_SUFFIX}`;

  return runWithRetry(token, model, [{ role: "user", content: chunkPrompt }]);
}

// ── Server function: text extraction ────────────────────────────────────────
export const extractFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TextInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    const token = (process.env.MISTRAL_API_KEY || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing MISTRAL_API_KEY)." };

    if (data.text.length < 20) {
      return { ok: false as const, error: "__NEEDS_VISION__" };
    }

    const chunks = chunkText(data.text, CHUNK_SIZE);
    console.log(`[extract] Processing ${chunks.length} chunk(s) SEQUENTIALLY for: ${data.fileName}`);

    const allResults: FlexibleRow[] = [];
    const startTime = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      const result = await processChunk(token, TEXT_MODEL, chunks[i], data.fileName, i, chunks.length);

      if (result.ok) {
        allResults.push(...result.rows);
        console.log(`[extract] Chunk ${i + 1}/${chunks.length}: extracted ${result.rows.length} invoice(s)`);
      } else {
        console.error(`[extract] Chunk ${i + 1} failed: ${result.error}`);
        if (i === 0) {
          return { ok: false as const, error: result.error };
        }
      }

      if (i < chunks.length - 1) {
        console.log(`[extract] Waiting ${SEQUENTIAL_DELAY_MS}ms before next chunk...`);
        await new Promise((resolve) => setTimeout(resolve, SEQUENTIAL_DELAY_MS));
      }
    }

    if (allResults.length === 0) {
      return { ok: false as const, error: "Failed to extract data from any chunk." };
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[extract] Done: ${chunks.length} chunk(s) in ${elapsedTime}ms, ${allResults.length} total invoice(s)`);

    return { ok: true as const, rows: allResults };
  });

// ── Server function: vision extraction ──────────────────────────────────────
export const extractFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImageInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    const token = (process.env.MISTRAL_API_KEY || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing MISTRAL_API_KEY)." };

    // Mistral vision: image_url مدعوم في pixtral
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
            text: `${FLEXIBLE_PROMPT}\n\nDocument filename: ${data.fileName}\n\nExtract data from this document image. Return ONLY the JSON object or array if multiple invoices.${USER_SUFFIX}`,
          },
        ],
      },
    ];

    const result = await runWithRetry(token, VISION_MODEL, messages);

    if (result.ok) {
      return { ok: true as const, rows: result.rows };
    } else {
      return result;
    }
  });
