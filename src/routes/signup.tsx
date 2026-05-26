import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { lovable } from "@/integrations/lovable";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { sendVerificationEmail, verifyEmailCode } from "@/lib/email.functions";
import { UserPlus, ArrowRight, AlertCircle, MailCheck, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — DataFlow AI" }] }),
  component: SignupPage,
});

type SignupStep = "form" | "verify" | "success";

function SignupPage() {
  const navigate = useNavigate();
  const { signup, isAuthed } = useAuth();
  const sendEmail = useServerFn(sendVerificationEmail);
  const verifyCode = useServerFn(verifyEmailCode);
  
  const [step, setStep] = useState<SignupStep>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthed) {
      navigate({ to: "/dashboard" });
    }
  }, [isAuthed, navigate]);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      // Create user in Supabase
      const res = await signup(email, password);
      if (!res.ok) {
        setErr(res.error ?? "Sign up failed.");
        setLoading(false);
        return;
      }

      // Send verification email with OTP
      try {
        await sendEmail({
          data: {
            email: email.trim().toLowerCase(),
            userId: undefined, // Will be set by auth hook if needed
          },
        });
      } catch (emailErr) {
        console.error("Failed to send verification email:", emailErr);
        setErr("Failed to send verification email. Please try again.");
        setLoading(false);
        return;
      }

      setStep("verify");
      setResendCountdown(60);
    } catch (signupErr: any) {
      setErr(signupErr?.message || "An error occurred during signup.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (verificationCode.length !== 6) {
      setErr("Please enter the 6-digit code.");
      return;
    }

    setLoading(true);

    try {
      const res = await verifyCode({
        data: {
          email: email.trim().toLowerCase(),
          code: verificationCode,
        },
      });

      if (!res.ok) {
        setErr(res.error ?? "Invalid verification code.");
        setLoading(false);
        return;
      }

      // Code verified successfully
      setStep("success");
      setLoading(false);

      // Redirect to login after 2 seconds
      setTimeout(() => {
        navigate({ to: "/login" });
      }, 2000);
    } catch (verifyErr: any) {
      setErr(verifyErr?.message || "Verification failed.");
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;
    
    setErr(null);
    setLoading(true);

    try {
      await sendEmail({
        data: {
          email: email.trim().toLowerCase(),
          userId: undefined,
        },
      });
      setResendCountdown(60);
      setVerificationCode("");
    } catch (err) {
      setErr("Failed to resend code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const googleSignIn = async () => {
    setErr(null);
    try {
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/dashboard",
      });
      if ("error" in res && res.error) {
        setErr((res.error as Error).message || "Google sign-in failed.");
      }
    } catch (err: any) {
      setErr(err?.message || "Google sign-in failed.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="absolute inset-0 radial-lime" />
        <div className="relative glass-strong w-full max-w-md rounded-2xl p-8">
          {/* Form Step */}
          {step === "form" && (
            <>
              <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
                <UserPlus className="h-5 w-5 text-lime" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Verify your email, then start extracting. No credit card required.
              </p>

              <form onSubmit={handleSignup} className="mt-6 space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  disabled={loading}
                  className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                />

                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (min. 6 characters)"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                />

                <input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                />

                {err && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      Create account <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="flex-1 h-px bg-border" /> or <span className="flex-1 h-px bg-border" />
              </div>

              <button
                type="button"
                onClick={googleSignIn}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-white text-black font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </button>

              <p className="mt-6 text-xs text-muted-foreground text-center">
                Already have an account?{" "}
                <Link to="/login" className="text-lime hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}

          {/* Verification Step */}
          {step === "verify" && (
            <>
              <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
                <MailCheck className="h-5 w-5 text-lime" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Verify your email</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                We sent a 6-digit code to <span className="text-foreground font-medium">{email}</span>. Enter it below to verify.
              </p>

              <form onSubmit={handleVerifyCode} className="mt-6 space-y-3">
                <div>
                  <label htmlFor="code" className="block text-xs font-medium text-muted-foreground mb-2">
                    Verification Code
                  </label>
                  <input
                    id="code"
                    type="text"
                    maxLength={6}
                    required
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    disabled={loading}
                    className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-center text-2xl font-bold tracking-widest outline-none focus:border-lime/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Enter the 6 digits from your email</p>
                </div>

                {err && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || verificationCode.length !== 6}
                  className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    <>
                      Verify Email <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs text-muted-foreground text-center mb-3">
                  Didn't receive the code?
                </p>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={resendCountdown > 0 || loading}
                  className="w-full text-sm text-lime hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Resend code"}
                </button>
              </div>

              <p className="mt-6 text-xs text-muted-foreground text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep("form");
                    setEmail("");
                    setPassword("");
                    setConfirm("");
                    setVerificationCode("");
                    setErr(null);
                  }}
                  className="text-lime hover:underline"
                >
                  Back to sign up
                </button>
              </p>
            </>
          )}

          {/* Success Step */}
          {step === "success" && (
            <>
              <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
                <CheckCircle2 className="h-5 w-5 text-lime" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-center">Email verified!</h1>
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Your email has been successfully verified. You can now sign in with your credentials.
              </p>

              <div className="mt-8 flex flex-col gap-2">
                <div className="flex items-center justify-center gap-2 text-sm text-lime">
                  <CheckCircle2 className="h-4 w-4" />
                  Email: <span className="font-medium">{email}</span>
                </div>
              </div>

              <p className="mt-8 text-xs text-muted-foreground text-center text-yellow-500">
                Redirecting to login page...
              </p>
            </>
          )}

          <p className="mt-6 text-[10px] text-muted-foreground/70 text-center">
            By creating an account, you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}
