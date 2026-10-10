# 우리, 남쪽으로 떠나요

2026.11.06–11.08 여수–순천 여행 초대장. 상시 투표와 현재 1위 일정 연동, 방명록, 전부/일부 정산 대상자 예산표를 지원한다. 주최자 계정은 없다.

[초대장](https://mumusyeo.github.io/yeosu/) · [공개 데모](https://mumusyeo.github.io/yeosu/demo.html) · [배포 상태](https://github.com/mumusyeo/yeosu/actions)

Windows에서 다음 한 명령으로 빌드·검증·GitHub 업로드·Pages 배포·완료 확인을 실행한다.

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1
```

로컬은 `preview.html`을 더블클릭하거나 다음 명령으로 실행한다. 사용 가능한 포트에서 브라우저가 열리며, 기본은 로컬 데모다.

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1
```

**기본 일정·숙소·초기 후보는 바로 열람할 수 있다.** 실제 투표·정산·방명록 공유에는 [SETUP.md](SETUP.md)의 SQL 실행과 익명 로그인 활성화가 필요하다. 공개 키는 이미 연결돼 있다.

- [요구사항과 원본 사진 정보](PRD.md)
- [실행·Supabase 설정·배포·문제 해결](SETUP.md)
- [검증과 구현 상태](IMPLEMENTATION.md)
- [최초 DB 설정 SQL](supabase/setup.sql)
- [v1 DB 업그레이드](supabase/migrations/002_shared_expenses.sql)

카카오톡 사진은 실행·빌드·수정에 사용하지 않는다. 데모의 투표·정산·글은 해당 브라우저에만 저장된다.
