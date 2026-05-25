import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@server/auth";
import { db } from "@server/db";
import { profiles, uploads, supportTickets, subscriptions } from "@shared/schema";
import { gte, desc } from "drizzle-orm";
import { ADMIN_EMAIL } from "./config";

function assertAdmin(email: string | null) {
  if (!email || email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error("Forbidden");
  }
}

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    assertAdmin(context.email);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [allUsers, allUploads7d, allTickets, allSubs] = await Promise.all([
      db.select({ id: profiles.id, email: profiles.email, createdAt: profiles.createdAt })
        .from(profiles)
        .orderBy(desc(profiles.createdAt)),
      db.select({ userId: uploads.userId, createdAt: uploads.createdAt })
        .from(uploads)
        .where(gte(uploads.createdAt, since7d)),
      db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(50),
      db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status })
        .from(subscriptions),
    ]);

    const uploads24h = allUploads7d.filter(u => new Date(u.createdAt).getTime() >= since24h.getTime());

    const days: { day: string; count: number }[] = [];
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = 0;
      days.push({ day: key, count: 0 });
    }
    for (const u of allUploads7d) {
      const key = new Date(u.createdAt).toISOString().slice(0, 10);
      if (key in dayMap) dayMap[key]++;
    }
    for (const d of days) d.count = dayMap[d.day] ?? 0;

    const sinceMs = since24h.getTime();
    const perUser: Record<string, number> = {};
    for (const u of allUploads7d) {
      if (new Date(u.createdAt).getTime() >= sinceMs) {
        perUser[u.userId] = (perUser[u.userId] ?? 0) + 1;
      }
    }
    const emailById: Record<string, string> = {};
    for (const u of allUsers) emailById[u.id] = u.email;
    const topUsers = Object.entries(perUser)
      .map(([uid, used]) => ({ email: emailById[uid] ?? uid.slice(0, 8), used }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 10);

    const planCounts = { free: 0, pro: 0, team: 0 } as Record<string, number>;
    for (const s of allSubs) planCounts[s.plan] = (planCounts[s.plan] ?? 0) + 1;

    return {
      totalUsers:   allUsers.length,
      uploadsToday: uploads24h.length,
      uploadsByDay: days,
      topUsers,
      tickets:      allTickets,
      planCounts,
    };
  });
