import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlanAndUsage } from "./usage.functions";
import { ADMIN_EMAIL } from "./config";

// ── Input schemas ────────────────────────────────────────────────────────
const CreateJobSchema = z.object({
  kind: z.enum(["text", "image"]),
  fileName: z.string().min(1).max(255),
  text: z.string().min(1).max(6_000_000).optional(),
  imageDataUrl: z.string().min(50).max(6_000_000).optional(),
});

const JobIdSchema = z.object({ jobId: z.string().uuid() });

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

// ── Create an extraction job and trigger background processing ────────────
export const createExtractionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateJobSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const quotaError = await assertWithinQuota(context);
    if (quotaError) return { ok: false as const, error: quotaError };

    if (data.kind === "text" && (!data.text || data.text.length < 20)) {
      return { ok: false as const, error: "__NEEDS_VISION__" };
    }
    if (data.kind === "image" && !data.imageDataUrl) {
      return { ok: false as const, error: "No image provided." };
    }

    // Insert the job (RLS: user_id must equal auth.uid()).
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        type: "extraction",
        status: "pending",
        file_name: data.fileName,
        input: {
          kind: data.kind,
          fileName: data.fileName,
          ...(data.kind === "text" ? { text: data.text } : { imageDataUrl: data.imageDataUrl }),
        },
      })
      .select("id")
      .single();

    if (error || !job) {
      return { ok: false as const, error: error?.message || "Failed to create job." };
    }

    // Fire-and-forget: trigger the background Edge Function. It responds
    // immediately and keeps processing via EdgeRuntime.waitUntil, so this
    // request never waits for the AI work — no Vercel timeout.
    const projectUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      await fetch(`${projectUrl}/functions/v1/process-job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey ?? "",
        },
        body: JSON.stringify({ jobId: job.id }),
      });
    } catch (e) {
      console.error("[createExtractionJob] failed to trigger process-job:", e);
      // The job stays pending; the client will surface a timeout if it never
      // gets picked up. We still return the jobId so the client can poll.
    }

    return { ok: true as const, jobId: job.id as string };
  });

// ── Result types (must be serializable for TanStack server fns) ──────────
type Cell = { v: string; c: number };
// Flexible row: columns are whatever fields the document actually contains.
export type ExtractionRow = Record<string, Cell>;

// ── Poll the status/result of a job ──────────────────────────────────────
export const getJobStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => JobIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: job, error } = await supabase
      .from("jobs")
      .select("status, output, error")
      .eq("id", data.jobId)
      .maybeSingle();

    if (error) return { status: "failed" as const, rows: [] as ExtractionRow[], error: error.message };
    if (!job) return { status: "failed" as const, rows: [] as ExtractionRow[], error: "Job not found." };

    const output = (job.output as { rows?: ExtractionRow[] } | null) ?? null;
    return {
      status: job.status as "pending" | "processing" | "completed" | "failed",
      rows: (output?.rows ?? []) as ExtractionRow[],
      error: (job.error as string | null) ?? null,
    };
  });

