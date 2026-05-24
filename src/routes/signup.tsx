import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { lovable } from "@/integrations/lovable";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { UserPlus, ArrowRight, AlertCircle, MailCheck } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — DataFlow AI" }] }),
  component: SignupPage,
});

function SignupPage() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) { setErr("Passwords do not match."); return; }
    setLoading(true);
    const res = await signup(email, password);
    setLoading(false);
    if (res.ok) setSent(true);
    else setErr(res.error ?? "Sign up failed.");
  };

  const googleSignIn = async () => {
    setErr(null);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/dashboard" });
    if (res.error) setErr(res.error.message || "Google sign-in failed.");
  };


  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="absolute inset-0 radial-lime" />
        <div className="relative glass-strong w-full max-w-md rounded-2xl p-8">
          <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
            <UserPlus className="h-5 w-5 text-lime" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Start extracting in seconds. No credit card required.</p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email"
              className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition"
            />
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min. 6 characters)" autoComplete="new-password"
              className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition"
            />
            <input
              type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password" autoComplete="new-password"
              className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition"
            />
            {err && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" /> {err}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60">
              {loading ? "Creating…" : <>Create account <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
          <p className="mt-6 text-xs text-muted-foreground text-center">
            Already have an account? <Link to="/login" className="text-lime hover:underline">Sign in</Link>
          </p>
          <p className="mt-3 text-[10px] text-muted-foreground/70 text-center">
            By creating an account, you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}
