import { createMiddleware } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { getSession } from "@server/session";

// Legacy alias — prefer importing requireAuth from @server/auth directly.
export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getWebRequest();
    const session = await getSession(request as Request);

    if (!session?.userId) {
      throw new Error("Unauthorized");
    }

    return next({
      context: {
        supabase: null,
        userId: session.userId,
        email: session.email,
        isAdmin: session.isAdmin,
        claims: {
          sub: session.userId,
          email: session.email,
        },
      },
    });
  }
);
