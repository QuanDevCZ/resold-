-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- One row per user holds the whole ledger ({lots, pulls}) as JSON.

create table if not exists public.ledgers (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{"lots":[],"pulls":[]}'::jsonb,
  rev        bigint not null default 0,          -- ms timestamp of the last edit; newer wins
  updated_at timestamptz not null default now()
);

alter table public.ledgers enable row level security;

-- Each signed-in user can only see and change their own row.
drop policy if exists "ledger select own" on public.ledgers;
drop policy if exists "ledger insert own" on public.ledgers;
drop policy if exists "ledger update own" on public.ledgers;
drop policy if exists "ledger delete own" on public.ledgers;
create policy "ledger select own" on public.ledgers for select to authenticated using (auth.uid() = user_id);
create policy "ledger insert own" on public.ledgers for insert to authenticated with check (auth.uid() = user_id);
create policy "ledger update own" on public.ledgers for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ledger delete own" on public.ledgers for delete to authenticated using (auth.uid() = user_id);

-- Live updates between devices.
alter publication supabase_realtime add table public.ledgers;
