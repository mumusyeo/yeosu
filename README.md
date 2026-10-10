# 우리, 남쪽으로 떠나요

2026.11.06–11.08 여수–순천 여행 사이트. 모두 같은 권한이며 로그인·개인 초대 링크 없이 닉네임으로 투표·정산·방명록을 함께 관리합니다. 현재 득표 1위가 일정표에 반영되며 투표 마감은 없습니다. 메인 사진 두 장을 슬라이드쇼로 보여 줍니다.

[여행 사이트](https://mumusyeo.github.io/yeosu/) · [바로 체험하는 데모](https://mumusyeo.github.io/yeosu/demo.html) · [배포 상태](https://github.com/mumusyeo/yeosu/actions)

로컬 실행:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Preview.ps1
```

공개 사이트 배포(빌드·검증·업로드·Pages 배포 확인까지):

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy.ps1
```

실제 공동 저장은 **처음 한 번 Supabase SQL Editor에서 [supabase/setup.sql](supabase/setup.sql)을 실행**해야 합니다. 로그인 설정이나 초대 링크는 필요 없습니다. [SETUP.md](SETUP.md)를 참고하세요. 데이터베이스가 준비되기 전에도 기본 일정과 사진은 보입니다.

로컬 데모는 Supabase 없이 사용할 수 있으며 데이터가 해당 브라우저에 저장됩니다. preview.html을 더블클릭해도 됩니다.

- [전체 요구사항과 원본 사진의 일정 정보](PRD.md)
- [실행·설정·배포·오류 해결](SETUP.md)
- [구현 및 검증 상태](IMPLEMENTATION.md)

카카오톡 원본 사진은 코드에 의존하지 않습니다. main_img와 main_img2는 공개 에셋에도 복사되어 있습니다.
