ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

ALTER TABLE public.pending_subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

UPDATE public.subscriptions
SET
  current_period_start = COALESCE(current_period_start, updated_at),
  current_period_end = COALESCE(current_period_end, updated_at + interval '1 month')
WHERE plan IN ('pro', 'team');

CREATE INDEX IF NOT EXISTS idx_uploads_user_created_at
  ON public.uploads (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  pending public.pending_subscriptions%rowtype;
  initial_plan public.plan_tier := 'free';
  initial_sale text;
  initial_sub text;
  initial_period_start timestamptz;
  initial_period_end timestamptz;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (new.id, 'user')
    on conflict do nothing;

  if lower(new.email) = 'abdalahkotp31@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
      on conflict do nothing;
  end if;

  select * into pending
  from public.pending_subscriptions
  where lower(email) = lower(new.email)
  limit 1;

  if found then
    initial_plan := pending.plan;
    initial_sale := pending.gumroad_sale_id;
    initial_sub := pending.gumroad_subscription_id;
    initial_period_start := pending.current_period_start;
    initial_period_end := pending.current_period_end;
    delete from public.pending_subscriptions where lower(email) = lower(new.email);
  end if;

  insert into public.subscriptions (
    user_id,
    plan,
    gumroad_sale_id,
    gumroad_subscription_id,
    current_period_start,
    current_period_end
  )
  values (
    new.id,
    initial_plan,
    initial_sale,
    initial_sub,
    case when initial_plan in ('pro', 'team') then coalesce(initial_period_start, now()) else null end,
    case when initial_plan in ('pro', 'team') then coalesce(initial_period_end, now() + interval '1 month') else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;