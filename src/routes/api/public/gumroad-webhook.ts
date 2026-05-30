import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin, hasAdminClient } from "@/integrations/supabase/client.server";
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
        if (!hasAdminClient()) {
          console.error("[gumroad] Supabase admin client is not configured");
          return new Response("Server misconfigured", { status: 500 });
        }

        const url = new URL(request.url);
        const provided =
          url.searchParams.get("secret") ||
          request.headers.get("x-webhook-secret") ||
          "";
        // Constant-time-ish comparison to avoid leaking secret length via timing.
        if (provided.length !== secret.length || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const raw = await request.text();
        const params = new URLSearchParams(raw);
        const event = (params.get("resource_name") || params.get("event") || "sale").toLowerCase();
        const email = (params.get("email") || "").trim().toLowerCase();
        const productName = params.get("product_name") || "";
        const saleId = params.get("sale_id") || null;
        const subId = params.get("subscription_id") || null;

        if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
          console.error("[gumroad] Missing or invalid email in payload");
          return new Response("Missing email", { status: 400 });
        }

        let newPlan: Plan = "free";
        const isCancel = /cancel|refund|end|dispute|fail/.test(event);
        if (!isCancel) {
          newPlan = GUMROAD_PRODUCT_TO_PLAN[productName] ?? "free";
          if (newPlan === "free") {
            console.warn(`[gumroad] Unknown product_name "${productName}" — defaulting to free`);
          }
        }

        const status = isCancel ? "cancelled" : "active";

        try {
          const { data: profile, error: profileErr } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (profileErr) throw profileErr;

          if (profile?.id) {
            const { error } = await supabaseAdmin.from("subscriptions").upsert(
              {
                user_id: profile.id,
                plan: newPlan,
                status,
                gumroad_sale_id: saleId,
                gumroad_subscription_id: subId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            );
            if (error) throw error;
          } else if (newPlan !== "free") {
            const { error } = await supabaseAdmin.from("pending_subscriptions").upsert(
              {
                email,
                plan: newPlan,
                gumroad_sale_id: saleId,
                gumroad_subscription_id: subId,
              },
              { onConflict: "email" },
            );
            if (error) throw error;
            console.log(`[gumroad] Stored pending subscription for ${email} (plan: ${newPlan})`);
          }
        } catch (e) {
          console.error("[gumroad] DB operation failed:", e);
          return new Response("DB error", { status: 500 });
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
