-- Optional per-expense account details and chronological ordering. Safe to repeat.
begin;
alter table public.expenses add column if not exists account_number text not null default '' check(length(account_number)<=100);
create or replace function public.trip_snapshot(p_trip uuid) returns jsonb
language plpgsql security definer set search_path='' as $$

begin
  perform trip_private.require_trip(p_trip);
  return jsonb_build_object(
    'server_time',now(),
    'expense_account_numbers',true,
    'trip',(select to_jsonb(t) from public.trips t where id=p_trip),
    'me',null,
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.participants p where trip_id=p_trip),'[]'::jsonb),
    'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by date,position,id) from public.schedule_items s where trip_id=p_trip),'[]'::jsonb),
    'lodgings',coalesce((select jsonb_agg(to_jsonb(l) order by check_in) from public.lodgings l where trip_id=p_trip),'[]'::jsonb),
    'polls',coalesce((select jsonb_agg(to_jsonb(p) order by s.date,s.position) from public.polls p join public.schedule_items s on s.id=p.schedule_id where p.trip_id=p_trip),'[]'::jsonb),
    'candidates',coalesce((select jsonb_agg(to_jsonb(c) order by created_at,id) from public.candidates c where trip_id=p_trip),'[]'::jsonb),
    'votes',coalesce((select jsonb_agg(to_jsonb(v)) from public.votes v where trip_id=p_trip and candidate_id is not null),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by occurred_at,created_at,id) from public.expenses x where trip_id=p_trip and deleted_at is null),'[]'::jsonb),
    'expense_splits',coalesce((select jsonb_agg(to_jsonb(s) order by participant_id) from public.expense_splits s join public.expenses x on x.id=s.expense_id where s.trip_id=p_trip and x.deleted_at is null),'[]'::jsonb)
  );
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
      if length(btrim(coalesce(p_payload->>'account_number',''))) > 100 then raise exception '계좌번호는 100자 이내로 입력해 주세요.'; end if;
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
        insert into public.expenses(trip_id,paid_by,occurred_at,item,amount,split_mode,request_id,account_number)
          values(p_trip,v_me,(p_payload->>'occurred_at')::timestamptz,v_name,v_amount,v_mode,v_id,btrim(coalesce(p_payload->>'account_number',''))) returning * into v_expense;
      else
        update public.expenses set occurred_at=(p_payload->>'occurred_at')::timestamptz,item=v_name,amount=v_amount,split_mode=v_mode,account_number=case when p_payload ? 'account_number' then btrim(coalesce(p_payload->>'account_number','')) else account_number end,updated_at=clock_timestamp() where id=v_expense.id;
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
commit;
