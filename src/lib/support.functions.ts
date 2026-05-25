import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  message: z.string().trim().min(5).max(4000),
});

const TO = "abdalahkotp31@gmail.com";

export const sendSupport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    let delivered = false;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (RESEND_API_KEY) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "DataFlow AI Support <onboarding@resend.dev>",
            to: [TO],
            reply_to: data.email || undefined,
            subject: `[DataFlow Support] from ${data.name}`,
            html: `<p><strong>From:</strong> ${escapeHtml(data.name)}${data.email ? ` &lt;${escapeHtml(data.email)}&gt;` : ""}</p>
                   <p><strong>Message:</strong></p>
                   <pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(data.message)}</pre>`,
          }),
        });
        delivered = res.ok;
      } catch (e) {
        console.error("[support] resend failed", e);
      }
    }

    try {
      await supabaseAdmin.from("support_tickets").insert({
        name: data.name,
        email: data.email || null,
        message: data.message,
        delivered,
      });
    } catch (e) {
      console.error("[support] insert failed", e);
    }

    return { ok: true as const, delivered };
  });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
