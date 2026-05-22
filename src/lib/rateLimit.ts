// Rolling 24h per-email rate limit, stored in localStorage.
export const DAILY_LIMIT = 100;
const KEY = "dataflow_ratelimit";
const DAY = 24 * 60 * 60 * 1000;

type Store = Record<string, number[]>; // email -> timestamps

function load(): Store {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function save(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}
function cleanup(arr: number[]): number[] {
  const cutoff = Date.now() - DAY;
  return arr.filter(t => t > cutoff);
}

export function getUsage(email: string) {
  const s = load();
  const arr = cleanup(s[email] || []);
  return { used: arr.length, remaining: Math.max(0, DAILY_LIMIT - arr.length), limit: DAILY_LIMIT };
}

export function consume(email: string): { ok: boolean; remaining: number } {
  const s = load();
  const arr = cleanup(s[email] || []);
  if (arr.length >= DAILY_LIMIT) return { ok: false, remaining: 0 };
  arr.push(Date.now());
  s[email] = arr;
  save(s);
  return { ok: true, remaining: DAILY_LIMIT - arr.length };
}

// All users summary for admin
export function allUsage(): { email: string; used: number }[] {
  const s = load();
  return Object.entries(s)
    .map(([email, arr]) => ({ email, used: cleanup(arr).length }))
    .sort((a, b) => b.used - a.used);
}

export function uploadsLast24h(): number {
  const s = load();
  return Object.values(s).reduce((n, arr) => n + cleanup(arr).length, 0);
}

export function uploadsByDay(days = 7): { day: string; count: number }[] {
  const s = load();
  const buckets: Record<string, number> = {};
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const arr of Object.values(s)) {
    for (const t of arr) {
      const key = new Date(t).toISOString().slice(0, 10);
      if (key in buckets) buckets[key] += 1;
    }
  }
  return Object.entries(buckets).map(([day, count]) => ({ day, count }));
}
