-- Apply confirmed lodging addresses and check-in/out times once, retaining later edits.
begin;
do $lodging_details$
begin
  if exists(select 1 from trip_private.app_updates where version=7) then return; end if;
  update public.lodgings set notes='전남광주 여수시, 돌산읍 송시길 19 · 체크인 15:00 · 체크아웃 11:00 · 예약 상태 확인 필요'
  where id='e0000000-0000-4000-8000-000000000001' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.lodgings set notes='전남광주 광양시 봉강면 지곡길 45 · 체크인 15:00 · 체크아웃 12:00 · 예약 및 바비큐·불멍 가능 여부 확인 필요'
  where id='e0000000-0000-4000-8000-000000000002' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set description='여기요 독채 · 전남광주 여수시, 돌산읍 송시길 19 · 체크인 15:00'
  where id='b0000000-0000-4000-8000-000000000007' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set start_time='11:00',description='여기요 독채 · 체크아웃 11:00'
  where id='b0000000-0000-4000-8000-000000000008' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set description='온녘 · 전남광주 광양시 봉강면 지곡길 45 · 체크인 15:00 · 예약 및 불멍 가능 여부 확인 필요'
  where id='b0000000-0000-4000-8000-000000000017' and trip_id='a0000000-0000-4000-8000-000000000001';
  update public.schedule_items set start_time='12:00',description='온녘 · 체크아웃 12:00'
  where id='b0000000-0000-4000-8000-000000000018' and trip_id='a0000000-0000-4000-8000-000000000001';
  insert into trip_private.app_updates(version) values(7);
end;
$lodging_details$;
commit;
