# 실행·배포·Supabase 최초 설정

## 로컬 실행

`yeosu` 폴더에서 다음 명령을 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1
```

실행기가 **브라우저를 열고 실제 접속 주소를 출력**한다. 기본 포트는 8765이고 이미 사용 중이면 8766부터 빈 포트를 찾는다. 상대 경로 대신 스크립트 기준의 절대 경로로 파일을 제공한다. 기본은 로컬 데모로, Supabase 설정 전에도 투표·방명록·예산표를 테스트할 수 있다. 종료는 Ctrl+C다.

```powershell
# 브라우저를 자동으로 열지 않기
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1 -NoBrowser

# 원하는 시작 포트
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1 -Port 8766

# 최초 DB/Auth 설정 완료 후 실제 공유 연결 테스트
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1 -Live
```

`preview.html` 더블클릭도 가능하다. CSS·JavaScript·배경 SVG를 한 파일에 담은 **로컬 데모**다. `docs/index.html`을 파일로 열면 이 미리보기로 이동한다. 파일, HTTP, 공개 데모 주소의 브라우저 저장소는 각각 다르다.

## error.png의 ERR_EMPTY_RESPONSE 해결

이 오류는 서버에서 HTTP 응답을 받지 못한 상태다. `http://127.0.0.1:8765/` 주소 자체는 맞다. 점검 당시 8765에는 기존 서버가 실행 중이었고 응답이 끊겼으며, 새 8766 서버의 HTML·CSS·JavaScript는 모두 200으로 응답했다.

1. 위의 새 `Start-Preview.ps1`로 실행한다.
2. 실행기에 출력된 **OPEN THIS ADDRESS** 주소로 접속한다. 포트가 바뀌었다면 기존 8765 탭 대신 새 주소를 사용한다.
3. 이전 `python -m http.server` 터미널이 있다면 그 터미널에서 Ctrl+C로 종료한다.

새 서버는 Windows에서 포트를 독점 바인딩해 중복 실행을 피하고, 콘솔 로그 출력 실패 때문에 응답이 끊기지 않도록 처리한다. 기존 프로세스를 자동 종료하지 않는다. 캐시를 사용하지 않아 수정 내용이 바로 반영된다. 서버 상태는 출력 주소 뒤 `__preview_health`를 붙여 확인한다. 서버 없이 확인하려면 `preview.html`을 사용한다.

직접 Python 표준 서버를 쓰려면 먼저 해당 포트가 비어 있는지 확인하고 아래처럼 실행한다. **이 방식은 실제 Supabase 설정을 사용**한다. 로그인 전에도 기본 일정·숙소·초기 후보를 볼 수 있으며, 실제 공동 편집 내용·득표·정산·방명록은 DB/Auth 최초 설정 후 친구별 초대 링크로 입장하면 보인다.

```powershell
python -m http.server 8766 --bind 127.0.0.1 --directory docs
```

## 한 명령으로 배포

저장소: [mumusyeo/yeosu](https://github.com/mumusyeo/yeosu)  
공개 주소: [https://mumusyeo.github.io/yeosu/](https://mumusyeo.github.io/yeosu/)  
로그: [GitHub Actions](https://github.com/mumusyeo/yeosu/actions)

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1
```

명령은 필요한 Node.js 22 런타임을 찾거나 프로젝트의 `.local/`에 체크섬을 검증해 설치하고, npm 의존성 설치 → 시드·미리보기·최초 SQL 생성 → 문법·도메인·PostgreSQL 검사 → 커밋 → main push → Pages 배포 완료 및 공개 파일 응답 확인을 실행한다. Git 설치가 필요하며, GitHub Pages도 API로 자동 활성화한다. 프로젝트 파일을 공개 저장소에 올리므로 개인 설정은 `.env` 또는 무시되는 `.local/`에 둔다.

GitHub 인증은 기존 Git Credential Manager 로그인을 사용한다. 처음에는 GitHub 로그인 화면이 열릴 수 있다. 자동화 환경에서는 `GH_TOKEN` 또는 `GITHUB_TOKEN`을 사용하며 저장소 쓰기, Actions 읽기/쓰기, Pages 및 Administration 권한이 필요하다. 토큰을 파일이나 명령 인자로 기록하지 않는다. 현재 로컬 저장소는 제공된 HTTPS 원격에 연결돼 있다. 다른 PC는 이 저장소를 clone하면 된다.

```powershell
# 검사만: 커밋·push·배포 없음
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1 -CheckOnly

# 업로드까지만 기다리고 Actions에서 배포 확인
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1 -NoWait

# 커밋 메시지 지정
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1 -Message "Update itinerary"
```

변경이 없을 때도 Actions를 다시 실행해 배포를 확인한다. 원격 main에 새 커밋이 있으면 덮어쓰지 않고 중단한다. 로컬 변경을 커밋하거나 stash한 뒤 `git pull --rebase`로 합치고 다시 실행한다. 강제 push는 사용하지 않는다. Node.js가 이미 설치돼 있으면 `npm run deploy`도 같은 실행기다.

## Supabase 최초 설정: 한 번만

‘여행 데이터베이스가 아직 준비되지 않았어요’는 여행용 RPC 함수가 아직 설치되지 않았다는 뜻이다. URL·공개 키 연결과 DB 설치는 별도다. 기본 일정은 DB/Auth 설정 없이도 열람할 수 있도록 수정했으며, 미리보기의 초기 후보를 실제 득표 결과로 표시하지 않는다.

프로젝트 URL과 **publishable 공개 키**는 `docs/config.js`에 이미 연결돼 있다. 확인 당시 여행 테이블/RPC가 없고 익명 로그인이 비활성화돼 있다. 공개 키로는 DB 구조나 Auth 프로젝트 설정을 바꿀 수 없으므로 아래 두 작업은 프로젝트 대시보드에서 한 번 수행한다.

1. [프로젝트 SQL Editor](https://supabase.com/dashboard/project/fhiqsvqluyzscxmsagnf/sql/new)에서 **`supabase/setup.sql` 전체를 복사해 실행**한다. 테이블·RLS·함수·상시 투표·정산표·초기 일정까지 설치하고, 결과로 **친구 1~8의 초대 URL 8개**를 반환한다. 각 링크를 복사해 해당 친구에게 전달한다. 이미 여행 테이블이 있는 프로젝트에는 이 파일을 재실행하지 않는다.
2. [Auth 설정](https://supabase.com/dashboard/project/fhiqsvqluyzscxmsagnf/auth/providers)에서 **Anonymous Sign-Ins**를 활성화한다. 익명 사용자라도 유효한 친구별 링크를 통과해야 여행 데이터에 접근한다.

SQL 결과의 링크를 열면 참여가 완료된다. 각 친구는 여행 설정에서 본인 이름을 바꿀 수 있고, 모든 친구가 같은 권한으로 일정·숙소를 편집하고 친구 링크를 발급한다. 별도 주최자 계정이나 이메일/비밀번호 로그인은 없다.

링크는 해당 친구의 로그인 수단이다. 발급 원문은 DB에 해시로만 저장돼 재조회할 수 없다. 새 링크를 발급하면 해당 친구의 예전 링크와 연결된 세션은 서버 조회부터 차단된다. 링크를 잃으면 다른 참여자가 여행 설정에서 재발급하거나 SQL Editor에서 아래를 실행한다. 이 함수는 브라우저에서 호출할 수 없다.

```sql
select 'https://mumusyeo.github.io/yeosu/#invite=' ||
  trip_private.bootstrap_invite(
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'f0000000-0000-4000-8000-000000000001'::uuid
  ) as invite_url;
```

기존 v1 DB라면 `001_trip.sql`과 `setup.sql`을 재실행하지 않고 `002_shared_expenses.sql`만 적용한다. 기존 표·후보·방명록은 유지하고 관리자 역할·투표 마감·확정 상태를 제거한다.

[공식 익명 로그인 문서](https://supabase.com/docs/guides/auth/auth-anonymous), [공개 키 권한](https://supabase.com/docs/guides/api/api-keys), [GitHub Pages API](https://docs.github.com/en/rest/pages/pages).

## 사용법

- 투표는 언제든 변경·취소한다. 매 시점 최다 득표가 메인 일정에 표시되며, 동점은 공동 1위, 0표는 대기다.
- 예산·정산에서 본인의 결제 날짜·시간·항목·금액과 전부/일부 대상자를 등록한다. 결제자 자신을 대상에서 제외해도 된다.
- 전부는 등록/수정 당시 활성 친구를 기준으로 배분한다. 나중에 추가한 친구는 예전 내역의 대상에 자동 추가되지 않는다. 원 단위 나머지까지 금액 합계를 보존한다.
- 본인의 결제 내역·방명록만 수정/삭제한다. 사람별 잔액과 송금 안내는 계산 결과이며 실제 송금 완료 추적은 없다.
- 여행 설정에서 공동 일정·숙소를 편집하고 친구를 추가한다. 본인의 이름만 바꾼다.
- 기록 내려받기는 초대 토큰을 제외한 일정·투표·방명록·정산 JSON을 저장한다.

## 개발 및 검증

`docs/`가 실행 원본이다. `preview.html`, `docs/demo.html`, `supabase/setup.sql`은 생성 파일이다. 변경 후 Node.js 22 이상으로 실행한다.

```powershell
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run test:db
python tests/browser-shared.py
python tests/browser-public.py
```

브라우저 검사는 테스트용 서버를 직접 생성·종료한다. `browser-shared.py`는 로컬 데모, `browser-public.py`는 인증 응답을 모의해 로그인 전 열람·DB/SDK 오류·권한 회수·로그아웃·6개 화면 너비를 검사하며 실제 Supabase 데이터를 쓰지 않는다. Python Playwright/Chromium이 없으면 최초 설치한다.

```powershell
python -m pip install playwright
python -m playwright install chromium
```

일정 원문·기차·렌터카·정산 규칙과 미확인 사항은 `PRD.md`에 보존돼 있다. 카카오톡 사진은 실행·빌드·테스트에서 읽지 않아 삭제해도 기능 수정에 영향이 없다. SQL에 있는 친구 이름은 초기 자리 이름이며 실제 명단은 서비스 안에서 수정한다.
