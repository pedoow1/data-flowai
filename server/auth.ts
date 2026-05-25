import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSession } from "./session";

export const requireAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const session = await getSession(request as unknown as Request);

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
