import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate,balanceSheet,validateExpense,renderBudget } from '../docs/expenses.js';
test('won remainder is deterministic and preserves exact amount',()=>{
  assert.deepEqual(allocate(1001,['b','a','c']),[{participant_id:'a',amount:334},{participant_id:'b',amount:334},{participant_id:'c',amount:333}]);
  assert.deepEqual(allocate(1,['c','b','a']),[{participant_id:'a',amount:1},{participant_id:'b',amount:0},{participant_id:'c',amount:0}]);
});
test('all captures active roster, some rejects empty/foreign targets and invalid amounts',()=>{
  const people=[{id:'a',active:true},{id:'b',active:true},{id:'c',active:false}],p={item:'점심',amount:1001,occurred_at:'2026-11-06T12:00:00+09:00',split_mode:'all'};
  assert.deepEqual(validateExpense(p,people).participant_ids,['a','b']);
  assert.throws(()=>validateExpense({...p,split_mode:'some',participant_ids:[]},people),/한 명/);assert.throws(()=>validateExpense({...p,split_mode:'some',participant_ids:['c']},people),/참여 중/);
  for(const amount of [-1,0,1.5,NaN,Infinity,2147483648])assert.throws(()=>validateExpense({...p,amount},people));
});
test('nicknames outside the settlement members are not split targets or counted',()=>{
  const people=[{id:'a',name:'밀로',active:true,in_settlement:true},{id:'g',name:'방명록 손님',active:true,in_settlement:false}],p={item:'점심',amount:1000,occurred_at:'2026-11-06T12:00:00+09:00',split_mode:'all'};
  assert.deepEqual(validateExpense(p,people).participant_ids,['a']);assert.throws(()=>validateExpense({...p,split_mode:'some',participant_ids:['g']},people),/참여 중/);
  const html=renderBudget({expenses:[],expense_splits:[],participants:people},null);assert(html.includes('1명'));assert(!html.includes('방명록 손님'));
});
test('payer may be excluded; balances and transfers sum exactly; deletion excluded',()=>{
  const expenses=[{id:'x',paid_by:'a',amount:1001},{id:'y',paid_by:'b',amount:600}],splits=[...allocate(1001,['b','c']).map(s=>({...s,expense_id:'x'})),...allocate(600,['a','b','c']).map(s=>({...s,expense_id:'y'}))],people=['a','b','c'].map(id=>({id,name:id,active:true}));
  const r=balanceSheet(expenses,splits,people);assert.equal(r.total,1601);assert.equal(r.rows.reduce((n,p)=>n+p.net,0),0);assert.deepEqual(r.rows.map(p=>p.net),[801,-101,-700]);
  for(const p of r.rows){const incoming=r.transfers.filter(t=>t.to===p.id).reduce((n,t)=>n+t.amount,0),outgoing=r.transfers.filter(t=>t.from===p.id).reduce((n,t)=>n+t.amount,0);assert.equal(incoming-outgoing,p.net);}
  expenses[0].deleted_at='2026-11-01';assert.equal(balanceSheet(expenses,splits,people).total,600);
});

test('optional account details survive validation and render safely in chronological order',()=>{
  const people=[{id:'p',name:'밀로',active:true}],input={item:'점심',amount:1000,occurred_at:'2026-11-06T12:00:00+09:00',split_mode:'all'};
  assert.equal(validateExpense(input,people).account_number,'');assert.equal(validateExpense({...input,account_number:'  은행 001-23  '},people).account_number,'은행 001-23');assert.throws(()=>validateExpense({...input,account_number:'x'.repeat(101)},people),/100자/);
  const rows=[{id:'b',item:'늦은 내역',amount:1000,paid_by:'p',occurred_at:'2026-11-06T15:00:00+09:00',created_at:'2026-10-10T00:00:00Z',account_number:'<script>bad</script>'},{id:'a',item:'빠른 내역',amount:1000,paid_by:'p',occurred_at:'2026-11-06T04:00:00Z',created_at:'2026-10-10T01:00:00Z'}];
  const html=renderBudget({expenses:rows,expense_splits:[],participants:people},null);assert(html.indexOf('빠른 내역')<html.indexOf('늦은 내역'));assert(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert(!html.includes('<script>bad'));
});
