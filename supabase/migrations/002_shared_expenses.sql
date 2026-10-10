-- Upgrade v1 to equal participants, continuously open polls and shared expenses.
-- Apply after 001_trip.sql; seed.sql follows both migrations for a new project.
begin;
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
commit;
