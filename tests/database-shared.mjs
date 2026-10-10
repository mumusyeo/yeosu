import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createSeed } from '../docs/seed.js';
import { allocate,balanceSheet } from '../docs/expenses.js';
const read=file=>readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8');
const authStub=`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`;
const db=new PGlite();await db.exec(authStub);
for(const file of ['migrations/001_trip.sql','migrations/002_shared_expenses.sql','seed.sql'])await db.exec(read(file));
// Model the roster in the previous release before applying the nickname migration.
await db.exec("update public.participants set name='친구 '||right(id::text,1)");
const seed=createSeed(),trip=seed.trip.id,poll=seed.polls[0],[a,b]=seed.candidates;
await db.query('insert into public.votes(trip_id,poll_id,participant_id,candidate_id) values($1,$2,$3,$4)',[trip,poll.id,seed.participants[0].id,a.id]);
await db.exec(read('migrations/003_nickname_board.sql'));
let passed=0;const check=async(name,fn)=>{await fn();console.log('PASS '+name);passed++;};
const role=async name=>{await db.exec('reset role');await db.exec('set role '+name);};
const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data;
const snap=()=>rpc('trip_snapshot',[trip]),mutate=(action,payload)=>rpc('trip_mutate',[trip,action,payload]);
await check('upgrade preserves votes while removing invitation tables/functions',async()=>{
  assert.equal((await db.query('select count(*)::integer n from public.votes')).rows[0].n,1);
  assert.equal((await db.query("select to_regprocedure('public.redeem_invite(text)') f")).rows[0].f,null);
  assert.equal((await db.query("select to_regclass('trip_private.invitations') t")).rows[0].t,null);
  await db.exec('delete from public.votes');
});
await check('anonymous and authenticated callers have identical read access without login',async()=>{
  for(const name of ['anon','authenticated']){await role(name);const data=await snap();assert.equal(data.schedule.length,22);assert.equal(data.me,null);assert(!('invitations' in data));assert.equal((await db.query('select * from public.participants')).rows.length,8);}
});
await check('nickname required; failed mutations cannot consume an empty participant slot',async()=>{
  await role('anon');await assert.rejects(()=>mutate('vote',{poll_id:poll.id,candidate_id:a.id}),/닉네임/);
  await assert.rejects(()=>mutate('vote',{nickname:'x'.repeat(41),poll_id:poll.id,candidate_id:a.id}),/닉네임/);
  await assert.rejects(()=>mutate('vote',{nickname:'실패',poll_id:poll.id,candidate_id:'d0000000-0000-4000-8000-000000099999'}),/선택 가능한/);
  assert((await snap()).participants.every(p=>p.is_placeholder));
});
await check('normalized nicknames reuse one vote across browsers and retain eight initial slots',async()=>{
  await mutate('vote',{nickname:'  Sea   Friend\t',poll_id:poll.id,candidate_id:a.id});
  await mutate('vote',{nickname:'sea friend',poll_id:poll.id,candidate_id:b.id});
  let data=await snap();assert.equal(data.participants.length,8);assert.equal(data.votes.length,1);assert.equal(data.votes[0].candidate_id,b.id);
  assert.equal(data.participants.find(p=>!p.is_placeholder).name,'Sea Friend');
  await mutate('vote',{nickname:'sea friend',poll_id:poll.id,candidate_id:null});assert.equal((await snap()).votes.length,0);
  await mutate('vote',{nickname:'갈대',poll_id:poll.id,candidate_id:a.id});
});
await check('all writers can recommend/hide/restore candidates; invalid links and duplicates rejected',async()=>{
  await mutate('candidate',{nickname:'바다',poll_id:poll.id,name:'공동 카페',url:'https://example.com',description:'같이 가요'});
  const candidate=(await snap()).candidates.find(c=>c.name==='공동 카페');
  await mutate('hide_candidate',{nickname:'갈대',id:candidate.id,hidden:true});
  await mutate('hide_candidate',{nickname:'바다',id:candidate.id,hidden:false});
  await assert.rejects(()=>mutate('candidate',{nickname:'갈대',poll_id:poll.id,name:'공동 카페'}),/이미 등록/);
  await assert.rejects(()=>mutate('candidate',{nickname:'갈대',poll_id:poll.id,name:'Bad',url:'javascript:bad'}),/check constraint/);
});
await check('guestbook nickname, retry deduplication and equal edit/delete rights',async()=>{
  const request_id=crypto.randomUUID();await mutate('guestbook_create',{nickname:'바다',request_id,content:'메시지'});
  await mutate('guestbook_create',{nickname:'바다',request_id,content:'duplicate'});
  const entries=await rpc('trip_guestbook',[trip,20]);assert.equal(entries.length,1);
  await mutate('guestbook_edit',{nickname:'갈대',id:entries[0].id,content:'함께 수정'});
  assert.equal((await rpc('trip_guestbook',[trip,20]))[0].content,'함께 수정');
  await mutate('guestbook_delete',{nickname:'갈대',id:entries[0].id});assert.equal((await rpc('trip_guestbook',[trip,20])).length,0);
});
let expense;
await check('expenses use entered payer nickname, exact all allocation and retry deduplication',async()=>{
  const payload={nickname:'바다',item:'점심',amount:801,occurred_at:'2026-11-06T12:00:00+09:00',split_mode:'all',request_id:crypto.randomUUID(),paid_by:seed.participants[7].id};
  await mutate('expense_create',payload);await mutate('expense_create',payload);
  const data=await snap();expense=data.expenses[0];assert.equal(data.expenses.length,1);
  assert.equal(data.participants.find(p=>p.id===expense.paid_by).name,'바다');
  assert.deepEqual(data.expense_splits.map(s=>({participant_id:s.participant_id,amount:s.amount})),allocate(801,data.participants.map(p=>p.id)));
});
await check('any nickname may edit/delete an expense; payer preserved and shares recomputed atomically',async()=>{
  let data=await snap();const ids=data.participants.filter(p=>p.id!==expense.paid_by).slice(0,2).map(p=>p.id);
  await mutate('expense_edit',{nickname:'갈대',id:expense.id,item:'수정 점심',amount:1001,occurred_at:expense.occurred_at,split_mode:'some',participant_ids:ids});
  data=await snap();assert.equal(data.expenses[0].paid_by,expense.paid_by);assert.equal(data.expense_splits.length,2);
  assert.equal(data.expense_splits.reduce((n,s)=>n+s.amount,0),1001);assert.equal(balanceSheet(data.expenses,data.expense_splits,data.participants).rows.reduce((n,p)=>n+p.net,0),0);
  await assert.rejects(()=>mutate('expense_edit',{nickname:'갈대',id:expense.id,item:'bad',amount:3,occurred_at:expense.occurred_at,split_mode:'some',participant_ids:[]}),/한 명/);
  assert.equal((await snap()).expenses[0].amount,1001);
  await mutate('expense_delete',{nickname:'갈대',id:expense.id});assert.equal((await snap()).expenses.length,0);
});
await check('common schedule/lodging/name editing without a host, invite or closing actions',async()=>{
  await mutate('schedule',{nickname:'바다',id:seed.schedule[3].id,date:'2026-11-06',title:'공동 산책',position:4,verified:true});
  await mutate('lodging',{nickname:'갈대',id:seed.lodgings[1].id,name:'함께 쉬는 숙소',url:seed.lodgings[1].url});
  const person=(await snap()).participants.find(p=>p.is_placeholder);
  await mutate('participant',{nickname:'바다',id:person.id,name:'다른 친구'});
  await assert.rejects(()=>mutate('invite',{nickname:'바다',id:person.id}),/지원하지/);
  await assert.rejects(()=>mutate('poll',{nickname:'바다',poll_id:poll.id,operation:'close'}),/지원하지/);
});
await check('raw writes and other trips remain blocked; empty nickname cannot bypass mutation validation',async()=>{
  await assert.rejects(()=>db.query("update public.schedule_items set title='raw'"),/permission denied/);
  await assert.rejects(()=>rpc('trip_snapshot',['a0000000-0000-4000-8000-000000000002']),/여행을/);
  await assert.rejects(()=>mutate('schedule',{id:seed.schedule[3].id,date:'2026-11-06',title:'bad',position:4}),/닉네임/);
});
await db.exec('reset role');await db.exec(read('seed.sql'));assert.equal((await db.query('select title from public.schedule_items where id=$1',[seed.schedule[3].id])).rows[0].title,'공동 산책');
await db.exec(read('migrations/004_trip_details.sql'));
await check('details upgrade retains record IDs, applies names/lodging/categories, and does not reapply edits',async()=>{
  const data=await snap();assert.deepEqual(data.participants.filter(p=>seed.participants.some(s=>s.id===p.id)).map(p=>p.name),seed.participants.map(p=>p.name));assert.equal(data.lodgings[1].name,'온녘');assert.equal(data.schedule.find(s=>s.id===seed.schedule[8].id).title,'여수 점심');
  await db.query('update public.lodgings set notes=$1 where id=$2',['추가 메모',seed.lodgings[1].id]);await db.exec(read('migrations/004_trip_details.sql'));assert.equal((await snap()).lodgings[1].notes,'추가 메모');
});
await db.exec(read('migrations/005_expense_accounts.sql'));
await check('optional accounts persist with chronological ordering, edits, legacy payloads and rollback',async()=>{
  await role('anon');const input={nickname:'밀로',item:'계좌 확인',amount:1001,split_mode:'all',occurred_at:'2026-11-07T12:00:00+09:00',request_id:'90000000-0000-4000-8000-000000000041',account_number:'  은행 001-23  '};
  await mutate('expense_create',input);await mutate('expense_create',{...input,item:'먼저 지출',occurred_at:'2026-11-06T13:00:00+09:00',request_id:'90000000-0000-4000-8000-000000000042',account_number:''});let data=await snap();assert(data.expense_account_numbers);assert.deepEqual(data.expenses.map(e=>e.item),['먼저 지출','계좌 확인']);const expense=data.expenses[1];assert.equal(expense.account_number,'은행 001-23');
  const edit={...input,id:expense.id,occurred_at:'2026-11-06T12:00:00+09:00',account_number:'새 은행 004-56'};await mutate('expense_edit',edit);data=await snap();assert.equal(data.expenses[0].id,expense.id);assert.equal(data.expenses[0].account_number,'새 은행 004-56');
  delete edit.account_number;await mutate('expense_edit',edit);assert.equal((await snap()).expenses[0].account_number,'새 은행 004-56');
  await assert.rejects(()=>mutate('expense_edit',{...edit,account_number:'x'.repeat(101)}),/100자/);assert.equal((await snap()).expenses[0].account_number,'새 은행 004-56');
  await mutate('expense_edit',{...edit,account_number:''});assert.equal((await snap()).expenses[0].account_number,'');await db.exec('reset role');await db.exec(read('migrations/005_expense_accounts.sql'));assert.equal((await snap()).expenses.length,2);
});
await db.close();
await check('setup creates the common URL without tokens and safely repeats without overwriting edits',async()=>{
  const fresh=new PGlite();await fresh.exec(authStub);const setup=read('setup.sql'),results=await fresh.exec(setup);
  assert.equal(results.at(-1).rows[0].invitation_url,'https://mumusyeo.github.io/yeosu/');
  await fresh.exec('set role anon');const data=(await fresh.query('select public.trip_snapshot($1) data',[trip])).rows[0].data;assert.equal(data.schedule.length,22);assert.deepEqual(data.participants.map(p=>p.name),seed.participants.map(p=>p.name));assert.equal(data.lodgings[1].name,'온녘');
  await fresh.exec('reset role');await fresh.query('update public.schedule_items set title=$1 where id=$2',['기존 수정',seed.schedule[0].id]);
  await fresh.exec(setup);assert.equal((await fresh.query('select title from public.schedule_items where id=$1',[seed.schedule[0].id])).rows[0].title,'기존 수정');await fresh.close();
});
console.log(`${passed} PostgreSQL/PGlite scenarios passed.`);
