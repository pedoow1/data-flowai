import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

let _cachedUserId: string | null = null;
let _cachedEmail: string | null = null;
let _cachedIsAdmin: boolean = false;

export function useAuth() {
  const [email, setEmail] = useState<string | null>(_cachedEmail);
  const [userId, setUserId] = useState<string | null>(_cachedUserId);
  const [isAdmin, setIsAdmin] = useState<boolean>(_cachedIsAdmin);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: { userId: string | null; email: string | null; isAdmin: boolean }) => {
        _cachedUserId = data.userId;
        _cachedEmail = data.email;
        _cachedIsAdmin = data.isAdmin ?? false;
        setUserId(data.userId);
        setEmail(data.email);
        setIsAdmin(data.isAdmin ?? false);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  const logout = useCallback(async () => {
    _cachedUserId = null;
    _cachedEmail = null;
    _cachedIsAdmin = false;
    setUserId(null);
    setEmail(null);
    setIsAdmin(false);
    window.location.href = "/__replauthlogout";
  }, []);

  return {
    email,
    userId,
    isAdmin,
    isAuthed: !!userId,
    ready,
    logout,
    login: async () => ({ ok: false, error: "Use Replit login" }),
    signup: async () => ({ ok: false, error: "Use Replit login" }),
  };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
