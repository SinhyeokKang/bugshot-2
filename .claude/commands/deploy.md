---
description: 웹스토어 배포 (버전 범프 → 스토어 빌드 → zip 패키징)
---

Chrome 웹스토어에 새 버전을 배포하기 위한 빌드 파이프라인.

## 절차

1. **사전 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 확인. 있으면 "먼저 커밋하세요" 안내 후 중단.
   - `node -p "require('./package.json').version"` — 현재 버전 확인
   - `git log --oneline -5` — 최근 커밋 확인

2. **버전 범프.** 사용자에게 범프 레벨을 물어본다:
   - `patch` — 버그 수정 (기본)
   - `minor` — 기능 추가
   - `major` — Breaking change
   - `skip` — 이미 범프했으면 건너뜀

   선택 후 `pnpm version <level>` 실행. (`pnpm version`은 package.json 수정 + git tag + commit을 한 번에 처리)

3. **스토어 빌드.** `pnpm build:store` 실행 (timeout 300000ms).
   - 실패 시 에러 보고 후 중단.
   - 성공 시 주요 번들 크기만 간결히 보고 (폰트 subset 로그 생략).

4. **zip 패키징.**
   ```
   cd dist && zip -r ../bugshot-v<version>.zip . && cd ..
   ```
   - 기존 같은 이름의 zip이 있으면 덮어쓸지 사용자에게 확인.
   - 완료 후 파일 경로와 크기 보고.

5. **완료 보고.**
   - 생성된 zip 경로
   - 버전 번호
   - "대시보드에서 기존 항목 → 패키지 탭 → 새 zip 업로드 → 제출" 안내

## 주의

- 미커밋 변경이 있으면 절대 진행하지 않는다.
- `git push`는 하지 않는다. 사용자가 `/push`로 별도 처리.
- 빌드 전 코드 수정 금지.
