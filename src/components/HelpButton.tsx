import { useState } from "react";
import { LifeBuoy, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { sendSupport } from "@/lib/support.functions";

export function HelpButton({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const send = useServerFn(sendSupport);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = (await send({ data: { name, email, message } })) as { ok: boolean; delivered?: boolean; error?: string };
      if (res.ok) {
        toast.success(res.delivered ? "Message sent — we'll be in touch." : "Thanks! Your message has been received.");
        setOpen(false); setName(""); setMessage("");
      } else {
        toast.error(res.error || "Could not send your message. Please try again.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not send your message.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full bg-lime text-primary-foreground shadow-[0_8px_30px_-4px_var(--lime-glow)] flex items-center justify-center hover:opacity-90 transition"
        aria-label="Open help"
      >
        <LifeBuoy className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="glass-strong w-full max-w-md rounded-2xl p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 mb-1">
              <LifeBuoy className="h-5 w-5 text-lime" />
              <h2 className="text-lg font-bold">Contact Support</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Send a message directly to the DataFlow AI team.</p>
            <form onSubmit={submit} className="space-y-3">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-lime/60" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email (optional)"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-lime/60" />
              <textarea required rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-lime/60 resize-none" />
              <button type="submit" disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-lime text-primary-foreground font-semibold py-2.5 rounded-lg hover:opacity-90 disabled:opacity-60">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Send message"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
