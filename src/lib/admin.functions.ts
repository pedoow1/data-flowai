import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await assertAdmin(userId);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [users, uploads24h, uploads7d, tickets, subs] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email, created_at").order("created_at", { ascending: false }),
      supabaseAdmin.from("uploads").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      supabaseAdmin.from("uploads").select("user_id, created_at").gte("created_at", since7d),
      supabaseAdmin.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("subscriptions").select("user_id, plan, status"),
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
      totalUsers: users.data?.length ?? 0,
      uploadsToday: uploads24h.count ?? 0,
      uploadsByDay: days,
      topUsers,
      tickets: tickets.data ?? [],
      planCounts,
    };
  });
