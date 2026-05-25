import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@server/auth";
import { ADMIN_EMAIL } from "./config";
import { db } from "@server/db";
import { profiles, subscriptions, uploads, supportTickets } from "@shared/schema";
import { eq, gte, desc, sql, count as drizzleCount } from "drizzle-orm";

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
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [allProfiles, uploads24hCount, uploads7d, tickets, subs] = await Promise.all([
      db.select({ id: profiles.id, email: profiles.email, createdAt: profiles.createdAt })
        .from(profiles)
        .orderBy(desc(profiles.createdAt)),
      db.select({ count: drizzleCount() }).from(uploads).where(gte(uploads.createdAt, since24h)),
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
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i);
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
      uploadsToday: uploads24hCount[0]?.count ?? 0,
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

export type AdminUser = {
  id: string;
  email: string;
  plan: "free" | "pro" | "team";
  status: string;
  uploads24h: number;
  joinedAt: string;
};

export const getAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    assertAdmin(context.email);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [profilesRows, subsRows, uploadsRows] = await Promise.all([
      db.select({ id: profiles.id, email: profiles.email, createdAt: profiles.createdAt })
        .from(profiles)
        .orderBy(desc(profiles.createdAt)),
      db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status })
        .from(subscriptions),
      db.select({ userId: uploads.userId })
        .from(uploads)
        .where(gte(uploads.createdAt, since24h)),
    ]);

    const subByUser: Record<string, { plan: string; status: string }> = {};
    for (const s of subsRows) {
      subByUser[s.userId] = { plan: s.plan, status: s.status };
    }

    const uploads24hCount: Record<string, number> = {};
    for (const u of uploadsRows) {
      uploads24hCount[u.userId] = (uploads24hCount[u.userId] ?? 0) + 1;
    }

    return profilesRows.map((p) => ({
      id: p.id,
      email: p.email,
      plan: ((subByUser[p.id]?.plan as "free" | "pro" | "team") ?? "free"),
      status: subByUser[p.id]?.status ?? "active",
      uploads24h: uploads24hCount[p.id] ?? 0,
      joinedAt: p.createdAt.toISOString(),
    }));
  });

export const setUserPlan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().min(1), plan: z.enum(["free", "pro", "team"]) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    assertAdmin(context.email);

    await db
      .insert(subscriptions)
      .values({ userId: data.userId, plan: data.plan, status: "active", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { plan: data.plan, status: "active", updatedAt: new Date() },
      });
    return { ok: true as const };
  });
