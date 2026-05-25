// Supabase client removed — this project now uses Replit Auth + Replit PostgreSQL.
// This stub exists so any remaining imports don't break during the transition.
export const supabase = {
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    getSession: async () => ({ data: { session: null } }),
    signInWithPassword: async () => ({ error: new Error("Not supported") }),
    signUp: async () => ({ error: new Error("Not supported") }),
    signOut: async () => ({}),
    getUser: async () => ({ data: { user: null }, error: null }),
    signInWithOAuth: async () => ({ error: null }),
  },
  from: (_table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    insert: () => ({}),
    upsert: () => ({}),
  }),
};
