import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

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

    const supabase = getAdminClient();
    const redirectTo = data.redirectTo ?? "https://data-flowai.vercel.app/dashboard";

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "signup",
      email: data.email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[email] generateLink error:", linkError?.message);
      return { ok: false as const, error: linkError?.message ?? "Could not generate link." };
    }

    const confirmUrl = linkData.properties.action_link;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "DataFlow AI <onboarding@resend.dev>",
        to: [data.email],
        subject: "Confirm your DataFlow AI account",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
            <div style="background:#0a0a0a;border:1px solid #222;border-radius:16px;padding:40px 32px;text-align:center">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:#bef264;border-radius:10px;font-weight:900;font-size:20px;color:#000;margin-bottom:24px">D</div>
              <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 10px">Confirm your email</h1>
              <p style="color:#888;font-size:14px;line-height:1.6;margin:0 0 28px">
                Click the button below to verify your <strong style="color:#fff">DataFlow AI</strong> account and start extracting documents.
              </p>
              <a href="${confirmUrl}"
                style="display:inline-block;background:#bef264;color:#000;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;letter-spacing:-0.01em">
                Confirm account
              </a>
              <p style="color:#555;font-size:12px;margin:28px 0 0;line-height:1.5">
                This link expires in 24 hours.<br>
                If you didn't create this account, you can safely ignore this email.
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend error:", body);
      return { ok: false as const, error: "Failed to send confirmation email." };
    }

    return { ok: true as const };
  });
