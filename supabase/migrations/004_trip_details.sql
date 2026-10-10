-- Apply updated travel details once, retaining participant IDs and all submissions.
begin;
create table if not exists trip_private.app_updates(version integer primary key);
do $details$
declare
  names text[] := array['밀로','임호','소연','레나','로건','유미','희우','희지'];
begin
  if exists(select 1 from trip_private.app_updates where version=4) then return; end if;
  for i in 1..8 loop
    update public.participants set name=names[i],is_placeholder=false
    where trip_id='a0000000-0000-4000-8000-000000000001'
      and id=('f0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  end loop;
  update public.trips set title='야앙! 우리가 간다!' where id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set title=case
    when id='b0000000-0000-4000-8000-000000000009' then '여수 점심'
    when id='b0000000-0000-4000-8000-000000000011' then '여수 카페'
    else '순천 저녁' end
  where trip_id='a0000000-0000-4000-8000-000000000001'
    and id in ('b0000000-0000-4000-8000-000000000009','b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000016');
  update public.lodgings set name='온녘',notes='전남광주 광양시 봉강면 지곡길 45 · 숙박일은 일정 기준 · 예약 및 바비큐·불멍 가능 여부 확인 필요'
  where id='e0000000-0000-4000-8000-000000000002' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set description='온녘 · 전남광주 광양시 봉강면 지곡길 45 · 예약 및 불멍 가능 여부 확인 필요'
  where id='b0000000-0000-4000-8000-000000000017' and trip_id='a0000000-0000-4000-8000-000000000001';
  insert into trip_private.app_updates(version) values(4);
end;
$details$;
commit;
