import { createSeed, TRIP_ID } from './seed.js';
import { normalizeName, validateCandidate, validateMessage, safeUrl, newId, validateNickname } from './domain.js';
import { validateExpense, allocate } from './expenses.js';

const DEMO_KEY = 'namjjok-demo-v1';
const clone = value => structuredClone(value);
function upgradeDemo(data) {
  if(data.schema_version===5)return data;
  const seed=createSeed();
  if(data.schema_version!==4){
  data.expenses ||= [];data.expense_splits ||= [];
  data.participants.forEach((p,i)=>{if(p.name==='주최자'||p.name===`친구 ${i}`)p.name=`친구 ${i+1}`;delete p.role;if(p.is_placeholder===undefined)p.is_placeholder=/^친구 [1-8]$/.test(p.name);});
  data.polls.forEach(p=>{delete p.status;delete p.deadline;delete p.confirmed_candidate_id;delete p.decision_reason;});
  for(const index of [1,20]){const row=data.schedule.find(s=>s.id===seed.schedule[index].id);if(row)Object.assign(row,{title:seed.schedule[index].title,description:seed.schedule[index].description,start_time:seed.schedule[index].start_time,verified:true});}
  for(const person of seed.participants){const existing=data.participants.find(p=>p.id===person.id);if(existing)Object.assign(existing,{name:person.name,is_placeholder:false});}
  for(const index of [8,10,15]){const row=data.schedule.find(s=>s.id===seed.schedule[index].id);if(row)row.title=seed.schedule[index].title;}
  const lodging=data.lodgings.find(l=>l.id===seed.lodgings[1].id);if(lodging)Object.assign(lodging,{name:seed.lodgings[1].name,notes:seed.lodgings[1].notes});
  const stay=data.schedule.find(s=>s.id===seed.schedule[16].id);if(stay)stay.description=seed.schedule[16].description;
  data.trip.title=seed.trip.title;delete data.me;delete data.invitations;
  }
  // Settlement members: the initial friends and anyone who already paid.
  data.participants.forEach(p=>{p.in_settlement=seed.participants.some(s=>s.id===p.id)||data.expenses.some(x=>x.paid_by===p.id&&!x.deleted_at);});
  data.schema_version=5;return data;
}
export class DemoRepository {
  constructor() {
    this.demo = true;
    this.memory = null;
    this.onchange = () => {};
    this.listener = event => { if (event.key === DEMO_KEY) this.onchange(); };
    window.addEventListener('storage', this.listener);
  }
  read() {
    try { const data = JSON.parse(localStorage.getItem(DEMO_KEY)); if (data?.trip?.id === TRIP_ID && Array.isArray(data.schedule)) return upgradeDemo(data); } catch { /* corrupted or disabled storage */ }
    return this.memory || createSeed();
  }
  write(data) { this.memory = clone(data); try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch { /* memory demo still usable */ } }
  async snapshot() { const data=clone(this.read());delete data.invitations;return {...data,me:null,expense_account_numbers:true,expense_bank_names:true,server_time:new Date().toISOString()}; }
  async guestbook(limit=20) { return clone(this.read().guestbook.filter(e=>!e.deleted_at).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,limit)); }
  async mutate(action, payload) {
    const work = async () => {
      const data=clone(this.read()),anonymous=['schedule','schedule_add','lodging'].includes(action),nickname=anonymous?'':validateNickname(payload.nickname);
      const knownActions=['vote','candidate','guestbook_create','guestbook_edit','guestbook_delete','hide_candidate','schedule','schedule_add','lodging','participant','participant_add','expense_create','expense_edit','expense_delete'];
      if(!knownActions.includes(action))throw new Error('지원하지 않는 작업이에요.');
      let me=data.participants.find(p=>normalizeName(p.name)===normalizeName(nickname));
      if(!anonymous){
        if(!me){me=data.participants.find(p=>p.is_placeholder);if(me){me.name=nickname;me.is_placeholder=false;}else{me={id:newId(),trip_id:TRIP_ID,name:nickname,active:true,is_placeholder:false,in_settlement:false};data.participants.push(me);}}
        me.active=true;me.is_placeholder=false;
      }
      const pollFor = () => { const p = data.polls.find(p => p.id === payload.poll_id); if (!p) throw new Error('투표를 찾을 수 없어요.'); return p; };
      const now = new Date().toISOString();
      let result = null;
      if (action === 'vote') {
        const p = pollFor();
        if (payload.candidate_id && !data.candidates.some(c => c.id === payload.candidate_id && c.poll_id === p.id && !c.hidden)) throw new Error('선택 가능한 후보가 아니에요.');
        data.votes = data.votes.filter(v => !(v.poll_id === p.id && v.participant_id === me.id));
        if (payload.candidate_id) data.votes.push({ id: newId(), trip_id:TRIP_ID, poll_id:p.id, participant_id:me.id, candidate_id:payload.candidate_id, updated_at:now });
      } else if (action === 'candidate') {
        const p = pollFor(); const input = validateCandidate(payload);
        if (data.candidates.some(c => c.poll_id === p.id && normalizeName(c.name) === normalizeName(input.name))) throw new Error('이미 등록된 장소예요.');
        data.candidates.push({ ...input, id:newId(), trip_id:TRIP_ID, poll_id:p.id, created_by:me.id, created_at:now, hidden:false });
      } else if (action === 'guestbook_create') {
        const content = validateMessage(payload.content);
        if (data.guestbook.some(e => e.request_id === payload.request_id && e.participant_id === me.id)) return null;
        if (data.guestbook.some(e => e.participant_id === me.id && Date.now() - Date.parse(e.created_at) < 10000)) throw new Error('메시지는 10초에 한 번 남길 수 있어요.');
        data.guestbook.push({ id:newId(), trip_id:TRIP_ID, participant_id:me.id, content, request_id:payload.request_id, created_at:now, updated_at:now, deleted_at:null });
      } else if (['guestbook_edit','guestbook_delete'].includes(action)) {
        const entry = data.guestbook.find(e => e.id === payload.id && !e.deleted_at);
        if (!entry) throw new Error('이 글을 변경할 권한이 없어요.');
        if (action === 'guestbook_edit') { entry.content = validateMessage(payload.content); entry.updated_at = now; } else entry.deleted_at = now;
      } else if (action === 'hide_candidate') {
        const c = data.candidates.find(c => c.id === payload.id); if (!c) throw new Error('후보를 찾을 수 없어요.');
        c.hidden=Boolean(payload.hidden);
      } else if (action === 'schedule') {
        const item = data.schedule.find(i => i.id === payload.id); if (!item) throw new Error('일정을 찾을 수 없어요.');
        if (!payload.title.trim() || payload.title.length>100) throw new Error('일정 제목은 1~100자예요.');
        if (!['2026-11-06','2026-11-07','2026-11-08'].includes(payload.date)) throw new Error('여행 날짜를 선택해 주세요.');
        Object.assign(item, { title:payload.title.trim(), description:payload.description, date:payload.date, start_time:payload.start_time || null, end_time:payload.end_time || null, verified:Boolean(payload.verified), position:Number(payload.position) });
      } else if (action === 'schedule_add') {
        if (!payload.title.trim()) throw new Error('제목을 입력해 주세요.');
        const id=newId();
        data.schedule.push({ id, trip_id:TRIP_ID, date:payload.date, title:payload.title.trim(), description:payload.description || '', start_time:null, end_time:null, verified:false, kind:payload.kind, position:Math.max(...data.schedule.map(s=>s.position))+1, lodging_id:null });
        if (['food','cafe'].includes(payload.kind)) data.polls.push({id:newId(),trip_id:TRIP_ID,schedule_id:id});
      } else if (action === 'lodging') {
        const l = data.lodgings.find(l=>l.id===payload.id); if (!l) throw new Error('숙소를 찾을 수 없어요.');
        if (!safeUrl(payload.url)) throw new Error('올바른 숙소 링크를 입력해 주세요.'); Object.assign(l,{name:payload.name.trim(),notes:payload.notes,url:safeUrl(payload.url),verified:Boolean(payload.verified)});
      } else if (action === 'participant') {
        const person = data.participants.find(p=>p.id===payload.id); if(!person) throw new Error('참여자를 찾을 수 없어요.');
        if (!payload.name.trim() || payload.name.length>40) throw new Error('이름은 1~40자예요.');
        const name=validateNickname(payload.name);if(data.participants.some(p=>p.id!==person.id&&normalizeName(p.name)===normalizeName(name)))throw new Error('이미 사용하는 닉네임이에요.');person.name=name;person.is_placeholder=false;
      } else if (action === 'participant_add') {
        if(!payload.name.trim() || payload.name.length>40) throw new Error('이름은 1~40자예요.');
        const name=validateNickname(payload.name);if(!data.participants.some(p=>normalizeName(p.name)===normalizeName(name))){const slot=data.participants.find(p=>p.is_placeholder);if(slot){slot.name=name;slot.is_placeholder=false;}else data.participants.push({id:newId(),trip_id:TRIP_ID,name,active:true,is_placeholder:false,in_settlement:false});}
      } else if (['expense_create','expense_edit'].includes(action)) {
        if(action==='expense_create'&&data.expenses.some(x=>x.request_id===payload.request_id&&x.paid_by===me.id))return null;
        if(action==='expense_create'&&data.expenses.some(x=>x.request_id===payload.request_id))throw new Error('다른 결제 내역의 요청 식별자예요.');
        // Only paying for something adds a nickname to the settlement members.
        if(action==='expense_create')me.in_settlement=true;
        const input=validateExpense(payload,data.participants);
        let expense;
        if(action==='expense_edit'){
          expense=data.expenses.find(x=>x.id===payload.id&&!x.deleted_at);
          if(!expense)throw new Error('결제 내역을 찾을 수 없어요.');
        }else{
          if(!payload.request_id)throw new Error('요청 식별자가 필요해요.');
          expense={id:newId(),trip_id:TRIP_ID,paid_by:me.id,request_id:payload.request_id,created_at:now,deleted_at:null};data.expenses.push(expense);
        }
        Object.assign(expense,{item:input.item,amount:input.amount,bank_name:input.bank_name,account_number:input.account_number,occurred_at:input.occurred_at,split_mode:input.split_mode,updated_at:now});
        data.expense_splits=data.expense_splits.filter(s=>s.expense_id!==expense.id);
        data.expense_splits.push(...allocate(input.amount,input.participant_ids).map(split=>({...split,id:newId(),trip_id:TRIP_ID,expense_id:expense.id})));
      } else if(action==='expense_delete'){
        const expense=data.expenses.find(x=>x.id===payload.id&&!x.deleted_at);
        if(!expense)throw new Error('결제 내역을 찾을 수 없어요.');
        expense.deleted_at=now;expense.updated_at=now;
      }
      else throw new Error('지원하지 않는 작업이에요.');
      this.write(data); this.onchange(); return result;
    };
    return navigator.locks ? navigator.locks.request('namjjok-demo-write', work) : work();
  }
  subscribe(callback) { this.onchange=callback; return ()=>{this.onchange=()=>{};window.removeEventListener('storage',this.listener);}; }
  async reset() { this.write(createSeed()); }
}

function loadSdk() {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./vendor/supabase.js';script.onload=resolve;script.onerror=()=>reject(new Error('인증 모듈을 불러오지 못했어요. 새로고침해 주세요.'));document.head.append(script);});
}
export class SupabaseRepository {
  constructor(client,tripId) { this.client=client;this.tripId=tripId;this.demo=false;this.channel=null; }
  static async create(config) {
    await loadSdk();
    return new SupabaseRepository(window.supabase.createClient(config.supabaseUrl,config.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),config.tripId);
  }
  async rpc(name,args) { const {data,error}=await this.client.rpc(name,args);if(error){const failure=new Error(['PGRST202','42501'].includes(error.code)?'공유 데이터 설정이 필요해요. 기본 일정은 계속 볼 수 있어요.':error.message);failure.code=error.code;throw failure;}return data; }
  async snapshot() { return this.rpc('trip_snapshot',{p_trip:this.tripId}); }
  async guestbook(limit=20) { return this.rpc('trip_guestbook',{p_trip:this.tripId,p_limit:limit}); }
  async mutate(action,payload) { return this.rpc('trip_mutate',{p_trip:this.tripId,p_action:action,p_payload:payload}); }
  subscribe(callback,statusCallback) {
    if(this.channel) this.client.removeChannel(this.channel);
    this.channel=this.client.channel(`trip-${this.tripId}`);
    ['trips','participants','schedule_items','lodgings','polls','candidates','votes','guestbook_entries','expenses','expense_splits'].forEach(table=>{
      for(const event of ['INSERT','UPDATE'])this.channel.on('postgres_changes',{event,schema:'public',table,filter:`${table==='trips'?'id':'trip_id'}=eq.${this.tripId}`},callback);
    });
    this.channel.subscribe(status=>{statusCallback?.(status);if(status==='SUBSCRIBED')callback();});
    return ()=>{if(this.channel){this.client.removeChannel(this.channel);this.channel=null;}};
  }
}
