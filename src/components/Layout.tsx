import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";

export function Header() {
  const { isAuthed, isAdmin, logout, email } = useAuth();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-black/60 border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <div className="h-7 w-7 rounded-md bg-lime flex items-center justify-center text-primary-foreground font-black text-sm">D</div>
          <span className="tracking-tight">DataFlow <span className="text-lime">AI</span></span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/" className="hidden sm:block px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground" activeOptions={{ exact: true }} activeProps={{ className: "text-foreground" }}>Home</Link>
          <Link to="/pricing" className="hidden sm:block px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Pricing</Link>
          {isAuthed ? (
            <>
              <Link to="/dashboard" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5" activeProps={{ className: "text-foreground" }}>
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </Link>
              {isAdmin && (
                <Link to="/admin" className="px-3 py-1.5 rounded-md text-lime hover:opacity-80 inline-flex items-center gap-1.5" activeProps={{ className: "text-lime" }}>
                  <ShieldCheck className="h-4 w-4" /> Admin
                </Link>
              )}
              <button onClick={() => void logout()} className="ml-2 px-3 py-1.5 rounded-md border border-border text-xs inline-flex items-center gap-1.5 hover:bg-white/5">
                <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{email}</span><span className="sm:hidden">Out</span>
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground text-sm">Sign in</Link>
              <Link to="/signup" className="px-4 py-1.5 rounded-md bg-lime text-primary-foreground text-sm font-semibold hover:opacity-90">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border mt-20">
      <div className="mx-auto max-w-7xl px-6 py-10 text-xs text-muted-foreground space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="font-semibold text-foreground">DataFlow AI</span>
          <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
        </div>
        <p className="max-w-3xl leading-relaxed">
          Your files are processed instantly and are never stored on our servers. We do not use your data to train our AI models. DataFlow AI provides automated extraction tools — users are responsible for verifying all output data.
        </p>
        <p>© {new Date().getFullYear()} DataFlow AI. All rights reserved.</p>
      </div>
    </footer>
  );
}
