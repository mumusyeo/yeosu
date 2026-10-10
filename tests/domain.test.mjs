import test from 'node:test';
import assert from 'node:assert/strict';
import { pollResult,resultLabel,safeUrl,escapeHtml,validateCandidate,validateMessage } from '../docs/domain.js';
import { createSeed } from '../docs/seed.js';

test('photo itinerary preserves latest train bookings and eight empty polls',()=>{
  const s=createSeed();assert.equal(s.polls.length,8);assert.equal(s.participants.length,8);assert.equal(s.votes.length,0);
  const trains=s.schedule.filter(i=>i.kind==='train');assert.deepEqual(trains.map(i=>[i.title,i.start_time,i.end_time]),[['용산 → 여수EXPO','07:43','11:23'],['순천 → 서울','16:08','18:56']]);
  assert.equal(s.lodgings[0].url,'https://www.airbnb.co.kr/rooms/959847712327131849');assert.equal(s.lodgings[1].url,'https://map.naver.com/p/entry/place/2048015818');
  assert.equal(s.schedule[1].start_time,'11:50');assert.match(s.schedule[1].description,/B9~10/);assert.equal(s.schedule[20].start_time,'15:50');assert.match(s.schedule[20].description,/188-35/);assert(s.participants.every(p=>!p.role));
});
test('zero votes do not choose a winner, tie is distinct from a single leader',()=>{
  const s=createSeed(),p=s.polls[0],[a,b]=s.candidates;
  assert.equal(pollResult(p,s.candidates,[]).kind,'waiting');
  const votes=[{poll_id:p.id,candidate_id:a.id},{poll_id:p.id,candidate_id:b.id}];
  assert.equal(pollResult(p,s.candidates,votes).kind,'tie');
  votes.push({poll_id:p.id,candidate_id:a.id});const r=pollResult(p,s.candidates,votes);assert.equal(r.kind,'leader');assert.equal(r.leaders[0].id,a.id);assert.equal(r.count,2);
  assert.equal(resultLabel(r,p),'현재 1위 · 2표');
});
test('hidden choices never contribute and old confirmation never overrides live leader',()=>{
  const s=createSeed(),p=s.polls[0],[a,b]=s.candidates;const votes=[{poll_id:p.id,candidate_id:a.id},{poll_id:p.id,candidate_id:a.id},{poll_id:p.id,candidate_id:b.id}];
  a.hidden=true;assert.equal(pollResult(p,s.candidates,votes).leaders[0].id,b.id);
  a.hidden=false;p.confirmed_candidate_id=b.id;p.status='closed';assert.equal(pollResult(p,s.candidates,votes).kind,'leader');assert.equal(pollResult(p,s.candidates,votes).leaders[0].id,a.id);
});
test('live result label has no deadline, closing or confirmation state',()=>{
  const p={status:'closed',deadline:'2020-11-06T00:00:00Z',confirmed_candidate_id:'x'};
  assert.equal(resultLabel({kind:'leader',count:2},p),'현재 1위 · 2표');assert.equal(resultLabel({kind:'tie',count:1},p),'공동 1위 · 각 1표');
});
test('unsafe URL schemes and executable markup are rejected or escaped',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,<script>','/relative'])assert.equal(safeUrl(url),'');
  assert.equal(safeUrl('https://map.naver.com/'),'https://map.naver.com/');assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
  assert.throws(()=>validateCandidate({name:'a',url:'javascript:x',price:'',description:''}));
  assert.throws(()=>validateCandidate({name:'a',url:'',price:'-1',description:''}));assert.throws(()=>validateCandidate({name:'a',url:'',price:'1.5',description:''}));
  assert.throws(()=>validateMessage('  '));assert.throws(()=>validateMessage('a'.repeat(1001)));assert.equal(validateMessage(' hello '),'hello');
});
