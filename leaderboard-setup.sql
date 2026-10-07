-- Run this ONCE in Supabase (SQL Editor -> New query). Keep your old leaderboard-setup.sql as is.
create table if not exists ranks (
  id         text primary key,
  name       text not null check (char_length(name) between 1 and 16),
  mode       text not null check (mode in ('1v1','2v2')),
  rating     int  not null default 1000 check (rating between 0 and 4000),
  games      int  not null default 0,
  wins       int  not null default 0 check (wins <= games),
  updated_at timestamptz not null default now()
);
alter table ranks enable row level security;
create policy "anyone can read ranks" on ranks for select using (true);
-- No insert/update policy: the only way to write is the function below, which caps each match at +/-40.
create or replace function report_rank(p_id text, p_name text, p_mode text, p_delta int, p_res int)
returns void language plpgsql security definer set search_path = public as $$
declare d int := least(40, greatest(-40, p_delta));
begin
  if p_mode not in ('1v1','2v2') or p_res not between 0 and 2 or char_length(p_id) > 60 then raise exception 'bad input'; end if;
  insert into ranks(id,name,mode,rating,games,wins)
  values (p_id, coalesce(nullif(left(trim(p_name),16),''),'Player'), p_mode, greatest(0,1000+d), 1, (p_res=2)::int)
  on conflict (id) do update set
    name = excluded.name,
    rating = greatest(0, least(4000, ranks.rating + d)),
    games = ranks.games + 1,
    wins = ranks.wins + (p_res=2)::int,
    updated_at = now();
end $$;
grant execute on function report_rank(text,text,text,int,int) to anon, authenticated;
