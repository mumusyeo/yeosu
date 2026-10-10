import { escapeHtml as e, safeUrl, pollResult, resultLabel, validateCandidate, validateMessage, newId, normalizeName, validateNickname } from './domain.js';
import { DemoRepository, SupabaseRepository } from './repository.js';
import { accountDetails, renderBudget, validateExpense } from './expenses.js';
import { createSeed } from './seed.js';
import { initSlideshow } from './slideshow.js';

const $ = selector => document.querySelector(selector);
const dates = ['2026-11-06','2026-11-07','2026-11-08'];
const days = ['여수, 바다를 만나는 날','여수에서 순천, 가을을 따라서','순천, 느긋한 마지막 하루'];
const kindNames = {train:'TRAIN · 기차',move:'ON THE ROAD · 이동',food:'GOOD FOOD · 식사',cafe:'COFFEE BREAK · 카페',sight:'SLOW WALK · 관광',stay:'STAY · 숙소'};
const state = {repo:null,data:null,publicPreview:false,entries:[],section:'schedule',date:dates[0],pollId:null,limit:20,loading:true,error:'',busy:false,guestDraft:'',guestNicknameDraft:null,requestId:newId(),unsubscribe:null,refreshing:false,refreshAgain:false,clockOffset:0,realtime:''};
// Trip details are shared edits, so these forms do not ask who is editing.
const anonymousForms = ['schedule-edit','schedule-add','lodging'];
let toastTimer,refreshTimer,expiryTimer,lastNickname='';
try{lastNickname=localStorage.getItem('namjjok-nickname')||'';}catch{}
if(new URLSearchParams(location.hash.slice(1)).has('invite'))history.replaceState(null,'',location.pathname+location.search+'#schedule');
function nicknameField(value=lastNickname){return field('닉네임','nickname',value,'text','required maxlength="40" autocomplete="nickname"')+'<p class="muted">같은 닉네임을 사용하면 투표와 정산 내역을 함께 모아 볼 수 있어요.</p>';}
function rememberNickname(value){lastNickname=validateNickname(value);try{localStorage.setItem('namjjok-nickname',lastNickname);}catch{}}
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function lockUi(value) {
  state.busy=value;
  $('#main').setAttribute('aria-busy',String(value));
  if(value)document.querySelectorAll('button:not([disabled])').forEach(el=>{el.disabled=true;el.dataset.busyDisabled='true';});
  else document.querySelectorAll('[data-busy-disabled]').forEach(el=>{el.disabled=false;delete el.dataset.busyDisabled;});
}
const button = (label,action,id='',cls='',disabled=false) => `<button type="button" class="${cls}" data-action="${action}" data-id="${e(id)}" ${disabled?'disabled':''}>${label}</button>`;
const link = (url,label,cls='') => safeUrl(url) ? `<a class="${cls}" href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : '';
const field = (label,name,value='',type='text',extra='') => `<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const textarea = (label,name,value='',max=500) => `<label class="field"><span>${label}</span><textarea aria-label="${e(label)}" name="${name}" maxlength="${max}" ${name==='content'?'required':''}>${e(value)}</textarea></label>`;
const formEnd = label => `<p class="form-error" role="alert"></p><div class="form-footer"><span>변경 사항은 저장 후 반영돼요.</span><button class="primary" type="submit">${label}</button></div>`;
const dateField = (value=state.date) => `<label class="field">날짜<select name="date">${dates.map((d,i)=>`<option value="${d}" ${value===d?'selected':''}>11월 ${6+i}일 (${['금','토','일'][i]})</option>`).join('')}</select></label>`;
const check = (label,name,value) => `<label class="checkbox"><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`;
const me = () => state.data?.participants.find(p=>normalizeName(p.name)===normalizeName(lastNickname));
const canEdit = () => Boolean(state.data)&&!state.publicPreview;
const pollById = id => state.data?.polls.find(p=>p.id===id);
const itemForPoll = poll => state.data.schedule.find(s=>s.id===poll.schedule_id);
const resultFor = poll => pollResult(poll,state.data.candidates,state.data.votes);
const shortDate = date => `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;
const fmtDate = value => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const localDateTime = value => value ? new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,16) : '';
const fromKst = value => value ? new Date(`${value}:00+09:00`).toISOString() : null;

function showPublicPreview() {
  const seed=createSeed();
  state.data={trip:seed.trip,schedule:seed.schedule,lodgings:seed.lodgings,polls:seed.polls,candidates:seed.candidates,votes:[],participants:[],invitations:[],expenses:[],expense_splits:[],me:null};
  state.publicPreview=true;state.entries=[];state.guestDraft='';state.clockOffset=0;state.loading=false;
  state.unsubscribe?.();state.unsubscribe=null;$('#dialog').close();
}
function renderConnection() {
  const el=$('#connection');
  el.className='connection'+(state.repo?.demo?' demo':'');
  el.innerHTML=state.repo?.demo?'<strong>로컬 데모</strong> <span>이 브라우저에만 저장돼요. 등록할 때 닉네임을 입력해 주세요.</span>':state.publicPreview?`<strong>기본 일정 보기</strong> <span>${e(state.error||'공유 기능을 연결하고 있어요.')}</span>`:state.error?`<strong>연결 확인 중</strong> <span>${e(state.error)}</span>`:!navigator.onLine?'<strong>오프라인</strong> <span>다시 연결되면 저장할 수 있어요.</span>':'';
  el.hidden=!el.textContent.trim();
}
function renderNav() {
  const tabs=[['schedule','여행 일정'],['votes','맛집 투표'],['lodgings','숙소'],['budget','예산 · 정산'],['guestbook','방명록']];
  $('#navigation').innerHTML=tabs.map(([id,title])=>`<a href="#${id}" class="${state.section===id?'active':''}" ${state.section===id?'aria-current="page"':''}>${title}</a>`).join('');
}
function heading(kicker,title,description,right='') {return `<div class="section-heading"><div><span class="section-kicker">${kicker}</span><h2>${title}</h2><p>${description}</p></div>${right}</div>`;}
function render() {
  const draft=$('#guest-content');if(draft) state.guestDraft=draft.value;
  const nickDraft=document.querySelector('.guest-form [name="nickname"]');if(nickDraft)state.guestNicknameDraft=nickDraft.value;
  renderConnection();renderNav();
  if(state.loading && !state.data) {$('#main').innerHTML='<div class="loading">여행 정보를 불러오고 있어요…</div>';return;}
  if(!state.data) {$('#main').innerHTML=`<section class="gate card"><span class="section-kicker">YOU ARE INVITED</span><h2>함께 떠날 준비됐나요?</h2><p>여행 정보를 연결하고 있어요. 잠시 후 다시 시도해 주세요.</p>${state.error?`<p class="form-error">${e(state.error)}</p>`:''}<div class="gate-buttons">${button('다시 연결하기','retry','','primary')}${''}</div></section>`;return;}
  if(state.section==='schedule') $('#main').innerHTML=renderSchedule();
  else if(state.section==='votes') $('#main').innerHTML=state.pollId&&pollById(state.pollId)?renderPoll(pollById(state.pollId)):renderVotes();
  else if(state.section==='lodgings') $('#main').innerHTML=renderLodgings();
  else if(state.section==='guestbook') $('#main').innerHTML=canEdit()?renderGuestbook():'<div class="notice">공유 데이터 설정 후 방명록을 사용할 수 있어요.</div>';
  else if(state.section==='budget') $('#main').innerHTML=canEdit()?renderBudget(state.data,me()):'<div class="notice">공유 데이터 설정 후 정산 내역을 함께 등록할 수 있어요.</div>';
  else {state.section='schedule';$('#main').innerHTML=renderSchedule();renderNav();}
  if(state.busy)lockUi(true);
}
function renderSchedule() {
  const items=state.data.schedule.filter(s=>s.date===state.date).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
  return heading('THREE DAYS, TOGETHER','우리의 여행 일정','바다를 따라, 갈대 사이로. 먹고 마실 곳은 함께 골라요.',canEdit()?button('+ 일정','schedule-add','','small'):'')+`<div class="date-tabs" role="group" aria-label="여행 날짜">${dates.map((d,i)=>`<button class="date-tab ${d===state.date?'active':''}" data-action="date" data-id="${d}" aria-pressed="${d===state.date}"><strong>11.${6+i} <small>${['금','토','일'][i]}</small></strong><span>DAY 0${i+1} · ${['여수','여수 → 순천','순천 → 서울'][i]}</span></button>`).join('')}</div><div class="day-summary"><h3>${days[dates.indexOf(state.date)]}</h3><span>${items.length}개의 순간</span></div><div class="timeline">${items.map(item=>{
    const poll=state.data.polls.find(p=>p.schedule_id===item.id),result=poll?resultFor(poll):null;
    const title=result?.leaders.length?result.leaders.map(c=>e(c.name)).join(' · '):e(item.title);
    const lodging=state.data.lodgings.find(l=>l.id===item.lodging_id);
    return `<article class="schedule-row"><div class="time">${item.start_time?`${e(item.start_time.slice(0,5))}${item.end_time?`<br>↓ ${e(item.end_time.slice(0,5))}`:''}`:'시간 미정'}</div><div class="card schedule-card ${poll?'vote-card':''}"><div><span class="kind-label">${kindNames[item.kind]||'TRIP'}</span>${poll?`<span class="visually-hidden">${e(item.title)}</span>`:''}<h4>${title}</h4><p>${e(item.description)}</p>${poll?`<span class="badge ${result.kind==='waiting'||result.kind==='tie'?'pending':''}">${e(state.publicPreview?'초기 후보 미리보기':resultLabel(result,poll))}</span>`:`<span class="badge ${item.verified?'':'pending'}">${item.verified?'확인된 일정':'일정 초안'}</span>`}${lodging?`<br>${link(lodging.url,'숙소 자세히 보기','external-link')}`:''}</div>${poll?button(state.publicPreview?'후보 보기':'후보 보기 · 투표','poll',poll.id,'small'):canEdit()?button('수정','schedule-edit',item.id,'small quiet'):''}</div></article>`;
  }).join('')}</div>`;
}
function renderVotes() {
  return heading('GOOD FOOD, GOOD COMPANY','먹고 싶은 곳, 한 표','친구들이 후보를 더하고, 가장 많은 표를 받은 곳이 일정표에 보여요.')+`<div class="notice">${state.publicPreview?'기본 후보 미리보기예요. 실제 투표 결과 확인과 후보 추천은 공유 데이터 연결 후 가능해요.':'일정마다 한 사람당 한 표. 언제든 선택을 바꾸거나 취소할 수 있고 현재 최다 득표가 일정표에 반영돼요.'}</div><div class="vote-grid">${state.data.polls.map(p=>{
    const item=itemForPoll(p),r=resultFor(p);
    return `<article class="card poll-summary"><span class="section-kicker">${shortDate(item.date)} · ${item.kind==='cafe'?'CAFE':'FOOD'} · 항상 투표 가능</span><h3>${e(item.title)}</h3><p>${state.publicPreview?'여행 초안에 등록된 후보를 둘러보세요.':r.leaders.length?r.leaders.map(c=>e(c.name)).join(' · '):'아직 정해지지 않았어요. 첫 표를 남겨 주세요.'}</p><div><span class="badge ${r.kind==='waiting'||r.kind==='tie'?'pending':''}">${e(state.publicPreview?'초기 후보 미리보기':resultLabel(r,p))}</span> <span class="count-label">후보 ${r.ranked.length}곳</span></div>${button(state.publicPreview?'후보 보기':'후보 보기 · 투표하기','poll',p.id,'small')}</article>`;
  }).join('')}</div>`;
}
function renderPoll(poll) {
  const item=itemForPoll(poll),result=resultFor(poll),mine=me()?state.data.votes.find(v=>v.poll_id===poll.id&&v.participant_id===me().id):null;
  const total=result.ranked.reduce((n,c)=>n+c.count,0),hiddenMine=mine&&!result.ranked.some(c=>c.id===mine.candidate_id);
  const choices=result.ranked.map((c,index)=>`<article class="card candidate ${mine?.candidate_id===c.id?'selected':''}"><div class="candidate-top"><div><span class="section-kicker">${c.count>0&&index===0?'MOST LOVED':'OPTION '+String(index+1).padStart(2,'0')}</span><h3>${e(c.name)}</h3></div>${state.publicPreview?'<span class="badge pending">초기 후보</span>':`<div class="votes">${c.count}<span>표</span></div>`}</div><p>${e(c.description)}</p>${state.publicPreview?'':`<div class="progress" aria-hidden="true"><span style="width:${total?c.count/total*100:0}%"></span></div>`}<div class="candidate-bottom"><div class="candidate-meta">${c.price!=null?`<span>1인 약 ${Number(c.price).toLocaleString('ko-KR')}원</span>`:''}${link(c.url,'장소 보기')}${!c.url?'<span>지도 링크 확인 필요</span>':''}</div>${canEdit()?button(mine?.candidate_id===c.id?'✓ 내 선택 · 취소':'이곳에 한 표','vote',c.id,mine?.candidate_id===c.id?'primary small':'small'):''}</div>${canEdit()?`<div class="guest-controls" style="margin-top:12px">${button('후보 숨기기','hide',c.id,'small quiet')}</div>`:''}</article>`).join('');
  return `${button('← 투표 목록','poll-back','','small quiet back-button')}<div class="poll-title"><span class="section-kicker">${shortDate(item.date)} · ${kindNames[item.kind]}</span><h2>${e(item.title)}</h2><p>${e(item.description)}</p><span class="badge ${state.publicPreview||result.kind==='tie'?'pending':''}">${e(state.publicPreview?'초기 후보 미리보기':resultLabel(result,poll))}</span></div>${hiddenMine?'<div class="notice">내가 선택했던 후보가 숨겨졌어요. 다른 후보를 선택해 주세요.</div>':''}<div class="poll-actions">${canEdit()?button('+ 후보 추천하기','candidate-add',poll.id,'primary'):'<p class="notice">공유 데이터 설정 후 후보를 추천하고 투표할 수 있어요.</p>'}</div><div class="candidate-list">${choices||`<div class="empty"><strong>${state.publicPreview?'아직 등록된 초기 후보가 없어요.':'첫 번째 추천을 기다려요.'}</strong>${state.publicPreview?'공유 데이터 설정 후 함께 가고 싶은 곳을 추천해 주세요.':'함께 가고 싶은 식당이나 카페를 후보로 추가해 주세요.'}</div>`}</div>${canEdit()?state.data.candidates.filter(c=>c.poll_id===poll.id&&c.hidden).map(c=>`<div class="card admin-row admin-hidden" style="margin-top:12px"><strong>숨긴 후보 · ${e(c.name)}</strong>${button('다시 표시','unhide',c.id,'small')}</div>`).join(''):''}<p class="muted">${state.publicPreview?'여행 초안의 후보예요. 실제 득표 결과는 공유 데이터 연결 후 확인할 수 있어요.':`${total}표 참여 · 언제든 자유롭게 변경하세요.`}</p>`;
}
function renderLodgings() {
  return heading('A PLACE TO REST','숙소','밤에는 느긋하게, 내일의 여행을 준비해요.')+`<div class="lodging-grid">${state.data.lodgings.map((l,i)=>`<article class="card lodging-card"><div class="lodging-visual ${i?'suncheon':''}" aria-hidden="true"><span>${e(l.city)}</span><small>${i?'AMONG THE REEDS':'BY THE SEA'}</small></div><span class="section-kicker">NIGHT 0${i+1} · ${shortDate(l.check_in)} → ${shortDate(l.check_out)}</span><h3>${e(l.name)}</h3><span class="badge ${l.verified?'':'pending'}">${l.verified?'숙소 정보 확인됨':'예약 및 상세 정보 확인 필요'}</span><p>${e(l.notes)}</p>${link(l.url,i?'네이버 지도에서 보기':'Airbnb에서 보기','external-link')}${canEdit()?`<div style="margin-top:18px">${button('숙소 정보 수정','lodging-edit',l.id,'small')}</div>`:''}</article>`).join('')}</div>`;
}
function renderGuestbook() {
  return heading('LEAVE A LITTLE NOTE','여행 전, 한마디','기대하는 순간, 가져갈 간식, 하고 싶은 이야기. 편하게 남겨요.')+`<form class="card guest-form" data-form="guestbook-create"><div class="guest-top"><span class="avatar">${e((lastNickname||'?').slice(0,1))}</span><strong>${e(lastNickname||'닉네임을 입력해 주세요.')}</strong></div>${nicknameField(state.guestNicknameDraft??lastNickname)}<label class="field" for="guest-content">친구들에게 남길 메시지<textarea id="guest-content" name="content" maxlength="1000" required placeholder="이번 여행에서 가장 기대되는 건…">${e(state.guestDraft)}</textarea></label><p class="form-error" role="alert"></p><div class="form-footer"><span>최대 1,000자 · 10초에 한 번</span><button class="primary" type="submit">메시지 남기기</button></div></form><div class="guest-list">${state.entries.map(entry=>{
    const person=state.data.participants.find(p=>p.id===entry.participant_id);
    return `<article class="card"><div class="guest-top"><span class="avatar">${e((person?.name||'?').slice(0,1))}</span><div><strong>${e(person?.name||'참여자')}</strong><time datetime="${e(entry.created_at)}">${fmtDate(entry.created_at)}${entry.updated_at!==entry.created_at?' · 수정됨':''}</time></div></div><p class="guest-message">${e(entry.content)}</p><div class="guest-controls">${canEdit()?button('수정','guest-edit',entry.id,'small quiet'):''}${canEdit()?button('삭제','guest-delete',entry.id,'small quiet danger'):''}</div></article>`;
  }).join('')||'<div class="empty"><strong>우리 여행의 첫 문장.</strong>첫 번째 메시지를 남겨 주세요.</div>'}</div>${state.entries.length>=state.limit?`<div style="margin-top:20px">${button('메시지 더 보기','guest-more')}</div>`:''}`;
}
function expenseForm(expense=null) {
  const account=accountDetails(expense||{});
  const current=expense?localDateTime(expense.occurred_at):localDateTime(new Date().toISOString());
  const ids=expense?state.data.expense_splits.filter(s=>s.expense_id===expense.id).map(s=>s.participant_id):[];
  showForm(expense?'내 결제 내역 수정':'내 결제 내역 등록',expense?'expense-edit':'expense-create',
    `<p class="dialog-description">${expense?'결제자: '+e(state.data.participants.find(p=>p.id===expense.paid_by)?.name||'참여자'):'입력한 닉네임을 결제자로 기록해요.'} · 원 단위로 균등 배분해요.</p><div class="form-row">${field('날짜','expense_date',current.slice(0,10),'date','required')}${field('시간','expense_time',current.slice(11,16),'time','required')}</div>`+
    `<div class="form-row">${field('은행명 (선택)','bank_name',account.bank_name,'text','maxlength="40" placeholder="예: 카카오뱅크"')}${field('계좌번호 (선택)','account_number',account.account_number,'text','maxlength="100" placeholder="예: 3333-00-1234567"')}</div>`+field('항목','item',expense?.item||'','text','required maxlength="100"')+field('금액 (원)','amount',expense?.amount||'','number','required min="1" max="2147483647" step="1"')+
    `<fieldset class="split-fieldset"><legend>정산 대상자</legend><div class="split-modes"><label><input type="radio" name="split_mode" value="all" ${expense?.split_mode!=='some'?'checked':''}> 전부</label><label><input type="radio" name="split_mode" value="some" ${expense?.split_mode==='some'?'checked':''}> 일부</label></div><div id="split-people" class="split-people" ${expense?.split_mode==='some'?'':'hidden'}>${state.data.participants.filter(p=>p.active).map(p=>`<label><input type="checkbox" name="participant_ids" value="${e(p.id)}" ${ids.includes(p.id)?'checked':''}>${e(p.name)}</label>`).join('')}</div><p class="muted">‘전부’는 저장할 때 참여 중인 친구 전원이에요.</p></fieldset>`,expense?.id||'','내역 저장');
  $('#dialog form').dataset.requestId=newId();
}

function showDialog(title,body) {$('#dialog-content').innerHTML=`<div class="dialog-heading"><h2>${e(title)}</h2>${button('×','dialog-close','','quiet')}</div>${body}`;if(!$('#dialog').open)$('#dialog').showModal();}
function showForm(title,form,body,id='',submit='저장하기') {showDialog(title,`<form data-form="${form}" data-id="${e(id)}">${anonymousForms.includes(form)?'':nicknameField()}${body}${formEnd(submit)}</form>`);}
function confirmAction(title,message,action,id,extra={}) {showDialog(title,`<p class="dialog-description">${e(message)}</p><form data-form="confirmation" data-id="${e(id)}" data-action-name="${action}" data-extra="${e(JSON.stringify(extra))}">${nicknameField()}${formEnd('확인')}</form>`);}
function scheduleForm(item) {showForm('일정 수정','schedule-edit',field('제목','title',item.title,'text','required maxlength="100"')+dateField(item.date)+`<div class="form-row">${field('시작 시간','start_time',item.start_time?.slice(0,5)||'','time')}${field('종료 시간','end_time',item.end_time?.slice(0,5)||'','time')}</div>`+field('일정 표시 순서','position',item.position,'number','min="1" max="9999" required')+textarea('설명','description',item.description,1000)+check('확인된 일정으로 표시','verified',item.verified),item.id);}
function navigate(section) {state.section=section;state.pollId=null;if(location.hash!==`#${section}`)location.hash=section;else render();}
async function refresh() {
  if(state.refreshing){state.refreshAgain=true;return;}
  if(!state.repo)return;
  state.refreshing=true;
  try {
    const [data,entries]=await Promise.all([state.repo.snapshot(),state.repo.guestbook(state.limit)]);
    const wasPublic=state.publicPreview;
    state.data=data;state.publicPreview=false;state.entries=entries;state.clockOffset=Date.parse(data.server_time)-Date.now();state.error='';state.loading=false;
    render();
    if(wasPublic&&!state.repo.demo)subscribe();
  } catch(error) {
    state.loading=false;state.error=error.message;
    // Never keep private content visible after membership is rejected.
    if(error.code==='42501'||/권한|초대|참여|인증|permission|JWT/i.test(error.message)||!state.data||state.publicPreview){showPublicPreview();}
    render();
  } finally {state.refreshing=false;if(state.refreshAgain){state.refreshAgain=false;queueMicrotask(refresh);}}
}
function subscribe() {
  state.unsubscribe?.();
  state.unsubscribe=state.repo.subscribe(()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,150);},status=>{state.realtime=status;renderConnection();});
}
async function write(action,payload) {
  if(!canEdit())throw new Error('닉네임을 입력해 주세요.');
  if(!navigator.onLine&&!state.repo.demo)throw new Error('오프라인이에요. 연결 후 저장해 주세요.');
  if(payload.nickname===undefined){const result=await state.repo.mutate(action,payload);await refresh();return result;}
  const nickname=validateNickname(payload.nickname);const result=await state.repo.mutate(action,{...payload,nickname});rememberNickname(nickname);await refresh();return result;
}
async function action(name,id,element) {
  if(name==='dialog-close'){$('#dialog').close();return;}
  if(name==='date'){state.date=id;render();return;}
  if(name==='poll'){state.section='votes';state.pollId=id;history.replaceState(null,'','#votes');render();$('#main').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(name==='poll-back'){state.pollId=null;render();return;}
  if(name==='retry'){if(!state.repo){await start();return;}await refresh();if(canEdit()&&!state.unsubscribe)subscribe();return;}
  if(!canEdit())throw new Error('닉네임을 입력해 주세요.');
  if(name==='vote'){const c=state.data.candidates.find(c=>c.id===id);showForm('닉네임으로 투표하기','vote',`<p class="dialog-description">${e(c.name)}에 투표해요. 같은 닉네임으로 이미 이 후보를 선택했다면 투표가 취소돼요.</p>`,id,'투표 반영');}
  else if(name==='candidate-add')showForm('함께 갈 곳 추천하기','candidate',`${field('장소 이름','name','','text','required maxlength="80"')}${field('지도 또는 상세 링크 (선택)','url','','url')}${field('1인 예상 가격 (선택, 원)','price','','number','min="0" max="2147483647" step="1"')}${textarea('추천 이유','description')}`,id,'후보 등록하기');
  else if(name==='hide')confirmAction('후보 숨기기','이 후보의 표는 집계에서 제외돼요. 선택한 친구는 다른 후보를 골라야 해요.','hide_candidate',id,{id,hidden:true});
  else if(name==='unhide'){await write('hide_candidate',{id,hidden:false});toast('후보를 다시 표시했어요.');}
  else if(name==='schedule-edit')scheduleForm(state.data.schedule.find(s=>s.id===id));
  else if(name==='schedule-add')showForm('새 일정 추가','schedule-add',dateField()+field('일정 제목','title','','text','required maxlength="100"')+`<label class="field">일정 종류<select name="kind">${Object.entries(kindNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><small>식사·카페를 선택하면 투표도 함께 만들어요.</small></label>`+textarea('설명','description','',1000));
  else if(name==='lodging-edit'){const l=state.data.lodgings.find(l=>l.id===id);showForm('숙소 정보 수정','lodging',field('숙소 이름','name',l.name,'text','required maxlength="100"')+field('숙소 링크','url',l.url,'url','required')+textarea('예약 상태·주소·입퇴실 안내','notes',l.notes,1000)+check('숙소 정보 확인 완료','verified',l.verified),id);}

  else if(name==='expense-add')expenseForm();
  else if(name==='expense-edit')expenseForm(state.data.expenses.find(x=>x.id===id));
  else if(name==='expense-delete')confirmAction('결제 내역 삭제','이 내역과 배분 금액을 정산에서 제외할까요?','expense_delete',id,{id});
  else if(name==='guest-edit'){const entry=state.entries.find(x=>x.id===id);showForm('메시지 수정','guest-edit',textarea('메시지','content',entry.content,1000),id);}
  else if(name==='guest-delete')confirmAction('메시지 삭제','이 메시지를 삭제할까요?','guestbook_delete',id,{id});
  else if(name==='guest-more'){state.limit+=20;await refresh();}
  else if(name==='demo-reset'){showDialog('데모 초기화',`<p class="dialog-description">이 브라우저에서 추가한 후보·표·메시지를 초기화해요.</p><form data-form="reset">${formEnd('초기화')}</form>`);}
  else if(name==='export'){if(!canEdit())throw new Error('먼저 여행에 참여해 주세요.');const entries=await state.repo.guestbook(10000);const snapshot={...state.data,guestbook:entries};delete snapshot.invitations;const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='yeosu-suncheon-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('기록을 내려받았어요.');}

}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('#navigation a');if(nav){event.preventDefault();navigate(nav.getAttribute('href').slice(1));return;}
  if(event.target.closest('.hero-link')){event.preventDefault();navigate('schedule');$('#navigation').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});return;}
  const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
  event.preventDefault();
  if(state.busy)return;lockUi(true);
  try{await action(el.dataset.action,el.dataset.id,el);}catch(error){toast(error.message);}finally{lockUi(false);}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();if(state.busy)return;
  lockUi(true);const submit=form.querySelector('[type=submit]');form.querySelector('.form-error').textContent='';
  const values=Object.fromEntries(new FormData(form)),id=form.dataset.id,type=form.dataset.form;
  try{
    if(!canEdit())throw new Error('닉네임을 입력해 주세요.');
    const nickname=anonymousForms.includes(type)?undefined:validateNickname(values.nickname);
    const register=(action,payload)=>write(action,{...payload,nickname});
    let result;
    if(type==='vote'){const c=state.data.candidates.find(c=>c.id===id),person=state.data.participants.find(p=>normalizeName(p.name)===normalizeName(nickname)),old=state.data.votes.find(v=>v.poll_id===c.poll_id&&v.participant_id===person?.id);await register('vote',{poll_id:c.poll_id,candidate_id:old?.candidate_id===id?null:id});}
    else if(type==='candidate'){result=await register('candidate',{...validateCandidate(values),poll_id:id});}
    else if(type==='confirmation')await register(form.dataset.actionName,JSON.parse(form.dataset.extra));
    else if(type==='schedule-edit')await register('schedule',{...values,id,verified:values.verified==='on'});
    else if(type==='schedule-add')await register('schedule_add',values);
    else if(type==='lodging')await register('lodging',{...values,id,verified:values.verified==='on'});
    else if(type==='participant'){const self=state.data.participants.find(p=>normalizeName(p.name)===normalizeName(nickname));await register('participant',{...values,id});if(self?.id===id){rememberNickname(values.name);render();}}
    else if(type==='participant-add')await register('participant_add',values);
    else if(['expense-create','expense-edit'].includes(type)){const input=validateExpense({...values,occurred_at:fromKst(`${values.expense_date}T${values.expense_time}`),participant_ids:new FormData(form).getAll('participant_ids')},state.data.participants);if((input.account_number||input.bank_name)&&!state.repo.demo&&!state.data.expense_bank_names)throw new Error('계좌번호 저장을 위한 공유 데이터 업데이트가 필요해요. 최신 setup.sql 적용 후 다시 시도해 주세요.');await register(type==='expense-create'?'expense_create':'expense_edit',{...input,id,request_id:form.dataset.requestId});}
    else if(type==='guestbook-create'){const content=validateMessage(values.content);await register('guestbook_create',{content,request_id:state.requestId});state.guestDraft='';state.requestId=newId();const input=$('#guest-content');if(input)input.value='';render();}
    else if(type==='guest-edit')await register('guestbook_edit',{id,content:validateMessage(values.content)});
    else if(type==='reset'){await state.repo.reset();state.section='schedule';await refresh();}
    $('#dialog').close();toast(state.repo.demo?'데모에 저장했어요.':'저장했어요.');
  }catch(error){if(anonymousForms.includes(type)&&/닉네임/.test(error.message))error.message='닉네임 없이 저장하려면 공유 데이터 업데이트가 필요해요. 최신 setup.sql 적용 후 다시 시도해 주세요.';if(form.isConnected)form.querySelector('.form-error').textContent=error.message;else toast(error.message);}
  finally{lockUi(false);}
});
document.addEventListener('input',event=>{if(event.target.id==='guest-content')state.guestDraft=event.target.value;if(event.target.name==='nickname'&&event.target.closest('.guest-form'))state.guestNicknameDraft=event.target.value;});
document.addEventListener('change',async event=>{if(event.target.name==='split_mode'){const box=$('#split-people');if(box)box.hidden=event.target.value!=='some';}});
window.addEventListener('hashchange',()=>{const target=location.hash.slice(1);if(['schedule','votes','lodgings','budget','guestbook'].includes(target)){state.section=target;state.pollId=null;render();}});
window.addEventListener('online',()=>{toast('연결이 복구됐어요.');refresh();});
window.addEventListener('offline',()=>{renderConnection();toast('오프라인이에요. 작성 중인 내용은 유지돼요.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
async function start() {
  try{
    const config=window.TRIP_CONFIG||{};
    const hasUrl=Boolean(config.supabaseUrl),hasKey=Boolean(config.supabaseKey);
    const target=location.hash.slice(1);if(['schedule','votes','lodgings','budget','guestbook'].includes(target))state.section=target;
    if(hasUrl||hasKey){showPublicPreview();render();}
    if(hasUrl!==hasKey)throw new Error('서비스 설정이 일부만 입력되어 있어요. URL과 공개 키를 모두 설정해 주세요.');
    state.repo=hasUrl?await SupabaseRepository.create(config):new DemoRepository();
    await refresh();if(canEdit()&&!state.unsubscribe)subscribe();
    expiryTimer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  }catch(error){state.error=error.message;showPublicPreview();render();}
}
window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(expiryTimer);state.unsubscribe?.();}});
initSlideshow();start();
