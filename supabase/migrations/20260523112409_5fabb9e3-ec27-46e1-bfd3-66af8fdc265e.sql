
-- enums
create type public.app_role as enum ('admin', 'user');
create type public.plan_tier as enum ('free', 'pro', 'team');

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- subscriptions
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan plan_tier not null default 'free',
  status text not null default 'active',
  gumroad_sale_id text,
  gumroad_subscription_id text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

-- uploads (usage)
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  status text not null default 'success',
  created_at timestamptz not null default now()
);
alter table public.uploads enable row level security;
create index uploads_user_created_idx on public.uploads (user_id, created_at desc);

-- support tickets
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  message text not null,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;

-- pending subscriptions (Gumroad webhook arrived before signup)
create table public.pending_subscriptions (
  email text primary key,
  plan plan_tier not null,
  gumroad_sale_id text,
  gumroad_subscription_id text,
  created_at timestamptz not null default now()
);
alter table public.pending_subscriptions enable row level security;

-- ===== RLS policies =====
-- profiles
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "admins read all profiles" on public.profiles
  for select using (public.has_role(auth.uid(), 'admin'));

-- user_roles
create policy "users read own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "admins read all roles" on public.user_roles
  for select using (public.has_role(auth.uid(), 'admin'));

-- subscriptions
create policy "users read own sub" on public.subscriptions
  for select using (auth.uid() = user_id);
create policy "admins read all subs" on public.subscriptions
  for select using (public.has_role(auth.uid(), 'admin'));

-- uploads
create policy "users read own uploads" on public.uploads
  for select using (auth.uid() = user_id);
create policy "users insert own uploads" on public.uploads
  for insert with check (auth.uid() = user_id);
create policy "admins read all uploads" on public.uploads
  for select using (public.has_role(auth.uid(), 'admin'));

-- support tickets — admins only
create policy "admins read tickets" on public.support_tickets
  for select using (public.has_role(auth.uid(), 'admin'));

-- pending_subscriptions: no client access (service role only)

-- ===== Signup trigger =====
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pending public.pending_subscriptions%rowtype;
  initial_plan public.plan_tier := 'free';
  initial_sale text;
  initial_sub text;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (new.id, 'user')
    on conflict do nothing;

  -- admin auto-promotion
  if lower(new.email) = 'abdalahkotp31@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
      on conflict do nothing;
  end if;

  -- check pending Gumroad sub
  select * into pending from public.pending_subscriptions where lower(email) = lower(new.email) limit 1;
  if found then
    initial_plan := pending.plan;
    initial_sale := pending.gumroad_sale_id;
    initial_sub := pending.gumroad_subscription_id;
    delete from public.pending_subscriptions where lower(email) = lower(new.email);
  end if;

  insert into public.subscriptions (user_id, plan, gumroad_sale_id, gumroad_subscription_id)
    values (new.id, initial_plan, initial_sale, initial_sub)
    on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
