-- Run this SQL once in the Supabase SQL Editor.
-- The service-role key is only used by server-side API functions; never put it in the game HTML.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null,
  checkout_session_id text not null unique,
  product_id text not null check (product_id in ('starter', 'pro', 'legend')),
  amount_total integer not null,
  currency text not null,
  payment_status text not null check (payment_status in ('paid')),
  opened boolean not null default false,
  reward jsonb,
  created_at timestamptz not null default now()
);

create index if not exists purchases_player_id_created_at_idx
  on public.purchases (player_id, created_at desc);

alter table public.purchases enable row level security;
-- No client-side policies are created. All reads/writes happen through API routes
-- using the service-role key stored as a private Vercel environment variable.
