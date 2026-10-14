-- Safe to run again at any time: this file never deletes or resets anyone's rating.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists leaderboard (
  id        text primary key,
  name      text not null check (char_length(name) between 1 and 16),
  club      text not null check (char_length(club) between 1 and 6),
  score     int  not null check (score between 0 and 5000),
  trophies  int  not null check (trophies between 0 and 600),
  seasons   int  not null check (seasons between 1 and 200),
  wins      int  not null check (wins between 0 and 1800),
  updated_at timestamptz not null default now(),
  -- plausibility limits: at most 9 matches and 3 trophies per season
  check (wins <= seasons * 9),
  check (trophies <= seasons * 3),
  check (score <= wins * 3 + seasons * 9 + trophies * 100)
);

alter table leaderboard enable row level security;
create policy "anyone can read"   on leaderboard for select using (true);
create policy "anyone can add"    on leaderboard for insert with check (true);
create policy "anyone can update" on leaderboard for update using (true) with check (true);

-- A lower score never overwrites a higher one, so nobody can wipe another player's entry.
create or replace function keep_best() returns trigger as $$
begin
  if new.score < old.score then return old; end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;
drop trigger if exists keep_best on leaderboard;
create trigger keep_best before update on leaderboard for each row execute function keep_best();

-- ===== Worldwide top scorers (one season) =====
create table if not exists scorers (
  id      text primary key,
  manager text not null check (char_length(manager) between 1 and 16),
  club    text not null check (char_length(club) between 1 and 6),
  num     int  not null check (num between 1 and 99),
  pos     text not null check (pos in ('FW','MF','DF')),
  goals   int  not null check (goals between 0 and 60),
  season  int  not null check (season between 1 and 200),
  updated_at timestamptz not null default now()
);
alter table scorers enable row level security;
create policy "anyone can read scorers"   on scorers for select using (true);
create policy "anyone can add scorers"    on scorers for insert with check (true);
create policy "anyone can update scorers" on scorers for update using (true) with check (true);
create or replace function keep_best_goals() returns trigger as $$
begin
  if new.goals < old.goals then return old; end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;
drop trigger if exists keep_best_goals on scorers;
create trigger keep_best_goals before update on scorers for each row execute function keep_best_goals();

-- Online 1v1 uses Supabase Realtime (broadcast + presence). No tables are needed.
-- It is on by default; if your project has "Allow public access" under Realtime settings, leave it enabled.

-- ===== Ranked ladder =====
create table if not exists ranked (
  id      text primary key,
  name    text not null check (char_length(name) between 1 and 14),
  rating  int  not null check (rating between 0 and 4000),
  wins    int  not null default 0 check (wins >= 0),
  draws   int  not null default 0 check (draws >= 0),
  losses  int  not null default 0 check (losses >= 0),
  games   int  not null default 0 check (games >= 0),
  updated_at timestamptz not null default now(),
  check (wins + draws + losses = games)
);
alter table ranked enable row level security;
create policy "anyone can read ranked"   on ranked for select using (true);
create policy "anyone can add ranked"    on ranked for insert with check (true);
create policy "anyone can update ranked" on ranked for update using (true) with check (true);
-- New players must start near 1000, and a rating can only move 40 points per update.
create or replace function ranked_guard() returns trigger as $$
declare ex boolean;
begin
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I where id = $1)', tg_table_name) into ex using new.id;
    if ex then return new; end if;               -- an upsert of an existing row is validated by the UPDATE branch
    if new.games > 1 then raise exception 'new players start with at most one game'; end if;
    new.rating = greatest(960, least(1040, new.rating));
  else
    if new.games <> old.games + 1
       or (new.wins - old.wins) + (new.draws - old.draws) + (new.losses - old.losses) <> 1
       or new.wins < old.wins or new.draws < old.draws or new.losses < old.losses
       or now() - old.updated_at < interval '100 seconds' then
      return old;                                 -- ignore impossible or too-fast updates
    end if;
    if (new.wins = old.wins + 1 and new.rating < old.rating)
       or (new.losses = old.losses + 1 and new.rating > old.rating) then
      return old;                                 -- a win cannot lower your rating, a loss cannot raise it
    end if;
    new.rating = greatest(old.rating - 40, least(old.rating + 40, new.rating));
  end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists ranked_guard on ranked;
create trigger ranked_guard before insert or update on ranked for each row execute function ranked_guard();

-- ===== Dream Team ranked ladder =====
create table if not exists dream_ranked (like ranked including all);
alter table dream_ranked enable row level security;
create policy "anyone can read dream_ranked"   on dream_ranked for select using (true);
create policy "anyone can add dream_ranked"    on dream_ranked for insert with check (true);
create policy "anyone can update dream_ranked" on dream_ranked for update using (true) with check (true);
drop trigger if exists ranked_guard on dream_ranked;
create trigger ranked_guard before insert or update on dream_ranked for each row execute function ranked_guard();

-- =====================================================================
-- ANTI-CHEAT (run this whole file again; every statement is safe to repeat)
-- =====================================================================
create table if not exists banned (id text primary key, reason text, created_at timestamptz not null default now());
alter table banned enable row level security;
drop policy if exists "anyone can check bans" on banned;
create policy "anyone can check bans" on banned for select using (true);  -- no insert policy: only you (dashboard) can ban

alter table leaderboard add column if not exists rid text;
alter table scorers     add column if not exists rid text;

-- Banned players cannot create rows.
create or replace function ban_check() returns trigger as $$
declare pid text;
begin
  pid := coalesce(to_jsonb(new)->>'rid', to_jsonb(new)->>'id');
  if exists (select 1 from banned where id = pid) then raise exception 'banned'; end if;
  return new;
end $$ language plpgsql;
drop trigger if exists ban_check_lb on leaderboard;
create trigger ban_check_lb before insert on leaderboard for each row execute function ban_check();
drop trigger if exists ban_check_sc on scorers;
create trigger ban_check_sc before insert on scorers for each row execute function ban_check();

-- Ranked ladders: one result per update, results must match the rating move,
-- at most one update per 100 seconds (a real match is longer), max 40 points each.
-- (This replaces the earlier version, which wrongly capped existing ratings at 1040.)
create or replace function ranked_guard() returns trigger as $$
declare ex boolean;
begin
  if exists (select 1 from banned where id = new.id) then raise exception 'banned'; end if;
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I where id = $1)', tg_table_name) into ex using new.id;
    if ex then return new; end if;               -- an upsert of an existing row is validated by the UPDATE branch
    if new.games > 1 then raise exception 'new players start with at most one game'; end if;
    new.rating = greatest(960, least(1040, new.rating));
  else
    if new.games <> old.games + 1
       or (new.wins - old.wins) + (new.draws - old.draws) + (new.losses - old.losses) <> 1
       or new.wins < old.wins or new.draws < old.draws or new.losses < old.losses
       or now() - old.updated_at < interval '100 seconds' then
      return old;                                 -- ignore impossible or too-fast updates
    end if;
    if (new.wins = old.wins + 1 and new.rating < old.rating)
       or (new.losses = old.losses + 1 and new.rating > old.rating) then
      return old;                                 -- a win cannot lower your rating, a loss cannot raise it
    end if;
    new.rating = greatest(old.rating - 40, least(old.rating + 40, new.rating));
  end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- Career leaderboard: no score jumps, at most one new season per update.
create or replace function keep_best() returns trigger as $$
begin
  if exists (select 1 from banned where id = new.rid) then raise exception 'banned'; end if;
  if new.score < old.score or new.seasons > old.seasons + 1 then return old; end if;
  new.score = least(new.score, old.score + 210);
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- Scorers: at most 12 new goals per update.
create or replace function keep_best_goals() returns trigger as $$
begin
  if exists (select 1 from banned where id = new.rid) then raise exception 'banned'; end if;
  if new.goals < old.goals or new.goals > old.goals + 12 then return old; end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- HOW TO BAN: run  select ban_player('THE-ID', 'reason');   (SQL Editor only)
-- The id is the "id" shown in Table Editor > ranked / dream_ranked.
create or replace function ban_player(pid text, why text default '') returns void as $$
begin
  insert into banned(id, reason) values (pid, why) on conflict do nothing;
  delete from ranked        where id  = pid;
  delete from dream_ranked  where id  = pid;
  delete from leaderboard   where rid = pid or id = pid;
  delete from scorers       where rid = pid;
end $$ language plpgsql;
revoke execute on function ban_player(text, text) from public, anon, authenticated;

-- HOW TO SPOT CHEATERS (examples to run in the SQL Editor):
--   select id, name, rating, games, wins from ranked where games >= 15 and wins::float / games > 0.9 order by rating desc;
--   select id, name, rating, games from dream_ranked order by rating desc limit 20;

-- =====================================================================
-- ADMIN: lets your SECRET key (used only by admin.html) edit rows.
-- Players using the public key are still fully restricted.
-- =====================================================================
create or replace function is_admin() returns boolean as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '') = 'service_role';
$$ language sql stable;

create or replace function ranked_guard() returns trigger as $$
declare ex boolean;
begin
  if is_admin() then return new; end if;
  if exists (select 1 from banned where id = new.id) then raise exception 'banned'; end if;
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

create or replace function keep_best() returns trigger as $$
begin
  if is_admin() then return new; end if;
  if exists (select 1 from banned where id = new.rid) then raise exception 'banned'; end if;
  if new.score < old.score or new.seasons > old.seasons + 1 then return old; end if;
  new.score = least(new.score, old.score + 210);
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create or replace function keep_best_goals() returns trigger as $$
begin
  if is_admin() then return new; end if;
  if exists (select 1 from banned where id = new.rid) then raise exception 'banned'; end if;
  if new.goals < old.goals or new.goals > old.goals + 12 then return old; end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- =====================================================================
-- ACCOUNTS: permanent usernames + each player can only write their own ladder row
-- In Supabase: Authentication > Sign In / Providers > Email > turn OFF "Confirm email"
-- (otherwise players must click a link in an email before they can log in).
-- =====================================================================
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null check (username ~ '^[A-Za-z0-9_]{3,14}$'),
  username_lc text generated always as (lower(username)) stored,
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_username_lc on profiles (username_lc);
alter table profiles enable row level security;
drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles for select using (true);
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles for insert with check (id = auth.uid());
-- no UPDATE policy, plus a trigger: a username can never change
create or replace function lock_username() returns trigger as $$
begin
  if new.username <> old.username then raise exception 'username is permanent'; end if;
  return new;
end $$ language plpgsql;
drop trigger if exists lock_username on profiles;
create trigger lock_username before update on profiles for each row execute function lock_username();
-- create the profile automatically at sign-up (username comes from the sign-up form)
create or replace function handle_new_user() returns trigger as $$
begin
  if new.raw_user_meta_data->>'username' ~ '^[A-Za-z0-9_]{3,14}$' then
    insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data->>'username') on conflict do nothing;
  end if;
  return new;
end $$ language plpgsql security definer set search_path = public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Ladders: only the logged-in owner can add or change their own row.
drop policy if exists "anyone can add ranked" on ranked;
drop policy if exists "anyone can update ranked" on ranked;
drop policy if exists "owner adds ranked" on ranked;
drop policy if exists "owner updates ranked" on ranked;
create policy "owner adds ranked"    on ranked for insert with check (id = auth.uid()::text);
create policy "owner updates ranked" on ranked for update using (id = auth.uid()::text) with check (id = auth.uid()::text);
drop policy if exists "anyone can add dream_ranked" on dream_ranked;
drop policy if exists "anyone can update dream_ranked" on dream_ranked;
drop policy if exists "owner adds dream_ranked" on dream_ranked;
drop policy if exists "owner updates dream_ranked" on dream_ranked;
create policy "owner adds dream_ranked"    on dream_ranked for insert with check (id = auth.uid()::text);
create policy "owner updates dream_ranked" on dream_ranked for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- The ladder name always comes from the permanent profile username.
create or replace function ranked_guard() returns trigger as $$
declare ex boolean; nm text;
begin
  if is_admin() then return new; end if;
  if exists (select 1 from banned where id = new.id) then raise exception 'banned'; end if;
  select username into nm from profiles where id::text = new.id;
  if nm is null then raise exception 'no profile'; end if;
  new.name := nm;
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
