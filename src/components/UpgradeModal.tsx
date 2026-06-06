import { X, Check, Zap } from "lucide-react";
import { LS_CHECKOUT_URL, LS_TEAM_CHECKOUT_URL } from "@/lib/config";

export function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="glass-strong relative max-w-3xl w-full rounded-2xl p-6 sm:p-10 animate-in fade-in zoom-in-95 duration-300">
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3 py-1 text-xs text-lime mb-4">
            <Zap className="h-3 w-3" /> Limit reached
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Upgrade to keep extracting</h2>
          <p className="text-muted-foreground mt-2 text-sm">Pick a plan. Cancel anytime.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <PlanCard name="Pro" price="$9" period="/mo" features={["50 documents / month", "All export formats", "Batch upload"]} ctaUrl={LS_CHECKOUT_URL} highlight />
          <PlanCard name="Team" price="$29" period="/mo" features={["Unlimited documents", "API access", "Team workspace", "24/7 support"]} ctaUrl={LS_TEAM_CHECKOUT_URL} />
        </div>
      </div>
    </div>
  );
}

function PlanCard({ name, price, period, features, ctaUrl, highlight }: {
  name: string; price: string; period: string; features: string[]; ctaUrl: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl p-6 border ${highlight ? "border-lime/40 bg-lime/[0.04]" : "border-border bg-card/40"}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-lg">{name}</h3>
        {highlight && <span className="text-[10px] uppercase tracking-wider text-lime font-medium">Most popular</span>}
      </div>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tight">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <ul className="mt-5 space-y-2.5">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-lime shrink-0" /> <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>
      <a href={ctaUrl} target="_blank" rel="noreferrer"
         className={`mt-6 block text-center font-semibold py-2.5 rounded-lg transition ${highlight ? "bg-lime text-primary-foreground hover:opacity-90" : "border border-border hover:bg-secondary"}`}>
        Upgrade to {name}
      </a>
    </div>
  );
}
