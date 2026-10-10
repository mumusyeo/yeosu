"""Verify public itinerary, backend failure and removal of private data after access loss."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'docs')))
Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}/'
SDK = """
window.__session=null;window.__mode='member';window.__calls=[];window.__closed=0;
const client={
  auth:{
    async getSession(){return {data:{session:window.__session},error:null};},
    async signInAnonymously(){return {error:{code:'anonymous_provider_disabled',message:'Anonymous sign-ins disabled'}};},
    async signOut(){window.__session=null;return {error:null};}
  },
  async rpc(name,args){
    window.__calls.push({name,args});
    if(window.__mode==='missing')return {error:{code:'PGRST202',message:'Function missing'}};
    if(window.__mode==='denied')return {error:{code:'42501',message:'Access denied'}};
    const {createSeed}=await import(new URL('./seed.js',document.baseURI));const data=createSeed(),me=data.participants[0];
    if(name==='trip_guestbook')return {data:[{id:'private-note',participant_id:me.id,content:'비공개 방명록',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]};
    data.me=me;data.server_time=new Date().toISOString();data.schedule[0].title='친구들이 수정한 출발 일정';
    data.expenses=[{id:'private-expense',item:'비공개 결제',amount:800,paid_by:me.id,occurred_at:'2026-11-06T12:30:00+09:00',split_mode:'all',created_at:new Date().toISOString()}];
    data.expense_splits=data.participants.map(p=>({expense_id:'private-expense',participant_id:p.id,amount:100}));
    return {data};
  },
  channel(){return {on(){return this;},subscribe(callback){queueMicrotask(()=>callback('SUBSCRIBED'));return this;}};},
  async removeChannel(){window.__closed++;}
};
window.supabase={createClient(){return client;}};
"""

try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        context.route('**/vendor/supabase.js', lambda route: route.fulfill(content_type='text/javascript', body=SDK))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE)
        page.wait_for_function('window.supabase !== undefined')
        expect(page.locator('.schedule-row')).to_have_count(7)
        expect(page.locator('#connection')).to_contain_text('기본 일정 미리보기')
        assert page.evaluate('window.__calls.length') == 0
        for date, count in [('2026-11-06', 7), ('2026-11-07', 10), ('2026-11-08', 5)]:
            page.locator(f'[data-action="date"][data-id="{date}"]').click()
            expect(page.locator('.schedule-row')).to_have_count(count)
        page.get_by_role('link', name='우리의 숙소', exact=True).click()
        expect(page.locator('.lodging-card')).to_have_count(2)
        assert page.locator('[data-action="lodging-edit"]').count() == 0
        page.get_by_role('link', name='맛집 투표', exact=True).click()
        expect(page.locator('.poll-summary')).to_have_count(8)
        page.locator('[data-action="poll"]').first.click()
        expect(page.locator('.candidate')).to_have_count(3)
        assert page.locator('[data-action="vote"],[data-action="candidate-add"],[data-action="hide"]').count() == 0
        assert page.locator('.votes').count() == 0
        for section in ['예산 · 정산', '방명록']:
            page.get_by_role('link', name=section, exact=True).click()
            expect(page.locator('.gate')).to_contain_text('친구별 초대 링크')
        # A synthetic UI action cannot mutate before membership is established.
        page.evaluate("""()=>{const b=document.createElement('button');b.dataset.action='expense-add';b.textContent='Synthetic expense';document.body.append(b);} """)
        page.get_by_role('button', name='Synthetic expense').click()
        expect(page.locator('#toast')).to_contain_text('초대 링크로 먼저')
        assert not page.locator('#dialog').evaluate('(d)=>d.open')
        assert page.evaluate('window.__calls.length') == 0
        page.get_by_role('button', name='Synthetic expense').evaluate('(b)=>b.remove()')
        for width in [320, 360, 390, 768, 1024, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            for section in ['schedule', 'votes', 'lodgings', 'budget', 'guestbook']:
                page.evaluate('(section)=>location.hash=section', section)
                expect(page.locator('#main')).not_to_be_empty()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), (width, section)
        # A stored anonymous session with no tables still keeps the itinerary visible.
        page.evaluate("window.__session={};window.__mode='missing';location.hash='schedule';document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator('#connection')).to_contain_text('데이터베이스가 아직 준비되지')
        expect(page.locator('.schedule-row')).to_have_count(5)
        # Membership unlocks private data; revocation removes it and returns to the public seed.
        page.evaluate("window.__mode='member';document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.get_by_role('link', name='여행 설정', exact=True)).to_be_visible()
        page.get_by_role('link', name='예산 · 정산', exact=True).click()
        expect(page.locator('.expense-card')).to_contain_text('비공개 결제')
        page.get_by_role('link', name='방명록', exact=True).click()
        expect(page.locator('.guest-message')).to_have_text('비공개 방명록')
        page.evaluate("window.__mode='denied';document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator('.gate')).to_be_visible()
        assert page.get_by_text('비공개 방명록', exact=True).count() == 0
        assert page.get_by_role('link', name='여행 설정', exact=True).count() == 0
        page.get_by_role('link', name='예산 · 정산', exact=True).click()
        assert page.locator('.expense-card').count() == 0
        assert page.evaluate('window.__closed') >= 1
        page.evaluate("window.__mode='member';document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator('[data-action="logout"]')).to_be_visible()
        page.locator('[data-action="logout"]').click()
        expect(page.locator('.schedule-row')).to_have_count(5)
        expect(page.locator('#connection')).to_contain_text('기본 일정 미리보기')
        assert page.locator('[data-action="logout"]').count() == 0
        invalid = context.new_page()
        invalid.on('pageerror', lambda error: errors.append(str(error)))
        invalid.goto(BASE + '#invite=' + 'a' * 64)
        expect(invalid.locator('.schedule-row')).to_have_count(7)
        expect(invalid.locator('#connection')).to_contain_text('익명 로그인을 켜 주세요')
        context.close()
        # Even SDK/network failure cannot block the basic trip information.
        blocked = browser.new_context()
        blocked.route('**/vendor/supabase.js', lambda route: route.abort())
        offline_page = blocked.new_page()
        offline_page.on('pageerror', lambda error: errors.append(str(error)))
        offline_page.goto(BASE)
        expect(offline_page.locator('.schedule-row')).to_have_count(7)
        offline_page.get_by_role('link', name='우리의 숙소', exact=True).click()
        expect(offline_page.locator('.lodging-card')).to_have_count(2)
        blocked.close()
        assert not errors, errors
        browser.close()
        print('PASS public view: all dates/lodgings/candidates, no anonymous RPC/writes, missing DB/SDK, private access and revocation, logout, invalid invite, 6 viewport widths')
finally:
    server.shutdown()
    server.server_close()
