import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

export type AuthUser = {
  id: string;
  name: string;
  email?: string;
  profileImage?: string;
  roles?: string[];
  bio?: string;
  url?: string;
};

let _cachedUser: AuthUser | null | undefined = undefined;

async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (_cachedUser !== undefined) return _cachedUser;
  try {
    const res = await fetch("/__replauthuser");
    if (!res.ok) { _cachedUser = null; return null; }
    const data = await res.json();
    if (!data?.id) { _cachedUser = null; return null; }
    _cachedUser = data as AuthUser;
    return _cachedUser;
  } catch {
    _cachedUser = null;
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUser(u);
      if (u) {
        const email = u.email ?? "";
        setIsAdmin(email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || (u.roles ?? []).includes("admin"));
      }
      setReady(true);
    });
  }, []);

  const logout = useCallback(() => {
    _cachedUser = undefined;
    window.location.href = "/__replauth?logout=1";
  }, []);

  const login = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    window.location.href = "/__replauth";
    return { ok: true };
  }, []);

  const signup = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    window.location.href = "/__replauth";
    return { ok: true };
  }, []);

  return {
    email: user?.email ?? null,
    userId: user?.id ?? null,
    isAdmin,
    isAuthed: !!user,
    ready,
    login,
    signup,
    logout,
  };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
