import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      typeof atob !== 'undefined'
        ? atob(payload)
        : Buffer.from(payload, 'base64').toString('utf-8')
    );
    return decoded;
  } catch {
    return null;
  }
}

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
    const payload = decodeJWT(token);
    if (!payload) throw new Error('Unauthorized: Invalid session token.');

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      throw new Error('Unauthorized: Session expired. Please sign in again.');
    }

    const userId = (payload.sub as string) || null;
    const email  = (payload.email as string) || null;
    if (!userId) throw new Error('Unauthorized: No user identity in token.');

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    return next({ context: { supabase, userId, claims: { sub: userId, email } } });
  });
