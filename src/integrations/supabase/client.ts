// Stub: Supabase has been replaced with Replit Auth + PostgreSQL.
// This file exists only to satisfy any remaining imports during migration.
// Do not add new imports from this file.

export const supabase = {
  auth: {
    onAuthStateChange: (_event: unknown, _session: unknown) => {
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    getSession: async () => ({ data: { session: null } }),
    signUp: async () => ({ error: new Error("Use Replit Auth") }),
    signInWithPassword: async () => ({ error: new Error("Use Replit Auth") }),
    signOut: async () => {},
    getClaims: async () => ({ data: null, error: new Error("Use Replit Auth") }),
    setSession: async () => ({ data: null, error: null }),
  },
  from: (_table: string) => ({
    select: (_cols?: string) => ({
      eq: () => ({ maybeSingle: async () => ({ data: null }) }),
    }),
    insert: async () => ({ error: null }),
    upsert: async () => ({ error: null }),
  }),
};
