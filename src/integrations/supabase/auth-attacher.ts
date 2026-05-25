import { createMiddleware } from '@tanstack/react-start'
import { supabase } from './client'

export const attachSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    // Calling getUser() first ensures the token is refreshed if it's close
    // to expiry (Supabase auto-refreshes the session when autoRefreshToken is true).
    // Then getSession() returns the (possibly renewed) access_token.
    let token: string | undefined;
    try {
      await supabase.auth.getUser();
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
)
