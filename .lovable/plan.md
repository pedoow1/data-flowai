# Implementation plan

## 1. Enable Lovable Cloud + schema
- Enable Cloud (provisions Supabase + auth).
- Tables (created via migration):
  - `profiles` (id → auth.users, email, created_at)
  - `user_roles` (id, user_id, role enum: 'admin' | 'user') + `has_role()` security-definer
  - `subscriptions` (user_id PK, plan enum 'free'|'pro'|'team', status, gumroad_sale_id, updated_at)
  - `uploads` (id, user_id, created_at, file_name, status) — replaces localStorage rate-limit + admin stats
  - `support_tickets` (id, name, email, message, created_at)
- Triggers: auto-insert `profiles` row + default `subscriptions` row ('free') + `user_roles` row on signup; auto-promote `abdalahkotp31@gmail.com` to 'admin'.
- RLS: users see only their own rows; admin sees all via `has_role()`.

## 2. Auth migration (localStorage → Supabase Auth)
- Rewrite `src/lib/auth.ts` to use `supabase.auth` (email + password). Keep `useAuth()` API surface so callers don't break.
- Update `login.tsx` and `signup.tsx` to call `signInWithPassword` / `signUp` with `emailRedirectTo: window.location.origin`.
- Wire `onAuthStateChange` in `__root.tsx` to invalidate router + queries.
- Admin status comes from `user_roles` (server-checked via `has_role()`).

## 3. Gumroad subscription webhook
- New server route: `src/routes/api/public/gumroad-webhook.ts` (POST).
- Verifies Gumroad signature using `GUMROAD_WEBHOOK_SECRET`.
- Handles events:
  - `sale` with `product_name == "DataFlow AI - Pro"` → set plan='pro'
  - `sale` with `product_name == "DataFlow AI - Team"` → set plan='team'
  - `subscription_ended`, `subscription_cancelled`, `cancelled`, `refunded`, `dispute` → set plan='free'
- Matches user by `email` (case-insensitive) against `profiles`. If no match, store pending row keyed by email so it applies on signup.
- Returns the final webhook URL to paste into Gumroad: `https://data-flowai.lovable.app/api/public/gumroad-webhook`.

## 4. Pricing UI → Gumroad
- Both Pro and Team buttons point to `https://kotpster.gumroad.com/l/hcbwro` (single URL user provided). I'll add a TODO note that Team should get its own product URL when ready.
- Update `LS_CHECKOUT_URL` + `LS_TEAM_CHECKOUT_URL` in `src/lib/config.ts`.

## 5. HF backend hardening
Current `extract.functions.ts` is mostly fine; tweak:
- Increase timeout: 60s → 120s.
- Better error surfacing: include response status + first 300 chars of body in dev.
- Add a fallback retry on 503 (model loading) after 5s.
- Confirm endpoint URL: `https://api-inference.huggingface.co/models/{model}/v1/chat/completions` ✓ correct for chat models on HF Inference.

## 6. Plan-aware rate limit
- Replace localStorage `rateLimit.ts` with a Supabase-backed check using `uploads` table:
  - Free: 2 / day
  - Pro: 50 / day
  - Team: **Unlimited** (no check)
- `getUsage()` becomes a server fn reading `uploads` count for the user in last 24h.
- Dashboard usage bar reads from server fn; hides limit row for Team.

## 7. Terms & Privacy navigation
- Audit `Layout.tsx` footer links. Replace any `<a href="#...">` with `<Link to="/terms">` / `<Link to="/privacy">` so they navigate instead of scrolling to top.

## 8. Admin dashboard
- `admin.tsx` reads from server fns scoped via `has_role(auth.uid(),'admin')`:
  - uploads-per-day chart (last 7 days)
  - total users
  - top active users
  - support tickets

## 9. Secrets needed
- `GUMROAD_WEBHOOK_SECRET` — I'll add via the secrets tool after the user creates it in Gumroad settings.
- `HF_API_KEY` — already set (will not rotate this turn per user choice).

## Files
**Created:** migration, `src/routes/api/public/gumroad-webhook.ts`, `src/lib/usage.functions.ts`, `src/lib/admin.functions.ts`, `src/integrations/supabase/*` (auto by Cloud enable).
**Edited:** `src/lib/auth.ts`, `src/lib/config.ts`, `src/lib/rateLimit.ts` (deprecated), `src/lib/extract.functions.ts`, `src/routes/login.tsx`, `src/routes/signup.tsx`, `src/routes/dashboard.tsx`, `src/routes/admin.tsx`, `src/routes/pricing.tsx`, `src/components/Layout.tsx`, `src/components/UpgradeModal.tsx`, `src/components/HelpButton.tsx`, `src/components/AuditTable.tsx` (if needed), `src/routes/__root.tsx`.

## Notes for you
- Migration **deletes localStorage accounts** — sign up again with `abdalahkotp31@gmail.com` + your password and you'll auto-get admin role.
- After deploy, copy the webhook URL into Gumroad → Settings → Advanced → "Ping URL".
- Send me your `GUMROAD_WEBHOOK_SECRET` (found in Gumroad → Settings → Advanced → Resource subscriptions secret) and I'll store it.

Approve to proceed.