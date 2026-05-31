import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL, FREE_LIFETIME_LIMIT, PRO_MONTHLY_LIMIT, TEAM_MONTHLY_LIMIT, TEAM_DAILY_LIMIT, getNextPeriodDates, type Plan } from "./config";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

type UsageSummary = {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  isAdmin: boolean;
  cycle: "lifetime" | "monthly" | "daily";
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  dailyUsed?: number;
  dailyLimit?: number;
  dailyRemaining?: number;
};

function isSchemaCacheError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("current_period_") &&
    (
      message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("could not find the") ||
      message.includes("column subscriptions.current_period_") ||
      message.includes("column pending_subscriptions.current_period_")
    )
  );
}

function addMonth(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

function inferPeriodBounds(plan: Plan, updatedAt?: string | null) {
  if (plan === "free") {
    return { start: null, end: null };
  }

  const fallbackStart = updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
    ? new Date(updatedAt).toISOString()
    : new Date().toISOString();

  return {
    start: fallbackStart,
    end: addMonth(fallbackStart),
  };
}

async function upsertSubscriptionWithFallback(
  supabase: ReturnType<typeof getServiceClient>,
  payload: {
    user_id: string;
    plan: Plan;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    updated_at: string;
  },
) {
  const fullRes = await supabase
    .from("subscriptions")
    .upsert(payload, { onConflict: "user_id" });

  if (!fullRes.error || !isSchemaCacheError(fullRes.error)) {
    return fullRes;
  }

  return supabase.from("subscriptions").upsert(
    {
      user_id: payload.user_id,
      plan: payload.plan,
      status: payload.status,
      updated_at: payload.updated_at,
    },
    { onConflict: "user_id" },
  );
}

async function loadSubscriptionState(supabase: any, userId: string) {
  const fullRes = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_start, current_period_end, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!fullRes.error) {
    return {
      plan: fullRes.data?.plan as Plan | undefined,
      status: fullRes.data?.status as string | undefined,
      currentPeriodStart: fullRes.data?.current_period_start ?? null,
      currentPeriodEnd: fullRes.data?.current_period_end ?? null,
      updatedAt: fullRes.data?.updated_at ?? null,
    };
  }

  if (!isSchemaCacheError(fullRes.error)) {
    throw new Error(fullRes.error.message);
  }

  const fallbackRes = await supabase
    .from("subscriptions")
    .select("plan, status, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (fallbackRes.error) {
    throw new Error(fallbackRes.error.message);
  }

  return {
    plan: fallbackRes.data?.plan as Plan | undefined,
    status: fallbackRes.data?.status as string | undefined,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    updatedAt: fallbackRes.data?.updated_at ?? null,
  };
}

function isValidActivePeriod(periodEnd: string | null | undefined) {
  return !!periodEnd && new Date(periodEnd).getTime() > Date.now();
}

async function resolveEffectivePlan(supabase: any, userId: string, isAdminOverride = false) {
  const [subscriptionState, adminRes] = await Promise.all([
    loadSubscriptionState(supabase, userId),
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);

  const isAdmin = isAdminOverride || !!adminRes.data;
  const rawPlan = subscriptionState.plan ?? "free";
  const status = subscriptionState.status ?? "active";
  const inferredBounds = inferPeriodBounds(rawPlan, subscriptionState.updatedAt);
  const currentPeriodStart = subscriptionState.currentPeriodStart ?? inferredBounds.start;
  const currentPeriodEnd = subscriptionState.currentPeriodEnd ?? inferredBounds.end;

  const isPaidPlan = rawPlan === "pro" || rawPlan === "team";
  const isSubscriptionActive = status === "active" && (
    subscriptionState.currentPeriodEnd == null ? true : isValidActivePeriod(currentPeriodEnd)
  );
  const effectivePlan: Plan = isPaidPlan && !isSubscriptionActive ? "free" : rawPlan;

  return {
    isAdmin,
    plan: effectivePlan,
    storedPlan: rawPlan,
    status,
    currentPeriodStart,
    currentPeriodEnd,
  };
}

export async function getPlanAndUsage(supabase: any, userId: string, isAdminOverride = false) {
  const effective = await resolveEffectivePlan(supabase, userId, isAdminOverride);

  if (effective.plan === "free") {
    const countRes = await supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const used = countRes.count ?? 0;
    return {
      plan: "free",
      used,
      limit: FREE_LIFETIME_LIMIT,
      remaining: Math.max(0, FREE_LIFETIME_LIMIT - used),
      unlimited: false,
      isAdmin: effective.isAdmin,
      cycle: "lifetime",
      label: "Free trial extractions",
      periodStart: null,
      periodEnd: null,
    } satisfies UsageSummary;
  }

  if (effective.plan === "pro") {
    const periodStart = effective.currentPeriodStart ?? new Date(0).toISOString();
    const periodEnd = effective.currentPeriodEnd;
    const countRes = await supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd ?? "9999-12-31T23:59:59.999Z");
    const used = countRes.count ?? 0;
    return {
      plan: "pro",
      used,
      limit: PRO_MONTHLY_LIMIT,
      remaining: Math.max(0, PRO_MONTHLY_LIMIT - used),
      unlimited: false,
      isAdmin: effective.isAdmin,
      cycle: "monthly",
      label: "Monthly Pro extractions",
      periodStart,
      periodEnd,
    } satisfies UsageSummary;
  }

  // Team: 1000 per billing month, with a hard cap of 50 per rolling 24h.
  const teamPeriodStart = effective.currentPeriodStart ?? new Date(0).toISOString();
  const teamPeriodEnd = effective.currentPeriodEnd;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [monthRes, dayRes] = await Promise.all([
    supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", teamPeriodStart)
      .lt("created_at", teamPeriodEnd ?? "9999-12-31T23:59:59.999Z"),
    supabase
      .from("uploads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since),
  ]);
  const monthlyUsed = monthRes.count ?? 0;
  const dailyUsed = dayRes.count ?? 0;
  const monthlyRemaining = Math.max(0, TEAM_MONTHLY_LIMIT - monthlyUsed);
  const dailyRemaining = Math.max(0, TEAM_DAILY_LIMIT - dailyUsed);
  return {
    plan: "team",
    used: monthlyUsed,
    limit: TEAM_MONTHLY_LIMIT,
    remaining: Math.min(monthlyRemaining, dailyRemaining),
    unlimited: false,
    isAdmin: effective.isAdmin,
    cycle: "monthly",
    label: "Monthly Team extractions (max 50/day)",
    periodStart: teamPeriodStart,
    periodEnd: teamPeriodEnd,
    dailyUsed,
    dailyLimit: TEAM_DAILY_LIMIT,
    dailyRemaining,
  } satisfies UsageSummary;
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
      let msg: string;
      if (usage.plan === "team" && (usage.dailyRemaining ?? 1) <= 0) {
        msg = "You've reached the daily cap of 50 extractions. Please try again tomorrow.";
      } else if (usage.cycle === "monthly") {
        msg = "You've reached your monthly extraction limit. It resets at the start of your next billing cycle.";
      } else {
        msg = "You've used all your free extractions. Upgrade to continue.";
      }
      return { ok: false as const, error: msg, usage };
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

    // Use the service-role client: the subscriptions table has no user-level
    // INSERT/UPDATE RLS policy, so a token-scoped client cannot upsert.
    const admin = getServiceClient();
    const { start, end } = getNextPeriodDates();
    const { error } = await upsertSubscriptionWithFallback(admin, {
      user_id: userId,
      plan: data.plan,
      status: "active",
      current_period_start: data.plan === "free" ? null : start,
      current_period_end: data.plan === "free" ? null : end,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      const friendly = isSchemaCacheError(error)
        ? "The backend is still refreshing its subscription schema. Please try again now."
        : error.message;
      return { ok: false as const, error: friendly };
    }
    return { ok: true as const, plan: data.plan };
  });
