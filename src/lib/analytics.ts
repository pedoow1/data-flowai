// Lightweight PostHog wrapper. No-ops if VITE_POSTHOG_KEY is not configured.
import posthog from "posthog-js";

let initialized = false;

export function initAnalytics() {
  if (initialized || typeof window === "undefined") return;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string) || "https://us.i.posthog.com",
    capture_pageview: true,
    autocapture: false,
    person_profiles: "identified_only",
  });
  initialized = true;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  posthog.capture(event, props);
}

export function identify(email: string) {
  if (!initialized) return;
  posthog.identify(email);
}
