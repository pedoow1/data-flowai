import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { Users, ShieldCheck, FileText, TrendingUp, Inbox, Loader2, UserCheck } from "lucide-react";
import { getAdminStats, getAdminUsers, setUserPlan, type AdminUser } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — DataFlow AI" }] }),
  component: AdminPage,
});

type Stats = Awaited<ReturnType<typeof getAdminStats>>;

const PLAN_COLOR: Record<string, string> = {
  free: "text-muted-foreground border-border/60",
  pro:  "text-lime border-lime/60",
  team: "text-yellow-400 border-yellow-400/60",
};

function AdminPage() {
  const { isAdmin, ready, isAuthed } = useAuth();
  const fetchStats = useServerFn(getAdminStats);
  const fetchUsers = useServerFn(getAdminUsers);
  const changePlan = useServerFn(setUserPlan);
  const qc = useQueryClient();

  const [changingId, setChangingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<Stats>({
    queryKey: ["admin-stats"],
    queryFn: () => fetchStats() as Promise<Stats>,
    enabled: ready && isAuthed && isAdmin,
    refetchInterval: 10_000,
  });

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => fetchUsers() as Promise<AdminUser[]>,
    enabled: ready && isAuthed && isAdmin,
    refetchInterval: 30_000,
  });

  if (ready && !isAuthed) return <Navigate to="/login" />;
  if (ready && !isAdmin) return <Navigate to="/dashboard" />;

  const maxDay = Math.max(1, ...(data?.uploadsByDay ?? []).map(d => d.count));
  const totalPaid = (data?.planCounts.pro ?? 0) + (data?.planCounts.team ?? 0);
  const freeCount = Math.max(0, (data?.totalUsers ?? 0) - totalPaid);

  const handlePlanChange = async (userId: string, plan: "free" | "pro" | "team") => {
    setChangingId(userId);
    try {
      const res = await changePlan({ data: { userId, plan } }) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? "Unknown error");
      toast.success(`Plan updated to ${plan.toUpperCase()}`);
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
      await qc.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (e) {
      toast.error("Failed to update plan", { description: (e as Error).message });
    } finally {
      setChangingId(null);
    }
  };

  const filtered = (users ?? []).filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase())
  );

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

        {/* ── Users Management ── */}
        <div className="mt-4 glass rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-lime" />
              <span className="font-semibold text-sm">
                Users Management
                {users && <span className="ml-2 text-xs text-muted-foreground font-normal">({users.length} users)</span>}
              </span>
            </div>
            <input
              type="text"
              placeholder="Search by email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg bg-white/5 border border-border focus:outline-none focus:border-lime/60 w-52"
            />
          </div>

          {usersLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
            </div>
          )}

          {!usersLoading && filtered.length === 0 && (
            <Empty>{search ? `No users matching "${search}"` : "No users found."}</Empty>
          )}

          {!usersLoading && filtered.length > 0 && (
            <>
            <div className="grid gap-3 p-4 sm:hidden">
              {filtered.map((u, i) => (
                <div key={u.id} className="rounded-xl border border-border/60 bg-white/[0.02] p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">#{i + 1}</div>
                      <div className="font-mono text-xs break-all">{u.email}</div>
                    </div>
                    <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 ${PLAN_COLOR[u.plan] ?? PLAN_COLOR.free}`}>
                      {u.plan.toUpperCase()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-muted-foreground block">Uploads 24h</span><span className="font-mono">{u.uploads24h}</span></div>
                    <div><span className="text-muted-foreground block">Joined</span><span>{new Date(u.joinedAt).toLocaleDateString()}</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["free", "pro", "team"] as const).map((p) => (
                      <button
                        key={p}
                        disabled={changingId === u.id || p === u.plan}
                        onClick={() => handlePlanChange(u.id, p)}
                        className={`px-2 py-2 rounded text-[11px] font-semibold border transition disabled:opacity-40 ${
                          p === u.plan
                            ? p === "team"
                              ? "bg-yellow-400/20 text-yellow-400 border-yellow-400/50"
                              : p === "pro"
                                ? "bg-lime/20 text-lime border-lime/50"
                                : "bg-white/10 text-foreground border-border"
                            : "bg-transparent text-muted-foreground border-border/50"
                        }`}
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5 font-medium">#</th>
                    <th className="text-left px-4 py-2.5 font-medium">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                    <th className="text-left px-4 py-2.5 font-medium">Uploads 24h</th>
                    <th className="text-left px-4 py-2.5 font-medium">Joined</th>
                    <th className="text-left px-4 py-2.5 font-medium">Change Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtered.map((u, i) => (
                    <UserRow
                      key={u.id}
                      index={i + 1}
                      user={u}
                      changing={changingId === u.id}
                      onPlanChange={(plan) => handlePlanChange(u.id, plan)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </main>
      <PrivacyBadge />
    </div>
  );
}

function UserRow({ index, user, changing, onPlanChange }: {
  index: number;
  user: AdminUser;
  changing: boolean;
  onPlanChange: (plan: "free" | "pro" | "team") => void;
}) {
  return (
    <tr className="hover:bg-white/[0.02] transition-colors">
      <td className="px-4 py-3 text-xs text-muted-foreground">{index}</td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs truncate max-w-[220px] block">{user.email}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-semibold border rounded px-1.5 py-0.5 ${PLAN_COLOR[user.plan] ?? PLAN_COLOR.free}`}>
          {user.plan.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-mono ${user.uploads24h > 0 ? "text-lime" : "text-muted-foreground"}`}>
          {user.uploads24h}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {new Date(user.joinedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {(["free", "pro", "team"] as const).map((p) => (
            <button
              key={p}
              disabled={changing || p === user.plan}
              onClick={() => onPlanChange(p)}
              className={`px-2 py-1 rounded text-[10px] font-semibold border transition disabled:opacity-40 ${
                p === user.plan
                  ? p === "team"
                    ? "bg-yellow-400/20 text-yellow-400 border-yellow-400/50"
                    : p === "pro"
                    ? "bg-lime/20 text-lime border-lime/50"
                    : "bg-white/10 text-foreground border-border"
                  : "bg-transparent text-muted-foreground border-border/50 hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {changing && p === user.plan ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : p.toUpperCase()}
            </button>
          ))}
        </div>
      </td>
    </tr>
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
