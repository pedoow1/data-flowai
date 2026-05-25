import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getWebRequest } from "@tanstack/react-start/server";
import { getSession } from "@server/session";
import { db } from "@server/db";
import { subscriptions, uploads, userRoles } from "@shared/schema";
import { eq, gte, and, count, sql } from "drizzle-orm";
import { PLAN_LIMITS, type Plan } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getPlanAndUsage(userId: string) {
  const since = new Date(Date.now() - DAY_MS);

  const [subRows, adminRows, uploadCount] = await Promise.all([
    db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    db.select().from(userRoles).where(
      and(eq(userRoles.userId, userId), eq(userRoles.role, "admin"))
    ).limit(1),
    db.select({ count: count() }).from(uploads).where(
      and(eq(uploads.userId, userId), gte(uploads.createdAt, since))
    ),
  ]);

  const isAdmin = adminRows.length > 0;
  const plan: Plan = isAdmin ? "team" : ((subRows[0]?.plan as Plan) ?? "free");
  const used = uploadCount[0]?.count ?? 0;
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = isAdmin || !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, used, limit, remaining, unlimited: isUnlimited };
}

export const getMyUsage = createServerFn({ method: "GET" }).handler(async () => {
  const request = getWebRequest();
  const session = await getSession(request);
  if (!session) throw new Error("Unauthorized");
  return getPlanAndUsage(session.userId);
});

export const recordUpload = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ data }) => {
    const request = getWebRequest();
    const session = await getSession(request);
    if (!session) throw new Error("Unauthorized");

    const usage = await getPlanAndUsage(session.userId);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }

    try {
      await db.insert(uploads).values({ userId: session.userId, fileName: data.fileName });
    } catch (e: any) {
      return { ok: false as const, error: e.message ?? "DB error", usage };
    }

    const after = await getPlanAndUsage(session.userId);
    return { ok: true as const, usage: after };
  });
