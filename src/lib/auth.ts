import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

let _cachedUserId: string | null = null;
let _cachedEmail: string | null = null;
let _cachedIsAdmin: boolean = false;
let _ready = false;

export function useAuth() {
  const [email, setEmail] = useState<string | null>(_cachedEmail);
  const [userId, setUserId] = useState<string | null>(_cachedUserId);
  const [isAdmin, setIsAdmin] = useState<boolean>(_cachedIsAdmin);
  const [ready, setReady] = useState(_ready);

  useEffect(() => {
    if (_ready) return;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.userId) {
          _cachedUserId = data.userId;
          _cachedEmail = data.email ?? null;
          _cachedIsAdmin = data.isAdmin ?? false;
          setUserId(data.userId);
          setEmail(data.email ?? null);
          setIsAdmin(data.isAdmin ?? false);
        } else {
          _cachedUserId = null;
          _cachedEmail = null;
          _cachedIsAdmin = false;
          setUserId(null);
          setEmail(null);
          setIsAdmin(false);
        }
        _ready = true;
        setReady(true);
      })
      .catch(() => {
        _ready = true;
        setReady(true);
      });
  }, []);

  const logout = useCallback(async () => {
    _cachedUserId = null;
    _cachedEmail = null;
    _cachedIsAdmin = false;
    _ready = false;
    setUserId(null);
    setEmail(null);
    setIsAdmin(false);
    setReady(false);
    window.location.href = "/__replauthlogout";
  }, []);

  const login = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Please use the Sign in button." };
  }, []);

  const signup = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Please use the Sign up button." };
  }, []);

  return { email, userId, isAdmin, isAuthed: !!userId, ready, login, signup, logout };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
