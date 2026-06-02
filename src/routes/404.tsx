import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function NotFoundPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate({ to: "/" });
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-white mb-4">404</h1>
        <p className="text-3xl font-semibold text-slate-400 mb-2">Page Not Found</p>
        <p className="text-slate-300 mb-8">The page you're looking for doesn't exist.</p>
        <p className="text-slate-400">Redirecting to home in 3 seconds...</p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/404")({ component: NotFoundPage });
