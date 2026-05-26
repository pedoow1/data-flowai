import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ── Groq configuration ──────────────────────────────────────────────────────
const TEXT_MODEL   = "llama-3.3-70b-versatile";
const VISION_MODEL = "llama-4-scout-17b-16e-instruct";
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS   = 120_000;

// ── Shared schemas ───────────────────────────────────────────────────────────
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
  text:     z.string().min(1).max(120_000),
  fileName: z.string().min(1).max(255),
});

const ImageInputSchema = z.object({
  imageDataUrl: z.string().min(50).max(6_000_000), // base64 data URL, max ~4.5 MB decoded
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

const USER_SUFFIX = `\n\nIMPORTANT: Do not truncate any text, numbers, or company names. Copy every value exactly as it appears in the document, character by character.`;

// ── Low-level fetch helper ───────────────────────────────────────────────────
async function callGroq(
  apiKey: string,
  body: unknown,
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body:   JSON.stringify(body),
    });
    return { status: res.status, bodyText: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// ── Response parser (shared) ─────────────────────────────────────────────────
function parseGroqResponse(
  status: number,
  bodyText: string,
  model: string,
): { ok: true; row: z.infer<typeof RowSchema> } | { ok: false; error: string } | null {
  if (status !== 200) return null; // caller handles non-200

  let json: any;
  try { json = JSON.parse(bodyText); }
  catch { return { ok: false, error: "Groq returned invalid JSON envelope." }; }

  const content: string = json?.choices?.[0]?.message?.content ?? "";
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

// ── Retry wrapper ─────────────────────────────────────────────────────────────
async function runWithRetry(
  apiKey: string,
  body: unknown,
  model: string,
): Promise<{ ok: true; row: z.infer<typeof RowSchema> } | { ok: false; error: string; debugDetail?: string }> {
  let lastError = "Unknown error";
  let lastDebug  = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, bodyText } = await callGroq(apiKey, body);

      if (status === 200) {
        const result = parseGroqResponse(status, bodyText, model);
        return result ?? { ok: false, error: "Failed to parse response.", debugDetail: `model=${model} status=200 body=${bodyText.slice(0, 500)}` };
      }

      console.error(`[extract/${model}] Groq ${status}:`, bodyText.slice(0, 400));
      lastDebug = `model=${model} status=${status} attempt=${attempt} body=${bodyText.slice(0, 600)}`;

      if (status === 503 || status === 502 || status === 524) {
        lastError = "Groq is temporarily unavailable.";
        await new Promise((r) => setTimeout(r, 5_000 * attempt));
        continue;
      }
      if (status === 429) {
        lastError = "Groq rate limit reached.";
        await new Promise((r) => setTimeout(r, 3_000 * attempt));
        continue;
      }
      if (status === 401 || status === 403) {
        return { ok: false, error: "Groq authentication failed — check your GROQ_API_KEY in Vercel.", debugDetail: lastDebug };
      }
      if (status === 404) {
        return { ok: false, error: `Groq model not found: ${model}.`, debugDetail: lastDebug };
      }
      try {
        const parsed = JSON.parse(bodyText);
        const msg = parsed?.error?.message || parsed?.message;
        if (msg) return { ok: false, error: `Groq: ${msg}`, debugDetail: lastDebug };
      } catch { /* plain text body */ }
      return { ok: false, error: `Groq error (${status}): ${bodyText.slice(0, 200)}`, debugDetail: lastDebug };
    } catch (e: any) {
      const isAbort = e?.name === "AbortError";
      lastError = isAbort ? "Extraction timed out." : (e?.message ?? "Network error");
      lastDebug = `model=${model} fetchError=${lastError}`;
      console.error(`[extract/${model}] fetch failed:`, lastError);
      if (isAbort) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  return { ok: false, error: `${lastError} Please try again.`, debugDetail: lastDebug };
}

// ── Server function: text extraction (llama-3.3-70b) ─────────────────────────
export const extractFromText = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TextInputSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Server misconfigured (missing GROQ_API_KEY)." };

    if (data.text.length < 20) {
      return { ok: false as const, error: "__NEEDS_VISION__" };
    }

    const body = {
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Document filename: ${data.fileName}\n\n---\n${data.text.slice(0, 80_000)}${USER_SUFFIX}`,
        },
      ],
      temperature:     0.0,
      max_tokens:      1024,
      response_format: { type: "json_object" },
    };

    return runWithRetry(apiKey, body, TEXT_MODEL);
  });

// ── Server function: vision extraction (llama-4-scout) ───────────────────────
export const extractFromImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ImageInputSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Server misconfigured (missing GROQ_API_KEY)." };

    const body = {
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: data.imageDataUrl },
            },
            {
              type: "text",
              text: `${SYSTEM_PROMPT}\n\nDocument filename: ${data.fileName}\n\nExtract all relevant fields from this document image and return ONLY the JSON object.${USER_SUFFIX}`,
            },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens:  1024,
    };

    return runWithRetry(apiKey, body, VISION_MODEL);
  });
