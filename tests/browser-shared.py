"""Tests the local demo without changing the production Supabase configuration."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('preview_server',ROOT/'scripts'/'preview-server.py')
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)
class QuietHandler(preview.PreviewHandler):
    def log_message(self, *_args):
        pass
server=preview.PreviewServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'docs')))
server.live=False
Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}/'
OUTPUT=ROOT/'playwright-results'
OUTPUT.mkdir(exist_ok=True)
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1280,'height':1000})
    context.add_init_script('Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});')
    errors=[]
    context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
    a=context.new_page();a.goto(BASE)
    expect(a.locator('.schedule-row')).to_have_count(7)
    expect(a.get_by_text('데모 · 다른 사람과 공유되지 않음')).to_be_visible()
    assert a.locator('[data-action="login"]').count()==0
    expect(a.locator('.schedule-card').filter(has_text='쏘카 픽업')).to_contain_text('B9~10')
    a.locator('[data-action="poll"]').first.click()
    expect(a.locator('.candidate')).to_have_count(3)
    assert a.locator('[data-action="close-poll"],[data-action="confirm"],[data-action="deadline"]').count()==0
    a.locator('[data-action="vote"]').first.click()
    a.get_by_role('link',name='여행 일정',exact=True).click()
    expect(a.locator('.schedule-card').filter(has_text='정다운 식당')).to_contain_text('현재 1위 · 1표')
    b=context.new_page();b.goto(BASE);b.locator('#demo-person').select_option(label='친구 2')
    b.locator('[data-action="poll"]').first.click();b.locator('[data-action="vote"]').nth(1).click()
    a.get_by_role('link',name='맛집 투표',exact=True).click()
    expect(a.locator('.poll-summary').first).to_contain_text('공동 1위 · 각 1표')
    b.get_by_role('button',name='+ 후보 추천하기').click();b.get_by_label('장소 이름',exact=True).fill('바다 앞 새 맛집')
    b.get_by_label('지도 또는 상세 링크 (선택)').fill('https://example.com/restaurant');b.get_by_label('1인 예상 가격 (선택, 원)').fill('15000');b.get_by_label('추천 이유').fill('같이 가요!')
    b.get_by_role('button',name='후보 등록하기',exact=True).click()
    expect(b.locator('.candidate')).to_have_count(4)
    b.locator('.candidate').filter(has_text='바다 앞 새 맛집').get_by_role('button',name='이곳에 한 표').click()
    expect(b.locator('.candidate.selected')).to_contain_text('바다 앞 새 맛집')
    b.reload();expect(b.locator('.poll-summary').first).to_contain_text('공동 1위 · 각 1표')

    a.get_by_role('link',name='예산 · 정산',exact=True).click()
    a.get_by_role('button',name='+ 내역 등록').click()
    a.get_by_label('날짜',exact=True).fill('2026-11-06');a.get_by_label('시간',exact=True).fill('12:30')
    a.get_by_label('항목',exact=True).fill('점심');a.get_by_label('금액 (원)',exact=True).fill('801')
    a.get_by_role('button',name='내역 저장',exact=True).click()
    expect(a.locator('.expense-card')).to_have_count(1)
    expect(a.locator('.expense-card')).to_contain_text('전부 · 8명')
    expect(a.locator('.expense-card')).to_contain_text('친구 1 101원')
    b.get_by_role('link',name='예산 · 정산',exact=True).click()
    expect(b.locator('.expense-card')).to_have_count(1)
    assert b.locator('[data-action="expense-edit"],[data-action="expense-delete"]').count()==0
    b.get_by_role('button',name='+ 내역 등록').click()
    b.get_by_label('날짜',exact=True).fill('2026-11-07');b.get_by_label('시간',exact=True).fill('15:00')
    b.get_by_label('항목',exact=True).fill('카페');b.get_by_label('금액 (원)',exact=True).fill('1001')
    b.get_by_role('radio',name='일부',exact=True).check();b.get_by_role('button',name='내역 저장',exact=True).click()
    expect(b.locator('#dialog .form-error')).to_contain_text('한 명 이상')
    b.locator('#split-people').get_by_role('checkbox',name='친구 1',exact=True).check()
    b.locator('#split-people').get_by_role('checkbox',name='친구 3',exact=True).check()
    b.get_by_role('button',name='내역 저장',exact=True).click()
    expect(b.locator('.expense-card')).to_have_count(2)
    expect(b.locator('.expense-card').filter(has_text='카페')).to_contain_text('일부 · 2명')
    b.locator('.expense-card').filter(has_text='카페').get_by_role('button',name='수정',exact=True).click()
    b.get_by_label('금액 (원)',exact=True).fill('1000');b.get_by_role('button',name='내역 저장',exact=True).click()
    expect(b.locator('.expense-card').filter(has_text='카페')).to_contain_text('친구 1 500원')
    a.reload();expect(a.locator('.expense-card')).to_have_count(2)
    expect(a.locator('.budget-stats').first).to_contain_text('1,801원')
    a.screenshot(path=str(OUTPUT/'budget-desktop.png'),full_page=True)
    b.locator('.expense-card').filter(has_text='카페').get_by_role('button',name='삭제',exact=True).click()
    b.locator('#dialog').get_by_role('button',name='확인',exact=True).click()
    expect(b.locator('.expense-card')).to_have_count(1)

    a.get_by_role('link',name='방명록',exact=True).click();a.get_by_label('친구들에게 남길 메시지').fill('<script>window.hacked=true</script> 기대돼요!')
    a.get_by_role('button',name='메시지 남기기').click();expect(a.locator('.guest-message')).to_have_count(1);assert a.evaluate('window.hacked') is None
    a.locator('[data-action="guest-edit"]').click();a.get_by_label('메시지',exact=True).fill('바다 보면서 맛있는 거 먹어요!');a.locator('#dialog').get_by_role('button',name='저장하기').click()
    b.get_by_role('link',name='방명록',exact=True).click();expect(b.locator('.guest-message')).to_have_text('바다 보면서 맛있는 거 먹어요!');assert b.locator('[data-action="guest-delete"]').count()==0
    b.get_by_role('link',name='여행 설정',exact=True).click();expect(b.locator('.admin-card')).to_have_count(2)
    b.locator('[data-action="schedule-edit"]').first.click();b.get_by_label('제목',exact=True).fill('용산 → 여수EXPO · 출발!');b.locator('#dialog').get_by_role('button',name='저장하기').click()
    b.locator('[data-action="invite"]').first.click();b.locator('#dialog').get_by_role('button',name='링크 발급',exact=True).click();expect(b.locator('#issued-link')).to_contain_text('#invite=');b.locator('[data-action="dialog-close"]').click()
    a.get_by_role('link',name='여행 일정',exact=True).click();a.screenshot(path=str(OUTPUT/'desktop.png'),full_page=True)
    for width in [320,360,390,768,1024,1440]:
        a.set_viewport_size({'width':width,'height':900})
        for section in ['schedule','votes','lodgings','budget','guestbook','settings']:
            a.goto(BASE+'#'+section);expect(a.locator('#main')).not_to_be_empty()
            assert a.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,section)
        if width==360:
            a.goto(BASE+'#budget');a.screenshot(path=str(OUTPUT/'budget-mobile.png'),full_page=True)
            a.goto(BASE+'#schedule');a.screenshot(path=str(OUTPUT/'mobile.png'),full_page=True)
    # Upgrade old locally stored votes/messages without requiring original photos.
    legacy_context=browser.new_context(viewport={'width':360,'height':800})
    legacy=legacy_context.new_page();legacy.goto(BASE)
    legacy.evaluate("""async()=>{
      const {createSeed}=await import('./seed.js');const s=createSeed();delete s.schema_version;delete s.expenses;delete s.expense_splits;
      s.participants.forEach((p,i)=>{p.role=i===0?'host':'guest';p.name=i===0?'주최자':`친구 ${i}`;});
      s.polls[0].status='closed';s.polls[0].deadline='2020-01-01';s.polls[0].confirmed_candidate_id=s.candidates[1].id;
      s.votes=[{id:'old-vote',poll_id:s.polls[0].id,participant_id:s.participants[0].id,candidate_id:s.candidates[0].id}];
      s.schedule[1].title='렌터카 대여';s.schedule[1].start_time=null;s.schedule[20].start_time=null;
      s.guestbook=[{id:'old-message',participant_id:s.participants[0].id,content:'이전 메시지',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',deleted_at:null}];
      localStorage.setItem('namjjok-demo-v1',JSON.stringify(s));
    }""")
    legacy.reload();expect(legacy.locator('.schedule-card').filter(has_text='정다운 식당')).to_contain_text('현재 1위 · 1표')
    expect(legacy.locator('.schedule-card').filter(has_text='쏘카 픽업')).to_contain_text('B9~10')
    legacy.get_by_role('link',name='방명록',exact=True).click();expect(legacy.locator('.guest-message')).to_have_text('이전 메시지')
    legacy.get_by_role('link',name='예산 · 정산',exact=True).click();expect(legacy.locator('.budget-stats')).to_contain_text('0원')
    legacy_context.close()
    # Standalone file is fully functional with all external HTTP resources blocked.
    offline=browser.new_context(viewport={'width':360,'height':800})
    offline.route('https://**/*',lambda route:route.abort())
    file_page=offline.new_page();file_page.on('pageerror',lambda error:errors.append(str(error)))
    file_page.goto((ROOT/'preview.html').as_uri());expect(file_page.locator('.schedule-row')).to_have_count(7)
    assert file_page.locator('.hero-art img').evaluate('(img)=>img.complete && img.naturalWidth>0')
    assert file_page.locator('h1').evaluate('(el)=>getComputedStyle(el).fontSize')!='32px'
    file_page.get_by_role('link',name='예산 · 정산',exact=True).click();expect(file_page.locator('.budget-stats')).to_be_visible()
    file_page.goto((ROOT/'docs/index.html').as_uri());expect(file_page.locator('.schedule-row')).to_have_count(7)
    assert 'preview.html' in file_page.url
    offline.close();assert not errors,errors;context.close();browser.close()
    server.shutdown();server.server_close()
    print('PASS browser: live voting, shared expenses/all/some/edit/delete, ownership, guestbook, shared settings, 6 widths, offline file preview and file redirect; no JS errors')
