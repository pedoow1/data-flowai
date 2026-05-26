import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple" | "microsoft", opts?: SignInOptions) => {
      // Use Supabase's default redirect handling instead of custom redirects
      // This avoids "Invalid path specified in request URL" errors
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google",
        options: {
          // Let Supabase handle the redirect to registered callback URL
          redirectTo: undefined,
        },
      });
      if (error) return { error };
      return { redirected: true };
    },
  },
};
