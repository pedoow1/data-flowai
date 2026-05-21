import { useEffect, useState, useCallback } from "react";
import { ADMIN_EMAIL } from "./config";

const KEY = "dataflow_auth_email";
const USERS_KEY = "dataflow_users";
const ATTEMPTS_KEY = "dataflow_attempts";
const TRAFFIC_KEY = "dataflow_traffic";
const LOGS_KEY = "dataflow_logs";

export type LogEntry = { ts: number; type: string; detail: string };
type StoredUser = { email: string; passwordHash: string; createdAt: number };

function read<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; }
}
function write(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(k, JSON.stringify(v));
}

// Lightweight non-cryptographic hash — sufficient for demo localStorage auth.
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36) + "_" + s.length.toString(36);
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
export function getUsers(): StoredUser[] { return read<StoredUser[]>(USERS_KEY, []); }
export function getTraffic(): number { return read<number>(TRAFFIC_KEY, 0); }
export function bumpTraffic() { write(TRAFFIC_KEY, getTraffic() + 1); }

function recordAttempt(email: string, success: boolean) {
  const attempts = read<{ email: string; ts: number; success: boolean }[]>(ATTEMPTS_KEY, []);
  attempts.unshift({ email, ts: Date.now(), success });
  write(ATTEMPTS_KEY, attempts.slice(0, 100));
}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEmail(read<string | null>(KEY, null));
    setReady(true);
  }, []);

  const signup = useCallback((e: string, password: string): { ok: boolean; error?: string } => {
    const normalized = e.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return { ok: false, error: "Enter a valid email address." };
    if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    const users = getUsers();
    if (users.some(u => u.email === normalized)) return { ok: false, error: "An account with this email already exists. Try signing in." };
    users.push({ email: normalized, passwordHash: hash(password), createdAt: Date.now() });
    write(USERS_KEY, users);
    write(KEY, normalized);
    setEmail(normalized);
    logEvent("auth", `Signup: ${normalized}`);
    return { ok: true };
  }, []);

  const login = useCallback((e: string, password: string): { ok: boolean; error?: string } => {
    const normalized = e.trim().toLowerCase();
    const users = getUsers();
    const user = users.find(u => u.email === normalized);
    if (!user || user.passwordHash !== hash(password)) {
      recordAttempt(normalized, false);
      logEvent("auth", `Login failed: ${normalized}`);
      return { ok: false, error: "Incorrect email or password." };
    }
    recordAttempt(normalized, true);
    write(KEY, normalized);
    setEmail(normalized);
    logEvent("auth", `Login success: ${normalized}`);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    logEvent("auth", `Logout: ${email}`);
    localStorage.removeItem(KEY);
    setEmail(null);
  }, [email]);

  const isAdmin = email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  return { email, isAdmin, isAuthed: !!email, ready, login, signup, logout };
}
