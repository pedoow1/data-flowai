import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Header, Footer } from "@/components/Layout";
import { PrivacyBadge } from "@/components/Privacy";
import { LS_CHECKOUT_URL, LS_TEAM_CHECKOUT_URL } from "@/lib/config";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — DataFlow AI" },
      { name: "description", content: "Simple, transparent pricing. Start free. Upgrade when you need more." },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const tiers = [
    { name: "Free", price: "$0", period: "forever", desc: "Kick the tires.", features: ["2 documents", "Excel export only", "Manual edit"], cta: "Start free", href: "/login", primary: false },
    { name: "Pro", price: "$9", period: "/month", desc: "For individuals shipping fast.", features: ["250 documents / month", "CSV, Excel export", "Batch upload", "Fast processing"], cta: "Upgrade to Pro", href: LS_CHECKOUT_URL, primary: true, external: true },
    { name: "Team", price: "$29", period: "/month", desc: "For high-volume workflows.", features: ["1000 documents / month (50/day limit)", "All export formats", "Batch upload", "Priority support"], cta: "Upgrade to Team", href: LS_TEAM_CHECKOUT_URL, primary: false, external: true },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <section className="relative mx-auto max-w-6xl px-6 pt-20 pb-12 text-center">
          <div className="absolute inset-0 radial-lime opacity-60" />
          <div className="relative">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">Pricing that scales with you</h1>
            <p className="mt-4 text-muted-foreground">Start free. Upgrade when you outgrow it. Cancel anytime.</p>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-6 pb-24 grid md:grid-cols-3 gap-4">
          {tiers.map(t => (
            <div key={t.name} className={`rounded-2xl p-7 border relative ${t.primary ? "border-lime/40 bg-lime/[0.04] shadow-[0_0_40px_-10px_var(--lime-glow)]" : "border-border bg-white/[0.02]"}`}>
              {t.primary && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest bg-lime text-primary-foreground font-bold px-2.5 py-0.5 rounded-full">Most popular</span>}
              <h3 className="font-semibold text-lg">{t.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-5xl font-bold tracking-tight">{t.price}</span>
                <span className="text-muted-foreground text-sm">{t.period}</span>
              </div>
              <ul className="mt-6 space-y-2.5">
                {t.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-lime shrink-0 mt-0.5" /> <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              {t.external ? (
                <a href={t.href} target="_blank" rel="noreferrer"
                   className={`mt-7 block text-center font-semibold py-2.5 rounded-lg transition ${t.primary ? "bg-lime text-primary-foreground hover:opacity-90" : "border border-border hover:bg-white/5"}`}>
                  {t.cta}
                </a>
              ) : (
                <Link to={t.href} className="mt-7 block text-center font-semibold py-2.5 rounded-lg border border-border hover:bg-white/5 transition">
                  {t.cta}
                </Link>
              )}
            </div>
          ))}
        </section>
      </main>
      <Footer />
      <PrivacyBadge />
    </div>
  );
}
