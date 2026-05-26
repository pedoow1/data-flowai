import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { lovable } from "@/integrations/lovable";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { UserPlus, AlertCircle, MailCheck, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — DataFlow AI" }] }),
  component: SignupPage,
});

type SignupStep = "oauth" | "success";

function SignupPage() {
  const navigate = useNavigate();
  const { isAuthed, ready } = useAuth();
  
  const [step, setStep] = useState<SignupStep>("oauth");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthed && ready) {
      navigate({ to: "/dashboard" });
    }
  }, [isAuthed, ready, navigate]);

  const googleSignUp = async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await lovable.auth.signInWithOAuth("google");
      if ("error" in res && res.error) {
        setErr((res.error as Error).message || "Google sign-up failed.");
        setLoading(false);
      }
      // If successful, Supabase will redirect automatically
    } catch (err: any) {
      setErr(err?.message || "An error occurred during sign-up.");
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-lime mx-auto mb-2" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="absolute inset-0 radial-lime" />
        <div className="relative glass-strong w-full max-w-md rounded-2xl p-8">
          {/* OAuth Sign Up Step */}
          {step === "oauth" && (
            <>
              <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
                <UserPlus className="h-5 w-5 text-lime" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Sign up with Google to start extracting documents. No credit card required.
              </p>

              <div className="mt-8 space-y-4">
                {err && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {err}
                  </div>
                )}

                <button
                  type="button"
                  onClick={googleSignUp}
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Creating account…
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24">
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
                      Sign up with Google
                    </>
                  )}
                </button>
              </div>

              <p className="mt-8 text-xs text-muted-foreground text-center">
                Already have an account?{" "}
                <Link to="/login" className="text-lime hover:underline font-medium">
                  Sign in
                </Link>
              </p>

              <p className="mt-3 text-[10px] text-muted-foreground/70 text-center">
                By creating an account, you agree to our Terms and Privacy Policy.
              </p>
            </>
          )}

          {/* Success Step */}
          {step === "success" && (
            <>
              <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
                <CheckCircle2 className="h-5 w-5 text-lime" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-center">Welcome!</h1>
              <p className="text-sm text-muted-foreground mt-2 text-center">
                Your account has been successfully created. You're now ready to start extracting documents.
              </p>

              <div className="mt-8 flex flex-col gap-2">
                <Link
                  to="/dashboard"
                  className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition"
                >
                  Go to Dashboard
                </Link>
              </div>

              <p className="mt-6 text-xs text-muted-foreground text-center">
                <Link to="/login" className="text-lime hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}
