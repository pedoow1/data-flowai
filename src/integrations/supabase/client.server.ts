// Stub: Supabase has been replaced with Replit PostgreSQL (Drizzle).
// All DB access now goes through server/db.ts.
// This file exists only to avoid import errors during migration.

export const supabaseAdmin = {
  from: (_table: string) => ({
    select: (_cols?: string) => ({
      eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      order: () => ({ limit: async () => ({ data: [] }) }),
      gte: () => ({ data: [], count: 0 }),
    }),
    insert: async () => ({ error: null }),
    upsert: async () => ({ error: null }),
    ilike: () => ({ maybeSingle: async () => ({ data: null }) }),
  }),
};
