// Gumroad webhook receiver — updates a user's subscription plan.
// Gumroad "ping" sends form-encoded body. We verify a shared secret passed
// either as ?secret= query param or x-webhook-secret header.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GUMROAD_PRODUCT_TO_PLAN, type Plan } from "@/lib/config";

export const Route = createFileRoute("/api/public/gumroad-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.GUMROAD_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[gumroad] GUMROAD_WEBHOOK_SECRET is not configured");
          return new Response("Server misconfigured", { status: 500 });
        }

        const url = new URL(request.url);
        const provided =
          url.searchParams.get("secret") ||
          request.headers.get("x-webhook-secret") ||
          "";
        if (provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Gumroad sends application/x-www-form-urlencoded
        const raw = await request.text();
        const params = new URLSearchParams(raw);
        const event = (params.get("resource_name") || params.get("event") || "sale").toLowerCase();
        const email = (params.get("email") || "").trim().toLowerCase();
        const productName = params.get("product_name") || "";
        const saleId = params.get("sale_id") || undefined;
        const subId = params.get("subscription_id") || undefined;

        if (!email) {
          console.error("[gumroad] Missing email in payload");
          return new Response("Missing email", { status: 400 });
        }

        // Determine new plan
        let newPlan: Plan = "free";
        const isCancel = /cancel|refund|end|dispute|fail/.test(event);
        if (isCancel) {
          newPlan = "free";
        } else {
          newPlan = GUMROAD_PRODUCT_TO_PLAN[productName] ?? "free";
          if (newPlan === "free") {
            console.warn(`[gumroad] Unknown product_name "${productName}" — defaulting to free`);
          }
        }

        // Find profile by email
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("email", email)
          .maybeSingle();

        if (profile) {
          const { error } = await supabaseAdmin
            .from("subscriptions")
            .upsert({
              user_id: profile.id,
              plan: newPlan,
              status: isCancel ? "cancelled" : "active",
              gumroad_sale_id: saleId,
              gumroad_subscription_id: subId,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" });
          if (error) {
            console.error("[gumroad] subscription upsert failed:", error);
            return new Response("DB error", { status: 500 });
          }
        } else {
          // No user yet — store pending so it applies on signup
          if (newPlan !== "free") {
            await supabaseAdmin.from("pending_subscriptions").upsert({
              email,
              plan: newPlan,
              gumroad_sale_id: saleId,
              gumroad_subscription_id: subId,
            });
          } else {
            // Cancellation for unknown email — nothing to do
          }
        }

        return new Response(JSON.stringify({ ok: true, plan: newPlan }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
    },
  },
});
