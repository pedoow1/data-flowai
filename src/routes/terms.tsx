import { createFileRoute } from "@tanstack/react-router";
import { Header, Footer } from "@/components/Layout";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — DataFlow AI" },
      { name: "description", content: "The terms that govern your use of DataFlow AI." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 mx-auto max-w-3xl px-4 sm:px-6 py-12 w-full">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Terms of Service</h1>
        <p className="text-xs text-muted-foreground mt-2">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose-invert mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">1. Acceptance</h2>
            <p>By accessing or using DataFlow AI, you agree to be bound by these Terms of Service. If you do not agree, do not use the service.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">2. Service description</h2>
            <p>DataFlow AI provides AI‑assisted document extraction tools. Output is generated automatically and you are responsible for verifying its accuracy before relying on it for any business, legal, or financial purpose.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">3. Acceptable use</h2>
            <p>You may not upload content you do not have the right to process, content that is unlawful, or content intended to abuse, harm, or deceive others. You may not attempt to reverse‑engineer the service or circumvent its rate limits.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">4. Accounts and plans</h2>
            <p>You are responsible for safeguarding your credentials. Free accounts are subject to daily usage caps. Paid plans unlock higher limits and additional features as described on the Pricing page.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">5. No warranty</h2>
            <p>The service is provided "as is" without warranties of any kind. We do not warrant that extraction results will be complete, accurate, or fit for any particular purpose.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">6. Limitation of liability</h2>
            <p>To the maximum extent permitted by law, DataFlow AI shall not be liable for indirect, incidental, special, consequential or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">7. Termination</h2>
            <p>We may suspend or terminate access at any time for violation of these terms. You may stop using the service and delete your account at any time.</p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-foreground">8. Changes</h2>
            <p>We may update these terms from time to time. Continued use of the service after changes take effect constitutes acceptance of the updated terms.</p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
