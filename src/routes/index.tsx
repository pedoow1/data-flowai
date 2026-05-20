import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, FileText, Sparkles, Zap, Lock, Gauge, CheckCircle2 } from "lucide-react";
import { Header, Footer } from "@/components/Layout";
import { PrivacyModal, PrivacyBadge } from "@/components/Privacy";
import { bumpTraffic } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DataFlow AI — AI-powered PDF data extraction" },
      { name: "description", content: "Extract structured data from invoices and PDFs in seconds. Confidence-scored, editable, exportable. Zero data retention." },
      { property: "og:title", content: "DataFlow AI — AI-powered PDF data extraction" },
      { property: "og:description", content: "Drop PDFs. Get clean structured data. Export to JSON, CSV, Excel." },
    ],
  }),
  component: Landing,
});

function Landing() {
  useEffect(() => { bumpTraffic(); }, []);
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <LogosStrip />
        <Features />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
      <PrivacyBadge />
      <PrivacyModal />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="absolute inset-0 radial-lime" />
      <div className="relative mx-auto max-w-7xl px-6 pt-20 sm:pt-28 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/5 px-3 py-1 text-xs">
          <Sparkles className="h-3 w-3 text-lime" />
          <span className="text-muted-foreground">Real-time extraction · No data retention</span>
        </div>
        <h1 className="mt-6 text-5xl sm:text-7xl font-bold tracking-tight leading-[0.95]">
          Turn PDFs into <span className="text-lime">structured data</span><br />in seconds.
        </h1>
        <p className="mt-6 max-w-xl mx-auto text-muted-foreground text-base sm:text-lg">
          DataFlow AI extracts invoices, receipts, and forms with confidence-scored accuracy. Edit, verify, export. Ship faster.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/login" className="group inline-flex items-center gap-2 bg-lime text-primary-foreground font-semibold px-5 py-3 rounded-lg hover:opacity-90 transition animate-pulse-glow">
            Start Extracting <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition" />
          </Link>
          <Link to="/pricing" className="inline-flex items-center gap-2 border border-border bg-white/[0.02] px-5 py-3 rounded-lg hover:bg-white/[0.05] transition text-sm font-medium">
            View pricing
          </Link>
        </div>

        {/* Floating PDF icons */}
        <div className="relative mt-16 max-w-4xl mx-auto">
          <div className="hidden sm:flex absolute -left-10 top-10 h-16 w-16 items-center justify-center rounded-2xl glass animate-float" style={{ animationDelay: "0s" }}>
            <FileText className="h-7 w-7 text-lime" />
          </div>
          <div className="hidden sm:flex absolute -right-6 top-24 h-12 w-12 items-center justify-center rounded-xl glass animate-float" style={{ animationDelay: "-2s" }}>
            <FileText className="h-5 w-5 text-lime/70" />
          </div>
          <div className="hidden sm:flex absolute right-32 -top-4 h-14 w-14 items-center justify-center rounded-2xl glass animate-float" style={{ animationDelay: "-4s" }}>
            <FileText className="h-6 w-6 text-lime/80" />
          </div>
          {/* Browser mock */}
          <div className="glass-strong rounded-2xl p-1.5 shadow-2xl">
            <div className="rounded-xl bg-black/60 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-lime/60" />
                <span className="ml-3 text-[10px] text-muted-foreground font-mono">dataflow.ai/dashboard</span>
              </div>
              <div className="p-6 text-left">
                <div className="text-xs text-muted-foreground mb-3">Extracted · 3 invoices · 96% avg confidence</div>
                <div className="space-y-2 font-mono text-xs">
                  {[
                    ["INV-48201", "Acme Corp", "$2,840.00", 97],
                    ["INV-48202", "Globex Inc", "$1,120.00", 94],
                    ["INV-48203", "Stark Industries", "$5,200.00", 99],
                  ].map(([a, b, c, conf]) => (
                    <div key={a as string} className="flex items-center gap-4 p-2 rounded bg-white/[0.02]">
                      <span className="text-lime">{a}</span>
                      <span className="text-muted-foreground flex-1 truncate">{b}</span>
                      <span>{c}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-lime/15 text-lime border border-lime/30">{conf}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogosStrip() {
  return (
    <section className="border-y border-border bg-white/[0.01] py-8">
      <div className="mx-auto max-w-7xl px-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-muted-foreground text-xs uppercase tracking-widest">
        <span>Trusted by teams at</span>
        {["Acme", "Globex", "Initech", "Stark", "Umbrella", "Wayne"].map(n => (
          <span key={n} className="font-bold text-foreground/70">{n}</span>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: <Zap className="h-5 w-5" />, t: "Real-time extraction", d: "Sub-second per page. Batch hundreds at once." },
    { icon: <Gauge className="h-5 w-5" />, t: "Confidence scoring", d: "Every cell ships with an AI accuracy percentage." },
    { icon: <CheckCircle2 className="h-5 w-5" />, t: "Editable audit grid", d: "Fix misreads inline before exporting." },
    { icon: <Lock className="h-5 w-5" />, t: "Zero retention", d: "Ephemeral memory. We never store your data." },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="max-w-2xl">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Built for accuracy and speed</h2>
        <p className="text-muted-foreground mt-3">A complete extraction pipeline — from drop to export, with verification baked in.</p>
      </div>
      <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map(i => (
          <div key={i.t} className="glass rounded-2xl p-6">
            <div className="h-10 w-10 rounded-lg bg-lime/10 border border-lime/20 text-lime flex items-center justify-center mb-4">{i.icon}</div>
            <h3 className="font-semibold">{i.t}</h3>
            <p className="text-sm text-muted-foreground mt-1.5">{i.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Drop your PDFs", d: "Drag & drop or batch upload up to 10MB each." },
    { n: "02", t: "AI extracts data", d: "Confidence-scored fields appear in a verifiable grid." },
    { n: "03", t: "Edit & export", d: "Fix anything inline. Export to JSON, CSV, or Excel." },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 border-t border-border">
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center">Three steps. Zero friction.</h2>
      <div className="mt-12 grid md:grid-cols-3 gap-4">
        {steps.map(s => (
          <div key={s.n} className="rounded-2xl p-6 border border-border">
            <div className="text-lime font-mono text-sm">{s.n}</div>
            <h3 className="text-lg font-semibold mt-2">{s.t}</h3>
            <p className="text-sm text-muted-foreground mt-1.5">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="glass-strong rounded-3xl p-10 sm:p-16 text-center relative overflow-hidden">
        <div className="absolute inset-0 radial-lime opacity-60" />
        <div className="relative">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">Stop typing. Start shipping.</h2>
          <p className="text-muted-foreground mt-3 max-w-lg mx-auto">Your team's hours back. Start free — 2 documents on us.</p>
          <Link to="/login" className="mt-8 inline-flex items-center gap-2 bg-lime text-primary-foreground font-semibold px-6 py-3 rounded-lg hover:opacity-90 transition">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
