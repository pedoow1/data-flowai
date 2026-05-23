// Supabase-backed auth + role hook.
// Keeps the same useAuth() shape that the rest of the app already imports.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAIL } from "./config";

// Lightweight no-op event logger kept for backwards compatibility.
// Real audit logging now lives in the database (uploads, subscriptions, support_tickets).
export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {
  // intentional no-op
}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  // Refresh admin role from user_roles table.
  const refreshRole = useCallback(async (uid: string | null, mail: string | null) => {
    if (!uid) { setIsAdmin(false); return; }
    // Fast path: known admin email
    if (mail && mail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      setIsAdmin(true);
      return;
    }
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
  }, []);

  useEffect(() => {
    // Listener first, then initial session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUserId(u?.id ?? null);
      setEmail(u?.email ?? null);
      // Defer role lookup to avoid blocking the auth callback.
      setTimeout(() => { void refreshRole(u?.id ?? null, u?.email ?? null); }, 0);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUserId(u?.id ?? null);
      setEmail(u?.email ?? null);
      void refreshRole(u?.id ?? null, u?.email ?? null).finally(() => setReady(true));
    });

    return () => subscription.unsubscribe();
  }, [refreshRole]);

  const signup = useCallback(async (e: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    const normalized = e.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { ok: false, error: "Enter a valid email address." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    const { error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (error) {
      if (/registered|already/i.test(error.message)) {
        return { ok: false, error: "An account with this email already exists. Try signing in." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }, []);

  const login = useCallback(async (e: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    const normalized = e.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error) return { ok: false, error: "Incorrect email or password." };
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { email, userId, isAdmin, isAuthed: !!userId, ready, login, signup, logout };
}

// Deprecated localStorage analytics — return empty arrays so old admin code compiles.
export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() { /* no-op */ }
