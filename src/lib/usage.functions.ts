import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_LIMITS, ADMIN_EMAIL, type Plan } from "./config";
import { createClient } from "@supabase/supabase-js";

const DAY_MS = 24 * 60 * 60 * 1000;

function getServiceClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function getPlanAndUsage(supabase: any, userId: string, isAdminOverride = false) {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [subRes, countRes, adminRes] = await Promise.all([
    supabase.from("subscriptions").select("plan").eq("user_id", userId).maybeSingle(),
    supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since),
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  const isAdmin = isAdminOverride || !!adminRes.data;
  const plan: Plan = (subRes.data?.plan as Plan) ?? "free";
  const used = countRes.count ?? 0;
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = isAdmin || !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, used, limit, remaining, unlimited: isUnlimited, isAdmin };
}

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const isAdminEmail =
      typeof claims?.email === "string" &&
      claims.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return getPlanAndUsage(supabase, userId, isAdminEmail);
  });

export const recordUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    const isAdminEmail =
      typeof claims?.email === "string" &&
      claims.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const usage = await getPlanAndUsage(supabase, userId, isAdminEmail);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }
    const { error } = await supabase.from("uploads").insert({ user_id: userId, file_name: data.fileName });
    if (error) return { ok: false as const, error: error.message, usage };
    const after = await getPlanAndUsage(supabase, userId, isAdminEmail);
    return { ok: true as const, usage: after };
  });

export const setAdminPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ plan: z.enum(["free", "pro", "team"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId, claims } = context;
    const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : "";
    const isAdminEmail = email === ADMIN_EMAIL.toLowerCase();
    if (!isAdminEmail) {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleData) throw new Error("Forbidden");
    }

    const { error } = await supabase
      .from("subscriptions")
      .upsert(
        { user_id: userId, plan: data.plan, status: "active", updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
