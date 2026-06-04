import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";
import { FlexibleRowSchema, FlexibleMultiRowSchema, normalizeRow } from "./flexible-schema";

// ── API configuration ────────────────────────────────────────────────────────
const TEXT_MODEL = "gemini-3.5-flash";
const VISION_MODEL = "gemini-3.5-flash";
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 1800000;
const MAX_TOKENS = 250000;
const CHUNK_SIZE = 20000;
const PARALLEL_LIMIT = 5;
const BATCH_DELAY_MS = 500;

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

// ── Google Gemini API helper ─────────────────────────────────────────────────
async function callGoogleAI(
  token: string,
  model: string,
  messages: any[],
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const contents = messages.map((msg: any) => {
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
      `${GOOGLE_API}/${model}:generateContent?key=${token}`,
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
  catch { return { ok: false, error: "Google AI returned invalid JSON." }; }

  const content: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!content) {
    return { ok: false, error: "Google AI returned empty response." };
  }

  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

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

// ── Retry wrapper ─────────────────────────────────────────────────────────
async function runWithRetry(
  token: string,
  model: string,
  messages: any[],
): Promise<{ ok: true; rows: FlexibleRow[] } | { ok: false; error: string }> {
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGoogleAI(token, model, messages);

      if (status === 200) {
        const result = parseFlexibleResponse(status, bodyText, model);
        return result ?? { ok: false, error: "Failed to parse response." };
      }

      console.error(`[extract/${model}] Google AI ${status}:`, bodyText.slice(0, 400));

      // ✅ تم تصحيح الـ Block المكسور بالكامل هنا ليعمل الـ Compile بنجاح
      if (status === 503 || status === 502 || status === 524) {
        lastError = "Google AI is temporarily unavailable.";
        await new Promise((r) => setTimeout(r, 4000 * attempt));
        continue;
      } else if (status === 429) {
        lastError = "Google AI rate limit reached.";
        await new Promise((r) => setTimeout(r, 8000 * attempt));
        continue;
      } else if (status === 401 || status === 403) {
        return { ok: false, error: "Google AI authentication failed — check your GOOGLE_API_KEY in Vercel." };
      } else if (status === 404) {
        return { ok: false, error: `Google AI model not found: ${model}.` };
      }

      try {
        const parsed = JSON.parse(bodyText);
        const msg = parsed?.error?.message || parsed?.message;
        if (msg) return { ok: false, error: `Google AI: ${msg}` };
      } catch { /* plain text body */ }

      return { ok: false, error: `Google AI error (${status}): ${bodyText.slice(0, 200)}` };
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

// ── Process single chunk (helper) ──────────────────────────────────────────
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

  const messages = [
    {
      role: "user",
      content: chunkPrompt,
    },
  ];

  return runWithRetry(token, model, messages);
}

// ── Server function: text extraction ────────────────────────────────────────
export const extractFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TextInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    // ✅ تم تصحيح الـ Token هنا ليسحب من مفتاح جوجل المناسب للـ URL
    const token = (process.env.GOOGLE_API_KEY || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing GOOGLE_API_KEY)." };

    if (data.text.length < 20) {
      return { ok: false as const, error: "__NEEDS_VISION__" };
    }

    const chunks = chunkText(data.text, CHUNK_SIZE);
    console.log(`[extract] Processing ${chunks.length} chunk(s) for: ${data.fileName} with parallel limit of ${PARALLEL_LIMIT}`);

    const allResults: FlexibleRow[] = [];
    const startTime = Date.now();

    for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_LIMIT) {
      const batchEnd = Math.min(batchStart + PARALLEL_LIMIT, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);

      console.log(`[extract] Processing parallel batch: chunks ${batchStart + 1} to ${batchEnd}/${chunks.length}`);

      const batchPromises = batchChunks.map((chunk, batchIndex) =>
        processChunk(token, TEXT_MODEL, chunk, data.fileName, batchStart + batchIndex, chunks.length)
      );

      const batchResults = await Promise.all(batchPromises);

      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        if (result.ok) {
          allResults.push(...result.rows);
          console.log(`[extract] Chunk ${batchStart + i + 1}: extracted ${result.rows.length} invoice(s)`);
        } else {
          console.error(`[extract] Chunk ${batchStart + i + 1} failed: ${result.error}`);
          if (batchStart + i === 0) {
            return { ok: false as const, error: result.error };
          }
        }
      }

      if (batchEnd < chunks.length) {
        console.log(`[extract] Waiting ${BATCH_DELAY_MS}ms before next parallel batch...`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    if (allResults.length === 0) {
      return { ok: false as const, error: "Failed to extract data from any chunk." };
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[extract] Successfully processed all ${chunks.length} chunk(s) in ${elapsedTime}ms, extracted ${allResults.length} total invoice(s)`);

    // ✅ دايماً بنرجع مصفوفة rows موحدة عشان الـ Client Consistency
    return { ok: true as const, rows: allResults };
  });

// ── Server function: vision extraction ──────────────────────────────────────
export const extractFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ImageInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    // ✅ تم تصحيح الـ Token هنا ليسحب من مفتاح جوجل
    const token = (process.env.GOOGLE_API_KEY || "").trim();
    if (!token) return { ok: false as const, error: "Server misconfigured (missing GOOGLE_API_KEY)." };

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
      return { ok: true as const, rows: result.rows }; // ✅ مصفوفة موحدة دايماً
    } else {
      return result;
    }
  });
