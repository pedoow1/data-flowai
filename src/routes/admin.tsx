import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { Users, ShieldCheck, FileText, TrendingUp, Inbox, Loader2, UserCheck } from "lucide-react";
import { getAdminStats } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — DataFlow AI" }] }),
  component: AdminPage,
});

type Stats = Awaited<ReturnType<typeof getAdminStats>>;

function AdminPage() {
  const { isAdmin, ready, isAuthed } = useAuth();
  const fetchStats = useServerFn(getAdminStats);
  const { data, isLoading, error } = useQuery<Stats>({
    queryKey: ["admin-stats"],
    queryFn: () => fetchStats() as Promise<Stats>,
    enabled: ready && isAuthed && isAdmin,
    refetchInterval: 10_000,
  });

  if (ready && !isAuthed) return <Navigate to="/login" />;
  if (ready && !isAdmin) return <Navigate to="/dashboard" />;

  const maxDay = Math.max(1, ...(data?.uploadsByDay ?? []).map(d => d.count));
  const totalPaid = (data?.planCounts.pro ?? 0) + (data?.planCounts.team ?? 0);
  const freeCount = Math.max(0, (data?.totalUsers ?? 0) - totalPaid);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-8 w-full">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-lime" />
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-6">Live analytics from the backend. Refreshes every 10s.</p>

        {isLoading && (
          <div className="glass rounded-2xl p-12 flex items-center justify-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
          </div>
        )}
        {error && (
          <div className="glass rounded-2xl p-6 text-sm text-red-400">Could not load analytics: {(error as Error).message}</div>
        )}

        {data && (
          <>
            {/* ── Top stats ── */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Stat icon={<TrendingUp className="h-4 w-4" />} label="Uploads (24h)" value={data.uploadsToday} />
              <Stat icon={<Users className="h-4 w-4" />} label="Registered Users" value={data.totalUsers} />
              <Stat icon={<FileText className="h-4 w-4" />} label="Pro Subscribers" value={data.planCounts.pro ?? 0} />
              <Stat icon={<ShieldCheck className="h-4 w-4" />} label="Team Subscribers" value={data.planCounts.team ?? 0} />
            </div>

            {/* ── Plan distribution ── */}
            <div className="glass rounded-2xl p-5 mb-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-4">Plan Distribution</h3>
              <div className="grid grid-cols-3 gap-4">
                <PlanBadge label="Free" count={freeCount} total={data.totalUsers} color="text-muted-foreground" bar="bg-white/20" />
                <PlanBadge label="Pro" count={data.planCounts.pro ?? 0} total={data.totalUsers} color="text-lime" bar="bg-lime" />
                <PlanBadge label="Team" count={data.planCounts.team ?? 0} total={data.totalUsers} color="text-yellow-400" bar="bg-yellow-400" />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4 mb-4">
              <Panel title="Uploads — last 7 days">
                <div className="p-4 flex items-end gap-2 h-48">
                  {data.uploadsByDay.map(d => (
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
                  {data.topUsers.length === 0 && <Empty>No uploads tracked yet.</Empty>}
                  {data.topUsers.map((u, i) => (
                    <div key={u.email + i} className="flex items-center justify-between px-4 py-2.5 text-sm">
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

            <Panel title={`Support Inbox (${data.tickets.length})`}>
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {data.tickets.length === 0 && <Empty><Inbox className="h-4 w-4 inline mr-1.5" />No support messages.</Empty>}
                {data.tickets.map((t) => (
                  <div key={t.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">
                        {t.name}{t.email && <span className="text-muted-foreground font-normal"> · {t.email}</span>}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{t.message}</p>
                    {!t.delivered && <span className="mt-1 inline-block text-[10px] text-yellow-400">Stored — connect Resend to deliver via email</span>}
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </main>
      <PrivacyBadge />
    </div>
  );
}

function PlanBadge({ label, count, total, color, bar }: {
  label: string; count: number; total: number; color: string; bar: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{pct}%</div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
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
