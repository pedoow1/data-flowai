import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

const KEY = "dataflow_auth_email";
const ATTEMPTS_KEY = "dataflow_attempts";
const TRAFFIC_KEY = "dataflow_traffic";
const LOGS_KEY = "dataflow_logs";

export type LogEntry = { ts: number; type: string; detail: string };

function read<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; }
}
function write(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(k, JSON.stringify(v));
}

export function logEvent(type: string, detail: string) {
  const logs = read<LogEntry[]>(LOGS_KEY, []);
  logs.unshift({ ts: Date.now(), type, detail });
  write(LOGS_KEY, logs.slice(0, 200));
}

export function getLogs(): LogEntry[] { return read<LogEntry[]>(LOGS_KEY, []); }
export function getAttempts(): { email: string; ts: number; success: boolean }[] {
  return read(ATTEMPTS_KEY, []);
}
export function getTraffic(): number { return read<number>(TRAFFIC_KEY, 0); }
export function bumpTraffic() {
  const cur = getTraffic();
  write(TRAFFIC_KEY, cur + 1);
}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEmail(read<string | null>(KEY, null));
    setReady(true);
  }, []);

  const login = useCallback((e: string) => {
    const normalized = e.trim().toLowerCase();
    const success = normalized === ADMIN_EMAIL.toLowerCase();
    const attempts = read<{ email: string; ts: number; success: boolean }[]>(ATTEMPTS_KEY, []);
    attempts.unshift({ email: normalized, ts: Date.now(), success });
    write(ATTEMPTS_KEY, attempts.slice(0, 100));
    if (success) {
      write(KEY, normalized);
      setEmail(normalized);
      logEvent("auth", `Login success: ${normalized}`);
      return true;
    }
    logEvent("auth", `Login failed: ${normalized}`);
    return false;
  }, []);

  const logout = useCallback(() => {
    logEvent("auth", `Logout: ${email}`);
    localStorage.removeItem(KEY);
    setEmail(null);
  }, [email]);

  const isAdmin = email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  return { email, isAdmin, isAuthed: !!email, ready, login, logout };
}
