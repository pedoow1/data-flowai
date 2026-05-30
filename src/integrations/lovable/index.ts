import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (
      provider: "google" | "apple" | "microsoft",
      opts?: SignInOptions,
    ) => {
      // Return the user to the same origin they started from (works on the
      // Vercel domain, the published domain, and local dev). The resolved
      // origin must be present in the backend's allowed redirect URLs.
      const redirectTo =
        opts?.redirect_uri ||
        (typeof window !== "undefined" ? window.location.origin : undefined);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google",
        options: {
          redirectTo,
        },
      });
      if (error) return { error };
      return { redirected: true };
    },
  },
};
