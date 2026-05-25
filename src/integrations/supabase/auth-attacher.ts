import { createMiddleware } from "@tanstack/react-start";

// No-op attacher — Replit Auth is handled server-side via @replit/repl-auth headers.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => next({})
);
