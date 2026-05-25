import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

function getAdmin() {
  if (_supabaseAdmin === undefined) _supabaseAdmin = createSupabaseAdminClient();
  return _supabaseAdmin;
}

// Proxy that returns null if key is not configured.
// Callers should check for null before using.
export const supabaseAdmin = new Proxy({} as NonNullable<ReturnType<typeof createSupabaseAdminClient>>, {
  get(_, prop, receiver) {
    const client = getAdmin();
    if (!client) return undefined;
    return Reflect.get(client, prop, receiver);
  },
});

export function hasAdminClient(): boolean {
  return getAdmin() !== null;
}
