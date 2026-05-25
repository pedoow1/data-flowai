import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../../server/db";
import { profiles, subscriptions, pendingSubscriptions } from "../../../../shared/schema";
import { eq, ilike } from "drizzle-orm";
import { GUMROAD_PRODUCT_TO_PLAN, type Plan } from "../../../lib/config";

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

        const profileRows = await db
          .select({ id: profiles.id })
          .from(profiles)
          .where(ilike(profiles.email, email))
          .limit(1);

        if (profileRows.length > 0) {
          const profileId = profileRows[0].id;
          try {
            await db
              .insert(subscriptions)
              .values({
                userId: profileId,
                plan: newPlan,
                status: isCancel ? "cancelled" : "active",
                gumroadSaleId: saleId ?? null,
                gumroadSubscriptionId: subId ?? null,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: subscriptions.userId,
                set: {
                  plan: newPlan,
                  status: isCancel ? "cancelled" : "active",
                  gumroadSaleId: saleId ?? null,
                  gumroadSubscriptionId: subId ?? null,
                  updatedAt: new Date(),
                },
              });
          } catch (error) {
            console.error("[gumroad] subscription upsert failed:", error);
            return new Response("DB error", { status: 500 });
          }
        } else {
          if (newPlan !== "free") {
            await db
              .insert(pendingSubscriptions)
              .values({
                email,
                plan: newPlan,
                gumroadSaleId: saleId ?? null,
                gumroadSubscriptionId: subId ?? null,
              })
              .onConflictDoUpdate({
                target: pendingSubscriptions.email,
                set: {
                  plan: newPlan,
                  gumroadSaleId: saleId ?? null,
                  gumroadSubscriptionId: subId ?? null,
                },
              });
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
