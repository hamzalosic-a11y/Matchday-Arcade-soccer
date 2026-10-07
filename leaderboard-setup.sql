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
