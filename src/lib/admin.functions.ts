import { createServerFn } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { getSession } from "@server/session";
import { db } from "@server/db";
import { profiles, uploads, subscriptions, supportTickets } from "@shared/schema";
import { gte, desc, count, eq } from "drizzle-orm";

export const getAdminStats = createServerFn({ method: "GET" }).handler(async () => {
  const request = getWebRequest();
  const session = await getSession(request);
  if (!session) throw new Error("Unauthorized");
  if (!session.isAdmin) throw new Error("Forbidden");

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [allProfiles, uploads24h, uploads7d, tickets, subs] = await Promise.all([
    db.select({ id: profiles.id, email: profiles.email, createdAt: profiles.createdAt })
      .from(profiles)
      .orderBy(desc(profiles.createdAt)),
    db.select({ count: count() }).from(uploads).where(gte(uploads.createdAt, since24h)),
    db.select({ userId: uploads.userId, createdAt: uploads.createdAt })
      .from(uploads)
      .where(gte(uploads.createdAt, since7d)),
    db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(50),
    db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status })
      .from(subscriptions),
  ]);

  const days: { day: string; count: number }[] = [];
  const dayMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = 0;
    days.push({ day: key, count: 0 });
  }
  for (const u of uploads7d) {
    const key = u.createdAt.toISOString().slice(0, 10);
    if (key in dayMap) dayMap[key]++;
  }
  for (const d of days) d.count = dayMap[d.day] ?? 0;

  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const perUser: Record<string, number> = {};
  for (const u of uploads7d) {
    if (u.createdAt.getTime() >= sinceMs) {
      perUser[u.userId] = (perUser[u.userId] ?? 0) + 1;
    }
  }
  const emailById: Record<string, string> = {};
  for (const u of allProfiles) emailById[u.id] = u.email;
  const topUsers = Object.entries(perUser)
    .map(([uid, used]) => ({ email: emailById[uid] ?? uid.slice(0, 8), used }))
    .sort((a, b) => b.used - a.used)
    .slice(0, 10);

  const planCounts = { free: 0, pro: 0, team: 0 } as Record<string, number>;
  for (const s of subs) planCounts[s.plan] = (planCounts[s.plan] ?? 0) + 1;

  return {
    totalUsers: allProfiles.length,
    uploadsToday: uploads24h[0]?.count ?? 0,
    uploadsByDay: days,
    topUsers,
    tickets: tickets.map(t => ({
      id: t.id,
      name: t.name,
      email: t.email,
      message: t.message,
      delivered: t.delivered,
      created_at: t.createdAt.toISOString(),
    })),
    planCounts,
  };
});
