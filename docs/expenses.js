import { escapeHtml as e } from './domain.js';

export function validateExpense(input, participants) {
  const item=String(input.item||'').trim(),amount=Number(input.amount);
  if(!item || item.length>100)throw new Error('항목은 1~100자로 입력해 주세요.');
  if(!Number.isSafeInteger(amount)||amount<1||amount>2147483647)throw new Error('금액은 1원 이상의 정수로 입력해 주세요.');
  const occurred_at=input.occurred_at;
  if(!occurred_at||!Number.isFinite(Date.parse(occurred_at)))throw new Error('날짜와 시간을 입력해 주세요.');
  const mode=input.split_mode;
  if(!['all','some'].includes(mode))throw new Error('정산 대상자를 선택해 주세요.');
  const active=new Set(participants.filter(p=>p.active).map(p=>p.id));
  const ids=mode==='all'?[...active]:[...new Set(input.participant_ids||[])];
  if(!ids.length)throw new Error('정산 대상자는 한 명 이상 선택해 주세요.');
  if(ids.some(id=>!active.has(id)))throw new Error('여행에 참여 중인 대상자만 선택할 수 있어요.');
  return { item,amount,occurred_at:new Date(occurred_at).toISOString(),split_mode:mode,participant_ids:ids.sort() };
}
export function allocate(amount,ids) {
  if(!Number.isSafeInteger(amount)||amount<1||!ids.length)throw new Error('금액과 정산 대상자가 필요해요.');
  const sorted=[...new Set(ids)].sort(),base=Math.floor(amount/sorted.length),rest=amount%sorted.length;
  return sorted.map((participant_id,i)=>({participant_id,amount:base+(i<rest?1:0)}));
}
export function balanceSheet(expenses,splits,participants) {
  const activeExpenses=expenses.filter(x=>!x.deleted_at),byId=new Map(activeExpenses.map(x=>[x.id,x]));
  const rows=participants.map(p=>({id:p.id,name:p.name,active:p.active,paid:0,share:0,net:0}));
  const people=new Map(rows.map(p=>[p.id,p]));
  for(const ex of activeExpenses){const payer=people.get(ex.paid_by);if(payer)payer.paid+=Number(ex.amount);}
  for(const split of splits){if(byId.has(split.expense_id)){const person=people.get(split.participant_id);if(person)person.share+=Number(split.amount);}}
  for(const p of rows)p.net=p.paid-p.share;
  const debtors=rows.filter(p=>p.net<0).map(p=>({...p,left:-p.net})).sort((a,b)=>b.left-a.left||a.id.localeCompare(b.id));
  const creditors=rows.filter(p=>p.net>0).map(p=>({...p,left:p.net})).sort((a,b)=>b.left-a.left||a.id.localeCompare(b.id));
  const transfers=[];let i=0,j=0;
  while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].left,creditors[j].left);transfers.push({from:debtors[i].id,to:creditors[j].id,amount});debtors[i].left-=amount;creditors[j].left-=amount;if(!debtors[i].left)i++;if(!creditors[j].left)j++;}
  return {total:activeExpenses.reduce((n,ex)=>n+Number(ex.amount),0),count:activeExpenses.length,rows,transfers};
}
const won=value=>Number(value).toLocaleString('ko-KR')+'원';
const fmt=value=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const btn=(label,action,id,cls='small')=>`<button type="button" class="${cls}" data-action="${action}" data-id="${e(id)}">${label}</button>`;
export function renderBudget(data,me) {
  const expenses=data.expenses.filter(ex=>!ex.deleted_at).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.created_at.localeCompare(a.created_at));
  const summary=balanceSheet(expenses,data.expense_splits,data.participants),personal=summary.rows.find(p=>p.id===me.id);
  const name=id=>data.participants.find(p=>p.id===id)?.name||'참여자';
  return `<div class="section-heading"><div><span class="section-kicker">SPLIT FAIRLY, TRAVEL HAPPILY</span><h2>예산 · 정산표</h2><p>내가 결제한 내역을 등록하고, 함께 나눌 친구들을 선택해요.</p></div>${btn('+ 내역 등록','expense-add','','primary')}</div>
    <div class="budget-stats"><div class="card"><span>등록된 총 지출</span><strong>${won(summary.total)}</strong><small>${summary.count}개 내역</small></div><div class="card"><span>내가 결제한 금액</span><strong>${won(personal?.paid||0)}</strong><small>${e(me.name)} 기준</small></div><div class="card"><span>내 정산 잔액</span><strong>${won(Math.abs(personal?.net||0))}</strong><small>${personal?.net>0?'받을 금액':personal?.net<0?'보낼 금액':'정산 균형'}</small></div></div>
    <div class="notice">선택한 대상자끼리 균등하게 나눠요. ‘전부’는 등록·수정 당시 참여 중인 친구들 기준이며, 이후 친구가 추가돼도 기존 내역의 대상자는 바뀌지 않아요. 이 표는 송금 전 계산이고 실제 송금 완료 여부를 추적하지 않아요.</div>
    <h3 class="budget-heading">결제 내역</h3><div class="expense-list">${expenses.map(ex=>{
      const splits=data.expense_splits.filter(s=>s.expense_id===ex.id),own=ex.paid_by===me.id;
      return `<article class="card expense-card"><div class="expense-top"><div><span class="section-kicker">${fmt(ex.occurred_at)} · ${e(name(ex.paid_by))} 결제</span><h4>${e(ex.item)}</h4></div><strong>${won(ex.amount)}</strong></div><div class="split-details"><span class="badge">${ex.split_mode==='all'?'전부':'일부'} · ${splits.length}명</span><p>${splits.map(s=>`${e(name(s.participant_id))} ${won(s.amount)}`).join(' · ')}</p></div>${own?`<div class="guest-controls">${btn('수정','expense-edit',ex.id)}${btn('삭제','expense-delete',ex.id,'small quiet danger')}</div>`:''}</article>`;
    }).join('')||'<div class="empty"><strong>첫 결제 내역을 남겨 주세요.</strong>기차, 숙소, 식사, 간식까지 함께 나눌 비용을 등록할 수 있어요.</div>'}</div>
    <h3 class="budget-heading">사람별 정산</h3><div class="balance-list">${summary.rows.filter(p=>p.active||p.paid||p.share).map(p=>`<article class="card balance-card"><strong>${e(p.name)}</strong><dl><div><dt>결제</dt><dd>${won(p.paid)}</dd></div><div><dt>부담</dt><dd>${won(p.share)}</dd></div><div><dt>${p.net>=0?'받을 금액':'보낼 금액'}</dt><dd class="${p.net>0?'credit':p.net<0?'debit':''}">${won(Math.abs(p.net))}</dd></div></dl></article>`).join('')}</div>
    <h3 class="budget-heading">송금 안내 <small>현재 내역으로 계산</small></h3><div class="transfer-list">${summary.transfers.map(t=>`<div class="card transfer-row"><span>${e(name(t.from))} <span aria-label="에게">→</span> ${e(name(t.to))}</span><strong>${won(t.amount)}</strong></div>`).join('')||'<div class="empty">현재 내역 기준으로 주고받을 금액이 없어요.</div>'}</div>`;
}
