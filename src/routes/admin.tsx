import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, getAttempts, getLogs, getTraffic } from "@/lib/auth";
import { Header } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { useEffect, useState } from "react";
import { Activity, Users, ShieldCheck, FileText } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — DataFlow AI" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, ready } = useAuth();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick(t => t + 1), 2000);
    return () => clearInterval(i);
  }, []);

  if (ready && !isAdmin) return <Navigate to="/login" />;

  const attempts = getAttempts();
  const logs = getLogs();
  const traffic = getTraffic();
  const success = attempts.filter(a => a.success).length;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl px-4 sm:px-6 py-8 w-full">
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck className="h-5 w-5 text-lime" />
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <Stat icon={<Activity className="h-4 w-4" />} label="Total Traffic" value={traffic} />
          <Stat icon={<Users className="h-4 w-4" />} label="Login Attempts" value={attempts.length} sub={`${success} successful`} />
          <Stat icon={<FileText className="h-4 w-4" />} label="System Events" value={logs.length} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
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
          <Panel title="System Logs">
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {logs.length === 0 && <Empty>No logs yet.</Empty>}
              {logs.map((l, i) => (
                <div key={i} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-mono text-lime">{l.type}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-xs mt-0.5">{l.detail}</div>
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
