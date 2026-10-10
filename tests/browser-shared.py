"""Exercise nickname registrations, equal editing rights, responsive layout and photo slideshow."""
from pathlib import Path
from functools import partial
from threading import Thread
import importlib.util
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('preview_server',ROOT/'scripts'/'preview-server.py')
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)
class QuietHandler(preview.PreviewHandler):
    def log_message(self,*_args):pass
server=preview.PreviewServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT/'docs')));server.live=False
Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}/'
OUTPUT=ROOT/'playwright-results';OUTPUT.mkdir(exist_ok=True)
try:
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True)
        context=browser.new_context(viewport={'width':1280,'height':900})
        context.add_init_script('Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});')
        errors=[];a=context.new_page();a.on('pageerror',lambda error:errors.append(str(error)))
        a.goto(BASE);expect(a.locator('.schedule-row')).to_have_count(7)
        assert a.get_by_role('link',name='여행 설정',exact=True).count()==0
        expect(a.locator('.wordmark')).to_contain_text('가만안둬');expect(a.locator('.wordmark span')).to_have_text('MK와 아이들')
        expect(a.locator('#hero-title')).to_have_text('야앙!우리가 간다!')
        assert a.locator('.hero-art').evaluate('(el)=>getComputedStyle(el).borderTopLeftRadius')=='0px'
        assert a.locator('[data-action="login"],[data-action="invite"],[data-action="logout"],#demo-person').count()==0
        expect(a.locator('.hero-slide')).to_have_count(2)
        assert a.locator('.hero-slide').nth(0).evaluate('(img)=>img.complete&&img.naturalWidth>0')
        expect(a.locator('.slide-counter')).to_have_text('1 / 2')
        expect(a.locator('.slide-counter')).to_have_text('2 / 2',timeout=4200)
        a.get_by_role('button',name='슬라이드쇼 일시정지',exact=True).click()
        a.get_by_role('button',name='여수 사진 보기',exact=True).click()
        expect(a.locator('.slide-counter')).to_have_text('1 / 2')
        a.wait_for_timeout(5200);expect(a.locator('.slide-counter')).to_have_text('1 / 2')
        a.get_by_role('button',name='다음 사진',exact=True).click();expect(a.locator('.slide-counter')).to_have_text('2 / 2')
        a.locator('[data-action="poll"]').first.click()
        a.locator('[data-action="vote"]').first.click();a.locator('#dialog [name="nickname"]').fill('밀로')
        a.locator('#dialog').get_by_role('button',name='투표 반영',exact=True).click()
        expect(a.locator('.candidate.selected')).to_contain_text('정다운 식당')
        b=context.new_page();b.on('pageerror',lambda error:errors.append(str(error)));b.goto(BASE)
        b.locator('[data-action="poll"]').first.click();b.locator('[data-action="vote"]').nth(1).click()
        b.locator('#dialog [name="nickname"]').fill('임호');b.locator('#dialog').get_by_role('button',name='투표 반영',exact=True).click()
        expect(b.locator('.poll-title')).to_contain_text('공동 1위')
        a.get_by_role('link',name='맛집 투표',exact=True).click();expect(a.locator('.poll-summary').first).to_contain_text('공동 1위')
        b.get_by_role('button',name='+ 후보 추천하기',exact=True).click()
        b.locator('#dialog [name="nickname"]').fill('임호');b.get_by_label('장소 이름',exact=True).fill('공동 추천 카페')
        b.locator('#dialog').get_by_role('button',name='후보 등록하기',exact=True).click();expect(b.locator('.candidate')).to_have_count(4)
        a.locator('[data-action="poll"]').first.click();a.locator('.candidate').filter(has_text='공동 추천 카페').get_by_role('button',name='후보 숨기기',exact=True).click()
        a.locator('#dialog [name="nickname"]').fill('밀로');a.locator('#dialog').get_by_role('button',name='확인',exact=True).click()
        expect(a.locator('.candidate')).to_have_count(3)
        a.get_by_role('link',name='예산 · 정산',exact=True).click();a.get_by_role('button',name='+ 내역 등록',exact=True).click()
        a.locator('#dialog [name="nickname"]').fill('밀로');a.get_by_label('날짜',exact=True).fill('2026-11-06')
        a.get_by_label('계좌번호 (선택)',exact=True).fill('카카오뱅크 3333-00-1234567');a.get_by_label('시간',exact=True).fill('12:30');a.get_by_label('항목',exact=True).fill('점심');a.get_by_label('금액 (원)',exact=True).fill('801')
        a.locator('#dialog').get_by_role('button',name='내역 저장',exact=True).click()
        expect(a.locator('.expense-card')).to_contain_text('밀로 결제');expect(a.locator('.expense-card')).to_contain_text('전부 · 8명')
        expect(a.locator('.expense-card')).to_contain_text('밀로 101원')
        b.get_by_role('link',name='예산 · 정산',exact=True).click();expect(b.locator('[data-action="expense-edit"]')).to_be_visible()
        b.locator('[data-action="expense-edit"]').click();b.locator('#dialog [name="nickname"]').fill('임호')
        expect(b.get_by_label('계좌번호 (선택)',exact=True)).to_have_value('카카오뱅크 3333-00-1234567');b.get_by_label('계좌번호 (선택)',exact=True).fill('국민은행 123-456');b.get_by_label('금액 (원)',exact=True).fill('1001');b.get_by_role('radio',name='일부',exact=True).check()
        for checkbox in b.locator('#split-people input').all():checkbox.uncheck()
        b.locator('#split-people').get_by_role('checkbox',name='임호',exact=True).check()
        b.locator('#split-people').get_by_role('checkbox',name='소연',exact=True).check()
        b.locator('#dialog').get_by_role('button',name='내역 저장',exact=True).click()
        expect(b.locator('.expense-card')).to_contain_text('일부 · 2명');expect(b.locator('.expense-card')).to_contain_text('밀로 결제')
        expect(a.locator('.expense-card')).to_contain_text('1,001원')
        expect(a.locator('.expense-card')).to_contain_text('국민은행 123-456')
        a.get_by_role('button',name='+ 내역 등록',exact=True).click();a.get_by_label('날짜',exact=True).fill('2026-11-06');a.get_by_label('시간',exact=True).fill('09:00');a.get_by_label('항목',exact=True).fill('기차');a.get_by_label('금액 (원)',exact=True).fill('800')
        a.locator('#dialog').get_by_role('button',name='내역 저장',exact=True).click();expect(a.locator('.expense-card h4')).to_have_text(['기차','점심'])
        a.locator('.expense-card').filter(has_text='기차').locator('[data-action="expense-edit"]').click();a.get_by_label('시간',exact=True).fill('15:00');a.locator('#dialog').get_by_role('button',name='내역 저장',exact=True).click();expect(a.locator('.expense-card h4')).to_have_text(['점심','기차'])
        a.locator('.expense-card').filter(has_text='기차').locator('[data-action="expense-delete"]').click();a.locator('#dialog').get_by_role('button',name='확인',exact=True).click();expect(a.locator('.expense-card')).to_have_count(1)
        a.screenshot(path=str(OUTPUT/'nickname-budget-desktop.png'),full_page=True)
        a.get_by_role('link',name='방명록',exact=True).click();a.locator('.guest-form [name="nickname"]').fill('밀로')
        a.get_by_label('친구들에게 남길 메시지',exact=True).fill('<script>window.hacked=true</script> 같이 가요')
        a.get_by_role('button',name='메시지 남기기',exact=True).click();expect(a.locator('.guest-message')).to_have_count(1)
        assert a.evaluate('window.hacked') is None
        b.get_by_role('link',name='방명록',exact=True).click();expect(b.locator('[data-action="guest-edit"]')).to_be_visible()
        b.locator('[data-action="guest-edit"]').click();b.locator('#dialog [name="nickname"]').fill('임호')
        b.locator('#dialog').get_by_label('메시지',exact=True).fill('누구나 함께 수정')
        b.locator('#dialog').get_by_role('button',name='저장하기',exact=True).click()
        expect(a.locator('.guest-message')).to_have_text('누구나 함께 수정')
        a.get_by_role('link',name='여행 일정',exact=True).click();a.locator('[data-action="schedule-edit"]').first.click()
        assert a.locator('#dialog [name="nickname"]').count()==0 and a.locator('#identity').count()==0;a.get_by_label('제목',exact=True).fill('용산 → 여수EXPO · 함께 출발')
        a.locator('#dialog').get_by_role('button',name='저장하기',exact=True).click()
        for width in [320,360,390,768,1024,1440]:
            a.set_viewport_size({'width':width,'height':900})
            for section in ['schedule','votes','lodgings','budget','guestbook']:
                a.goto(BASE+'#'+section);expect(a.locator('#main')).not_to_be_empty()
                assert a.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,section)
            if width==360:
                a.goto(BASE+'#budget');a.screenshot(path=str(OUTPUT/'nickname-budget-mobile.png'),full_page=True)
                a.goto(BASE+'#schedule');a.screenshot(path=str(OUTPUT/'slideshow-mobile.png'),full_page=True)
        b.get_by_role('link',name='예산 · 정산',exact=True).click();b.locator('[data-action="expense-delete"]').click()
        b.locator('#dialog [name="nickname"]').fill('임호');b.locator('#dialog').get_by_role('button',name='확인',exact=True).click()
        expect(b.locator('.expense-card')).to_have_count(0)
        offline=browser.new_context(viewport={'width':360,'height':800},reduced_motion='reduce')
        offline.route('https://**/*',lambda route:route.abort());file_page=offline.new_page()
        file_page.on('pageerror',lambda error:errors.append(str(error)))
        file_page.goto((ROOT/'preview.html').as_uri());expect(file_page.locator('.schedule-row')).to_have_count(7)
        expect(file_page.get_by_role('button',name='슬라이드쇼 자동 재생',exact=True)).to_be_visible()
        for slide in file_page.locator('.hero-slide').all():assert slide.evaluate('(img)=>img.complete&&img.naturalWidth>0')
        file_page.get_by_role('button',name='다음 사진',exact=True).click();expect(file_page.locator('.slide-counter')).to_have_text('2 / 2')
        file_page.goto((ROOT/'docs/index.html').as_uri());expect(file_page.locator('.schedule-row')).to_have_count(7)
        assert 'preview.html' in file_page.url
        offline.close();context.close();assert not errors,errors;browser.close()
        print('PASS browser: nickname votes/candidates/expenses/guestbook, equal edits/deletes, exact splits, schedule, 6 widths, slideshow auto/manual/pause/reduced motion/offline')
finally:
    server.shutdown();server.server_close()
