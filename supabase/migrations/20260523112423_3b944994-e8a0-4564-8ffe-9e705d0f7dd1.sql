
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create policy "no client access" on public.pending_subscriptions
  for all using (false) with check (false);
