import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSession } from "@server/session";

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const session = await getSession(request as unknown as Request);
  if (!session) return null;
  return session;
});

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  return { ok: true };
});
