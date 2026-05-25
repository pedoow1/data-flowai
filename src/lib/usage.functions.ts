import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@server/auth";
import { db } from "@server/db";
import { subscriptions, uploads, userRoles } from "@shared/schema";
import { eq, gte } from "drizzle-orm";
import { PLAN_LIMITS, ADMIN_EMAIL, type Plan } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getPlanAndUsage(userId: string, isAdminOverride = false) {
  const since = new Date(Date.now() - DAY_MS);

  const [subRows, recentUploads, adminRoles] = await Promise.all([
    db.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    db.select({ id: uploads.id }).from(uploads).where(
      eq(uploads.userId, userId)
    ),
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
  ]);

  const used = recentUploads.filter((_r, _i) => true).length;
  const allUploads = await db.select({ createdAt: uploads.createdAt }).from(uploads).where(eq(uploads.userId, userId));
  const usedToday = allUploads.filter(r => new Date(r.createdAt).getTime() >= since.getTime()).length;

  const isAdmin = isAdminOverride || adminRoles.some(r => r.role === "admin");
  const plan: Plan = isAdmin ? "team" : ((subRows[0]?.plan as Plan) ?? "free");
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = isAdmin || !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - usedToday);
  return { plan, used: usedToday, limit, remaining, unlimited: isUnlimited };
}

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, email } = context;
    const isAdminEmail = email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return getPlanAndUsage(userId, isAdminEmail);
  });

export const recordUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId, email } = context;
    const isAdminEmail = email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const usage = await getPlanAndUsage(userId, isAdminEmail);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }
    try {
      await db.insert(uploads).values({ userId, fileName: data.fileName });
    } catch (e: any) {
      return { ok: false as const, error: e.message ?? "DB error", usage };
    }
    const after = await getPlanAndUsage(userId, isAdminEmail);
    return { ok: true as const, usage: after };
  });
