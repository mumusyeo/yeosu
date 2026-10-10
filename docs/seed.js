export const TRIP_ID = 'a0000000-0000-4000-8000-000000000001';
export const uuid = (group, number) => `${group}0000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const rows = [
  [0,'train','용산 → 여수EXPO','07:43','11:23','예약 승차권 기준 · 여수EXPO역에서 만나요.'],
  [0,'move','쏘카 픽업 · 스타리아 11인승','11:50',null,'여수엑스포 국제관B동 지하 1층 B9~10 구역 · 11월 6일 11:50 대여 시작'],
  [0,'food','여수 점심',null,null,'게장과 하모샤브샤브, 우리의 첫 끼를 골라요.',['정다운 식당','꽃돌게장 1번가','경도회관']],
  [0,'sight','여수 한 바퀴',null,null,'오동도 · 고소동 · 이순신광장 · 케이블카 / 방문 범위 조정 예정'],
  [0,'cafe','여수 카페',null,null,'바다를 보며 잠깐 쉬어갈 곳을 추천해 주세요.',[]],
  [0,'food','여수 저녁',null,null,'여수의 밤, 함께 나눌 저녁.',['좋은마차 삼치회']],
  [0,'stay','여수 숙소',null,null,'여기요 독채 · 전남광주 여수시, 돌산읍 송시길 19 · 체크인 15:00',null,1],
  [1,'stay','여수 숙소 체크아웃','11:00',null,'여기요 독채 · 체크아웃 11:00'],
  [1,'food','여수 점심',null,null,'든든한 점심으로 둘째 날 시작.',['갈치조림기똥차게맛있는집']],
  [1,'sight','향일암 · 돌산',null,null,'바다를 따라 걷는 오전 / 방문 시간 미정'],
  [1,'cafe','여수 카페',null,null,'순천으로 가기 전 커피 한 잔.',[]],
  [1,'move','여수 → 순천',null,null,'쏘카 스타리아 11인승으로 이동 · 관광 동선과 이동시간 확인 필요'],
  [1,'sight','순천만의 가을',null,null,'순천만국가정원 · 순천만습지와 갈대 / 동선 확인 필요'],
  [1,'sight','와온의 노을',null,null,'와온카페 올리브 ~ 와온공원 사이 / 실제 일몰 시간 확인 필요'],
  [1,'cafe','순천 카페',null,null,'노을과 함께 마실 커피.',['와온카페 올리브']],
  [1,'food','순천 저녁',null,null,'숙소 바비큐를 기본 후보로, 다른 저녁도 추천해 주세요.',['숙소 바비큐']],
  [1,'stay','순천 숙소 · 불멍',null,null,'온녘 · 전남광주 광양시 봉강면 지곡길 45 · 체크인 15:00 · 예약 및 불멍 가능 여부 확인 필요',null,2],
  [2,'stay','순천 숙소 체크아웃','12:00',null,'온녘 · 체크아웃 12:00'],
  [2,'food','순천 점심',null,null,'마지막 날도 맛있게.',['금빈회관']],
  [2,'sight','순천의 이야기',null,null,'순천드라마촬영장 · 낙안읍성 / 기차 시간에 맞춰 방문 범위 조정'],
  [2,'move','쏘카 반납 · 순천역 이동','15:50',null,'순천시 덕암동 188-35 롯데렌터카 순천지점 · 11월 8일 15:50 반납 / 기차 16:08까지 18분, 짐 정리·역 이동 시간 확인 필요'],
  [2,'train','순천 → 서울','16:08','18:56','예약 승차권 기준 · 순천역 16:08 출발'],
];
export function createSeed() {
  const candidates = [], polls = [];
  const schedule = rows.map(([day,kind,title,start,end,description,names,lodging], index) => {
    const id = uuid('b', index + 1);
    if (names) {
      const poll_id = uuid('c', polls.length + 1);
      polls.push({ id: poll_id, trip_id: TRIP_ID, schedule_id: id });
      names.forEach(name => candidates.push({ id: uuid('d', candidates.length + 1), trip_id: TRIP_ID, poll_id, name, url: '', price: null, description: name === '경도회관' ? '하모샤브샤브 · 배로 이동 / 영업 여부 확인 필요' : '기존 일정 초안 · 영업 여부와 가격 확인 필요', hidden: false, created_by: null, created_at: `2026-10-10T00:00:${String(candidates.length).padStart(2,'0')}Z` }));
    }
    return { id, trip_id: TRIP_ID, date: `2026-11-0${6 + day}`, position: index + 1, kind, title, start_time: start, end_time: end, description, verified: kind === 'train' || (kind==='move' && Boolean(start)), lodging_id: lodging ? uuid('e',lodging) : null };
  });
  return {
    trip: { id: TRIP_ID, title: '야앙! 우리가 간다!', start_date: '2026-11-06', end_date: '2026-11-08', timezone: 'Asia/Seoul' },
    schema_version:5, expense_account_numbers:true, expense_bank_names:true, schedule, polls, candidates, votes: [], guestbook: [], expenses:[], expense_splits:[],
    participants: Array.from({length:8}, (_, i) => ({ id: uuid('f',i+1), trip_id: TRIP_ID, name: ['밀로','임호','소연','레나','로건','유미','희우','희지'][i], active: true, is_placeholder:false, in_settlement:true })),
    lodgings: [
      { id: uuid('e',1), trip_id: TRIP_ID, city:'여수', name:'여기요 독채', check_in:'2026-11-06', check_out:'2026-11-07', url:'https://www.airbnb.co.kr/rooms/959847712327131849', notes:'전남광주 여수시, 돌산읍 송시길 19 · 체크인 15:00 · 체크아웃 11:00 · 예약 상태 확인 필요', verified:false },
      { id: uuid('e',2), trip_id: TRIP_ID, city:'순천', name:'온녘', check_in:'2026-11-07', check_out:'2026-11-08', url:'https://map.naver.com/p/entry/place/2048015818', notes:'전남광주 광양시 봉강면 지곡길 45 · 체크인 15:00 · 체크아웃 12:00 · 예약 및 바비큐·불멍 가능 여부 확인 필요', verified:false },
    ], invitations: [],
  };
}
