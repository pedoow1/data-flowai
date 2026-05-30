import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin, hasAdminClient } from "@/integrations/supabase/client.server";
import { GUMROAD_PRODUCT_TO_PLAN, getNextPeriodDates, type Plan } from "@/lib/config";

function isPeriodColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("current_period_") && (
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the")
  );
}

async function upsertSubscriptionWithFallback(payload: {
  user_id: string;
  plan: Plan;
  status: string;
  gumroad_sale_id: string | null;
  gumroad_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  updated_at: string;
}) {
  const fullRes = await supabaseAdmin.from("subscriptions").upsert(payload, { onConflict: "user_id" });
  if (!fullRes.error || !isPeriodColumnError(fullRes.error)) {
    return fullRes;
  }

  return supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: payload.user_id,
      plan: payload.plan,
      status: payload.status,
      gumroad_sale_id: payload.gumroad_sale_id,
      gumroad_subscription_id: payload.gumroad_subscription_id,
      updated_at: payload.updated_at,
    },
    { onConflict: "user_id" },
  );
}

async function upsertPendingSubscriptionWithFallback(payload: {
  email: string;
  plan: Plan;
  gumroad_sale_id: string | null;
  gumroad_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
}) {
  const fullRes = await supabaseAdmin.from("pending_subscriptions").upsert(payload, { onConflict: "email" });
  if (!fullRes.error || !isPeriodColumnError(fullRes.error)) {
    return fullRes;
  }

  return supabaseAdmin.from("pending_subscriptions").upsert(
    {
      email: payload.email,
      plan: payload.plan,
      gumroad_sale_id: payload.gumroad_sale_id,
      gumroad_subscription_id: payload.gumroad_subscription_id,
    },
    { onConflict: "email" },
  );
}

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
        const { start, end } = getNextPeriodDates();

        try {
          const { data: profile, error: profileErr } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (profileErr) throw profileErr;

          if (profile?.id) {
            const { error } = await upsertSubscriptionWithFallback({
              user_id: profile.id,
              plan: newPlan,
              status,
              gumroad_sale_id: saleId,
              gumroad_subscription_id: subId,
              current_period_start: isCancel || newPlan === "free" ? null : start,
              current_period_end: isCancel || newPlan === "free" ? null : end,
              updated_at: new Date().toISOString(),
            });
            if (error) throw error;
          } else if (newPlan !== "free") {
            const { error } = await upsertPendingSubscriptionWithFallback({
              email,
              plan: newPlan,
              gumroad_sale_id: saleId,
              gumroad_subscription_id: subId,
              current_period_start: start,
              current_period_end: end,
            });
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
