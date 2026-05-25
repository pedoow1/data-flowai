import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple" | "microsoft", opts?: SignInOptions) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google",
        options: {
          redirectTo: opts?.redirect_uri ?? (typeof window !== "undefined" ? window.location.origin + "/dashboard" : undefined),
        },
      });
      if (error) return { error };
      return { redirected: true };
    },
  },
};
