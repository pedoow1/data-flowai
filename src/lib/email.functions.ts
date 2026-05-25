import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const sendConfirmationEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      redirectTo: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return { ok: false as const, error: "Email service not configured." };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "DataFlow AI <onboarding@resend.dev>",
        to: [data.email],
        subject: "Welcome to DataFlow AI",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
            <div style="background:#0a0a0a;border:1px solid #222;border-radius:16px;padding:40px 32px;text-align:center">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:#bef264;border-radius:10px;font-weight:900;font-size:20px;color:#000;margin-bottom:24px">D</div>
              <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 10px">Welcome to DataFlow AI</h1>
              <p style="color:#888;font-size:14px;line-height:1.6;margin:0 0 28px">
                Your <strong style="color:#fff">DataFlow AI</strong> account is ready. Start extracting data from your documents now.
              </p>
              <a href="${data.redirectTo ?? "https://dataflow.replit.app/dashboard"}"
                style="display:inline-block;background:#bef264;color:#000;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:-0.01em">
                Go to Dashboard
              </a>
            </div>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend error:", body);
      return { ok: false as const, error: "Failed to send email." };
    }

    return { ok: true as const };
  });
