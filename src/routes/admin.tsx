import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, getAttempts, getLogs, getTraffic, getUsers } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { useEffect, useState } from "react";
import { Activity, Users, ShieldCheck, FileText, TrendingUp, Inbox } from "lucide-react";
import { allUsage, uploadsByDay, uploadsLast24h } from "@/lib/rateLimit";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — DataFlow AI" }] }),
  component: AdminPage,
});

type Ticket = { name: string; email?: string; message: string; ts: number; delivered?: boolean };

function AdminPage() {
  const { isAdmin, ready } = useAuth();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick(t => t + 1), 3000);
    return () => clearInterval(i);
  }, []);

  if (ready && !isAdmin) return <Navigate to="/login" />;

  const attempts = getAttempts();
  const logs = getLogs();
  const traffic = getTraffic();
  const users = getUsers();
  const usage = allUsage();
  const days = uploadsByDay(7);
  const today = uploadsLast24h();
  const maxDay = Math.max(1, ...days.map(d => d.count));
  const tickets: Ticket[] = (() => {
    try { return JSON.parse(localStorage.getItem("dataflow_support_tickets") || "[]"); } catch { return []; }
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-8 w-full">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-lime" />
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-6">Local/demo data — based on this browser's storage. Enable Lovable Cloud for cross‑device analytics.</p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat icon={<TrendingUp className="h-4 w-4" />} label="Uploads (24h)" value={today} />
          <Stat icon={<Users className="h-4 w-4" />} label="Registered Users" value={users.length} />
          <Stat icon={<Activity className="h-4 w-4" />} label="Total Traffic" value={traffic} />
          <Stat icon={<FileText className="h-4 w-4" />} label="System Events" value={logs.length} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <Panel title="Uploads — last 7 days">
            <div className="p-4 flex items-end gap-2 h-48">
              {days.map(d => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-muted-foreground font-mono">{d.count}</div>
                  <div className="w-full bg-lime/80 rounded-t" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 2 }} />
                  <div className="text-[10px] text-muted-foreground">{d.day.slice(5)}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Top Active Users (24h)">
            <div className="divide-y divide-border max-h-72 overflow-y-auto">
              {usage.length === 0 && <Empty>No uploads tracked yet.</Empty>}
              {usage.slice(0, 10).map((u, i) => (
                <div key={u.email} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
                    <span className="font-mono text-xs truncate">{u.email}</span>
                  </div>
                  <span className="text-xs text-lime font-mono">{u.used}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title={`Support Inbox (${tickets.length})`}>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {tickets.length === 0 && <Empty><Inbox className="h-4 w-4 inline mr-1.5" />No support messages.</Empty>}
              {tickets.map((t, i) => (
                <div key={i} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">{t.name}{t.email && <span className="text-muted-foreground font-normal"> · {t.email}</span>}</div>
                    <span className="text-[10px] text-muted-foreground">{new Date(t.ts).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{t.message}</p>
                  {!t.delivered && <span className="mt-1 inline-block text-[10px] text-yellow-400">Pending — connect Resend to deliver via email</span>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Recent Login Attempts">
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {attempts.length === 0 && <Empty>No attempts yet.</Empty>}
              {attempts.map((a, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs truncate">{a.email}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(a.ts).toLocaleString()}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${a.success ? "text-lime border-lime/30 bg-lime/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
                    {a.success ? "GRANTED" : "DENIED"}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-semibold text-sm">{title}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-xs text-muted-foreground">{children}</div>;
}
