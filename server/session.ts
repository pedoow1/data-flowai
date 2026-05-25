import { getUserInfo } from "@replit/repl-auth";
import { db } from "./db";
import { profiles, userRoles, subscriptions } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { ADMIN_EMAIL } from "../src/lib/config";

export type SessionUser = {
  userId: string;
  email: string;
  isAdmin: boolean;
};

export async function getSession(request: Request): Promise<SessionUser | null> {
  let identity: { id?: string; name?: string } | null = null;
  try {
    identity = getUserInfo(request as any);
  } catch {
    return null;
  }

  if (!identity?.id) return null;

  const userId = identity.id;
  const email = identity.name ?? userId;

  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  await ensureProfile(userId, email, isAdmin);

  return { userId, email, isAdmin };
}

async function ensureProfile(userId: string, email: string, isAdmin: boolean) {
  try {
    await db
      .insert(profiles)
      .values({ id: userId, email })
      .onConflictDoNothing();

    await db
      .insert(userRoles)
      .values({ userId, role: "user" })
      .onConflictDoNothing();

    if (isAdmin) {
      await db
        .insert(userRoles)
        .values({ userId, role: "admin" })
        .onConflictDoNothing();
    }

    await db
      .insert(subscriptions)
      .values({ userId, plan: "free", status: "active" })
      .onConflictDoNothing();
  } catch (e) {
    console.error("[session] ensureProfile failed:", e);
  }
}
