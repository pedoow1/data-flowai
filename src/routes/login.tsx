import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { Lock, ArrowRight, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — DataFlow AI" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) nav({ to: "/dashboard" });
    else setErr(res.error ?? "Sign in failed.");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="absolute inset-0 radial-lime" />
        <div className="relative glass-strong w-full max-w-md rounded-2xl p-8">
          <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5">
            <Lock className="h-5 w-5 text-lime" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sign in to DataFlow</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Welcome back. Enter your credentials below.</p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email"
              className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition"
            />
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" autoComplete="current-password"
              className="w-full bg-black/40 border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-lime/60 transition"
            />
            {err && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0" /> {err}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60">
              {loading ? "Verifying…" : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
          <p className="mt-6 text-xs text-muted-foreground text-center">
            New to DataFlow? <Link to="/signup" className="text-lime hover:underline">Create an account</Link>
          </p>
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}
