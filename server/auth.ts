import { createMiddleware } from "@tanstack/react-start";
import { getWebRequest } from "@tanstack/react-start/server";
import { getSession } from "./session";

export const requireAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getWebRequest();
    const session = await getSession(request);

    if (!session?.userId) {
      throw new Error("Unauthorized");
    }

    return next({
      context: {
        userId: session.userId,
        email: session.email ?? null,
        isAdmin: session.isAdmin ?? false,
      },
    });
  }
);
