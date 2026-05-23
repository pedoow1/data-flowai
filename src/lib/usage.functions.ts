// Server fns for plan-aware usage + rate limiting (backed by Supabase).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_LIMITS, type Plan } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getPlanAndUsage(supabase: any, userId: string) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [subRes, countRes] = await Promise.all([
    supabase.from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
    supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since),
  ]);
  const plan: Plan = (subRes.data?.plan as Plan) ?? "free";
  const used = countRes.count ?? 0;
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, used, limit, remaining, unlimited: isUnlimited };
}

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    return getPlanAndUsage(supabase, userId);
  });

export const recordUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Re-check limit server-side to prevent client tampering.
    const usage = await getPlanAndUsage(supabase, userId);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }
    const { error } = await supabase.from("uploads").insert({ user_id: userId, file_name: data.fileName });
    if (error) return { ok: false as const, error: error.message, usage };
    const after = await getPlanAndUsage(supabase, userId);
    return { ok: true as const, usage: after };
  });
