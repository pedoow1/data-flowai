import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign in — DataFlow AI" }] }),
  component: SignupRedirect,
});

function SignupRedirect() {
  const { isAuthed, ready } = useAuth();
  if (ready && isAuthed) return <Navigate to="/dashboard" />;
  return <Navigate to="/login" />;
}
