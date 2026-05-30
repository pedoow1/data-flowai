import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

export const requireSupabaseAuth = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    const { supabase } = await import('./client');
    const { data: { session } } = await supabase.auth.getSession();
    return next({
      headers: session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {},
    });
  })
  .server(async ({ next }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase environment variables.');
    }

    const request = getRequest();
    if (!request?.headers) throw new Error('Unauthorized: No request context');

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Please sign in to continue.');
    }

    const token = authHeader.replace('Bearer ', '').trim();

    // Create a token-scoped client (RLS applies as this user).
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    // CRITICAL: verify the JWT signature with Supabase's Auth server.
    // Never trust the decoded payload directly — that allows forged tokens.
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      throw new Error('Unauthorized: Invalid or expired session. Please sign in again.');
    }

    return next({
      context: {
        supabase,
        userId: user.id,
        claims: { sub: user.id, email: user.email ?? null },
      },
    });
  });
