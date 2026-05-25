import { useEffect, useState, useCallback } from "react";
import { getMe } from "./auth.functions";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const session = await getMe();
      if (session) {
        setUserId(session.userId);
        setEmail(session.email);
        setIsAdmin(session.isAdmin);
      } else {
        setUserId(null);
        setEmail(null);
        setIsAdmin(false);
      }
    } catch {
      setUserId(null);
      setEmail(null);
      setIsAdmin(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    window.location.href = "/__replauthuser";
    return { ok: true };
  }, []);

  const signup = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    window.location.href = "/__replauthuser";
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    window.location.href = "/__replauthuser";
  }, []);

  return { email, userId, isAdmin, isAuthed: !!userId, ready, login, signup, logout };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
