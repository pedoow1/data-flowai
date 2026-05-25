import { createFileRoute } from "@tanstack/react-router";
import { getSession } from "@server/session";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getSession(request as Request);
        if (!session) {
          return new Response(JSON.stringify({ userId: null, email: null, isAdmin: false }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            userId: session.userId,
            email: session.email,
            isAdmin: session.isAdmin,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
});
