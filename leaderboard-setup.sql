-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- ONE ACCOUNT PER EMAIL: enforced by Supabase auth (no duplicates allowed)

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null check (char_length(username) between 3 and 14),
  username_lc text generated always as (lower(username)) stored,
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_username_lc on profiles (username_lc);
alter table profiles enable row level security;
drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles for select using (true);
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles for insert with check (id = auth.uid());

-- Username is permanent (cannot be changed)
create or replace function lock_username() returns trigger as $$
begin
  if new.username <> old.username then raise exception 'username is permanent'; end if;
  return new;
end $$ language plpgsql;
drop trigger if exists lock_username on profiles;
create trigger lock_username before update on profiles for each row execute function lock_username();

-- Auto-create profile when user signs up
create or replace function handle_new_user() returns trigger as $$
begin
  if new.raw_user_meta_data->>'username' ~ '^[A-Za-z0-9_]{3,14}$' then
    insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data->>'username') on conflict do nothing;
  end if;
  return new;
end $$ language plpgsql security definer set search_path = public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ===== Ranked ladder =====
create table if not exists ranked (
  id      text primary key,
  name    text not null check (char_length(name) between 3 and 14),
  rating  int  not null default 1000 check (rating between 0 and 4000),
  wins    int  not null default 0 check (wins >= 0),
  draws   int  not null default 0 check (draws >= 0),
  losses  int  not null default 0 check (losses >= 0),
  games   int  not null default 0 check (games >= 0),
  updated_at timestamptz not null default now(),
  check (wins + draws + losses = games)
);
alter table ranked enable row level security;
create policy "anyone can read ranked"   on ranked for select using (true);
create policy "owner adds ranked"    on ranked for insert with check (id = auth.uid()::text);
create policy "owner updates ranked" on ranked for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- ===== Dream Team ranked ladder =====
create table if not exists dream_ranked (like ranked including all);
alter table dream_ranked enable row level security;
create policy "anyone can read dream_ranked"   on dream_ranked for select using (true);
create policy "owner adds dream_ranked"    on dream_ranked for insert with check (id = auth.uid()::text);
create policy "owner updates dream_ranked" on dream_ranked for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- Ranked guard: prevents cheating, caps rating changes at 40 per game
create or replace function ranked_guard() returns trigger as $$
declare ex boolean; nm text;
begin
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I where id = $1)', tg_table_name) into ex using new.id;
    if ex then return new; end if;
    if new.games > 1 then raise exception 'new players start with at most one game'; end if;
    new.rating = greatest(960, least(1040, new.rating));
  else
    if new.games <> old.games + 1
       or (new.wins - old.wins) + (new.draws - old.draws) + (new.losses - old.losses) <> 1
       or new.wins < old.wins or new.draws < old.draws or new.losses < old.losses
       or now() - old.updated_at < interval '100 seconds' then
      return old;
    end if;
    if (new.wins = old.wins + 1 and new.rating < old.rating)
       or (new.losses = old.losses + 1 and new.rating > old.rating) then
      return old;
    end if;
    new.rating = greatest(old.rating - 40, least(old.rating + 40, new.rating));
  end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists ranked_guard on ranked;
create trigger ranked_guard before insert or update on ranked for each row execute function ranked_guard();
drop trigger if exists ranked_guard on dream_ranked;
create trigger ranked_guard before insert or update on dream_ranked for each row execute function ranked_guard();

-- ===== Career leaderboard =====
create table if not exists leaderboard (
  id        text primary key,
  name      text not null check (char_length(name) between 3 and 14),
  club      text not null check (char_length(club) between 1 and 6),
  score     int  not null check (score between 0 and 5000),
  trophies  int  not null check (trophies between 0 and 600),
  seasons   int  not null check (seasons between 1 and 200),
  wins      int  not null check (wins between 0 and 1800),
  updated_at timestamptz not null default now(),
  check (wins <= seasons * 9),
  check (trophies <= seasons * 3),
  check (score <= wins * 3 + seasons * 9 + trophies * 100)
);
alter table leaderboard enable row level security;
create policy "anyone can read"   on leaderboard for select using (true);
create policy "anyone can add"    on leaderboard for insert with check (true);
create policy "anyone can update" on leaderboard for update using (true) with check (true);

create or replace function keep_best() returns trigger as $$
begin
  if new.score < old.score or new.seasons > old.seasons + 1 then return old; end if;
  new.score = least(new.score, old.score + 210);
  new.updated_at = now();
  return new;
end $$ language plpgsql;
drop trigger if exists keep_best on leaderboard;
create trigger keep_best before update on leaderboard for each row execute function keep_best();

-- ===== Online 1v1 uses Supabase Realtime (broadcast + presence) =====
-- Enable "Allow public access" under Realtime settings in Supabase console
