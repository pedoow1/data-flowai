import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@server/auth";
import { PLAN_LIMITS, ADMIN_EMAIL, type Plan } from "./config";
import { db } from "@server/db";
import { subscriptions, uploads, userRoles } from "@shared/schema";
import { eq, gte, and, count as drizzleCount } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getPlanAndUsage(userId: string, isAdminOverride = false) {
  const since = new Date(Date.now() - DAY_MS);

  const [subRows, uploadCount, adminRoleRows] = await Promise.all([
    db.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    db.select({ count: drizzleCount() }).from(uploads).where(and(eq(uploads.userId, userId), gte(uploads.createdAt, since))),
    db.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, "admin"))).limit(1),
  ]);

  const isAdmin = isAdminOverride || adminRoleRows.length > 0;
  const plan: Plan = (subRows[0]?.plan as Plan) ?? "free";
  const used = uploadCount[0]?.count ?? 0;
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = isAdmin || !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, used, limit, remaining, unlimited: isUnlimited, isAdmin };
}

export const getMyUsage = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, email } = context;
    const isAdminEmail = typeof email === "string" && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return getPlanAndUsage(userId, isAdminEmail);
  });

export const recordUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId, email } = context;
    const isAdminEmail = typeof email === "string" && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const usage = await getPlanAndUsage(userId, isAdminEmail);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }
    try {
      await db.insert(uploads).values({ userId, fileName: data.fileName });
    } catch (e: any) {
      return { ok: false as const, error: e.message ?? "Failed to record upload.", usage };
    }
    const after = await getPlanAndUsage(userId, isAdminEmail);
    return { ok: true as const, usage: after };
  });

export const setAdminPlan = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ plan: z.enum(["free", "pro", "team"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId, email } = context;
    const isAdminEmail = typeof email === "string" && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    if (!isAdminEmail) throw new Error("Forbidden");

    await db
      .insert(subscriptions)
      .values({ userId, plan: data.plan, status: "active", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: { plan: data.plan, status: "active", updatedAt: new Date() },
      });
    return { ok: true as const };
  });
