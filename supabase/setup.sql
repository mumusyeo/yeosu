-- Generated: npm run build. Run the WHOLE file in the project SQL Editor.
-- Supports a new project and upgrades from v1/v2. Existing records and edits are retained.
begin;
do $install_base$
begin
  if to_regclass('public.trips') is null then
    execute $migration_001$-- Run once in a dedicated Supabase project, followed by seed.sql.

create schema if not exists trip_private;
revoke all on schema trip_private from public, anon;
grant usage on schema trip_private to authenticated;

create table public.trips (
  id uuid primary key, title text not null check (length(btrim(title)) between 1 and 100),
  start_date date not null, end_date date not null, timezone text not null default 'Asia/Seoul',
  check (end_date >= start_date)
);
create table public.participants (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  name text not null check (length(btrim(name)) between 1 and 40),
  role text not null default 'guest' check (role in ('host','guest')), active boolean not null default true,
  owner_auth_id uuid references auth.users(id), unique(id,trip_id), unique(trip_id,owner_auth_id),
  check (owner_auth_id is null or role = 'host')
);
create table public.lodgings (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  city text not null, name text not null check (length(btrim(name)) between 1 and 100),
  check_in date not null, check_out date not null,
  url text not null check (url ~* '^https?://[^[:space:]]+$' and length(url) <= 2048),
  notes text not null default '' check (length(notes) <= 1000), verified boolean not null default false,
  unique(id,trip_id), check(check_out > check_in)
);
create table public.schedule_items (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  date date not null, position integer not null check(position between 1 and 9999),
  kind text not null check(kind in ('train','move','food','cafe','sight','stay')),
  title text not null check(length(btrim(title)) between 1 and 100),
  description text not null default '' check(length(description) <= 1000),
  start_time time, end_time time, verified boolean not null default false, lodging_id uuid,
  unique(id,trip_id), foreign key(lodging_id,trip_id) references public.lodgings(id,trip_id),
  check(end_time is null or start_time is null or end_time >= start_time)
);
create table public.polls (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  schedule_id uuid not null unique, status text not null default 'open' check(status in ('open','closed')),
  deadline timestamptz, confirmed_candidate_id uuid,
  decision_reason text not null default '' check(length(decision_reason) <= 500),
  unique(id,trip_id), foreign key(schedule_id,trip_id) references public.schedule_items(id,trip_id),
  check(confirmed_candidate_id is null or status='closed')
);
create table public.candidates (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  poll_id uuid not null, name text not null check(length(btrim(name)) between 1 and 80),
  normalized_name text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  url text not null default '' check(url='' or (url ~* '^https?://[^[:space:]]+$' and length(url) <= 2048)),
  price integer check(price >= 0), description text not null default '' check(length(description) <= 500),
  hidden boolean not null default false, created_by uuid, created_at timestamptz not null default now(),
  unique(poll_id,normalized_name), unique(id,poll_id,trip_id),
  foreign key(poll_id,trip_id) references public.polls(id,trip_id),
  foreign key(created_by,trip_id) references public.participants(id,trip_id)
);
alter table public.polls add constraint polls_confirmed_candidate_fk
  foreign key(confirmed_candidate_id,id,trip_id) references public.candidates(id,poll_id,trip_id);
create table public.votes (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  poll_id uuid not null, participant_id uuid not null, candidate_id uuid,
  updated_at timestamptz not null default now(), unique(poll_id,participant_id),
  foreign key(poll_id,trip_id) references public.polls(id,trip_id),
  foreign key(candidate_id,poll_id,trip_id) references public.candidates(id,poll_id,trip_id),
  foreign key(participant_id,trip_id) references public.participants(id,trip_id)
);
create table public.guestbook_entries (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  participant_id uuid not null, content text not null check(length(btrim(content)) between 1 and 1000),
  request_id uuid not null unique, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  foreign key(participant_id,trip_id) references public.participants(id,trip_id)
);
create index guestbook_trip_created on public.guestbook_entries(trip_id,created_at desc,id) where deleted_at is null;
create index votes_trip_poll on public.votes(trip_id,poll_id);
create index schedule_trip_date on public.schedule_items(trip_id,date,position);
create index candidates_trip_poll on public.candidates(trip_id,poll_id);
create table trip_private.invitations (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  participant_id uuid not null, token_hash text not null unique,
  created_at timestamptz not null default now(), expires_at timestamptz, revoked_at timestamptz,
  unique(id,participant_id,trip_id), foreign key(participant_id,trip_id) references public.participants(id,trip_id)
);
create table trip_private.participant_sessions (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null, participant_id uuid not null, invitation_id uuid not null,
  primary key(auth_user_id,trip_id),
  foreign key(invitation_id,participant_id,trip_id) references trip_private.invitations(id,participant_id,trip_id)
);
create table trip_private.redeem_limits (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  last_attempt timestamptz not null default now(), attempts integer not null default 1
);
alter table trip_private.invitations enable row level security;
alter table trip_private.participant_sessions enable row level security;
alter table trip_private.redeem_limits enable row level security;
revoke all on all tables in schema trip_private from public, anon, authenticated;

-- These helpers bypass RLS only to resolve server-owned membership records.
create function trip_private.member(p_trip uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.participants p where p.trip_id=p_trip and p.active and (
    (p.role='host' and p.owner_auth_id=auth.uid()) or exists (
      select 1 from trip_private.participant_sessions s join trip_private.invitations i on i.id=s.invitation_id
      where s.auth_user_id=auth.uid() and s.trip_id=p_trip and s.participant_id=p.id
        and i.revoked_at is null and (i.expires_at is null or i.expires_at>now())
    )
  ) order by (p.role='host') desc limit 1;
$$;
create function trip_private.host(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.participants where id=trip_private.member(p_trip) and role='host');
$$;
create function trip_private.require_member(p_trip uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id:=trip_private.member(p_trip);
  if v_id is null then raise exception '초대가 만료되었거나 여행 참여 권한이 없어요.' using errcode='42501'; end if;
  return v_id;
end;
$$;
create function trip_private.require_host(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not trip_private.host(p_trip) then raise exception '주최자만 변경할 수 있어요.' using errcode='42501'; end if;
end;
$$;
revoke all on all functions in schema trip_private from public, anon, authenticated;
grant execute on function trip_private.member(uuid),trip_private.host(uuid) to authenticated;

-- SELECT is allowed through RLS. All writes go through the constrained RPC below.
do $$
declare t text;
begin
  foreach t in array array['trips','participants','lodgings','schedule_items','polls','candidates','votes','guestbook_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    if t='participants' then
      execute 'grant select(id,trip_id,name,role,active) on public.participants to authenticated';
    else
      execute format('grant select on public.%I to authenticated',t);
    end if;
    execute format('create policy trip_read on public.%I for select to authenticated using (trip_private.member(%I) is not null)',t,case when t='trips' then 'id' else 'trip_id' end);
  end loop;
end;
$$;

-- Token stays in the URL fragment until the client reads and clears it. Only a
-- SHA-256 digest is persisted. No Edge Function or service_role browser key is needed.
create function public.redeem_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv trip_private.invitations; v_uid uuid:=auth.uid(); v_attempts integer;
begin
  if v_uid is null then raise exception '먼저 인증 세션을 시작해 주세요.' using errcode='42501'; end if;
  if length(p_token)<>64 or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'message','유효하지 않은 초대 링크예요.'); end if;
  insert into trip_private.redeem_limits(auth_user_id) values(v_uid)
    on conflict(auth_user_id) do update set
      attempts=case when trip_private.redeem_limits.last_attempt < now()-interval '1 minute' then 1 else trip_private.redeem_limits.attempts+1 end,
      last_attempt=case when trip_private.redeem_limits.last_attempt < now()-interval '1 minute' then now() else trip_private.redeem_limits.last_attempt end
    returning attempts into v_attempts;
  if v_attempts>10 then return jsonb_build_object('ok',false,'message','잠시 후 초대 링크를 다시 열어 주세요.'); end if;
  select i.* into v_inv from trip_private.invitations i join public.participants p on p.id=i.participant_id
    where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and i.revoked_at is null
      and (i.expires_at is null or i.expires_at>now()) and p.active and p.role='guest' for update of i;
  if v_inv.id is null then return jsonb_build_object('ok',false,'message','초대 링크가 만료되거나 폐기됐어요. 새 링크를 받아 주세요.'); end if;
  insert into trip_private.participant_sessions(auth_user_id,trip_id,participant_id,invitation_id)
    values(v_uid,v_inv.trip_id,v_inv.participant_id,v_inv.id)
    on conflict(auth_user_id,trip_id) do update set participant_id=excluded.participant_id,invitation_id=excluded.invitation_id;
  return jsonb_build_object('ok',true,'trip_id',v_inv.trip_id);
end;
$$;

create function public.trip_snapshot(p_trip uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=trip_private.require_member(p_trip); v_host boolean:=trip_private.host(p_trip);
begin
  return jsonb_build_object(
    'server_time',now(),
    'trip',(select to_jsonb(t) from public.trips t where id=p_trip),
    'me',(select jsonb_build_object('id',id,'name',name,'role',role,'active',active) from public.participants where id=v_me),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'trip_id',trip_id,'name',name,'role',role,'active',active) order by (role='host') desc,name,id) from public.participants where trip_id=p_trip),'[]'::jsonb),
    'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by date,position,id) from public.schedule_items s where trip_id=p_trip),'[]'::jsonb),
    'lodgings',coalesce((select jsonb_agg(to_jsonb(l) order by check_in) from public.lodgings l where trip_id=p_trip),'[]'::jsonb),
    'polls',coalesce((select jsonb_agg(to_jsonb(p) order by s.date,s.position) from public.polls p join public.schedule_items s on s.id=p.schedule_id where p.trip_id=p_trip),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from public.candidates c where trip_id=p_trip),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.votes v where trip_id=p_trip and candidate_id is not null),'[]'::jsonb),
    'invitations',case when v_host then coalesce((select jsonb_agg(jsonb_build_object('id',id,'participant_id',participant_id,'created_at',created_at,'expires_at',expires_at,'revoked_at',revoked_at) order by created_at desc) from trip_private.invitations where trip_id=p_trip),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
create function public.trip_guestbook(p_trip uuid,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=trip_private.require_member(p_trip);
begin
  if p_limit<1 or p_limit>10000 or (p_limit>500 and not trip_private.host(p_trip)) then raise exception '조회 개수가 올바르지 않아요.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc,id desc) from
    (select * from public.guestbook_entries where trip_id=p_trip and deleted_at is null order by created_at desc,id desc limit p_limit) g),'[]'::jsonb);
end;
$$;

-- All state transitions are atomic. Participant lock serializes guestbook rate
-- checks; poll lock serializes vote, candidate, deadline and host decisions.
create function public.trip_mutate(p_trip uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid:=trip_private.require_member(p_trip); v_host boolean:=trip_private.host(p_trip);
  v_poll public.polls; v_candidate public.candidates; v_entry public.guestbook_entries;
  v_person public.participants; v_item public.schedule_items;
  v_id uuid; v_name text; v_content text; v_token text; v_expiry timestamptz;
  v_date date; v_count integer; v_max integer; v_leaders integer; v_winner uuid;
begin
  perform 1 from public.participants where id=v_me for update;
  -- Check again after waiting for a concurrent participant deactivation.
  perform trip_private.require_member(p_trip);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception '요청 내용이 올바르지 않아요.'; end if;

  if p_action in ('vote','candidate','poll') then
    select * into v_poll from public.polls where id=(p_payload->>'poll_id')::uuid and trip_id=p_trip for update;
    if v_poll.id is null then raise exception '투표를 찾을 수 없어요.'; end if;
    if p_action in ('vote','candidate') and (v_poll.status<>'open' or v_poll.confirmed_candidate_id is not null or (v_poll.deadline is not null and v_poll.deadline<=now())) then
      raise exception '마감되거나 확정된 투표예요.';
    end if;
  end if;

  if p_action='vote' then
    v_id:=nullif(p_payload->>'candidate_id','')::uuid;
    if v_id is not null and not exists(select 1 from public.candidates where id=v_id and poll_id=v_poll.id and trip_id=p_trip and not hidden) then raise exception '선택 가능한 후보가 아니에요.'; end if;
    insert into public.votes(trip_id,poll_id,participant_id,candidate_id) values(p_trip,v_poll.id,v_me,v_id)
      on conflict(poll_id,participant_id) do update set candidate_id=excluded.candidate_id,updated_at=now();

  elsif p_action='candidate' then
    v_name:=btrim(coalesce(p_payload->>'name',''));
    if length(v_name) not between 1 and 80 then raise exception '장소 이름은 1~80자예요.'; end if;
    if exists(select 1 from public.candidates where poll_id=v_poll.id and normalized_name=lower(regexp_replace(v_name,'\s+',' ','g'))) then raise exception '이미 등록된 장소예요.'; end if;
    insert into public.candidates(trip_id,poll_id,name,url,price,description,created_by)
      values(p_trip,v_poll.id,v_name,coalesce(p_payload->>'url',''),nullif(p_payload->>'price','')::integer,coalesce(p_payload->>'description',''),v_me);

  elsif p_action='guestbook_create' then
    v_id:=(p_payload->>'request_id')::uuid;
    if v_id is null then raise exception '요청 식별자가 필요해요.'; end if;
    if exists(select 1 from public.guestbook_entries where request_id=v_id and participant_id=v_me and trip_id=p_trip) then return jsonb_build_object('ok',true); end if;
    if exists(select 1 from public.guestbook_entries where participant_id=v_me and created_at>now()-interval '10 seconds') then raise exception '메시지는 10초에 한 번 남길 수 있어요.'; end if;
    v_content:=btrim(coalesce(p_payload->>'content',''));
    if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
    insert into public.guestbook_entries(trip_id,participant_id,content,request_id) values(p_trip,v_me,v_content,v_id);

  elsif p_action in ('guestbook_edit','guestbook_delete') then
    select * into v_entry from public.guestbook_entries where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
    if v_entry.id is null or (v_entry.participant_id<>v_me and not (p_action='guestbook_delete' and v_host)) then raise exception '이 글을 변경할 권한이 없어요.' using errcode='42501'; end if;
    if p_action='guestbook_edit' then
      v_content:=btrim(coalesce(p_payload->>'content',''));
      if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
      update public.guestbook_entries set content=v_content,updated_at=clock_timestamp() where id=v_entry.id;
    else update public.guestbook_entries set deleted_at=now(),updated_at=clock_timestamp() where id=v_entry.id;
    end if;

  else
    perform trip_private.require_host(p_trip);
    if p_action='poll' then
      if p_payload->>'operation'='confirm' then
        v_id:=(p_payload->>'candidate_id')::uuid;
        if not exists(select 1 from public.candidates where id=v_id and poll_id=v_poll.id and not hidden) then raise exception '유효한 후보를 선택해 주세요.'; end if;
        select max(n) into v_max from (select count(v.id)::integer as n from public.candidates c left join public.votes v on v.candidate_id=c.id and v.poll_id=c.poll_id where c.poll_id=v_poll.id and not c.hidden group by c.id) counts;
        select count(*)::integer,min(id::text)::uuid into v_leaders,v_winner from (
          select c.id from public.candidates c left join public.votes v on v.candidate_id=c.id and v.poll_id=c.poll_id
          where c.poll_id=v_poll.id and not c.hidden group by c.id having count(v.id)=v_max and v_max>0
        ) leaders;
        if (v_leaders<>1 or v_winner is distinct from v_id) and length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception '현재 단독 1위와 다른 결정을 할 때는 이유를 남겨 주세요.'; end if;
        update public.polls set confirmed_candidate_id=v_id,status='closed',decision_reason=btrim(coalesce(p_payload->>'reason','')) where id=v_poll.id;
      elsif p_payload->>'operation'='reopen' then
        update public.polls set confirmed_candidate_id=null,status='open',deadline=null,decision_reason='' where id=v_poll.id;
      elsif p_payload->>'operation'='close' then update public.polls set status='closed' where id=v_poll.id;
      elsif p_payload->>'operation'='deadline' then update public.polls set deadline=nullif(p_payload->>'deadline','')::timestamptz where id=v_poll.id;
      else raise exception '지원하지 않는 투표 작업이에요.'; end if;

    elsif p_action='hide_candidate' then
      -- Lock order is always participant -> poll -> candidate.
      select * into v_candidate from public.candidates where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if v_candidate.id is null then raise exception '후보를 찾을 수 없어요.'; end if;
      select * into v_poll from public.polls where id=v_candidate.poll_id for update;
      if v_poll.confirmed_candidate_id=v_candidate.id then raise exception '확정을 해제한 후 숨겨 주세요.'; end if;
      update public.candidates set hidden=(p_payload->>'hidden')::boolean where id=v_candidate.id;

    elsif p_action in ('schedule','schedule_add') then
      v_date:=(p_payload->>'date')::date;
      if not exists(select 1 from public.trips where id=p_trip and v_date between start_date and end_date) then raise exception '여행 날짜를 선택해 주세요.'; end if;
      if p_action='schedule' then
        update public.schedule_items set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),date=v_date,
          start_time=nullif(p_payload->>'start_time','')::time,end_time=nullif(p_payload->>'end_time','')::time,
          verified=coalesce((p_payload->>'verified')::boolean,false),position=(p_payload->>'position')::integer
          where id=(p_payload->>'id')::uuid and trip_id=p_trip;
        if not found then raise exception '일정을 찾을 수 없어요.'; end if;
      else
        perform 1 from public.trips where id=p_trip for update;
        select coalesce(max(position),0)+1 into v_count from public.schedule_items where trip_id=p_trip;
        insert into public.schedule_items(trip_id,date,position,kind,title,description)
          values(p_trip,v_date,v_count,p_payload->>'kind',btrim(p_payload->>'title'),coalesce(p_payload->>'description','')) returning id into v_id;
        if p_payload->>'kind' in ('food','cafe') then insert into public.polls(trip_id,schedule_id) values(p_trip,v_id); end if;
      end if;

    elsif p_action='lodging' then
      update public.lodgings set name=btrim(p_payload->>'name'),notes=coalesce(p_payload->>'notes',''),url=p_payload->>'url',verified=coalesce((p_payload->>'verified')::boolean,false)
        where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if not found then raise exception '숙소를 찾을 수 없어요.'; end if;

    elsif p_action='participant' then
      select * into v_person from public.participants where id=(p_payload->>'id')::uuid and trip_id=p_trip for update;
      if v_person.id is null then raise exception '참여자를 찾을 수 없어요.'; end if;
      if v_person.role='host' and not coalesce((p_payload->>'active')::boolean,false) then raise exception '주최자를 비활성화할 수 없어요.'; end if;
      update public.participants set name=btrim(p_payload->>'name'),active=coalesce((p_payload->>'active')::boolean,false) where id=v_person.id;

    elsif p_action='participant_add' then
      insert into public.participants(trip_id,name) values(p_trip,btrim(p_payload->>'name'));

    elsif p_action in ('invite','revoke_invite') then
      select * into v_person from public.participants where id=(p_payload->>'id')::uuid and trip_id=p_trip for update;
      if v_person.id is null or v_person.role='host' then raise exception '친구를 선택해 주세요.'; end if;
      if p_action='invite' and not v_person.active then raise exception '참여 중인 친구에게만 링크를 발급할 수 있어요.'; end if;
      v_expiry:=nullif(p_payload->>'expires_at','')::timestamptz;
      if p_action='invite' and v_expiry is not null and v_expiry<=now() then raise exception '만료 일시는 현재보다 이후로 설정해 주세요.'; end if;
      update trip_private.invitations set revoked_at=now() where participant_id=v_person.id and revoked_at is null;
      if p_action='invite' then
        v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
        insert into trip_private.invitations(trip_id,participant_id,token_hash,expires_at)
          values(p_trip,v_person.id,encode(sha256(convert_to(v_token,'UTF8')),'hex'),v_expiry);
        return jsonb_build_object('ok',true,'token',v_token);
      end if;
    else raise exception '지원하지 않는 작업이에요.'; end if;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.redeem_invite(text),public.trip_snapshot(uuid),public.trip_guestbook(uuid,integer),public.trip_mutate(uuid,text,jsonb) from public,anon;
grant execute on function public.redeem_invite(text),public.trip_snapshot(uuid),public.trip_guestbook(uuid,integer),public.trip_mutate(uuid,text,jsonb) to authenticated;

-- UPDATE/INSERT only: cancelled votes and deleted messages remain tombstones.
-- Avoid DELETE events, which have special RLS limitations in Realtime.
do $$
declare t text;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime with (publish='insert,update');
  end if;
  foreach t in array array['trips','participants','lodgings','schedule_items','polls','candidates','votes','guestbook_entries'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end;
$$;
$migration_001$;
  end if;
  if to_regclass('public.expenses') is null then
    execute $migration_002$-- Upgrade v1 to equal participants, continuously open polls and shared expenses.
-- Apply after 001_trip.sql; seed.sql follows both migrations for a new project.

create table public.expenses (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  paid_by uuid not null, occurred_at timestamptz not null check(isfinite(occurred_at)),
  item text not null check(length(btrim(item)) between 1 and 100),
  amount integer not null check(amount>0), split_mode text not null check(split_mode in ('all','some')),
  request_id uuid not null unique, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(id,trip_id), foreign key(paid_by,trip_id) references public.participants(id,trip_id)
);
create table public.expense_splits (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips,
  expense_id uuid not null, participant_id uuid not null, amount integer not null check(amount>=0),
  unique(expense_id,participant_id),
  foreign key(expense_id,trip_id) references public.expenses(id,trip_id),
  foreign key(participant_id,trip_id) references public.participants(id,trip_id)
);
create index expenses_trip_time on public.expenses(trip_id,occurred_at desc) where deleted_at is null;
create index expense_splits_trip on public.expense_splits(trip_id,expense_id);
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
revoke all on public.expenses,public.expense_splits from public,anon,authenticated;
grant select on public.expenses,public.expense_splits to authenticated;
create policy trip_read on public.expenses for select to authenticated using(trip_private.member(trip_id) is not null);
create policy trip_read on public.expense_splits for select to authenticated using(trip_private.member(trip_id) is not null);

create or replace function trip_private.member(p_trip uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select p.id from public.participants p join trip_private.participant_sessions s on s.participant_id=p.id and s.trip_id=p.trip_id
    join trip_private.invitations i on i.id=s.invitation_id
  where p.trip_id=p_trip and p.active and s.auth_user_id=auth.uid()
    and i.revoked_at is null and (i.expires_at is null or i.expires_at>now()) limit 1;
$$;
drop function trip_private.require_host(uuid);
drop function trip_private.host(uuid);
alter table public.participants drop column owner_auth_id;
alter table public.participants drop column role;
grant select on public.participants to authenticated;
alter table public.polls drop constraint polls_confirmed_candidate_fk;
alter table public.polls drop column confirmed_candidate_id;
alter table public.polls drop column status;
alter table public.polls drop column deadline;
alter table public.polls drop column decision_reason;

create or replace function public.trip_snapshot(p_trip uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_me uuid:=trip_private.require_member(p_trip);
begin
  return jsonb_build_object(
    'server_time',now(),
    'trip',(select to_jsonb(t) from public.trips t where id=p_trip),
    'me',(select to_jsonb(p) from public.participants p where id=v_me),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.participants p where trip_id=p_trip),'[]'::jsonb),
    'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by date,position,id) from public.schedule_items s where trip_id=p_trip),'[]'::jsonb),
    'lodgings',coalesce((select jsonb_agg(to_jsonb(l) order by check_in) from public.lodgings l where trip_id=p_trip),'[]'::jsonb),
    'polls',coalesce((select jsonb_agg(to_jsonb(p) order by s.date,s.position) from public.polls p join public.schedule_items s on s.id=p.schedule_id where p.trip_id=p_trip),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from public.candidates c where trip_id=p_trip),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.votes v where trip_id=p_trip and candidate_id is not null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by occurred_at desc,created_at desc) from public.expenses x where trip_id=p_trip and deleted_at is null),'[]'::jsonb),
    'expense_splits',coalesce((select jsonb_agg(to_jsonb(s) order by participant_id) from public.expense_splits s join public.expenses x on x.id=s.expense_id where s.trip_id=p_trip and x.deleted_at is null),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'participant_id',participant_id,'created_at',created_at,'expires_at',expires_at,'revoked_at',revoked_at) order by created_at desc) from trip_private.invitations where trip_id=p_trip),'[]'::jsonb)
  );
end;
$$;


create or replace function public.redeem_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv trip_private.invitations; v_uid uuid:=auth.uid(); v_attempts integer;
begin
  if v_uid is null then raise exception '먼저 인증 세션을 시작해 주세요.' using errcode='42501'; end if;
  if length(p_token)<>64 or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'message','유효하지 않은 초대 링크예요.'); end if;
  insert into trip_private.redeem_limits(auth_user_id) values(v_uid)
    on conflict(auth_user_id) do update set
      attempts=case when trip_private.redeem_limits.last_attempt < now()-interval '1 minute' then 1 else trip_private.redeem_limits.attempts+1 end,
      last_attempt=case when trip_private.redeem_limits.last_attempt < now()-interval '1 minute' then now() else trip_private.redeem_limits.last_attempt end
    returning attempts into v_attempts;
  if v_attempts>10 then return jsonb_build_object('ok',false,'message','잠시 후 초대 링크를 다시 열어 주세요.'); end if;
  select i.* into v_inv from trip_private.invitations i join public.participants p on p.id=i.participant_id
    where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and i.revoked_at is null
      and (i.expires_at is null or i.expires_at>now()) and p.active for update of i;
  if v_inv.id is null then return jsonb_build_object('ok',false,'message','초대 링크가 만료되거나 폐기됐어요. 새 링크를 받아 주세요.'); end if;
  insert into trip_private.participant_sessions(auth_user_id,trip_id,participant_id,invitation_id)
    values(v_uid,v_inv.trip_id,v_inv.participant_id,v_inv.id)
    on conflict(auth_user_id,trip_id) do update set participant_id=excluded.participant_id,invitation_id=excluded.invitation_id;
  return jsonb_build_object('ok',true,'trip_id',v_inv.trip_id);
end;
$$;

create or replace function public.trip_guestbook(p_trip uuid,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid:=trip_private.require_member(p_trip);
begin
  if p_limit<1 or p_limit>10000 then raise exception '조회 개수가 올바르지 않아요.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc,id desc) from
    (select * from public.guestbook_entries where trip_id=p_trip and deleted_at is null order by created_at desc,id desc limit p_limit) g),'[]'::jsonb);
end;
$$;

create or replace function public.trip_mutate(p_trip uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid:=trip_private.require_member(p_trip);
  v_poll public.polls; v_candidate public.candidates; v_entry public.guestbook_entries;
  v_person public.participants; v_item public.schedule_items;
  v_id uuid; v_name text; v_content text; v_token text; v_expiry timestamptz;
  v_date date; v_count integer; v_expense public.expenses; v_ids uuid[]; v_amount integer; v_mode text;
begin
  perform 1 from public.participants where id=v_me for update;
  -- Check again after waiting for a concurrent participant deactivation.
  perform trip_private.require_member(p_trip);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception '요청 내용이 올바르지 않아요.'; end if;

  if p_action in ('vote','candidate') then
    select * into v_poll from public.polls where id=(p_payload->>'poll_id')::uuid and trip_id=p_trip for update;
    if v_poll.id is null then raise exception '투표를 찾을 수 없어요.'; end if;

  end if;

  if p_action='vote' then
    v_id:=nullif(p_payload->>'candidate_id','')::uuid;
    if v_id is not null and not exists(select 1 from public.candidates where id=v_id and poll_id=v_poll.id and trip_id=p_trip and not hidden) then raise exception '선택 가능한 후보가 아니에요.'; end if;
    insert into public.votes(trip_id,poll_id,participant_id,candidate_id) values(p_trip,v_poll.id,v_me,v_id)
      on conflict(poll_id,participant_id) do update set candidate_id=excluded.candidate_id,updated_at=now();

  elsif p_action='candidate' then
    v_name:=btrim(coalesce(p_payload->>'name',''));
    if length(v_name) not between 1 and 80 then raise exception '장소 이름은 1~80자예요.'; end if;
    if exists(select 1 from public.candidates where poll_id=v_poll.id and normalized_name=lower(regexp_replace(v_name,'\s+',' ','g'))) then raise exception '이미 등록된 장소예요.'; end if;
    insert into public.candidates(trip_id,poll_id,name,url,price,description,created_by)
      values(p_trip,v_poll.id,v_name,coalesce(p_payload->>'url',''),nullif(p_payload->>'price','')::integer,coalesce(p_payload->>'description',''),v_me);

  elsif p_action='guestbook_create' then
    v_id:=(p_payload->>'request_id')::uuid;
    if v_id is null then raise exception '요청 식별자가 필요해요.'; end if;
    if exists(select 1 from public.guestbook_entries where request_id=v_id and participant_id=v_me and trip_id=p_trip) then return jsonb_build_object('ok',true); end if;
    if exists(select 1 from public.guestbook_entries where participant_id=v_me and created_at>now()-interval '10 seconds') then raise exception '메시지는 10초에 한 번 남길 수 있어요.'; end if;
    v_content:=btrim(coalesce(p_payload->>'content',''));
    if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
    insert into public.guestbook_entries(trip_id,participant_id,content,request_id) values(p_trip,v_me,v_content,v_id);

  elsif p_action in ('guestbook_edit','guestbook_delete') then
    select * into v_entry from public.guestbook_entries where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
    if v_entry.id is null or v_entry.participant_id<>v_me then raise exception '이 글을 변경할 권한이 없어요.' using errcode='42501'; end if;
    if p_action='guestbook_edit' then
      v_content:=btrim(coalesce(p_payload->>'content',''));
      if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
      update public.guestbook_entries set content=v_content,updated_at=clock_timestamp() where id=v_entry.id;
    else update public.guestbook_entries set deleted_at=now(),updated_at=clock_timestamp() where id=v_entry.id;
    end if;

  else
    if p_action='hide_candidate' then
      -- Lock order is always participant -> poll -> candidate.
      select * into v_candidate from public.candidates where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if v_candidate.id is null then raise exception '후보를 찾을 수 없어요.'; end if;
      select * into v_poll from public.polls where id=v_candidate.poll_id for update;
      if v_candidate.created_by is distinct from v_me then raise exception '직접 추천한 후보만 숨기거나 복원할 수 있어요.' using errcode='42501'; end if;
      update public.candidates set hidden=(p_payload->>'hidden')::boolean where id=v_candidate.id;

    elsif p_action in ('schedule','schedule_add') then
      v_date:=(p_payload->>'date')::date;
      if not exists(select 1 from public.trips where id=p_trip and v_date between start_date and end_date) then raise exception '여행 날짜를 선택해 주세요.'; end if;
      if p_action='schedule' then
        update public.schedule_items set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),date=v_date,
          start_time=nullif(p_payload->>'start_time','')::time,end_time=nullif(p_payload->>'end_time','')::time,
          verified=coalesce((p_payload->>'verified')::boolean,false),position=(p_payload->>'position')::integer
          where id=(p_payload->>'id')::uuid and trip_id=p_trip;
        if not found then raise exception '일정을 찾을 수 없어요.'; end if;
      else
        perform 1 from public.trips where id=p_trip for update;
        select coalesce(max(position),0)+1 into v_count from public.schedule_items where trip_id=p_trip;
        insert into public.schedule_items(trip_id,date,position,kind,title,description)
          values(p_trip,v_date,v_count,p_payload->>'kind',btrim(p_payload->>'title'),coalesce(p_payload->>'description','')) returning id into v_id;
        if p_payload->>'kind' in ('food','cafe') then insert into public.polls(trip_id,schedule_id) values(p_trip,v_id); end if;
      end if;

    elsif p_action='lodging' then
      update public.lodgings set name=btrim(p_payload->>'name'),notes=coalesce(p_payload->>'notes',''),url=p_payload->>'url',verified=coalesce((p_payload->>'verified')::boolean,false)
        where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if not found then raise exception '숙소를 찾을 수 없어요.'; end if;

    elsif p_action='participant' then
      select * into v_person from public.participants where id=(p_payload->>'id')::uuid and trip_id=p_trip for update;
      if v_person.id is null then raise exception '참여자를 찾을 수 없어요.'; end if;
      if v_person.id<>v_me then raise exception '본인의 이름만 변경할 수 있어요.' using errcode='42501'; end if;
      update public.participants set name=btrim(p_payload->>'name') where id=v_person.id;

    elsif p_action='participant_add' then
      insert into public.participants(trip_id,name) values(p_trip,btrim(p_payload->>'name'));

    elsif p_action in ('expense_create','expense_edit') then
      if p_action='expense_create' then
        v_id:=(p_payload->>'request_id')::uuid;
        if v_id is null then raise exception '요청 식별자가 필요해요.'; end if;
        if exists(select 1 from public.expenses where request_id=v_id and paid_by=v_me and trip_id=p_trip) then return jsonb_build_object('ok',true); end if;
        if exists(select 1 from public.expenses where request_id=v_id) then raise exception '이미 사용한 요청 식별자예요.'; end if;
      else
        select * into v_expense from public.expenses where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
        if v_expense.id is null or v_expense.paid_by<>v_me then raise exception '본인의 결제 내역만 수정할 수 있어요.' using errcode='42501'; end if;
      end if;
      v_name:=btrim(coalesce(p_payload->>'item',''));
      v_amount:=(p_payload->>'amount')::integer;
      if length(v_name) not between 1 and 100 then raise exception '항목은 1~100자예요.'; end if;
      if v_amount is null or v_amount<1 then raise exception '금액은 1원 이상의 정수로 입력해 주세요.'; end if;
      v_mode:=p_payload->>'split_mode';
      if v_mode='all' then
        select array_agg(id order by id) into v_ids from public.participants where trip_id=p_trip and active;
      elsif v_mode='some' then
        if jsonb_typeof(p_payload->'participant_ids') is distinct from 'array' then raise exception '정산 대상자를 선택해 주세요.'; end if;
        select array_agg(id order by id) into v_ids from (select distinct value::uuid as id from jsonb_array_elements_text(p_payload->'participant_ids')) selected;
      else raise exception '정산 대상자를 선택해 주세요.'; end if;
      if v_ids is null or cardinality(v_ids)=0 then raise exception '정산 대상자는 한 명 이상 선택해 주세요.'; end if;
      if exists(select 1 from unnest(v_ids) as selected(id) where not exists(select 1 from public.participants p where p.id=selected.id and p.trip_id=p_trip and p.active)) then raise exception '여행에 참여 중인 대상자만 선택할 수 있어요.'; end if;
      if p_action='expense_create' then
        insert into public.expenses(trip_id,paid_by,occurred_at,item,amount,split_mode,request_id)
          values(p_trip,v_me,(p_payload->>'occurred_at')::timestamptz,v_name,v_amount,v_mode,v_id) returning * into v_expense;
      else
        update public.expenses set occurred_at=(p_payload->>'occurred_at')::timestamptz,item=v_name,amount=v_amount,split_mode=v_mode,updated_at=clock_timestamp() where id=v_expense.id;
        delete from public.expense_splits where expense_id=v_expense.id;
      end if;
      insert into public.expense_splits(trip_id,expense_id,participant_id,amount)
        select p_trip,v_expense.id,id,v_amount/cardinality(v_ids)+case when ord<=v_amount%cardinality(v_ids) then 1 else 0 end
        from unnest(v_ids) with ordinality as audience(id,ord);

    elsif p_action='expense_delete' then
      select * into v_expense from public.expenses where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
      if v_expense.id is null or v_expense.paid_by<>v_me then raise exception '본인의 결제 내역만 삭제할 수 있어요.' using errcode='42501'; end if;
      update public.expenses set deleted_at=now(),updated_at=clock_timestamp() where id=v_expense.id;

    elsif p_action in ('invite','revoke_invite') then
      select * into v_person from public.participants where id=(p_payload->>'id')::uuid and trip_id=p_trip for update;
      if v_person.id is null then raise exception '친구를 선택해 주세요.'; end if;
      if p_action='invite' and not v_person.active then raise exception '참여 중인 친구에게만 링크를 발급할 수 있어요.'; end if;
      v_expiry:=nullif(p_payload->>'expires_at','')::timestamptz;
      if p_action='invite' and v_expiry is not null and v_expiry<=now() then raise exception '만료 일시는 현재보다 이후로 설정해 주세요.'; end if;
      update trip_private.invitations set revoked_at=now() where participant_id=v_person.id and revoked_at is null;
      if p_action='invite' then
        v_token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
        insert into trip_private.invitations(trip_id,participant_id,token_hash,expires_at)
          values(p_trip,v_person.id,encode(sha256(convert_to(v_token,'UTF8')),'hex'),v_expiry);
        return jsonb_build_object('ok',true,'token',v_token);
      end if;
    else raise exception '지원하지 않는 작업이에요.'; end if;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
-- Bootstrap the first participant only from Dashboard SQL; not a browser RPC.
create function trip_private.bootstrap_invite(p_trip uuid,p_person uuid) returns text
language plpgsql security definer set search_path='' as $$
declare v_token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
  if not exists(select 1 from public.participants where id=p_person and trip_id=p_trip and active) then raise exception '참여자를 찾을 수 없어요.'; end if;
  update trip_private.invitations set revoked_at=now() where trip_id=p_trip and participant_id=p_person and revoked_at is null;
  insert into trip_private.invitations(trip_id,participant_id,token_hash)
    values(p_trip,p_person,encode(sha256(convert_to(v_token,'UTF8')),'hex'));
  return v_token;
end;
$$;
revoke all on function trip_private.bootstrap_invite(uuid,uuid) from public,anon,authenticated;

-- Update the two rental records in an existing v1 database without changing votes.
update public.schedule_items set title='쏘카 픽업 · 스타리아 11인승',start_time='11:50',verified=true,
  description='여수엑스포 국제관B동 지하 1층 B9~10 구역 · 11월 6일 11:50 대여 시작'
  where id='b0000000-0000-4000-8000-000000000002' and trip_id='a0000000-0000-4000-8000-000000000001';
update public.schedule_items set title='쏘카 반납 · 순천역 이동',start_time='15:50',verified=true,
  description='순천시 덕암동 188-35 롯데렌터카 순천지점 · 11월 8일 15:50 반납 / 기차 16:08까지 18분, 짐 정리·역 이동 시간 확인 필요'
  where id='b0000000-0000-4000-8000-000000000021' and trip_id='a0000000-0000-4000-8000-000000000001';
update public.participants set name='친구 1' where id='f0000000-0000-4000-8000-000000000001' and name='주최자';

alter publication supabase_realtime add table public.expenses,public.expense_splits;
$migration_002$;
  end if;
end;
$install_base$;
-- Generated from docs/seed.js. Re-running preserves existing edits and votes.

insert into public.trips (id,title,start_date,end_date,timezone)
select id,title,start_date,end_date,timezone from jsonb_to_recordset($seed$[{"id":"a0000000-0000-4000-8000-000000000001","title":"우리, 남쪽으로 떠나요","start_date":"2026-11-06","end_date":"2026-11-08","timezone":"Asia/Seoul"}]$seed$::jsonb) as s(id uuid,title text,start_date date,end_date date,timezone text)
on conflict(id) do nothing;

insert into public.participants (id,trip_id,name,active)
select id,trip_id,name,active from jsonb_to_recordset($seed$[{"id":"f0000000-0000-4000-8000-000000000001","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 1","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000002","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 2","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000003","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 3","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000004","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 4","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000005","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 5","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000006","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 6","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000007","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 7","active":true,"is_placeholder":true},{"id":"f0000000-0000-4000-8000-000000000008","trip_id":"a0000000-0000-4000-8000-000000000001","name":"친구 8","active":true,"is_placeholder":true}]$seed$::jsonb) as s(id uuid,trip_id uuid,name text,active boolean)
on conflict(id) do nothing;

insert into public.lodgings (id,trip_id,city,name,check_in,check_out,url,notes,verified)
select id,trip_id,city,name,check_in,check_out,url,notes,verified from jsonb_to_recordset($seed$[{"id":"e0000000-0000-4000-8000-000000000001","trip_id":"a0000000-0000-4000-8000-000000000001","city":"여수","name":"여기요 독채","check_in":"2026-11-06","check_out":"2026-11-07","url":"https://www.airbnb.co.kr/rooms/959847712327131849","notes":"예약 상태 · 주소 · 입퇴실 시간 확인 필요","verified":false},{"id":"e0000000-0000-4000-8000-000000000002","trip_id":"a0000000-0000-4000-8000-000000000001","city":"순천","name":"순천 숙소 · 이름 확인 필요","check_in":"2026-11-07","check_out":"2026-11-08","url":"https://map.naver.com/p/entry/place/2048015818","notes":"숙박일은 일정 기준 · 예약 및 바비큐·불멍 가능 여부 확인 필요","verified":false}]$seed$::jsonb) as s(id uuid,trip_id uuid,city text,name text,check_in date,check_out date,url text,notes text,verified boolean)
on conflict(id) do nothing;

insert into public.schedule_items (id,trip_id,date,position,kind,title,description,start_time,end_time,verified,lodging_id)
select id,trip_id,date,position,kind,title,description,start_time,end_time,verified,lodging_id from jsonb_to_recordset($seed$[{"id":"b0000000-0000-4000-8000-000000000001","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":1,"kind":"train","title":"용산 → 여수EXPO","start_time":"07:43","end_time":"11:23","description":"예약 승차권 기준 · 여수EXPO역에서 만나요.","verified":true,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000002","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":2,"kind":"move","title":"쏘카 픽업 · 스타리아 11인승","start_time":"11:50","end_time":null,"description":"여수엑스포 국제관B동 지하 1층 B9~10 구역 · 11월 6일 11:50 대여 시작","verified":true,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000003","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":3,"kind":"food","title":"여수 점심","start_time":null,"end_time":null,"description":"게장과 하모샤브샤브, 우리의 첫 끼를 골라요.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000004","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":4,"kind":"sight","title":"여수 한 바퀴","start_time":null,"end_time":null,"description":"오동도 · 고소동 · 이순신광장 · 케이블카 / 방문 범위 조정 예정","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000005","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":5,"kind":"cafe","title":"여수 카페","start_time":null,"end_time":null,"description":"바다를 보며 잠깐 쉬어갈 곳을 추천해 주세요.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000006","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":6,"kind":"food","title":"여수 저녁","start_time":null,"end_time":null,"description":"여수의 밤, 함께 나눌 저녁.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000007","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-06","position":7,"kind":"stay","title":"여수 숙소","start_time":null,"end_time":null,"description":"여기요 독채 · 예약 상태 확인 필요","verified":false,"lodging_id":"e0000000-0000-4000-8000-000000000001"},{"id":"b0000000-0000-4000-8000-000000000008","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":8,"kind":"stay","title":"여수 숙소 체크아웃","start_time":null,"end_time":null,"description":"체크아웃 시간 확인 필요","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000009","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":9,"kind":"food","title":"여수 점심 · 해장","start_time":null,"end_time":null,"description":"든든한 점심으로 둘째 날 시작.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000010","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":10,"kind":"sight","title":"향일암 · 돌산","start_time":null,"end_time":null,"description":"바다를 따라 걷는 오전 / 방문 시간 미정","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000011","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":11,"kind":"cafe","title":"여수·돌산 카페","start_time":null,"end_time":null,"description":"순천으로 가기 전 커피 한 잔.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000012","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":12,"kind":"move","title":"여수 → 순천","start_time":null,"end_time":null,"description":"쏘카 스타리아 11인승으로 이동 · 관광 동선과 이동시간 확인 필요","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000013","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":13,"kind":"sight","title":"순천만의 가을","start_time":null,"end_time":null,"description":"순천만국가정원 · 순천만습지와 갈대 / 동선 확인 필요","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000014","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":14,"kind":"sight","title":"와온의 노을","start_time":null,"end_time":null,"description":"와온카페 올리브 ~ 와온공원 사이 / 실제 일몰 시간 확인 필요","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000015","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":15,"kind":"cafe","title":"순천 카페","start_time":null,"end_time":null,"description":"노을과 함께 마실 커피.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000016","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":16,"kind":"food","title":"순천 저녁 · 바비큐","start_time":null,"end_time":null,"description":"숙소 바비큐를 기본 후보로, 다른 저녁도 추천해 주세요.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000017","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-07","position":17,"kind":"stay","title":"순천 숙소 · 불멍","start_time":null,"end_time":null,"description":"숙소 이름, 예약 및 불멍 가능 여부 확인 필요","verified":false,"lodging_id":"e0000000-0000-4000-8000-000000000002"},{"id":"b0000000-0000-4000-8000-000000000018","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-08","position":18,"kind":"stay","title":"순천 숙소 체크아웃","start_time":null,"end_time":null,"description":"체크아웃 시간 확인 필요","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000019","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-08","position":19,"kind":"food","title":"순천 점심","start_time":null,"end_time":null,"description":"마지막 날도 맛있게.","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000020","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-08","position":20,"kind":"sight","title":"순천의 이야기","start_time":null,"end_time":null,"description":"순천드라마촬영장 · 낙안읍성 / 기차 시간에 맞춰 방문 범위 조정","verified":false,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000021","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-08","position":21,"kind":"move","title":"쏘카 반납 · 순천역 이동","start_time":"15:50","end_time":null,"description":"순천시 덕암동 188-35 롯데렌터카 순천지점 · 11월 8일 15:50 반납 / 기차 16:08까지 18분, 짐 정리·역 이동 시간 확인 필요","verified":true,"lodging_id":null},{"id":"b0000000-0000-4000-8000-000000000022","trip_id":"a0000000-0000-4000-8000-000000000001","date":"2026-11-08","position":22,"kind":"train","title":"순천 → 서울","start_time":"16:08","end_time":"18:56","description":"예약 승차권 기준 · 순천역 16:08 출발","verified":true,"lodging_id":null}]$seed$::jsonb) as s(id uuid,trip_id uuid,date date,position integer,kind text,title text,description text,start_time time,end_time time,verified boolean,lodging_id uuid)
on conflict(id) do nothing;

insert into public.polls (id,trip_id,schedule_id)
select id,trip_id,schedule_id from jsonb_to_recordset($seed$[{"id":"c0000000-0000-4000-8000-000000000001","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000003"},{"id":"c0000000-0000-4000-8000-000000000002","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000005"},{"id":"c0000000-0000-4000-8000-000000000003","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000006"},{"id":"c0000000-0000-4000-8000-000000000004","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000009"},{"id":"c0000000-0000-4000-8000-000000000005","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000011"},{"id":"c0000000-0000-4000-8000-000000000006","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000015"},{"id":"c0000000-0000-4000-8000-000000000007","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000016"},{"id":"c0000000-0000-4000-8000-000000000008","trip_id":"a0000000-0000-4000-8000-000000000001","schedule_id":"b0000000-0000-4000-8000-000000000019"}]$seed$::jsonb) as s(id uuid,trip_id uuid,schedule_id uuid)
on conflict(id) do nothing;

insert into public.candidates (id,trip_id,poll_id,name,url,price,description,hidden,created_by,created_at)
select id,trip_id,poll_id,name,url,price,description,hidden,created_by,created_at from jsonb_to_recordset($seed$[{"id":"d0000000-0000-4000-8000-000000000001","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000001","name":"정다운 식당","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:00Z"},{"id":"d0000000-0000-4000-8000-000000000002","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000001","name":"꽃돌게장 1번가","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:01Z"},{"id":"d0000000-0000-4000-8000-000000000003","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000001","name":"경도회관","url":"","price":null,"description":"하모샤브샤브 · 배로 이동 / 영업 여부 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:02Z"},{"id":"d0000000-0000-4000-8000-000000000004","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000003","name":"좋은마차 삼치회","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:03Z"},{"id":"d0000000-0000-4000-8000-000000000005","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000004","name":"갈치조림기똥차게맛있는집","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:04Z"},{"id":"d0000000-0000-4000-8000-000000000006","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000006","name":"와온카페 올리브","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:05Z"},{"id":"d0000000-0000-4000-8000-000000000007","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000007","name":"숙소 바비큐","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:06Z"},{"id":"d0000000-0000-4000-8000-000000000008","trip_id":"a0000000-0000-4000-8000-000000000001","poll_id":"c0000000-0000-4000-8000-000000000008","name":"금빈회관","url":"","price":null,"description":"기존 일정 초안 · 영업 여부와 가격 확인 필요","hidden":false,"created_by":null,"created_at":"2026-10-10T00:00:07Z"}]$seed$::jsonb) as s(id uuid,trip_id uuid,poll_id uuid,name text,url text,price integer,description text,hidden boolean,created_by uuid,created_at timestamptz)
on conflict(id) do nothing;

do $install_nicknames$
begin
  if to_regprocedure('trip_private.require_trip(uuid)') is null then
    execute $migration_003$-- Upgrade v2 to a shared nickname board. No accounts, anonymous sign-in or invite links.
-- Apply after 001 + 002 + seed (or run the generated setup.sql on an empty project).

alter table public.participants add column is_placeholder boolean not null default false;
update public.participants set is_placeholder=true
where trip_id='a0000000-0000-4000-8000-000000000001'
  and id::text like 'f0000000-0000-4000-8000-%' and name ~ '^친구 [1-8]$';

create function trip_private.require_trip(p_trip uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_trip is distinct from 'a0000000-0000-4000-8000-000000000001'::uuid
     or not exists(select 1 from public.trips where id=p_trip) then
    raise exception '여행을 찾을 수 없어요.' using errcode='42501';
  end if;
end;
$$;
create function trip_private.clean_nickname(p_name text) returns text
language plpgsql immutable set search_path='' as $$
declare v_name text:=btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g'));
begin
  if length(v_name) not between 1 and 40 then raise exception '닉네임은 1~40자로 입력해 주세요.'; end if;
  return v_name;
end;
$$;
create function trip_private.nickname_person(p_trip uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_name text:=trip_private.clean_nickname(p_name);v_id uuid;
begin
  perform trip_private.require_trip(p_trip);
  -- Serialize the small board's mutations, including simultaneous nickname registration.
  perform 1 from public.trips where id=p_trip for update;
  select id into v_id from public.participants where trip_id=p_trip
    and lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(v_name) order by id limit 1;
  if v_id is not null then
    update public.participants set active=true,is_placeholder=false where id=v_id;
    return v_id;
  end if;
  select id into v_id from public.participants where trip_id=p_trip and is_placeholder order by id limit 1;
  if v_id is not null then
    update public.participants set name=v_name,active=true,is_placeholder=false where id=v_id;
  else
    insert into public.participants(trip_id,name) values(p_trip,v_name) returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function trip_private.require_trip(uuid),trip_private.clean_nickname(text),trip_private.nickname_person(uuid,text) from public,anon,authenticated;
create or replace function public.trip_snapshot(p_trip uuid) returns jsonb
language plpgsql security definer set search_path='' as $$

begin
  perform trip_private.require_trip(p_trip);
  return jsonb_build_object(
    'server_time',now(),
    'trip',(select to_jsonb(t) from public.trips t where id=p_trip),
    'me',null,
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.participants p where trip_id=p_trip),'[]'::jsonb),
    'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by date,position,id) from public.schedule_items s where trip_id=p_trip),'[]'::jsonb),
    'lodgings',coalesce((select jsonb_agg(to_jsonb(l) order by check_in) from public.lodgings l where trip_id=p_trip),'[]'::jsonb),
    'polls',coalesce((select jsonb_agg(to_jsonb(p) order by s.date,s.position) from public.polls p join public.schedule_items s on s.id=p.schedule_id where p.trip_id=p_trip),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from public.candidates c where trip_id=p_trip),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.votes v where trip_id=p_trip and candidate_id is not null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by occurred_at desc,created_at desc) from public.expenses x where trip_id=p_trip and deleted_at is null),'[]'::jsonb),
    'expense_splits',coalesce((select jsonb_agg(to_jsonb(s) order by participant_id) from public.expense_splits s join public.expenses x on x.id=s.expense_id where s.trip_id=p_trip and x.deleted_at is null),'[]'::jsonb)
  );
end;
$$;


create or replace function public.trip_guestbook(p_trip uuid,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$

begin
  perform trip_private.require_trip(p_trip);
  if p_limit<1 or p_limit>10000 then raise exception '조회 개수가 올바르지 않아요.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(g) order by created_at desc,id desc) from
    (select * from public.guestbook_entries where trip_id=p_trip and deleted_at is null order by created_at desc,id desc limit p_limit) g),'[]'::jsonb);
end;
$$;

create or replace function public.trip_mutate(p_trip uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid:=trip_private.nickname_person(p_trip,p_payload->>'nickname');
  v_poll public.polls; v_candidate public.candidates; v_entry public.guestbook_entries;
  v_person public.participants; v_item public.schedule_items;
  v_id uuid; v_name text; v_content text; v_token text; v_expiry timestamptz;
  v_date date; v_count integer; v_expense public.expenses; v_ids uuid[]; v_amount integer; v_mode text;
begin
  perform 1 from public.participants where id=v_me for update;
  -- Check again after waiting for a concurrent participant deactivation.
  perform trip_private.require_trip(p_trip);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception '요청 내용이 올바르지 않아요.'; end if;

  if p_action in ('vote','candidate') then
    select * into v_poll from public.polls where id=(p_payload->>'poll_id')::uuid and trip_id=p_trip for update;
    if v_poll.id is null then raise exception '투표를 찾을 수 없어요.'; end if;

  end if;

  if p_action='vote' then
    v_id:=nullif(p_payload->>'candidate_id','')::uuid;
    if v_id is not null and not exists(select 1 from public.candidates where id=v_id and poll_id=v_poll.id and trip_id=p_trip and not hidden) then raise exception '선택 가능한 후보가 아니에요.'; end if;
    insert into public.votes(trip_id,poll_id,participant_id,candidate_id) values(p_trip,v_poll.id,v_me,v_id)
      on conflict(poll_id,participant_id) do update set candidate_id=excluded.candidate_id,updated_at=now();

  elsif p_action='candidate' then
    v_name:=btrim(coalesce(p_payload->>'name',''));
    if length(v_name) not between 1 and 80 then raise exception '장소 이름은 1~80자예요.'; end if;
    if exists(select 1 from public.candidates where poll_id=v_poll.id and normalized_name=lower(regexp_replace(v_name,'\s+',' ','g'))) then raise exception '이미 등록된 장소예요.'; end if;
    insert into public.candidates(trip_id,poll_id,name,url,price,description,created_by)
      values(p_trip,v_poll.id,v_name,coalesce(p_payload->>'url',''),nullif(p_payload->>'price','')::integer,coalesce(p_payload->>'description',''),v_me);

  elsif p_action='guestbook_create' then
    v_id:=(p_payload->>'request_id')::uuid;
    if v_id is null then raise exception '요청 식별자가 필요해요.'; end if;
    if exists(select 1 from public.guestbook_entries where request_id=v_id and participant_id=v_me and trip_id=p_trip) then return jsonb_build_object('ok',true); end if;
    if exists(select 1 from public.guestbook_entries where participant_id=v_me and created_at>now()-interval '10 seconds') then raise exception '메시지는 10초에 한 번 남길 수 있어요.'; end if;
    v_content:=btrim(coalesce(p_payload->>'content',''));
    if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
    insert into public.guestbook_entries(trip_id,participant_id,content,request_id) values(p_trip,v_me,v_content,v_id);

  elsif p_action in ('guestbook_edit','guestbook_delete') then
    select * into v_entry from public.guestbook_entries where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
    if v_entry.id is null then raise exception '글을 찾을 수 없어요.' using errcode='42501'; end if;
    if p_action='guestbook_edit' then
      v_content:=btrim(coalesce(p_payload->>'content',''));
      if length(v_content) not between 1 and 1000 then raise exception '메시지는 1~1,000자예요.'; end if;
      update public.guestbook_entries set content=v_content,updated_at=clock_timestamp() where id=v_entry.id;
    else update public.guestbook_entries set deleted_at=now(),updated_at=clock_timestamp() where id=v_entry.id;
    end if;

  else
    if p_action='hide_candidate' then
      -- Lock order is always participant -> poll -> candidate.
      select * into v_candidate from public.candidates where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if v_candidate.id is null then raise exception '후보를 찾을 수 없어요.'; end if;
      select * into v_poll from public.polls where id=v_candidate.poll_id for update;
      update public.candidates set hidden=(p_payload->>'hidden')::boolean where id=v_candidate.id;

    elsif p_action in ('schedule','schedule_add') then
      v_date:=(p_payload->>'date')::date;
      if not exists(select 1 from public.trips where id=p_trip and v_date between start_date and end_date) then raise exception '여행 날짜를 선택해 주세요.'; end if;
      if p_action='schedule' then
        update public.schedule_items set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),date=v_date,
          start_time=nullif(p_payload->>'start_time','')::time,end_time=nullif(p_payload->>'end_time','')::time,
          verified=coalesce((p_payload->>'verified')::boolean,false),position=(p_payload->>'position')::integer
          where id=(p_payload->>'id')::uuid and trip_id=p_trip;
        if not found then raise exception '일정을 찾을 수 없어요.'; end if;
      else
        perform 1 from public.trips where id=p_trip for update;
        select coalesce(max(position),0)+1 into v_count from public.schedule_items where trip_id=p_trip;
        insert into public.schedule_items(trip_id,date,position,kind,title,description)
          values(p_trip,v_date,v_count,p_payload->>'kind',btrim(p_payload->>'title'),coalesce(p_payload->>'description','')) returning id into v_id;
        if p_payload->>'kind' in ('food','cafe') then insert into public.polls(trip_id,schedule_id) values(p_trip,v_id); end if;
      end if;

    elsif p_action='lodging' then
      update public.lodgings set name=btrim(p_payload->>'name'),notes=coalesce(p_payload->>'notes',''),url=p_payload->>'url',verified=coalesce((p_payload->>'verified')::boolean,false)
        where id=(p_payload->>'id')::uuid and trip_id=p_trip;
      if not found then raise exception '숙소를 찾을 수 없어요.'; end if;

    elsif p_action='participant' then
      select * into v_person from public.participants where id=(p_payload->>'id')::uuid and trip_id=p_trip for update;
      if v_person.id is null then raise exception '참여자를 찾을 수 없어요.'; end if;
      v_name:=trip_private.clean_nickname(p_payload->>'name');
      if exists(select 1 from public.participants where trip_id=p_trip and id<>v_person.id and lower(regexp_replace(btrim(name),'\s+',' ','g'))=lower(v_name)) then raise exception '이미 사용하는 닉네임이에요.'; end if;
      update public.participants set name=v_name,is_placeholder=false where id=v_person.id;

    elsif p_action='participant_add' then
      perform trip_private.nickname_person(p_trip,p_payload->>'name');

    elsif p_action in ('expense_create','expense_edit') then
      if p_action='expense_create' then
        v_id:=(p_payload->>'request_id')::uuid;
        if v_id is null then raise exception '요청 식별자가 필요해요.'; end if;
        if exists(select 1 from public.expenses where request_id=v_id and paid_by=v_me and trip_id=p_trip) then return jsonb_build_object('ok',true); end if;
        if exists(select 1 from public.expenses where request_id=v_id) then raise exception '이미 사용한 요청 식별자예요.'; end if;
      else
        select * into v_expense from public.expenses where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
        if v_expense.id is null then raise exception '결제 내역을 찾을 수 없어요.' using errcode='42501'; end if;
      end if;
      v_name:=btrim(coalesce(p_payload->>'item',''));
      v_amount:=(p_payload->>'amount')::integer;
      if length(v_name) not between 1 and 100 then raise exception '항목은 1~100자예요.'; end if;
      if v_amount is null or v_amount<1 then raise exception '금액은 1원 이상의 정수로 입력해 주세요.'; end if;
      v_mode:=p_payload->>'split_mode';
      if v_mode='all' then
        select array_agg(id order by id) into v_ids from public.participants where trip_id=p_trip and active;
      elsif v_mode='some' then
        if jsonb_typeof(p_payload->'participant_ids') is distinct from 'array' then raise exception '정산 대상자를 선택해 주세요.'; end if;
        select array_agg(id order by id) into v_ids from (select distinct value::uuid as id from jsonb_array_elements_text(p_payload->'participant_ids')) selected;
      else raise exception '정산 대상자를 선택해 주세요.'; end if;
      if v_ids is null or cardinality(v_ids)=0 then raise exception '정산 대상자는 한 명 이상 선택해 주세요.'; end if;
      if exists(select 1 from unnest(v_ids) as selected(id) where not exists(select 1 from public.participants p where p.id=selected.id and p.trip_id=p_trip and p.active)) then raise exception '여행에 참여 중인 대상자만 선택할 수 있어요.'; end if;
      if p_action='expense_create' then
        insert into public.expenses(trip_id,paid_by,occurred_at,item,amount,split_mode,request_id)
          values(p_trip,v_me,(p_payload->>'occurred_at')::timestamptz,v_name,v_amount,v_mode,v_id) returning * into v_expense;
      else
        update public.expenses set occurred_at=(p_payload->>'occurred_at')::timestamptz,item=v_name,amount=v_amount,split_mode=v_mode,updated_at=clock_timestamp() where id=v_expense.id;
        delete from public.expense_splits where expense_id=v_expense.id;
      end if;
      insert into public.expense_splits(trip_id,expense_id,participant_id,amount)
        select p_trip,v_expense.id,id,v_amount/cardinality(v_ids)+case when ord<=v_amount%cardinality(v_ids) then 1 else 0 end
        from unnest(v_ids) with ordinality as audience(id,ord);

    elsif p_action='expense_delete' then
      select * into v_expense from public.expenses where id=(p_payload->>'id')::uuid and trip_id=p_trip and deleted_at is null for update;
      if v_expense.id is null then raise exception '결제 내역을 찾을 수 없어요.' using errcode='42501'; end if;
      update public.expenses set deleted_at=now(),updated_at=clock_timestamp() where id=v_expense.id;

    else raise exception '지원하지 않는 작업이에요.'; end if;
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

-- All viewers of this invitation have the same read rights; raw writes remain RPC-only.
do $$
declare t text;
begin
  foreach t in array array['trips','participants','lodgings','schedule_items','polls','candidates','votes','guestbook_entries','expenses','expense_splits'] loop
    execute format('drop policy trip_read on public.%I',t);
    execute format('grant select on public.%I to anon,authenticated',t);
    execute format('create policy trip_read on public.%I for select to anon,authenticated using (%I = %L::uuid)',t,case when t='trips' then 'id' else 'trip_id' end,'a0000000-0000-4000-8000-000000000001');
  end loop;
end;
$$;
revoke all on function public.trip_snapshot(uuid),public.trip_guestbook(uuid,integer),public.trip_mutate(uuid,text,jsonb) from public;
grant execute on function public.trip_snapshot(uuid),public.trip_guestbook(uuid,integer),public.trip_mutate(uuid,text,jsonb) to anon,authenticated;
drop function public.redeem_invite(text);
drop function trip_private.bootstrap_invite(uuid,uuid);
drop function trip_private.require_member(uuid);
drop function trip_private.member(uuid);
drop table trip_private.participant_sessions,trip_private.redeem_limits,trip_private.invitations;
$migration_003$;
  end if;
end;
$install_nicknames$;
commit;
select 'https://mumusyeo.github.io/yeosu/' as invitation_url,
  'Ready: shared nickname board. No Auth configuration or personal links needed.' as status;
