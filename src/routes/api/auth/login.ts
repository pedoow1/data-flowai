import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = new URL(request.url).host;
        return Response.redirect(
          `https://replit.com/auth_with_repl_site?domain=${host}`,
          302
        );
      },
    },
  },
});
