import { escapeHtml as e, safeUrl, pollResult, resultLabel, validateCandidate, validateMessage, newId } from './domain.js';
import { DemoRepository, SupabaseRepository } from './repository.js';
import { renderBudget, validateExpense } from './expenses.js';
import { createSeed } from './seed.js';

const $ = selector => document.querySelector(selector);
const dates = ['2026-11-06','2026-11-07','2026-11-08'];
const days = ['여수, 바다를 만나는 날','여수에서 순천, 가을을 따라서','순천, 느긋한 마지막 하루'];
const kindNames = {train:'TRAIN · 기차',move:'ON THE ROAD · 이동',food:'GOOD FOOD · 식사',cafe:'COFFEE BREAK · 카페',sight:'SLOW WALK · 관광',stay:'STAY · 숙소'};
const state = {repo:null,data:null,publicPreview:false,entries:[],section:'schedule',date:dates[0],pollId:null,limit:20,loading:true,error:'',busy:false,guestDraft:'',requestId:newId(),unsubscribe:null,refreshing:false,refreshAgain:false,clockOffset:0,realtime:''};
let toastTimer, refreshTimer, expiryTimer, inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite');
if (inviteToken) history.replaceState(null,'',`${location.pathname}${location.search}#schedule`);
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
const me = () => state.data?.me;
const canEdit = () => Boolean(me());
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
function participationNotice(title) {
  return `<section class="gate card"><span class="section-kicker">JOIN THE TRIP</span><h2>${e(title)}</h2><p>친구별 초대 링크로 입장하면 함께 사용할 수 있어요. 기본 일정과 숙소는 지금도 둘러볼 수 있어요.</p><div class="gate-buttons">${button('다시 연결하기','retry','','small')}</div></section>`;
}

function renderConnection() {
  const el=$('#connection');
  if(state.repo?.demo) {
    el.className='connection demo';
    const people=state.data?.participants || state.repo.read().participants;
    el.innerHTML=`<strong>데모 · 다른 사람과 공유되지 않음</strong> <span>이 브라우저에서만 저장돼요.</span><label> 체험할 참여자<select id="demo-person" aria-label="데모 참여자">${people.filter(p=>p.active).map(p=>`<option value="${e(p.id)}" ${p.id===state.repo.participantId?'selected':''}>${e(p.name)}</option>`).join('')}</select></label>`;
  } else {
    if(state.publicPreview){
      el.className='connection';
      el.innerHTML=`<strong>기본 일정 미리보기</strong> <span>공동 편집 내용과 투표 결과는 친구별 초대 링크로 입장해 확인해 주세요.</span>${state.error?`<span>${e(state.error)}</span>`:''}`;
    }else{
      el.className=`connection ${state.error?'error':''}`;
      el.textContent=state.error || (!navigator.onLine?'오프라인이에요. 연결 후 다시 시도해 주세요.':state.data?(state.realtime==='SUBSCRIBED'?'친구들과 실시간으로 함께 만드는 여행':'여행 연결됨 · 실시간 연결을 복구하고 있어요'):'친구별 초대 링크로 접속해 주세요.');
    }
  }
  $('#identity').innerHTML=me()?`<span class="avatar" aria-hidden="true">${e(me().name.slice(0,1))}</span><span>${e(me().name)}</span>${state.repo.demo?'':button('로그아웃','logout','','small quiet')}`:'<span class="muted">함께 만드는 여행</span>';
}
function renderNav() {
  const tabs=[['schedule','여행 일정'],['votes','맛집 투표'],['lodgings','우리의 숙소'],['budget','예산 · 정산'],['guestbook','방명록']];
  if(canEdit()) tabs.push(['settings','여행 설정']);
  $('#navigation').innerHTML=tabs.map(([id,title])=>`<a href="#${id}" class="${state.section===id?'active':''}" ${state.section===id?'aria-current="page"':''}>${title}</a>`).join('');
}
function heading(kicker,title,description,right='') {return `<div class="section-heading"><div><span class="section-kicker">${kicker}</span><h2>${title}</h2><p>${description}</p></div>${right}</div>`;}
function render() {
  const draft=$('#guest-content');if(draft) state.guestDraft=draft.value;
  renderConnection();renderNav();
  if(state.loading && !state.data) {$('#main').innerHTML='<div class="loading">여행 정보를 불러오고 있어요…</div>';return;}
  if(!state.data) {$('#main').innerHTML=`<section class="gate card"><span class="section-kicker">YOU ARE INVITED</span><h2>함께 떠날 준비됐나요?</h2><p>친구별 초대 링크를 열면 여행 일정과 맛집 투표에 참여할 수 있어요. 링크가 만료되었다면 친구에게 새 링크를 받아 주세요.</p>${state.error?`<p class="form-error">${e(state.error)}</p>`:''}<div class="gate-buttons">${button('다시 연결하기','retry','','primary')}${''}</div></section>`;return;}
  if(state.section==='schedule') $('#main').innerHTML=renderSchedule();
  else if(state.section==='votes') $('#main').innerHTML=state.pollId&&pollById(state.pollId)?renderPoll(pollById(state.pollId)):renderVotes();
  else if(state.section==='lodgings') $('#main').innerHTML=renderLodgings();
  else if(state.section==='guestbook') $('#main').innerHTML=canEdit()?renderGuestbook():participationNotice('친구들과 여행 이야기를 나눠요');
  else if(state.section==='budget') $('#main').innerHTML=canEdit()?renderBudget(state.data,me()):participationNotice('예산과 정산은 함께 떠나는 친구들에게');
  else if(state.section==='settings' && canEdit()) $('#main').innerHTML=renderSettings();
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
  return heading('GOOD FOOD, GOOD COMPANY','먹고 싶은 곳, 한 표','친구들이 후보를 더하고, 가장 많은 표를 받은 곳이 일정표에 보여요.')+`<div class="notice">${state.publicPreview?'기본 후보 미리보기예요. 실제 투표 결과 확인과 후보 추천은 친구별 초대 링크로 입장한 뒤 가능해요.':'일정마다 한 사람당 한 표. 언제든 선택을 바꾸거나 취소할 수 있고 현재 최다 득표가 일정표에 반영돼요.'}</div><div class="vote-grid">${state.data.polls.map(p=>{
    const item=itemForPoll(p),r=resultFor(p);
    return `<article class="card poll-summary"><span class="section-kicker">${shortDate(item.date)} · ${item.kind==='cafe'?'CAFE':'FOOD'} · 항상 투표 가능</span><h3>${e(item.title)}</h3><p>${state.publicPreview?'여행 초안에 등록된 후보를 둘러보세요.':r.leaders.length?r.leaders.map(c=>e(c.name)).join(' · '):'아직 정해지지 않았어요. 첫 표를 남겨 주세요.'}</p><div><span class="badge ${r.kind==='waiting'||r.kind==='tie'?'pending':''}">${e(state.publicPreview?'초기 후보 미리보기':resultLabel(r,p))}</span> <span class="count-label">후보 ${r.ranked.length}곳</span></div>${button(state.publicPreview?'후보 보기':'후보 보기 · 투표하기','poll',p.id,'small')}</article>`;
  }).join('')}</div>`;
}
function renderPoll(poll) {
  const item=itemForPoll(poll),result=resultFor(poll),mine=canEdit()?state.data.votes.find(v=>v.poll_id===poll.id&&v.participant_id===me().id):null;
  const total=result.ranked.reduce((n,c)=>n+c.count,0),hiddenMine=mine&&!result.ranked.some(c=>c.id===mine.candidate_id);
  const choices=result.ranked.map((c,index)=>`<article class="card candidate ${mine?.candidate_id===c.id?'selected':''}"><div class="candidate-top"><div><span class="section-kicker">${c.count>0&&index===0?'MOST LOVED':'OPTION '+String(index+1).padStart(2,'0')}</span><h3>${e(c.name)}</h3></div>${state.publicPreview?'<span class="badge pending">초기 후보</span>':`<div class="votes">${c.count}<span>표</span></div>`}</div><p>${e(c.description)}</p>${state.publicPreview?'':`<div class="progress" aria-hidden="true"><span style="width:${total?c.count/total*100:0}%"></span></div>`}<div class="candidate-bottom"><div class="candidate-meta">${c.price!=null?`<span>1인 약 ${Number(c.price).toLocaleString('ko-KR')}원</span>`:''}${link(c.url,'장소 보기')}${!c.url?'<span>지도 링크 확인 필요</span>':''}</div>${canEdit()?button(mine?.candidate_id===c.id?'✓ 내 선택 · 취소':'이곳에 한 표','vote',c.id,mine?.candidate_id===c.id?'primary small':'small'):''}</div>${canEdit()&&c.created_by===me().id?`<div class="guest-controls" style="margin-top:12px">${button('내 추천 숨기기','hide',c.id,'small quiet')}</div>`:''}</article>`).join('');
  return `${button('← 투표 목록','poll-back','','small quiet back-button')}<div class="poll-title"><span class="section-kicker">${shortDate(item.date)} · ${kindNames[item.kind]}</span><h2>${e(item.title)}</h2><p>${e(item.description)}</p><span class="badge ${state.publicPreview||result.kind==='tie'?'pending':''}">${e(state.publicPreview?'초기 후보 미리보기':resultLabel(result,poll))}</span></div>${hiddenMine?'<div class="notice">내가 선택했던 후보가 숨겨졌어요. 다른 후보를 선택해 주세요.</div>':''}<div class="poll-actions">${canEdit()?button('+ 후보 추천하기','candidate-add',poll.id,'primary'):'<p class="notice">친구별 초대 링크로 입장하면 후보를 추천하고 투표할 수 있어요.</p>'}</div><div class="candidate-list">${choices||`<div class="empty"><strong>${state.publicPreview?'아직 등록된 초기 후보가 없어요.':'첫 번째 추천을 기다려요.'}</strong>${state.publicPreview?'여행에 참여한 뒤 함께 가고 싶은 곳을 추천해 주세요.':'함께 가고 싶은 식당이나 카페를 후보로 추가해 주세요.'}</div>`}</div>${canEdit()?state.data.candidates.filter(c=>c.poll_id===poll.id&&c.hidden&&c.created_by===me().id).map(c=>`<div class="card admin-row admin-hidden" style="margin-top:12px"><strong>숨긴 후보 · ${e(c.name)}</strong>${button('다시 표시','unhide',c.id,'small')}</div>`).join(''):''}<p class="muted">${state.publicPreview?'여행 초안의 후보예요. 실제 득표 결과는 초대 링크로 입장해 확인해 주세요.':`${total}표 참여 · 언제든 자유롭게 변경하세요.`}</p>`;
}
function renderLodgings() {
  return heading('A PLACE TO REST','우리의 숙소','밤에는 느긋하게, 내일의 여행을 준비해요.')+`<div class="lodging-grid">${state.data.lodgings.map((l,i)=>`<article class="card lodging-card"><div class="lodging-visual ${i?'suncheon':''}" aria-hidden="true"><span>${e(l.city)}</span><small>${i?'AMONG THE REEDS':'BY THE SEA'}</small></div><span class="section-kicker">NIGHT 0${i+1} · ${shortDate(l.check_in)} → ${shortDate(l.check_out)}</span><h3>${e(l.name)}</h3><span class="badge ${l.verified?'':'pending'}">${l.verified?'숙소 정보 확인됨':'예약 및 상세 정보 확인 필요'}</span><p>${e(l.notes)}</p>${link(l.url,i?'네이버 지도에서 보기':'Airbnb에서 보기','external-link')}${canEdit()?`<div style="margin-top:18px">${button('숙소 정보 수정','lodging-edit',l.id,'small')}</div>`:''}</article>`).join('')}</div>`;
}
function renderGuestbook() {
  return heading('LEAVE A LITTLE NOTE','여행 전, 한마디','기대하는 순간, 가져갈 간식, 하고 싶은 이야기. 편하게 남겨요.')+`<form class="card guest-form" data-form="guestbook-create"><div class="guest-top"><span class="avatar">${e(me().name.slice(0,1))}</span><strong>${e(me().name)}</strong></div><label class="field" for="guest-content">친구들에게 남길 메시지<textarea id="guest-content" name="content" maxlength="1000" required placeholder="이번 여행에서 가장 기대되는 건…">${e(state.guestDraft)}</textarea></label><p class="form-error" role="alert"></p><div class="form-footer"><span>최대 1,000자 · 10초에 한 번</span><button class="primary" type="submit">메시지 남기기</button></div></form><div class="guest-list">${state.entries.map(entry=>{
    const person=state.data.participants.find(p=>p.id===entry.participant_id);
    return `<article class="card"><div class="guest-top"><span class="avatar">${e((person?.name||'?').slice(0,1))}</span><div><strong>${e(person?.name||'참여자')}</strong><time datetime="${e(entry.created_at)}">${fmtDate(entry.created_at)}${entry.updated_at!==entry.created_at?' · 수정됨':''}</time></div></div><p class="guest-message">${e(entry.content)}</p><div class="guest-controls">${entry.participant_id===me().id?button('수정','guest-edit',entry.id,'small quiet'):''}${entry.participant_id===me().id?button('삭제','guest-delete',entry.id,'small quiet danger'):''}</div></article>`;
  }).join('')||'<div class="empty"><strong>우리 여행의 첫 문장.</strong>첫 번째 메시지를 남겨 주세요.</div>'}</div>${state.entries.length>=state.limit?`<div style="margin-top:20px">${button('메시지 더 보기','guest-more')}</div>`:''}`;
}
function renderSettings() {
  const participants=state.data.participants;
  return heading('MAKE IT OURS','여행 설정','모두 같은 참여자예요. 일정과 숙소를 함께 수정할 수 있어요.',button('기록 내려받기','export','','small'))+`<div class="admin-grid"><section class="card admin-card"><h3>함께 떠나는 친구들</h3>${participants.map(p=>{
    const invitation=state.data.invitations?.find(i=>i.participant_id===p.id&&!i.revoked_at&&(!i.expires_at||Date.parse(i.expires_at)>Date.now()+state.clockOffset));
    return `<div class="admin-row ${p.active?'':'inactive'}"><div><strong>${e(p.name)}</strong><br><small>${!p.active?'참여 종료':invitation?'유효한 초대 링크 있음':'참여자'}</small></div><div class="row-buttons">${p.id===me().id?button('내 이름 수정','participant-edit',p.id,'small'):''}${button('링크 발급','invite',p.id,'small',!p.active)}${invitation?button('폐기','revoke-invite',p.id,'small danger'):''}</div></div>`;
  }).join('')}${button('+ 친구 추가','participant-add','','small')}</section><section class="card admin-card"><h3>일정 편집</h3>${state.data.schedule.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.position-b.position).map(item=>`<div class="admin-row"><div><small>${shortDate(item.date)} · ${item.start_time?.slice(0,5)||'시간 미정'}</small><br><strong>${e(item.title)}</strong></div>${button('수정','schedule-edit',item.id,'small')}</div>`).join('')}${button('+ 새 일정 추가','schedule-add','','small')}</section></div>${state.repo.demo?`<div class="notice" style="margin-top:20px">데모에서 발급한 링크는 실제 친구 초대에 사용할 수 없어요. ${button('데모 초기화','demo-reset','','small danger')}</div>`:''}`;
}
function expenseForm(expense=null) {
  const current=expense?localDateTime(expense.occurred_at):localDateTime(new Date().toISOString());
  const ids=expense?state.data.expense_splits.filter(s=>s.expense_id===expense.id).map(s=>s.participant_id):[];
  showForm(expense?'내 결제 내역 수정':'내 결제 내역 등록',expense?'expense-edit':'expense-create',
    `<p class="dialog-description">결제자: ${e(me().name)} · 원 단위로 균등 배분해요.</p><div class="form-row">${field('날짜','expense_date',current.slice(0,10),'date','required')}${field('시간','expense_time',current.slice(11,16),'time','required')}</div>`+
    field('항목','item',expense?.item||'','text','required maxlength="100"')+field('금액 (원)','amount',expense?.amount||'','number','required min="1" max="2147483647" step="1"')+
    `<fieldset class="split-fieldset"><legend>정산 대상자</legend><div class="split-modes"><label><input type="radio" name="split_mode" value="all" ${expense?.split_mode!=='some'?'checked':''}> 전부</label><label><input type="radio" name="split_mode" value="some" ${expense?.split_mode==='some'?'checked':''}> 일부</label></div><div id="split-people" class="split-people" ${expense?.split_mode==='some'?'':'hidden'}>${state.data.participants.filter(p=>p.active).map(p=>`<label><input type="checkbox" name="participant_ids" value="${e(p.id)}" ${ids.includes(p.id)?'checked':''}>${e(p.name)}</label>`).join('')}</div><p class="muted">‘전부’는 저장할 때 참여 중인 친구 전원이에요.</p></fieldset>`,expense?.id||'','내역 저장');
  $('#dialog form').dataset.requestId=newId();
}

function showDialog(title,body) {$('#dialog-content').innerHTML=`<div class="dialog-heading"><h2>${e(title)}</h2>${button('×','dialog-close','','quiet')}</div>${body}`;if(!$('#dialog').open)$('#dialog').showModal();}
function showForm(title,form,body,id='',submit='저장하기') {showDialog(title,`<form data-form="${form}" data-id="${e(id)}">${body}${formEnd(submit)}</form>`);}
function confirmAction(title,message,action,id,extra={}) {showDialog(title,`<p class="dialog-description">${e(message)}</p><form data-form="confirmation" data-id="${e(id)}" data-action-name="${action}" data-extra="${e(JSON.stringify(extra))}">${formEnd('확인')}</form>`);}
function scheduleForm(item) {showForm('일정 수정','schedule-edit',field('제목','title',item.title,'text','required maxlength="100"')+dateField(item.date)+`<div class="form-row">${field('시작 시간','start_time',item.start_time?.slice(0,5)||'','time')}${field('종료 시간','end_time',item.end_time?.slice(0,5)||'','time')}</div>`+field('일정 표시 순서','position',item.position,'number','min="1" max="9999" required')+textarea('설명','description',item.description,1000)+check('확인된 일정으로 표시','verified',item.verified),item.id);}
function navigate(section) {state.section=section;state.pollId=null;if(location.hash!==`#${section}`)location.hash=section;else render();}
async function refresh() {
  if(state.refreshing){state.refreshAgain=true;return;}
  if(!state.repo)return;
  state.refreshing=true;
  try {
    if(!state.repo.demo&&!await state.repo.hasSession()){state.error='';showPublicPreview();render();return;}
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
  if(!canEdit())throw new Error('친구별 초대 링크로 먼저 입장해 주세요.');
  if(!navigator.onLine&&!state.repo.demo)throw new Error('오프라인이에요. 연결 후 저장해 주세요.');
  const result=await state.repo.mutate(action,payload);await refresh();return result;
}
async function action(name,id,element) {
  if(name==='dialog-close'){$('#dialog').close();return;}
  if(name==='date'){state.date=id;render();return;}
  if(name==='poll'){state.section='votes';state.pollId=id;history.replaceState(null,'','#votes');render();$('#main').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(name==='poll-back'){state.pollId=null;render();return;}
  if(name==='retry') {if(!state.repo){await start();return;}if(inviteToken){await state.repo.redeem(inviteToken);inviteToken=null;}await refresh();if(canEdit()&&!state.unsubscribe)subscribe();return;}
  if(name==='logout'){await state.repo.signOut();state.error='';state.section='schedule';showPublicPreview();render();return;}
  if(!canEdit())throw new Error('친구별 초대 링크로 먼저 입장해 주세요.');
  if(name==='vote') {const c=state.data.candidates.find(c=>c.id===id),old=state.data.votes.find(v=>v.poll_id===c.poll_id&&v.participant_id===me().id);await write('vote',{poll_id:c.poll_id,candidate_id:old?.candidate_id===id?null:id});toast('선택을 반영했어요.');}
  else if(name==='candidate-add')showForm('함께 갈 곳 추천하기','candidate',`${field('장소 이름','name','','text','required maxlength="80"')}${field('지도 또는 상세 링크 (선택)','url','','url')}${field('1인 예상 가격 (선택, 원)','price','','number','min="0" max="2147483647" step="1"')}${textarea('추천 이유','description')}`,id,'후보 등록하기');
  else if(name==='hide')confirmAction('후보 숨기기','이 후보의 표는 집계에서 제외돼요. 선택한 친구는 다른 후보를 골라야 해요.','hide_candidate',id,{id,hidden:true});
  else if(name==='unhide'){await write('hide_candidate',{id,hidden:false});toast('후보를 다시 표시했어요.');}
  else if(name==='schedule-edit')scheduleForm(state.data.schedule.find(s=>s.id===id));
  else if(name==='schedule-add')showForm('새 일정 추가','schedule-add',dateField()+field('일정 제목','title','','text','required maxlength="100"')+`<label class="field">일정 종류<select name="kind">${Object.entries(kindNames).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><small>식사·카페를 선택하면 투표도 함께 만들어요.</small></label>`+textarea('설명','description','',1000));
  else if(name==='lodging-edit'){const l=state.data.lodgings.find(l=>l.id===id);showForm('숙소 정보 수정','lodging',field('숙소 이름','name',l.name,'text','required maxlength="100"')+field('숙소 링크','url',l.url,'url','required')+textarea('예약 상태·주소·입퇴실 안내','notes',l.notes,1000)+check('숙소 정보 확인 완료','verified',l.verified),id);}
  else if(name==='participant-edit'){const p=state.data.participants.find(p=>p.id===id);showForm('참여자 수정','participant',field('이름','name',p.name,'text','required maxlength="40"')+'<p class="muted">다른 친구의 이름은 해당 친구가 변경할 수 있어요.</p>',id);}
  else if(name==='participant-add')showForm('친구 추가','participant-add',field('이름','name','','text','required maxlength="40"'));
  else if(name==='invite')showForm('친구별 초대 링크 발급','invite',`<p class="dialog-description">${e(state.data.participants.find(p=>p.id===id).name)} 님의 로그인 링크를 만들어요. 재발급 시 이전 링크와 연결된 접속 권한이 종료돼요.</p>${field('만료 일시 (선택, 한국 시간)','expires_at','','datetime-local')}`,id,'링크 발급');
  else if(name==='revoke-invite')confirmAction('초대 링크 폐기','이 친구의 기존 링크와 연결된 접속 권한이 종료돼요. 필요하면 새 링크를 발급할 수 있어요.','revoke_invite',id,{id});
  else if(name==='expense-add')expenseForm();
  else if(name==='expense-edit')expenseForm(state.data.expenses.find(x=>x.id===id));
  else if(name==='expense-delete')confirmAction('결제 내역 삭제','이 내역과 배분 금액을 정산에서 제외할까요?','expense_delete',id,{id});
  else if(name==='guest-edit'){const entry=state.entries.find(x=>x.id===id);showForm('메시지 수정','guest-edit',textarea('메시지','content',entry.content,1000),id);}
  else if(name==='guest-delete')confirmAction('메시지 삭제','이 메시지를 삭제할까요?','guestbook_delete',id,{id});
  else if(name==='guest-more'){state.limit+=20;await refresh();}
  else if(name==='demo-reset'){showDialog('데모 초기화',`<p class="dialog-description">이 브라우저에서 추가한 후보·표·메시지를 초기화해요.</p><form data-form="reset">${formEnd('초기화')}</form>`);}
  else if(name==='export'){if(!canEdit())throw new Error('먼저 여행에 참여해 주세요.');const entries=await state.repo.guestbook(10000);const snapshot={...state.data,guestbook:entries};delete snapshot.invitations;const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='yeosu-suncheon-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('기록을 내려받았어요.');}
  else if(name==='copy-link'){const value=$('#issued-link').textContent;try{await navigator.clipboard.writeText(value);toast('링크를 복사했어요.');}catch{toast('링크를 선택해서 복사해 주세요.');}}
}

document.addEventListener('click',async event=>{
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
    if(!canEdit())throw new Error('친구별 초대 링크로 먼저 입장해 주세요.');
    let result;
    if(type==='candidate'){result=await write('candidate',{...validateCandidate(values),poll_id:id});}
    else if(type==='confirmation')await write(form.dataset.actionName,JSON.parse(form.dataset.extra));
    else if(type==='schedule-edit')await write('schedule',{...values,id,verified:values.verified==='on'});
    else if(type==='schedule-add')await write('schedule_add',values);
    else if(type==='lodging')await write('lodging',{...values,id,verified:values.verified==='on'});
    else if(type==='participant')await write('participant',{...values,id});
    else if(type==='participant-add')await write('participant_add',values);
    else if(type==='invite'){
      result=await write('invite',{id,expires_at:fromKst(values.expires_at)});
      const issuedUrl=new URL(location.href);issuedUrl.search='';issuedUrl.hash=`invite=${result.token}`;
      const invitationUrl=issuedUrl.href;
      showDialog('초대 링크가 준비됐어요',`<p class="dialog-description">${state.repo.demo?'데모 링크예요. 실제 친구 초대에는 사용할 수 없어요.':'링크는 지금만 표시돼요. 해당 친구에게 전달할 수 있도록 복사해 두세요.'}</p><p id="issued-link" class="notice invite-link">${e(invitationUrl)}</p>${button('링크 복사','copy-link','','primary')}`);
      return;
    }
    else if(['expense-create','expense-edit'].includes(type)){const input=validateExpense({...values,occurred_at:fromKst(`${values.expense_date}T${values.expense_time}`),participant_ids:new FormData(form).getAll('participant_ids')},state.data.participants);await write(type==='expense-create'?'expense_create':'expense_edit',{...input,id,request_id:form.dataset.requestId});}
    else if(type==='guestbook-create'){const content=validateMessage(values.content);await write('guestbook_create',{content,request_id:state.requestId});state.guestDraft='';state.requestId=newId();const input=$('#guest-content');if(input)input.value='';render();}
    else if(type==='guest-edit')await write('guestbook_edit',{id,content:validateMessage(values.content)});
    else if(type==='reset'){await state.repo.reset();state.section='schedule';await refresh();}
    $('#dialog').close();toast(state.repo.demo?'데모에 저장했어요.':'저장했어요.');
  }catch(error){if(form.isConnected)form.querySelector('.form-error').textContent=error.message;else toast(error.message);}
  finally{lockUi(false);}
});
document.addEventListener('input',event=>{if(event.target.id==='guest-content')state.guestDraft=event.target.value;});
document.addEventListener('change',async event=>{if(event.target.name==='split_mode'){const box=$('#split-people');if(box)box.hidden=event.target.value!=='some';}if(event.target.id==='demo-person'){await state.repo.selectParticipant(event.target.value);state.guestDraft='';state.pollId=null;state.requestId=newId();await refresh();}});
window.addEventListener('hashchange',()=>{const target=location.hash.slice(1);if(['schedule','votes','lodgings','budget','guestbook','settings'].includes(target)){state.section=target;state.pollId=null;render();}});
window.addEventListener('online',()=>{toast('연결이 복구됐어요.');refresh();});
window.addEventListener('offline',()=>{renderConnection();toast('오프라인이에요. 작성 중인 내용은 유지돼요.');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
async function start() {
  try{
    const config=window.TRIP_CONFIG||{};
    const hasUrl=Boolean(config.supabaseUrl),hasKey=Boolean(config.supabaseKey);
    const target=location.hash.slice(1);if(['schedule','votes','lodgings','budget','guestbook','settings'].includes(target))state.section=target;
    if(hasUrl||hasKey){showPublicPreview();render();}
    if(hasUrl!==hasKey)throw new Error('서비스 설정이 일부만 입력되어 있어요. URL과 공개 키를 모두 설정해 주세요.');
    state.repo=hasUrl?await SupabaseRepository.create(config):new DemoRepository();
    if(inviteToken&&state.repo.demo){state.error='데모에서는 실제 초대 링크 인증을 사용할 수 없어요.';inviteToken=null;toast(state.error);}
    if(inviteToken){await state.repo.redeem(inviteToken);inviteToken=null;}
    await refresh();if(canEdit()&&!state.unsubscribe)subscribe();
    expiryTimer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
  }catch(error){state.error=error.message;showPublicPreview();render();}
}
window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(expiryTimer);state.unsubscribe?.();}});
start();
