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

const MODEL = "Qwen/Qwen2.5-7B-Instruct-1M";
const HF_URL = `https://api-inference.huggingface.co/models/${MODEL}/v1/chat/completions`;

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

export const extractFromText = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.HF_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "Server is not configured (missing HF_API_KEY)." };
    }
    if (data.text.length < 20) {
      return { ok: false as const, error: "Could not read text from this PDF. It may be a scanned image (OCR not supported)." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Document: ${data.fileName}\n\n---\n${data.text.slice(0, 80_000)}` },
          ],
          temperature: 0.1,
          max_tokens: 600,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 503) return { ok: false as const, error: "AI model is warming up. Please retry in a few seconds." };
        if (res.status === 429) return { ok: false as const, error: "AI service is rate-limiting requests. Please retry shortly." };
        if (res.status === 401 || res.status === 403) return { ok: false as const, error: "AI service authentication failed." };
        return { ok: false as const, error: `AI service error (${res.status}). ${body.slice(0, 200)}` };
      }

      const json: any = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "";
      const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

      let parsed: unknown;
      try { parsed = JSON.parse(cleaned); }
      catch { return { ok: false as const, error: "AI returned an unparseable response. Please retry." }; }

      const validated = RowSchema.safeParse(parsed);
      if (!validated.success) {
        return { ok: false as const, error: "AI response missing required fields. Please retry." };
      }

      return { ok: true as const, row: validated.data };
    } catch (e: any) {
      if (e?.name === "AbortError") return { ok: false as const, error: "Extraction timed out. Please try a smaller document." };
      return { ok: false as const, error: e?.message || "Unknown error during extraction." };
    } finally {
      clearTimeout(timeout);
    }
  });
