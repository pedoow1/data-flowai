import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { UserPlus, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — DataFlow AI" }] }),
  component: SignupPage,
});

function SignupPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="absolute inset-0 radial-lime" />
        <div className="relative glass-strong w-full max-w-md rounded-2xl p-8 text-center">
          <div className="h-12 w-12 rounded-xl bg-lime/10 border border-lime/30 flex items-center justify-center mb-5 mx-auto">
            <UserPlus className="h-5 w-5 text-lime" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1.5 mb-6">Sign up instantly with your Replit account. No credit card required.</p>
          <a
            href="/__replauth"
            className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </a>
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
