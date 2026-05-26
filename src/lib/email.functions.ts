import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Simple in-memory store for verification codes (in production, use a database)
const verificationCodes = new Map<string, { code: string; createdAt: number; userId?: string }>();

// Clean up expired codes (older than 15 minutes)
const cleanupExpiredCodes = () => {
  const now = Date.now();
  for (const [email, data] of verificationCodes.entries()) {
    if (now - data.createdAt > 15 * 60 * 1000) {
      verificationCodes.delete(email);
    }
  }
};

const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendVerificationEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      userId: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return { ok: true as const };
    }

    cleanupExpiredCodes();
    const otp = generateOTP();
    verificationCodes.set(data.email, { code: otp, createdAt: Date.now(), userId: data.userId });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "DataFlow AI <onboarding@resend.dev>",
        to: [data.email],
        subject: "Verify your email for DataFlow AI",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
            <div style="background:#0a0a0a;border:1px solid #222;border-radius:16px;padding:40px 32px;text-align:center">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:#bef264;border-radius:10px;font-weight:900;font-size:20px;color:#000;margin-bottom:24px">D</div>
              <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 10px">Verify your email</h1>
              <p style="color:#888;font-size:14px;line-height:1.6;margin:0 0 28px">
                Your verification code is:
              </p>
              <div style="background:#1a1a1a;border:2px solid #bef264;border-radius:12px;padding:20px;margin:0 0 28px">
                <div style="font-family:monospace;font-size:32px;font-weight:900;color:#bef264;letter-spacing:8px">${otp}</div>
              </div>
              <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 20px">
                Enter this code on the verification screen to confirm your email address.
              </p>
              <p style="color:#555;font-size:12px;margin:28px 0 0;line-height:1.5">
                This code expires in 15 minutes. If you did not create this account, you can safely ignore this email.
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend error:", body);
    }

    return { ok: true as const };
  });

export const verifyEmailCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email(),
      code: z.string().length(6),
    }).parse(d)
  )
  .handler(async ({ data }) => {
    cleanupExpiredCodes();
    
    const stored = verificationCodes.get(data.email);
    if (!stored) {
      return { ok: false as const, error: "No verification code found. Please request a new one." };
    }

    if (stored.code !== data.code) {
      return { ok: false as const, error: "Invalid verification code." };
    }

    // Code is valid, delete it
    verificationCodes.delete(data.email);

    return { ok: true as const };
  });
