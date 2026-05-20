import { useEffect, useState } from "react";
import { X, Shield } from "lucide-react";

const KEY = "dataflow_privacy_seen";

export function PrivacyModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(KEY)) setTimeout(() => setOpen(true), 600);
  }, []);
  if (!open) return null;
  const close = () => { localStorage.setItem(KEY, "1"); setOpen(false); };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-strong relative max-w-md w-full rounded-2xl p-8 animate-in fade-in zoom-in-95 duration-300">
        <button onClick={close} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-lime/10 border border-lime/30 mb-5">
          <Shield className="h-7 w-7 text-lime" />
        </div>
        <h3 className="text-xl font-semibold tracking-tight">Privacy First, Always.</h3>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          DataFlow AI uses <span className="text-foreground font-medium">ephemeral memory processing</span>.
          We do not store or train AI on your documents. Files are processed in real-time and discarded immediately.
        </p>
        <button onClick={close} className="mt-6 w-full bg-lime text-primary-foreground font-semibold py-2.5 rounded-lg hover:opacity-90 transition">
          I understand
        </button>
      </div>
    </div>
  );
}

export function PrivacyBadge() {
  return (
    <div className="fixed bottom-4 right-4 z-50 glass rounded-full px-4 py-2 flex items-center gap-2 text-xs shadow-2xl">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-lime"></span>
      </span>
      <Shield className="h-3.5 w-3.5 text-lime" />
      <span className="text-muted-foreground hidden sm:inline">
        Enterprise Security: <span className="text-foreground">Real-time, No data retention</span>
      </span>
      <span className="text-foreground sm:hidden">Secure</span>
    </div>
  );
}
