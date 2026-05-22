## Scope

This turn converts the current mock dashboard into a working product with a real AI backend, proper auth redirects, RBAC, rate limiting, a side‑by‑side PDF preview, two legal pages, in‑app support, admin analytics, and PostHog analytics.

## Important upfront notes

**1. Your Hugging Face key is now compromised.** You pasted `hf_ZSxKNw…` into a public chat. As soon as I finish, you should rotate it at huggingface.co/settings/tokens. I will:
- Store the key as a server‑only secret (`HF_API_KEY`) via the secrets tool — never in the codebase, never shipped to the browser.
- Call HF from a TanStack `createServerFn` so the key stays on the server.

**2. Model choice.** `Qwen/Qwen2.5-7B-Instruct-1M` is a text/chat LLM on HF Inference, not a document‑understanding model. PDFs are binary — the model cannot read them directly. The realistic pipeline is:
- Extract raw text from the PDF in the browser using `pdfjs-dist`.
- Send that text to Qwen with a structured‑extraction prompt (tool/JSON output).
- Parse the JSON response into table rows.
Scanned/image PDFs will return little or no text (no OCR). I'll surface a clear error in that case.

**3. Email for the Help form.** The runtime has no email service wired up. Options:
- **(A)** Use the existing **Resend** connector — cleanest, deliverable. Recommended.
- **(B)** `mailto:` fallback — opens the user's mail client, no backend needed, but not "in‑app".
I will implement **(A)** and ask you to connect Resend when prompted; if you decline, I'll fall back to (B).

**4. Persistence.** Rate limits, history, admin analytics (uploads/day, user count, top users) all need persistence across devices. Today everything is `localStorage`, which means:
- A user can reset rate limits by clearing storage.
- Admin "user count / top users" can only see *this browser*.
Doing this properly needs Lovable Cloud (database). I will **keep the current localStorage approach** for this turn to stay in scope and avoid a giant migration, and clearly label admin numbers as "local/demo" until you ask to enable Cloud. Say the word and I'll migrate auth + rate limit + analytics to Cloud in a follow‑up.

## What I will build

### Backend
- `src/lib/extract.functions.ts` — `createServerFn` that takes extracted PDF text and calls HF Inference (`Qwen/Qwen2.5-7B-Instruct-1M`) with a JSON‑extraction prompt; returns typed rows or an error. Reads `process.env.HF_API_KEY`. No file is ever uploaded to our server (zero retention is automatic — there is no server storage).
- `src/lib/support.functions.ts` — `createServerFn` that sends the support message via Resend to `abdalahkotp31@gmail.com` (if connected).

### Frontend dashboard (`src/routes/dashboard.tsx`)
- Browser‑side PDF text extraction with `pdfjs-dist`.
- On upload: `setRows([])` immediately → show skeleton/pulse → call serverFn → populate rows from current file only.
- Toast notifications (sonner) for success / failure, error toast includes a **Retry** button.
- **Rate limit:** 100 uploads / rolling 24h per email, stored in localStorage. Progress bar in the sidebar; warning toast at ≤10 remaining; hard block + polite message at 0.
- **Side‑by‑side layout:** PDF preview (iframe with object URL) on the left, editable table on the right. Stacks vertically under `lg`.
- Editable table is already in `AuditTable` — I'll verify cells are click‑to‑edit and keep it.
- **Export to Excel/CSV available to all plans** (remove the `locked` gate for export).
- Floating **Help** button (bottom‑right) opening a dialog with Name + Message → calls support serverFn → thank‑you toast.
- Footer disclaimer text updated to the exact zero‑retention copy.

### Auth & RBAC
- After successful login/signup, redirect to `/dashboard` (already does on signup; verifying login path).
- Admin = `abdalahkotp31@gmail.com` only → Pro features + `/admin` route. All other accounts = Free plan by default. Free plan still gets full extract + export; only the "Pro" perks (higher quotas, admin view) are gated.

### New routes
- `/privacy` — professional SaaS Privacy Policy template.
- `/terms` — professional SaaS Terms of Service template.
- Footer links wired to both.
- `/admin` already exists; I'll add a small analytics panel (uploads today, total uploads, unique known users from local store, top users by upload count) with a clear "local/demo data" badge.

### Analytics
- Add `posthog-js`, initialized client‑side with a public project key from `VITE_POSTHOG_KEY` env var. I will **ask you for the key** via the secrets flow; if you skip it, analytics is a no‑op (safe).
- Track `file_upload_success` and `file_upload_failure` with minimal metadata (filename hash, page count, duration). No PII, no file contents.

### Usage alerts
- Sidebar progress bar reflects 24h rolling window, not plan limit. Inline message "You have N uploads remaining today".

## Things I am NOT doing this turn (call out)
- No Cloud / database migration (see note 3).
- No server‑side file upload or deletion — files never leave the browser, so there's nothing to delete. The disclaimer is accurate as written.
- No OCR for scanned PDFs.
- I'm not implementing email without a real provider — Resend connector or `mailto` fallback only.

## Files I'll touch
- New: `src/lib/extract.functions.ts`, `src/lib/support.functions.ts`, `src/lib/pdf.ts`, `src/lib/rateLimit.ts`, `src/lib/analytics.ts`, `src/components/HelpButton.tsx`, `src/components/PdfPreview.tsx`, `src/routes/privacy.tsx`, `src/routes/terms.tsx`
- Edit: `src/routes/dashboard.tsx`, `src/routes/login.tsx`, `src/components/Layout.tsx` (footer), `src/components/AuditTable.tsx` (remove export lock), `src/routes/admin.tsx`, `src/routes/__root.tsx` (PostHog init), `src/routeTree.gen.ts`
- Secrets I'll request: `HF_API_KEY` (required), `VITE_POSTHOG_KEY` (optional).
- Connector I'll request: **Resend** (optional, for Help form).

Approve and I'll build it. If you'd rather I also enable Lovable Cloud now (recommended for real rate limiting and admin analytics), say so and I'll fold it in.