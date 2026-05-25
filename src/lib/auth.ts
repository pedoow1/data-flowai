import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMe, logoutFn } from "./auth.functions";

export type LogEntry = { ts: number; type: string; detail: string };
export function logEvent(_type: string, _detail: string) {}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  const fetchMe = useServerFn(getMe);
  const logoutServer = useServerFn(logoutFn);

  const refresh = useCallback(async () => {
    try {
      const me = (await fetchMe()) as { userId: string; email: string; isAdmin: boolean } | null;
      if (me) {
        setUserId(me.userId);
        setEmail(me.email);
        setIsAdmin(me.isAdmin);
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
  }, [fetchMe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await logoutServer();
    } catch {}
    setUserId(null);
    setEmail(null);
    setIsAdmin(false);
    window.location.href = "/";
  }, [logoutServer]);

  const login = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Use the Replit login button." };
  }, []);

  const signup = useCallback(async (_e: string, _password: string): Promise<{ ok: boolean; error?: string }> => {
    return { ok: false, error: "Use the Replit login button." };
  }, []);

  return { email, userId, isAdmin, isAuthed: !!userId, ready, login, signup, logout };
}

export function getLogs(): LogEntry[] { return []; }
export function getAttempts(): { email: string; ts: number; success: boolean }[] { return []; }
export function getUsers(): { email: string; createdAt: number }[] { return []; }
export function getTraffic(): number { return 0; }
export function bumpTraffic() {}
