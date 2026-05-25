import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAIL } from "./config";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

// Module-level cache so any new Header/component instance starts with the
// last-known session immediately — no async flash of "Sign in / Sign up".
let _cachedUserId: string | null = null;
let _cachedEmail: string | null = null;
let _cachedIsAdmin: boolean = false;

export function useAuth() {
  const [email, setEmail] = useState<string | null>(_cachedEmail);
  const [userId, setUserId] = useState<string | null>(_cachedUserId);
  const [isAdmin, setIsAdmin] = useState<boolean>(_cachedIsAdmin);
  const [ready, setReady] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    // If no Supabase token in localStorage we're definitely logged out — show buttons immediately
    const hasToken = Object.keys(localStorage).some(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token")
    );
    return !hasToken;
  });

  const applyUser = useCallback((u: { id: string; email?: string | null } | null) => {
    const id = u?.id ?? null;
    const mail = u?.email ?? null;
    _cachedUserId = id;
    _cachedEmail = mail;
    setUserId(id);
    setEmail(mail);
  }, []);

  const refreshRole = useCallback(async (uid: string | null, mail: string | null) => {
    if (!uid) { _cachedIsAdmin = false; setIsAdmin(false); return; }
    if (mail && mail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      _cachedIsAdmin = true; setIsAdmin(true);
      return;
    }
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "admin")
        .maybeSingle();
      _cachedIsAdmin = !!data;
      setIsAdmin(!!data);
    } catch {
      // network failure — keep existing admin state, don't block the UI
    }
  }, []);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    try {
      // Listen for future auth state changes (login / logout / token refresh)
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        const u = session?.user ?? null;
        applyUser(u);
        void refreshRole(u?.id ?? null, u?.email ?? null);
      });
      subscription = data.subscription;
    } catch {
      // Supabase not configured in this environment — show logged-out UI
      setReady(true);
      return;
    }

    // Hydrate from the stored session once on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      applyUser(u);
      setReady(true);
      void refreshRole(u?.id ?? null, u?.email ?? null);
    }).catch(() => {
      setReady(true);
    });

    return () => subscription?.unsubscribe();
  }, [applyUser, refreshRole]);

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
    _cachedUserId = null;
    _cachedEmail = null;
    _cachedIsAdmin = false;
    await supabase.auth.signOut();
  }, []);

  return { email, userId, isAdmin, isAuthed: !!userId, ready, login, signup, logout };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
