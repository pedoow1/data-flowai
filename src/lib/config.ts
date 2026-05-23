// Gumroad checkout URLs (set in Gumroad dashboard, used by Pricing + UpgradeModal)
export const LS_CHECKOUT_URL = "https://kotpster.gumroad.com/l/hcbwro";
export const LS_TEAM_CHECKOUT_URL = "https://kotpster.gumroad.com/l/hcbwro";

export const ADMIN_EMAIL = "abdalahkotp31@gmail.com";

// Plan limits — per rolling 24h window
export const PLAN_LIMITS = {
  free: 2,
  pro: 50,
  team: Infinity,
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

// Exact Gumroad product names that map to plan tiers
export const GUMROAD_PRODUCT_TO_PLAN: Record<string, Plan> = {
  "DataFlow AI - Pro": "pro",
  "DataFlow AI - Team": "team",
};
