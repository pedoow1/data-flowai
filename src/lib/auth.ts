import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

export type AuthUser = {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  isAuthed: boolean;
  ready: boolean;
};

let _cached: AuthUser | null = null;
let _promise: Promise<AuthUser> | null = null;

async function fetchAuthUser(): Promise<AuthUser> {
  if (_cached) return _cached;
  if (_promise) return _promise;
  _promise = fetch("/api/auth/me")
    .then(async (r) => {
      if (!r.ok) return { userId: null, email: null, isAdmin: false, isAuthed: false, ready: true };
      const d = await r.json();
      return {
        userId: d.userId ?? null,
        email: d.email ?? null,
        isAdmin: d.isAdmin ?? false,
        isAuthed: !!d.userId,
        ready: true,
      };
    })
    .catch(() => ({ userId: null, email: null, isAdmin: false, isAuthed: false, ready: true }))
    .finally(() => { _promise = null; });
  return _promise;
}

export function invalidateAuthCache() {
  _cached = null;
  _promise = null;
}

export function useAuth() {
  const [state, setState] = useState<AuthUser>({
    userId: null,
    email: null,
    isAdmin: false,
    isAuthed: false,
    ready: false,
  });

  const refresh = useCallback(async () => {
    invalidateAuthCache();
    const user = await fetchAuthUser();
    setState(user);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAuthUser().then((user) => { if (!cancelled) setState(user); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Please use the Log in button." };
  }, []);

  const signup = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Please use the Log in button." };
  }, []);

  const logout = useCallback(async () => {
    invalidateAuthCache();
    window.location.href = "https://replit.com/logout";
  }, []);

  return { ...state, login, signup, logout, refresh };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
