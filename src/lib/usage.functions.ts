import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { db } from "../../server/db";
import { subscriptions, uploads, userRoles, profiles } from "../../shared/schema";
import { eq, gte, and, count, sql } from "drizzle-orm";
import { PLAN_LIMITS, ADMIN_EMAIL, type Plan } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

function getUserIdFromRequest(request: Request): string | null {
  const userId = request.headers.get("x-replit-user-id");
  if (userId) return userId;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.replace("Bearer ", "");
  return null;
}

async function getPlanAndUsage(userId: string) {
  const since = new Date(Date.now() - DAY_MS);

  const [subRows, countRows, adminRows, profileRows] = await Promise.all([
    db.select({ plan: subscriptions.plan }).from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1),
    db.select({ cnt: count() }).from(uploads).where(and(eq(uploads.userId, userId), gte(uploads.createdAt, since))),
    db.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, "admin"))).limit(1),
    db.select({ email: profiles.email }).from(profiles).where(eq(profiles.id, userId)).limit(1),
  ]);

  const email = profileRows[0]?.email ?? "";
  const isAdmin = adminRows.length > 0 || email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const plan: Plan = isAdmin ? "team" : ((subRows[0]?.plan as Plan) ?? "free");
  const used = countRows[0]?.cnt ?? 0;
  const limitNum = PLAN_LIMITS[plan];
  const isUnlimited = isAdmin || !Number.isFinite(limitNum);
  const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : (limitNum as number);
  const remaining = isUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { plan, used, limit, remaining, unlimited: isUnlimited };
}

export const getMyUsage = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const userId = request ? getUserIdFromRequest(request) : null;
  if (!userId) throw new Error("Unauthorized");
  return getPlanAndUsage(userId);
});

export const recordUpload = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ fileName: z.string().min(1).max(255) }).parse(d))
  .handler(async ({ data }) => {
    const request = getRequest();
    const userId = request ? getUserIdFromRequest(request) : null;
    if (!userId) return { ok: false as const, error: "Unauthorized", usage: { plan: "free" as Plan, used: 0, limit: 2, remaining: 0, unlimited: false } };

    const usage = await getPlanAndUsage(userId);
    if (!usage.unlimited && usage.remaining <= 0) {
      return { ok: false as const, error: "Daily limit reached for your plan.", usage };
    }

    await db.insert(uploads).values({ userId, fileName: data.fileName });
    const after = await getPlanAndUsage(userId);
    return { ok: true as const, usage: after };
  });
