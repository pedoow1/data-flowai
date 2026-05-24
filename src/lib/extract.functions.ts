import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  text: z.string().min(1).max(120_000),
  fileName: z.string().min(1).max(255),
});

const CellSchema = z.object({ v: z.string(), c: z.number().min(0).max(100) });
const RowSchema = z.object({
  invoiceNumber: CellSchema,
  client: CellSchema,
  date: CellSchema,
  amount: CellSchema,
  tax: CellSchema,
  total: CellSchema,
});

const MODEL = "qwen/qwen-2.5-7b-instruct:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 120_000;

const SYSTEM = `You are a precise document extraction engine. Given raw text from a PDF (invoice, receipt, bill, report, or similar), extract the most likely structured fields and return ONLY valid JSON matching this exact TypeScript type:

type Row = {
  invoiceNumber: { v: string; c: number };
  client: { v: string; c: number };
  date: { v: string; c: number };
  amount: { v: string; c: number };
  tax: { v: string; c: number };
  total: { v: string; c: number };
};

Rules:
- "v" is the extracted string value. Use "—" if missing.
- "c" is your confidence 0-100 for that field.
- Output ONLY the JSON object. No prose, no markdown, no code fences.
- Currency values should include the currency symbol if present in the text.
- Dates should be ISO YYYY-MM-DD when possible.`;

async function callHF(apiKey: string, body: unknown): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-wait-for-model": "true",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const bodyText = await res.text();
    return { status: res.status, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

export const extractFromText = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.HF_API_KEY;
    if (!apiKey) {
      console.error("[extract] Missing HF_API_KEY env var");
      return { ok: false as const, error: "Server is not configured (missing HF_API_KEY)." };
    }
    if (data.text.length < 20) {
      return {
        ok: false as const,
        error: "Could not read text from this PDF. It may be a scanned image (OCR not supported).",
      };
    }

    const requestBody = {
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Document: ${data.fileName}\n\n---\n${data.text.slice(0, 80_000)}` },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
    };

    let attempt = 0;
    let lastError = "Unknown error";
    while (attempt < 3) {
      attempt++;
      try {
        const { status, bodyText } = await callHF(apiKey, requestBody);

        if (status === 200) {
          let json: any;
          try { json = JSON.parse(bodyText); }
          catch { return { ok: false as const, error: "AI service returned invalid JSON envelope." }; }

          const content: string = json?.choices?.[0]?.message?.content ?? "";
          const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

          let parsed: unknown;
          try { parsed = JSON.parse(cleaned); }
          catch {
            console.error("[extract] Model returned unparseable content:", content.slice(0, 300));
            return { ok: false as const, error: "AI returned an unparseable response. Please retry." };
          }

          const validated = RowSchema.safeParse(parsed);
          if (!validated.success) {
            console.error("[extract] Schema mismatch:", JSON.stringify(validated.error.issues).slice(0, 300));
            return { ok: false as const, error: "AI response missing required fields. Please retry." };
          }
          return { ok: true as const, row: validated.data };
        }

        // Non-200 — log and decide whether to retry
        console.error(`[extract] HF API ${status}:`, bodyText.slice(0, 400));

        if (status === 503 || status === 524) {
          lastError = "AI model is warming up.";
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        if (status === 429) {
          lastError = "AI service is rate-limiting requests.";
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          continue;
        }
        if (status === 401 || status === 403) {
          return { ok: false as const, error: "AI service authentication failed (invalid HF_API_KEY)." };
        }
        if (status === 404) {
          return { ok: false as const, error: `AI model not found: ${MODEL}.` };
        }
        return { ok: false as const, error: `AI service error (${status}): ${bodyText.slice(0, 200)}` };
      } catch (e: any) {
        const isAbort = e?.name === "AbortError";
        lastError = isAbort ? "Extraction timed out." : (e?.message || "Network error");
        console.error("[extract] Fetch failed:", lastError, e);
        if (isAbort) break;
        // Network error — retry once more
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    return { ok: false as const, error: `${lastError} Please try again in a few seconds.` };
  });
