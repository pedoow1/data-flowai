// Gumroad checkout URLs (set in Gumroad dashboard, used by Pricing + UpgradeModal)
export const LS_CHECKOUT_URL = "https://kotpster.gumroad.com/l/hcbwro";
export const LS_TEAM_CHECKOUT_URL = "https://kotpster.gumroad.com/l/hcbwro";

export const ADMIN_EMAIL = "abdalahkotp31@gmail.com";

export const FREE_LIFETIME_LIMIT = 2;
export const PRO_MONTHLY_LIMIT = 50;
export const TEAM_DAILY_LIMIT = 100;

export const PLAN_LIMITS = {
  free: FREE_LIFETIME_LIMIT,
  pro: PRO_MONTHLY_LIMIT,
  team: TEAM_DAILY_LIMIT,
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getNextPeriodDates(from = new Date()) {
  const start = new Date(from);
  const end = new Date(from);
  end.setMonth(end.getMonth() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// Exact Gumroad product names that map to plan tiers
export const GUMROAD_PRODUCT_TO_PLAN: Record<string, Plan> = {
  "DataFlow AI - Pro": "pro",
  "DataFlow AI - Team": "team",
};
