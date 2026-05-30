import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL, getNextPeriodDates } from "./config";

function assertAdmin(claimsEmail: string | undefined) {
  if (!claimsEmail || claimsEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error("Forbidden");
  }
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

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

async function upsertSubscriptionForAdmin(
  supabase: ReturnType<typeof getServiceClient>,
  payload: {
    user_id: string;
    plan: "free" | "pro" | "team";
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    updated_at: string;
  },
) {
  const fullRes = await supabase.from("subscriptions").upsert(payload, { onConflict: "user_id" });
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

async function loadSubscriptionsForAdmin(supabase: ReturnType<typeof getServiceClient>) {
  const fullRes = await supabase.from("subscriptions").select("user_id, plan, status, current_period_start, current_period_end");
  if (!fullRes.error) {
    return fullRes.data ?? [];
  }
  if (!isSchemaCacheError(fullRes.error)) {
    throw new Error(fullRes.error.message);
  }

  const fallbackRes = await supabase.from("subscriptions").select("user_id, plan, status");
  if (fallbackRes.error) {
    throw new Error(fallbackRes.error.message);
  }
  return (fallbackRes.data ?? []).map((row) => ({
    ...row,
    current_period_start: null,
    current_period_end: null,
  }));
}

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    const supabase = getServiceClient();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [authUsersRes, uploads24h, uploads7d, tickets, subs] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from("uploads").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      supabase.from("uploads").select("user_id, created_at").gte("created_at", since7d),
      supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(50),
      loadSubscriptionsForAdmin(supabase),
    ]);

    const authUsers = authUsersRes.data?.users ?? [];

    const days: { day: string; count: number }[] = [];
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = 0;
      days.push({ day: key, count: 0 });
    }
    for (const u of uploads7d.data ?? []) {
      const key = (u.created_at as string).slice(0, 10);
      if (key in dayMap) dayMap[key]++;
    }
    for (const d of days) d.count = dayMap[d.day] ?? 0;

    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const perUser: Record<string, number> = {};
    for (const u of uploads7d.data ?? []) {
      if (new Date(u.created_at as string).getTime() >= sinceMs) {
        perUser[u.user_id as string] = (perUser[u.user_id as string] ?? 0) + 1;
      }
    }
    const emailById: Record<string, string> = {};
    for (const u of authUsers) emailById[u.id] = u.email ?? "";
    const topUsers = Object.entries(perUser)
      .map(([uid, used]) => ({ email: emailById[uid] ?? uid.slice(0, 8), used }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 10);

    const planCounts = { free: 0, pro: 0, team: 0 } as Record<string, number>;
    for (const s of subs ?? []) planCounts[s.plan as string] = (planCounts[s.plan as string] ?? 0) + 1;

    return {
      totalUsers:   authUsers.length,
      uploadsToday: uploads24h.count ?? 0,
      uploadsByDay: days,
      topUsers,
      tickets:      tickets.data ?? [],
      planCounts,
    };
  });

export type AdminUser = {
  id: string;
  email: string;
  plan: "free" | "pro" | "team";
  status: string;
  uploads24h: number;
  joinedAt: string;
};

export const getAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    const supabase = getServiceClient();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [authUsersRes, subsRes, uploadsRes] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      loadSubscriptionsForAdmin(supabase),
      supabase.from("uploads").select("user_id").gte("created_at", since24h),
    ]);

    const authUsers = authUsersRes.data?.users ?? [];

    const subByUser: Record<string, { plan: string; status: string }> = {};
    for (const s of subsRes ?? []) {
      subByUser[s.user_id as string] = { plan: s.plan as string, status: s.status as string };
    }

    const uploads24hCount: Record<string, number> = {};
    for (const u of uploadsRes.data ?? []) {
      uploads24hCount[u.user_id as string] = (uploads24hCount[u.user_id as string] ?? 0) + 1;
    }

    return authUsers.map((p) => ({
      id: p.id,
      email: p.email ?? "",
      plan: ((subByUser[p.id]?.plan as "free" | "pro" | "team") ?? "free"),
      status: subByUser[p.id]?.status ?? "active",
      uploads24h: uploads24hCount[p.id] ?? 0,
      joinedAt: p.created_at,
    }));
  });

export const setUserPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), plan: z.enum(["free", "pro", "team"]) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    const supabase = getServiceClient();
    const { start, end } = getNextPeriodDates();
    const { error } = await upsertSubscriptionForAdmin(supabase, {
      user_id: data.userId,
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
