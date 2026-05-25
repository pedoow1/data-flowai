import { createMiddleware } from '@tanstack/react-start'
import { supabase } from './client'

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    // getUser() makes a server-side call to Supabase and always returns a
    // fresh, validated session — it also triggers token refresh if needed.
    // Falls back to getSession() for offline / network-error cases.
    let token: string | undefined;
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { data: sessionData } = await supabase.auth.getSession();
        token = sessionData.session?.access_token;
      }
    } catch {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  },
)
