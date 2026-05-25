import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL } from "./config";

function assertAdmin(claimsEmail: string | undefined) {
  if (!claimsEmail || claimsEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error("Forbidden");
  }
}

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, claims } = context;

    assertAdmin(claims.email as string | undefined);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [users, uploads24h, uploads7d, tickets, subs] = await Promise.all([
      supabase.from("profiles").select("id, email, created_at").order("created_at", { ascending: false }),
      supabase.from("uploads").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      supabase.from("uploads").select("user_id, created_at").gte("created_at", since7d),
      supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("subscriptions").select("user_id, plan, status"),
    ]);

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
    for (const u of users.data ?? []) emailById[u.id as string] = u.email as string;
    const topUsers = Object.entries(perUser)
      .map(([uid, used]) => ({ email: emailById[uid] ?? uid.slice(0, 8), used }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 10);

    const planCounts = { free: 0, pro: 0, team: 0 } as Record<string, number>;
    for (const s of subs.data ?? []) planCounts[s.plan as string] = (planCounts[s.plan as string] ?? 0) + 1;

    return {
      totalUsers:   users.data?.length ?? 0,
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
    const { supabase, claims } = context;
    assertAdmin(claims.email as string | undefined);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [profilesRes, subsRes, uploadsRes] = await Promise.all([
      supabase.from("profiles").select("id, email, created_at").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("user_id, plan, status"),
      supabase.from("uploads").select("user_id").gte("created_at", since24h),
    ]);

    const subByUser: Record<string, { plan: string; status: string }> = {};
    for (const s of subsRes.data ?? []) {
      subByUser[s.user_id as string] = { plan: s.plan as string, status: s.status as string };
    }

    const uploads24hCount: Record<string, number> = {};
    for (const u of uploadsRes.data ?? []) {
      uploads24hCount[u.user_id as string] = (uploads24hCount[u.user_id as string] ?? 0) + 1;
    }

    return (profilesRes.data ?? []).map((p) => ({
      id: p.id as string,
      email: p.email as string,
      plan: ((subByUser[p.id as string]?.plan as "free" | "pro" | "team") ?? "free"),
      status: subByUser[p.id as string]?.status ?? "active",
      uploads24h: uploads24hCount[p.id as string] ?? 0,
      joinedAt: p.created_at as string,
    }));
  });

export const setUserPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), plan: z.enum(["free", "pro", "team"]) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, claims } = context;
    assertAdmin(claims.email as string | undefined);

    const { error } = await supabase
      .from("subscriptions")
      .upsert(
        { user_id: data.userId, plan: data.plan, status: "active", updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
