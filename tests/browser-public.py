"""Verify shared access through the Supabase adapter without accounts or invite links."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'docs')))
Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}/'
SDK="""
window.__calls=[];window.supabase={createClient(){return {
  get auth(){throw new Error('Auth must not be used');},
  async rpc(name,args){
    window.__calls.push({name,args});
    if(window.__missing)return {error:{code:'PGRST202',message:'Missing'}};
    if(name==='trip_mutate')return {data:{ok:true}};
    if(name==='trip_guestbook')return {data:[]};
    const {createSeed}=await import(new URL('./seed.js',document.baseURI));const data=createSeed();
    data.server_time=new Date().toISOString();data.me=null;return {data};
  },
  channel(){return {on(){return this;},subscribe(cb){queueMicrotask(()=>cb('SUBSCRIBED'));return this;}};},
  async removeChannel(){}
};}};
"""
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);ctx=browser.new_context(viewport={'width':390,'height':844})
        ctx.route('**/vendor/supabase.js',lambda route:route.fulfill(content_type='text/javascript',body=SDK))
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE);assert page.get_by_role('link',name='여행 설정',exact=True).count()==0
        expect(page.locator('.schedule-row')).to_have_count(7)
        expect(page.locator('#connection')).to_contain_text('로그인 없이 누구나')
        assert page.locator('[data-action="login"],[data-action="invite"],[data-action="logout"]').count()==0
        page.locator('[data-action="poll"]').first.click();page.locator('[data-action="vote"]').first.click()
        dialog=page.locator('#dialog');dialog.locator('[name="nickname"]').fill('소금')
        dialog.get_by_role('button',name='투표 반영',exact=True).click()
        expect(page.locator('#dialog')).not_to_be_visible()
        assert page.evaluate("window.__calls.some(c=>c.name==='trip_mutate'&&c.args.p_payload.nickname==='소금')")
        page.get_by_role('link',name='방명록',exact=True).click();expect(page.locator('.guest-form [name="nickname"]')).to_be_visible()
        page.get_by_role('link',name='예산 · 정산',exact=True).click();expect(page.get_by_role('button',name='+ 내역 등록',exact=True)).to_be_visible()
        ctx.close()
        missing=browser.new_context();missing.add_init_script('window.__missing=true')
        missing.route('**/vendor/supabase.js',lambda route:route.fulfill(content_type='text/javascript',body=SDK))
        fallback=missing.new_page();fallback.on('pageerror',lambda e:errors.append(str(e)));fallback.goto(BASE)
        expect(fallback.locator('#connection')).to_contain_text('공유 데이터 설정')
        expect(fallback.locator('.schedule-row')).to_have_count(7)
        fallback.get_by_role('link',name='숙소',exact=True).click();expect(fallback.locator('.lodging-card')).to_have_count(2)
        fallback.evaluate("window.__missing=false;document.dispatchEvent(new Event('visibilitychange'))")
        assert fallback.get_by_role('link',name='여행 설정',exact=True).count()==0
        expect(fallback.locator('#connection')).to_contain_text('로그인 없이 누구나')
        missing.close()
        blocked=browser.new_context();blocked.route('**/vendor/supabase.js',lambda route:route.abort())
        offline=blocked.new_page();offline.on('pageerror',lambda e:errors.append(str(e)));offline.goto(BASE)
        expect(offline.locator('.schedule-row')).to_have_count(7)
        expect(offline.locator('.hero-slide')).to_have_count(2)
        for width in [320,390,768,1440]:
            offline.set_viewport_size({'width':width,'height':900})
            assert offline.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        blocked.close();assert not errors,errors;browser.close()
        print('PASS Supabase adapter: no Auth/invites, public snapshots, nickname payloads, equal controls, setup/SDK failure with itinerary retained, recovery, photos, responsive layout')
finally:
    server.shutdown();server.server_close()
