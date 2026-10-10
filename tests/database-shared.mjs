import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createSeed } from '../docs/seed.js';
import { allocate,balanceSheet } from '../docs/expenses.js';
const db=new PGlite();
const authStub=`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`;
await db.exec(authStub);
for(const file of ['migrations/001_trip.sql','migrations/002_shared_expenses.sql','seed.sql'])await db.exec(readFileSync(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
const s=createSeed(),trip=s.trip.id,otherTrip='a0000000-0000-4000-8000-000000000002';
const userA='10000000-0000-4000-8000-000000000001',userB='10000000-0000-4000-8000-000000000002',userA2='10000000-0000-4000-8000-000000000003',outsider='10000000-0000-4000-8000-000000000004';
await db.query('insert into auth.users(id) select unnest($1::uuid[])',[[userA,userB,userA2,outsider]]);
await db.query("insert into public.trips values($1,'Another trip','2026-11-06','2026-11-08','Asia/Seoul')",[otherTrip]);
const tokenA=(await db.query('select trip_private.bootstrap_invite($1,$2) as token',[trip,s.participants[0].id])).rows[0].token;
const tokenB=(await db.query('select trip_private.bootstrap_invite($1,$2) as token',[trip,s.participants[1].id])).rows[0].token;
let passed=0;const check=async(label,fn)=>{await fn();console.log('PASS '+label);passed++;};
const as=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await db.exec(uid?'set role authenticated':'set role anon');};
const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data;
const mutate=(action,payload)=>rpc('trip_mutate',[trip,action,payload]);
const snap=()=>rpc('trip_snapshot',[trip]),reject=(fn,re)=>assert.rejects(fn,re);
const poll=s.polls[0],a=s.candidates[0],b=s.candidates[1];
await check('uninvited sessions cannot read/write or bootstrap access',async()=>{
  await as(null);await reject(()=>snap(),/permission denied/);await as(outsider);await reject(()=>snap(),/권한/);assert.equal((await db.query('select * from public.expenses')).rows.length,0);
  await reject(()=>db.query('select trip_private.bootstrap_invite($1,$2)',[trip,s.participants[0].id]),/permission denied/);await reject(()=>db.query('select * from trip_private.invitations'),/permission denied/);
});
await check('equal permissions and two devices resolve to one participant',async()=>{
  for(const uid of [userA,userA2]){await as(uid);assert.equal((await rpc('redeem_invite',[tokenA])).ok,true);assert.equal((await snap()).me.id,s.participants[0].id);}
  await as(userB);assert.equal((await rpc('redeem_invite',[tokenB])).ok,true);assert.equal((await snap()).me.id,s.participants[1].id);
  assert((await snap()).participants.every(p=>!('role' in p)));assert((await snap()).polls.every(p=>!('status' in p)&&!('deadline' in p)));
});
await check('continuously editable votes and one vote per participant',async()=>{
  await as(userA);await mutate('vote',{poll_id:poll.id,candidate_id:a.id});await as(userA2);await mutate('vote',{poll_id:poll.id,candidate_id:b.id});assert.equal((await snap()).votes.length,1);
  await mutate('vote',{poll_id:poll.id,candidate_id:null});assert.equal((await snap()).votes.length,0);
  await as(userA);await mutate('vote',{poll_id:poll.id,candidate_id:a.id});await as(userB);await mutate('vote',{poll_id:poll.id,candidate_id:b.id});
  await reject(()=>mutate('poll',{poll_id:poll.id,operation:'close'}),/지원하지/);await reject(()=>mutate('poll',{poll_id:poll.id,operation:'confirm',candidate_id:b.id}),/지원하지/);
  await mutate('vote',{poll_id:poll.id,candidate_id:a.id});await mutate('vote',{poll_id:poll.id,candidate_id:b.id});
});
await check('direct writes, cross-trip access and mismatched candidates are rejected',async()=>{
  await reject(()=>db.query('update public.votes set candidate_id=null'),/permission denied/);await reject(()=>rpc('trip_snapshot',[otherTrip]),/권한/);await reject(()=>mutate('vote',{poll_id:s.polls[1].id,candidate_id:a.id}),/선택 가능한/);
});
await check('candidate validation and own-only hiding are server enforced',async()=>{
  const payload={poll_id:poll.id,name:'새 카페',url:'https://example.com',price:5000,description:'좋아요'};
  await as(userA);await mutate('candidate',payload);await reject(()=>mutate('candidate',{...payload,name:'  새   카페  '}),/이미 등록/);await reject(()=>mutate('candidate',{...payload,name:'Unsafe',url:'javascript:alert(1)'}),/check constraint/);
  const c=(await snap()).candidates.find(c=>c.name==='새 카페');await as(userB);await reject(()=>mutate('hide_candidate',{id:c.id,hidden:true}),/직접 추천/);
  await as(userA);await mutate('hide_candidate',{id:c.id,hidden:true});await mutate('hide_candidate',{id:c.id,hidden:false});
});
await check('guestbook retry deduplication, throttle and own-only editing/deletion',async()=>{
  await as(userA);const request_id=crypto.randomUUID();await mutate('guestbook_create',{content:'<script>x</script>',request_id});await mutate('guestbook_create',{content:'duplicate',request_id});let entries=await rpc('trip_guestbook',[trip,20]);assert.equal(entries.length,1);
  await reject(()=>mutate('guestbook_create',{content:'too soon',request_id:crypto.randomUUID()}),/10초/);
  await as(userB);await reject(()=>mutate('guestbook_edit',{id:entries[0].id,content:'no'}),/권한/);await reject(()=>mutate('guestbook_delete',{id:entries[0].id}),/권한/);
  await as(userA);await mutate('guestbook_edit',{id:entries[0].id,content:'edited'});await mutate('guestbook_delete',{id:entries[0].id});assert.equal((await rpc('trip_guestbook',[trip,20])).length,0);
});
let expenseA,expenseB;
await check('all expense targets, exact integer allocation, idempotency and forged payer',async()=>{
  await as(userA);const request_id=crypto.randomUUID(),payload={item:'숙소',amount:1001,occurred_at:'2026-11-06T12:00:00+09:00',split_mode:'all',request_id,paid_by:s.participants[1].id};
  await mutate('expense_create',payload);await mutate('expense_create',payload);const d=await snap();assert.equal(d.expenses.length,1);expenseA=d.expenses[0];assert.equal(expenseA.paid_by,s.participants[0].id);
  assert.equal(d.expense_splits.length,8);assert.equal(d.expense_splits.reduce((n,x)=>n+x.amount,0),1001);assert.deepEqual(d.expense_splits.map(x=>({participant_id:x.participant_id,amount:x.amount})),allocate(1001,s.participants.map(p=>p.id)));
});
await check('some targets can exclude payer; invalid targets, amounts and raw edits fail',async()=>{
  await as(userB);const payload={item:'커피',amount:600,occurred_at:'2026-11-07T09:30:00+09:00',split_mode:'some',participant_ids:[s.participants[0].id,s.participants[2].id],request_id:crypto.randomUUID()};
  await mutate('expense_create',payload);expenseB=(await snap()).expenses.find(x=>x.item==='커피');const d=await snap();assert.equal(d.expense_splits.filter(x=>x.expense_id===expenseB.id).length,2);
  await reject(()=>mutate('expense_create',{...payload,request_id:crypto.randomUUID(),participant_ids:[]}),/한 명/);await reject(()=>mutate('expense_create',{...payload,request_id:crypto.randomUUID(),participant_ids:[otherTrip]}),/참여 중/);
  for(const amount of [0,-1,1.5])await reject(()=>mutate('expense_create',{...payload,request_id:crypto.randomUUID(),amount}),/정수|invalid input/);
  await reject(()=>db.query('update public.expense_splits set amount=0'),/permission denied/);const r=balanceSheet(d.expenses,d.expense_splits,d.participants);assert.equal(r.total,1601);assert.equal(r.rows.reduce((n,x)=>n+x.net,0),0);
});
await check('expense ownership, changed splits and rollback preserve exact sum',async()=>{
  await as(userB);await reject(()=>mutate('expense_delete',{id:expenseA.id}),/본인의/);await reject(()=>mutate('expense_edit',{id:expenseA.id}),/본인의/);
  await as(userA);const input={id:expenseA.id,item:'숙소 수정',amount:1000,occurred_at:'2026-11-06T10:00:00+09:00',split_mode:'some',participant_ids:[s.participants[0].id,s.participants[1].id,s.participants[2].id]};
  await mutate('expense_edit',input);let d=await snap();assert.equal(d.expense_splits.filter(x=>x.expense_id===expenseA.id).reduce((n,x)=>n+x.amount,0),1000);
  await reject(()=>mutate('expense_edit',{...input,participant_ids:[otherTrip]}),/참여 중/);d=await snap();assert.equal(d.expenses.find(x=>x.id===expenseA.id).amount,1000);
  await mutate('expense_delete',{id:expenseA.id});d=await snap();assert.equal(d.expenses.length,1);assert.equal(d.expense_splits.length,2);
});
await check('shared schedule and lodging editing without host; own-only names',async()=>{
  await as(userB);await mutate('schedule',{id:s.schedule[3].id,date:'2026-11-06',title:'여수 산책',description:'같이 수정',position:4,start_time:'14:00',end_time:'15:00',verified:true});
  await mutate('schedule_add',{date:'2026-11-08',title:'마지막 커피',kind:'cafe'});assert.equal((await snap()).polls.length,9);
  await mutate('lodging',{id:s.lodgings[1].id,name:'숙소 확인',url:s.lodgings[1].url,notes:'메모',verified:true});await reject(()=>mutate('participant',{id:s.participants[0].id,name:'다른 이름'}),/본인의/);await mutate('participant',{id:s.participants[1].id,name:'친구 B'});
});
await check('added participant does not change captured expense audience',async()=>{
  await as(userA);await mutate('participant_add',{name:'새 친구'});const d=await snap();assert.equal(d.participants.length,9);assert.equal(d.expense_splits.filter(x=>x.expense_id===expenseB.id).length,2);
});
await check('invitation rotation and expiry invalidate previously connected devices',async()=>{
  await as(userB);const next=(await mutate('invite',{id:s.participants[0].id})).token;await as(userA);await reject(()=>snap(),/권한/);assert.equal((await rpc('redeem_invite',[tokenA])).ok,false);assert.equal((await rpc('redeem_invite',[next])).ok,true);
  await as(userA2);await reject(()=>snap(),/권한/);assert.equal((await db.query('select * from public.expenses')).rows.length,0);await as(userB);await mutate('revoke_invite',{id:s.participants[0].id});await as(userA);await reject(()=>snap(),/권한/);
  await db.exec('reset role');await db.query("update trip_private.invitations set expires_at=now()-interval '1 minute' where participant_id=$1",[s.participants[1].id]);await as(userB);await reject(()=>snap(),/권한/);
});
await db.exec('reset role');const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','trip_private') and c.relkind='r'")).rows;assert(tables.every(t=>t.relrowsecurity));
await db.exec(readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8'));assert.equal((await db.query('select title from public.schedule_items where id=$1',[s.schedule[3].id])).rows[0].title,'여수 산책');
await db.close();
await check('one-file fresh setup creates eight distinct links and refuses destructive re-installation',async()=>{
  const fresh=new PGlite();await fresh.exec(authStub);
  const setup=readFileSync(new URL('../supabase/setup.sql',import.meta.url),'utf8');
  const results=await fresh.exec(setup),links=results.at(-1).rows;
  assert.equal(links.length,8);assert.equal(new Set(links.map(x=>x.invite_url)).size,8);
  assert(links.every(x=>/^https:\/\/mumusyeo\.github\.io\/yeosu\/#invite=[a-f0-9]{64}$/.test(x.invite_url)));
  assert.equal((await fresh.query('select count(*)::integer as n from public.schedule_items')).rows[0].n,22);
  await assert.rejects(()=>fresh.exec(setup),/already exist/);
  await fresh.exec('rollback');assert.equal((await fresh.query('select count(*)::integer as n from trip_private.invitations')).rows[0].n,8);
  await fresh.close();
});
console.log(`${passed} PostgreSQL/PGlite scenarios passed.`);
