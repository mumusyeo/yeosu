# 실행·공동 데이터 설정·배포

## 로컬 실행

yeosu 폴더에서 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1
```

브라우저가 열리고 OPEN THIS ADDRESS에 접속 주소가 출력됩니다. 기본 포트 8765가 사용 중이면 빈 포트를 선택합니다. 기본은 로컬 데모로 모든 등록 기능을 닉네임으로 시험할 수 있습니다. 종료는 Ctrl+C입니다.

```powershell
# 브라우저 자동 열기 끄기
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1 -NoBrowser
# 실제 Supabase 공동 데이터 연결
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1 -Live
```

preview.html 더블클릭도 가능합니다. 사진 두 장과 코드를 내장한 오프라인 데모입니다. 로컬·파일·공개 데모는 각각의 브라우저 저장소를 사용하며 실제 공동 DB로 전송하지 않습니다.

## Supabase 최초 설정: SQL 한 번

연결된 프로젝트: https://fhiqsvqluyzscxmsagnf.supabase.co

1. Supabase Dashboard에서 이 프로젝트의 SQL Editor를 엽니다.
2. 저장소의 supabase/setup.sql **전체 내용**을 붙여 넣고 Run을 누릅니다.
3. 성공 결과를 확인한 후 [여행 사이트](https://mumusyeo.github.io/yeosu/)를 새로고침합니다.

이 파일은 새 DB 설치와 예전 초대 방식 DB 업그레이드를 함께 지원합니다. 재실행해도 기존 입력과 편집한 일정을 유지합니다. 기존 초대·세션 기능은 제거합니다.

**Anonymous Sign-Ins 활성화, 로그인, 개인 초대 링크 발급은 필요 없습니다.** 모두 공통 주소로 접속하고 등록·수정·삭제 때 닉네임을 입력합니다. 이전 SETUP의 Auth·초대 절차는 더 이상 적용하지 마세요.

프로젝트 URL과 공개 키는 docs/config.js에 반영되어 있습니다. 공개 키는 DB 구조를 생성할 권한이 없으므로 SQL Editor 작업은 프로젝트 소유자가 처음 한 번 해야 합니다. 이후 프런트엔드 변경 배포에는 매번 SQL을 실행할 필요가 없습니다. 향후 DB 구조 변경이 있는 업데이트는 새 마이그레이션 안내를 따릅니다.

## 닉네임·정산 명단

닉네임은 1~40자이며 같은 닉네임은 같은 참여자로 취급합니다. 투표는 슬롯별 닉네임당 한 표이고 다른 후보로 변경하거나 같은 후보를 다시 눌러 취소합니다. 최근 닉네임을 브라우저에 기억하지만 매 작업 폼에서 바꿀 수 있습니다.

친구 명단은 밀로, 임호, 소연, 레나, 로건, 유미, 희우, 희지입니다. 각자 이 이름을 닉네임으로 입력하면 기존 명단에 연결됩니다. 다른 닉네임은 새 참여자로 추가되므로 정산 대상 명단에도 추가됩니다. 여행 설정 메뉴는 제거했습니다. 결제 내역의 닉네임은 결제자입니다. 다른 사람이 수정할 수 있으며 수정 시 원래 결제자는 유지됩니다. 모두 일정·숙소·후보·정산·방명록을 공동 편집합니다.

## 한 명령으로 배포

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1
```

빌드·정적 검사·단위 및 DB 테스트 후 Git에 커밋하고 mumusyeo/yeosu로 올립니다. Pages 배포 성공과 공개 URL 응답까지 확인합니다. GitHub 인증이 없으면 Git Credential Manager 로그인 안내를 따릅니다. Node가 없으면 전용 도구 폴더에 준비합니다.

공통 URL: https://mumusyeo.github.io/yeosu/

데모 URL: https://mumusyeo.github.io/yeosu/demo.html

## 화면 또는 데이터 오류

ERR_EMPTY_RESPONSE는 해당 포트에서 HTTP 응답을 받지 못한 상태입니다. 기존 Python 서버를 Ctrl+C로 종료한 뒤 Start-Preview.ps1에서 출력한 실제 주소로 접속하세요. 포트가 바뀌었으면 예전 8765 주소를 계속 사용하지 마세요. 실행기가 기존 다른 프로세스를 임의 종료하지는 않습니다.

공동 데이터 설정 안내가 보인다면 위 SQL을 실행하고 새로고침하세요. 기본 일정·숙소·사진은 계속 표시됩니다. SQL이 적용되어도 실패하면 브라우저 콘솔과 Supabase SQL 오류를 확인하세요. PGRST202는 RPC가 아직 없거나 API 스키마 캐시가 갱신되지 않은 경우입니다. SQL 적용 직후 잠시 기다렸다 새로고침할 수 있습니다.

직접 정적 서버를 실행하려면 사용 중이지 않은 포트에서:

```powershell
python -m http.server 8766 --bind 127.0.0.1 --directory docs
```

이 주소는 실제 Supabase에 연결됩니다. 데모는 /demo.html로 접속하세요. 스크립트 실행에 계속 문제가 있으면 preview.html을 직접 열어 화면과 로컬 기능을 확인할 수 있습니다.

## 사진 보관

카카오톡 원본의 일정 정보는 PRD와 seed에 보존되어 있습니다. 삭제해도 실행·일반 수정에 영향이 없습니다. 메인 사진은 docs/assets/main_img.jpg와 main_img2.jpg를 사용합니다. 루트 원본이 있으면 빌드 때 복사하고 없으면 기존 공개 에셋을 그대로 사용하므로 공개 에셋은 유지하세요.

## 기존 DB의 세부 정보 업데이트

이번 숙소·명단·투표 제목 수정은 setup.sql 전체를 다시 실행하거나 supabase/migrations/004_trip_details.sql을 실행해 적용합니다. 004는 한 번만 적용되며 참여자 ID, 기존 투표·방명록·정산 내역과 분담액을 보존합니다. 최초 적용 시 지정된 8명의 이름과 숙소·투표 제목은 최신 요청으로 바뀝니다. 이후 재실행은 덮어쓰지 않습니다.

## 정산 계좌번호 업데이트

기존 DB에서 계좌번호를 저장하려면 supabase/migrations/005_expense_accounts.sql 전체를 SQL Editor에서 실행합니다. 최신 setup.sql 전체를 실행해도 됩니다. 계좌번호가 없는 기존 내역과 분담액은 유지되며 SQL 재실행도 가능합니다. 적용 후 브라우저를 새로고침하세요. 계좌번호는 선택 입력으로 은행명과 함께 최대 100자까지 적을 수 있습니다. 내역은 결제 날짜·시간이 빠른 순으로 정렬됩니다.
