import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  message: z.string().trim().min(5).max(4000),
});

const TO = "abdalahkotp31@gmail.com";

export const sendSupport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // If Resend is connected, send via the Lovable gateway.
    if (LOVABLE_API_KEY && RESEND_API_KEY) {
      try {
        const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
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
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { ok: false as const, error: `Email service error (${res.status}). ${body.slice(0, 200)}` };
        }
        return { ok: true as const, delivered: true };
      } catch (e: any) {
        return { ok: false as const, error: e?.message || "Failed to send support message." };
      }
    }

    // No email provider connected — return ok so the UI thanks the user
    // and store-and-forward on the client side via localStorage admin view.
    return { ok: true as const, delivered: false };
  });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
