// Stub: Lovable auth has been replaced with Replit Auth.
// This file exists only to satisfy any remaining imports.

export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: string, _opts?: { redirect_uri?: string }) => {
      window.location.href = "/__replauth";
      return { redirected: true };
    },
  },
};
