import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — DataFlow AI" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { isAuthed, ready } = useAuth();

  if (ready && isAuthed) return <Navigate to="/dashboard" />;

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
          <p className="text-sm text-muted-foreground mt-1.5">
            Log in with your Replit account to continue.
          </p>
          <div className="mt-6">
            <a
              href="/api/auth/login"
              className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition"
            >
              Log in
            </a>
          </div>
          <p className="mt-6 text-xs text-muted-foreground text-center">
            New here? Just click Log in — your account is created automatically.
          </p>
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}
