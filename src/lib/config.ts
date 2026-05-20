// Configuration placeholders — swap these later for production.
export const LS_CHECKOUT_URL = "https://your-store.lemonsqueezy.com/buy/REPLACE_ME";
export const LS_TEAM_CHECKOUT_URL = "https://your-store.lemonsqueezy.com/buy/REPLACE_TEAM";

export const ADMIN_EMAIL = "abdalahkotp31@gmail.com";

export const PLAN_LIMITS = {
  free: 2,
  pro: 50,
  team: Infinity,
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
