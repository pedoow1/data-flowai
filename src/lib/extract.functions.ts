import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";
import { FlexibleRowSchema, FlexibleMultiRowSchema, normalizeRow } from "./flexible-schema";

// ── API configuration ────────────────────────────────────────────────────────
const TEXT_MODEL = "gemini-3-flash-preview";
const VISION_MODEL = "gemini-3-flash-preview";
const GITHUB_MODELS_API = "https://models.inference.ai.azure.com";
const TIMEOUT_MS = 300_000;
const MAX_TOKENS = 8000;
const CHUNK_SIZE = 8000;
const PARALLEL_LIMIT = 2;
const BATCH_DELAY_MS = 300;

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

// ── FLEXIBLE PROMPT: Extract ALL fields, not just 6 hardcoded ones ───────────
const FLEXIBLE_PROMPT = `You are a precision invoice and document data extraction engine.

Your task: Extract ALL structured fields from the document and return ONLY valid JSON.

For each invoice found, return an object with these fields (include as many as are present):
- invoiceNumber: the invoice/receipt/order/transaction number
- client OR vendor OR billTo OR seller: the company/person name
- date OR invoiceDate: the date (ISO YYYY-MM-DD if possible)
- amount OR subtotal OR netAmount: subtotal before tax
- tax OR vat OR gst: tax amount (or "—" if absent)
- total OR grandTotal: final amount with tax
