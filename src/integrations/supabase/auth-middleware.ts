import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { db } from "../../../server/db";
import { profiles, subscriptions, userRoles } from "../../../shared/schema";
import { eq } from "drizzle-orm";
import { ADMIN_EMAIL } from "../../lib/config";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("x-replit-user-id");
    const userId = authHeader ?? request.headers.get("authorization")?.replace("Bearer ", "");

    if (!userId) {
      throw new Error("Unauthorized: Not authenticated");
    }

    const userIdStr = userId;

    return next({
      context: {
        db,
        userId: userIdStr,
      },
    });
  },
);
