import { createFileRoute } from "@tanstack/react-router";
import { Header, Footer } from "@/components/Layout";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — DataFlow AI" },
      { name: "description", content: "How DataFlow AI handles, stores, and protects your data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-xs text-muted-foreground mt-2">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose-invert mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">1. Our commitment</h2>
            <p>DataFlow AI ("we", "us", "our") is built around a zero‑data‑retention principle. Your uploaded documents are processed in ephemeral memory and are never persisted on our servers, shared with third parties, or used to train AI models.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">2. What we process</h2>
            <p>When you upload a PDF, its raw text is sent to our AI inference provider solely to produce the structured extraction you requested. The file itself never leaves your browser; only the extracted text is transmitted, and only for the duration of the inference request.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">3. Account data</h2>
            <p>To authenticate you and enforce fair usage limits, we store your email address and a hashed password. We do not collect billing details directly — payments are handled by our payment processor.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">4. Analytics</h2>
            <p>We use privacy‑respecting product analytics to understand aggregate feature usage. We do not record document contents, file names, or any personally identifying field values.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">5. Cookies</h2>
            <p>We use strictly necessary local storage to remember your session and your preferences. No third‑party advertising cookies are set.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">6. Your rights</h2>
            <p>You may request deletion of your account and associated data at any time by contacting support. Because we do not retain documents, there is no document data to export or delete.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">7. Changes</h2>
            <p>We will post any material changes to this policy on this page and update the "Last updated" date above.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">8. Contact</h2>
            <p>Questions about this policy? Use the in‑app Help button to reach us.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
