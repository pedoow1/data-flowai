// Lovable integration removed — this project now uses Replit Auth.
export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: string, _opts?: { redirect_uri?: string }) => {
      if (typeof window !== "undefined") {
        const host = window.location.host;
        window.location.href = `https://replit.com/auth_with_repl_site?domain=${host}`;
      }
      return { redirected: true };
    },
  },
};
