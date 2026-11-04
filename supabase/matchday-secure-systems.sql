-- Matchday secure accounts, inventory, coin economy, Stripe fulfillment and private rooms.
-- Existing profiles, leaderboard rows and game saves are preserved.
create table if not exists public.wallets(user_id uuid primary key references auth.users(id) on delete cascade,balance bigint not null default 0 check(balance>=0),updated_at timestamptz not null default now());
create table if not exists public.wallet_transactions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,amount bigint not null check(amount<>0),reason text not null,idempotency_key text not null unique,created_at timestamptz not null default now());
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id,created_at desc);
create table if not exists public.player_cards(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,card_key text not null,rarity text not null,card jsonb not null,level integer not null default 0 check(level between 0 and 50),created_at timestamptz not null default now());
create index if not exists player_cards_user_created_idx on public.player_cards(user_id,created_at desc);
create index if not exists player_cards_duplicate_idx on public.player_cards(user_id,card_key,rarity);
create table if not exists public.matchday_stripe_events(event_id text primary key,event_type text not null,processed_at timestamptz not null default now());
create table if not exists public.matchday_rooms(id uuid primary key default gen_random_uuid(),room_code text not null unique check(room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),host_user_id uuid not null references auth.users(id) on delete cascade,guest_user_id uuid references auth.users(id) on delete set null,status text not null default 'open' check(status in('open','full','cancelled')),created_at timestamptz not null default now(),expires_at timestamptz not null);
create index if not exists matchday_rooms_expiry_idx on public.matchday_rooms(status,expires_at);

alter table public.purchases add column if not exists uid uuid references auth.users(id) on delete set null;
alter table public.purchases add column if not exists session_id text;
alter table public.purchases add column if not exists checkout_session_id text;
alter table public.purchases add column if not exists product_id text;
alter table public.purchases add column if not exists amount_total integer;
alter table public.purchases add column if not exists currency text;
alter table public.purchases add column if not exists payment_status text;
alter table public.purchases add column if not exists opened boolean not null default false;
alter table public.purchases add column if not exists reward jsonb;
create unique index if not exists purchases_session_id_uidx on public.purchases(session_id) where session_id is not null;

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.player_cards enable row level security;
alter table public.matchday_stripe_events enable row level security;
alter table public.matchday_rooms enable row level security;
drop policy if exists "wallet owner reads balance" on public.wallets;
create policy "wallet owner reads balance" on public.wallets for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "wallet owner reads transactions" on public.wallet_transactions;
create policy "wallet owner reads transactions" on public.wallet_transactions for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "card owner reads inventory" on public.player_cards;
create policy "card owner reads inventory" on public.player_cards for select to authenticated using((select auth.uid())=user_id);
drop policy if exists "room participants read room" on public.matchday_rooms;
create policy "room participants read room" on public.matchday_rooms for select to authenticated using((select auth.uid())=host_user_id or (select auth.uid())=guest_user_id);
revoke all on public.wallets,public.wallet_transactions,public.player_cards,public.matchday_stripe_events,public.matchday_rooms from anon,authenticated;
grant select on public.wallets,public.wallet_transactions,public.player_cards,public.matchday_rooms to authenticated;
grant all on public.wallets,public.wallet_transactions,public.player_cards,public.matchday_stripe_events,public.matchday_rooms to service_role;
revoke all on public.purchases from anon,authenticated;

create or replace function public.fulfill_matchday_checkout(p_event_id text,p_event_type text,p_session_id text,p_uid uuid,p_product_id text,p_amount_total integer,p_currency text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare expected_amount integer; inserted_count integer;
begin
 if p_product_id not in('starter','pro','legend') then raise exception 'Unknown pack'; end if;
 expected_amount:=case p_product_id when 'starter' then 990 when 'pro' then 2990 else 4990 end;
 if p_amount_total<>expected_amount or lower(p_currency)<>'sek' then raise exception 'Payment amount mismatch'; end if;
 if p_event_id is null or p_session_id is null or p_uid is null then raise exception 'Missing payment identity'; end if;
 insert into public.matchday_stripe_events(event_id,event_type) values(p_event_id,p_event_type) on conflict(event_id) do nothing;
 get diagnostics inserted_count=row_count;
 if inserted_count=0 then return false; end if;
 insert into public.purchases(session_id,checkout_session_id,uid,product_id,amount_total,currency,payment_status,opened,status)
 values(p_session_id,p_session_id,p_uid,p_product_id,p_amount_total,lower(p_currency),'paid',false,'granted')
 on conflict(session_id) do nothing;
 get diagnostics inserted_count=row_count;
 if inserted_count=0 then return false; end if;
 insert into public.wallets(user_id,balance) values(p_uid,0) on conflict(user_id) do nothing;
 return true;
end; $$;

create or replace function public.claim_matchday_pack(p_uid uuid,p_purchase_id bigint,p_reward jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.purchases%rowtype;
begin
 select * into p from public.purchases where id=p_purchase_id and uid=p_uid and payment_status='paid' for update;
 if not found then raise exception 'Paid pack not found for this account'; end if;
 if p.opened then return p.reward; end if;
 if p_reward is null or coalesce(p_reward->>'nm','')='' then raise exception 'Invalid reward'; end if;
 update public.purchases set opened=true,reward=p_reward,status='opened' where id=p.id;
 insert into public.player_cards(user_id,card_key,rarity,card)
 values(p_uid,lower(p_reward->>'nm')||':'||upper(coalesce(p_reward->>'pos','MF')),coalesce(p_reward->>'rarity','Bronze'),p_reward);
 return p_reward;
end; $$;

create or replace function public.manage_matchday_card(p_uid uuid,p_card_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target public.player_cards%rowtype; duplicate_ids uuid[]; wallet_balance bigint;
begin
 select * into target from public.player_cards where id=p_card_id and user_id=p_uid for update;
 if not found then raise exception 'Card not found in this account'; end if;
 if p_action='burn' then
  if lower(target.rarity) not in('bronze','common') then raise exception 'Only common Bronze cards can be burned'; end if;
  delete from public.player_cards where id=target.id;
  insert into public.wallets(user_id,balance) values(p_uid,25) on conflict(user_id) do update set balance=public.wallets.balance+25,updated_at=now();
  insert into public.wallet_transactions(user_id,amount,reason,idempotency_key) values(p_uid,25,'Burned duplicate Bronze player card','burn:'||target.id::text) on conflict(idempotency_key) do nothing;
  select balance into wallet_balance from public.wallets where user_id=p_uid;
  return jsonb_build_object('action','burn','coins',25,'balance',wallet_balance);
 elsif p_action='train' then
  if lower(target.rarity) not in('bronze','common') then raise exception 'Training currently uses common Bronze duplicates'; end if;
  select array_agg(id) into duplicate_ids from (select id from public.player_cards where user_id=p_uid and card_key=target.card_key and id<>target.id and lower(rarity) in('bronze','common') order by created_at limit 3 for update) duplicates;
  if coalesce(array_length(duplicate_ids,1),0)<3 then raise exception 'You need three duplicate Bronze cards of this player to train'; end if;
  delete from public.player_cards where id=any(duplicate_ids);
  update public.player_cards set
   card=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(card,'{ovr}',to_jsonb(least(99,coalesce((card->>'ovr')::integer,0)+1)),true),'{pac}',to_jsonb(least(99,coalesce((card->>'pac')::integer,0)+1)),true),'{sht}',to_jsonb(least(99,coalesce((card->>'sht')::integer,0)+1)),true),'{pas}',to_jsonb(least(99,coalesce((card->>'pas')::integer,0)+1)),true),'{def}',to_jsonb(least(99,coalesce((card->>'def')::integer,0)+1)),true),
   level=level+1 where id=target.id and user_id=p_uid;
  return jsonb_build_object('action','train','consumed',3,'card_id',target.id,'level',target.level+1);
 end if;
 raise exception 'Unknown card action';
end; $$;

revoke all on function public.fulfill_matchday_checkout(text,text,text,uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.claim_matchday_pack(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.manage_matchday_card(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fulfill_matchday_checkout(text,text,text,uuid,text,integer,text) to service_role;
grant execute on function public.claim_matchday_pack(uuid,bigint,jsonb) to service_role;
grant execute on function public.manage_matchday_card(uuid,uuid,text) to service_role;
