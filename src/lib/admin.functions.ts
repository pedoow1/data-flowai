import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL } from "./config";
import { db } from "@server/db";
import {
  profiles,
  subscriptions,
  uploads,
  supportTickets,
  userRoles,
} from "@shared/schema";
import { eq, gte, count, desc, sql } from "drizzle-orm";

function assertAdmin(email: string | undefined) {
  if (!email || email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error("Forbidden");
  }
}

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsersRows,
      uploads24hRows,
      uploads7dRows,
      ticketsRows,
      subsRows,
    ] = await Promise.all([
      db.select({ count: count() }).from(profiles),
      db.select({ count: count() }).from(uploads).where(gte(uploads.createdAt, since24h)),
      db
        .select({ userId: uploads.userId, createdAt: uploads.createdAt })
        .from(uploads)
        .where(gte(uploads.createdAt, since7d)),
      db
        .select()
        .from(supportTickets)
        .orderBy(desc(supportTickets.createdAt))
        .limit(50),
      db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status }).from(subscriptions),
    ]);

    const totalUsers = totalUsersRows[0]?.count ?? 0;
    const uploadsToday = uploads24hRows[0]?.count ?? 0;

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
    for (const u of uploads7dRows) {
      const key = (u.createdAt as Date).toISOString().slice(0, 10);
      if (key in dayMap) dayMap[key]++;
    }
    for (const d of days) d.count = dayMap[d.day] ?? 0;

    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const perUser: Record<string, number> = {};
    for (const u of uploads7dRows) {
      if ((u.createdAt as Date).getTime() >= sinceMs) {
        perUser[u.userId] = (perUser[u.userId] ?? 0) + 1;
      }
    }

    const profileEmailRows = await db.select({ id: profiles.id, email: profiles.email }).from(profiles);
    const emailById: Record<string, string> = {};
    for (const p of profileEmailRows) emailById[p.id] = p.email;

    const topUsers = Object.entries(perUser)
      .map(([uid, used]) => ({ email: emailById[uid] ?? uid.slice(0, 8), used }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 10);

    const planCounts = { free: 0, pro: 0, team: 0 } as Record<string, number>;
    for (const s of subsRows) planCounts[s.plan as string] = (planCounts[s.plan as string] ?? 0) + 1;

    return {
      totalUsers,
      uploadsToday,
      uploadsByDay: days,
      topUsers,
      tickets: ticketsRows.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        message: t.message,
        delivered: t.delivered,
        created_at: (t.createdAt as Date).toISOString(),
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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [profileRows, subsRows, uploadsRows] = await Promise.all([
      db.select({ id: profiles.id, email: profiles.email, createdAt: profiles.createdAt }).from(profiles),
      db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status }).from(subscriptions),
      db.select({ userId: uploads.userId }).from(uploads).where(gte(uploads.createdAt, since24h)),
    ]);

    const subByUser: Record<string, { plan: string; status: string }> = {};
    for (const s of subsRows) {
      subByUser[s.userId] = { plan: s.plan as string, status: s.status };
    }

    const uploads24hCount: Record<string, number> = {};
    for (const u of uploadsRows) {
      uploads24hCount[u.userId] = (uploads24hCount[u.userId] ?? 0) + 1;
    }

    return profileRows.map((p) => ({
      id: p.id,
      email: p.email,
      plan: ((subByUser[p.id]?.plan as "free" | "pro" | "team") ?? "free"),
      status: subByUser[p.id]?.status ?? "active",
      uploads24h: uploads24hCount[p.id] ?? 0,
      joinedAt: (p.createdAt as Date).toISOString(),
    }));
  });

export const setUserPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string(), plan: z.enum(["free", "pro", "team"]) }).parse(d)
  )
  .handler(async ({ context, data }) => {
    const { claims } = context;
    assertAdmin(claims.email as string | undefined);

    await db
      .insert(subscriptions)
      .values({ userId: data.userId, plan: data.plan, status: "active", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { plan: data.plan, status: "active", updatedAt: new Date() },
      });
    return { ok: true as const };
  });
