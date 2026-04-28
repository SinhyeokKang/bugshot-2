---
description: 웹스토어 배포 (main 가드 → 버전 범프 → 태그 push → 스토어 빌드 → zip → 심사 요청 안내)
---

Chrome 웹스토어 배포 흐름. main 브랜치에서만 실행. 버전 범프 + 태그 + 스토어 빌드 산출물 패키징 + 크롬 웹스토어 심사 요청 가이드까지 한 번에 진행한다.

## 워크플로우 위치

```
1. dev 기준 pull → 작업 (/pull → 코드 작성 → /build로 검증)
2. dev push (/push)
3. /merge — dev → main squash PR
4. main 체크아웃 + git pull → /deploy ← 여기
5. dev 동기화 (force push, /deploy 마지막 안내 따라 수동 실행)
```

## 사전 가정

- main 브랜치 프로텍션이 걸려 있되 `enforce_admins: false`라 admin(본인)은 보호 우회 push 가능. 우회가 막혀있으면 `/deploy`는 push 단계에서 멈추고 안내한다.
- `pnpm version`이 만드는 commit + tag는 main에 직접 쌓이고 dev에는 없으므로, 배포 후 dev 동기화가 필요하다.

## 절차

0. **브랜치 가드** — `git branch --show-current`로 현재 브랜치 확인. `main`이 아니면 즉시 중단:
   > deploy는 main에서만 실행합니다. `git checkout main && git pull` 후 다시 시도하세요.

1. **사전 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 확인. 있으면 "먼저 커밋하세요" 안내 후 중단.
   - `git fetch origin main && git status -uno` — main이 origin/main과 동기 상태인지. 뒤처지면 `git pull` 안내 후 중단.
   - `node -p "require('./package.json').version"` — 현재 버전 확인
   - `git log --oneline -10` — 직전 머지/배포 이후 변경 흐름

2. **버전 범프.** 사용자에게 범프 레벨을 물어본다:
   - `patch` — 버그 수정 (기본)
   - `minor` — 기능 추가
   - `major` — Breaking change
   - `skip` — 이미 범프했으면 건너뜀

   선택 후 `pnpm version <level>` 실행. (package.json 수정 + commit + tag를 한 번에 처리. main 브랜치에 새 commit과 tag 생성.)

3. **버전 커밋 + 태그 push.** `git push --follow-tags`로 main의 새 commit과 tag를 origin에 반영.
   - 정상: `main -> main` + `[new tag] vX.Y.Z` 출력 확인.
   - 거부 시 (`protected branch hook declined`): 즉시 중단하고 안내:
     > main 보호 우회가 막혀 있어 push가 거부됐습니다. Settings > Branches에서 `Allow specified actors to bypass`에 본인을 추가하거나, 임시로 보호를 풀고 push 후 재적용하세요.
   - **거부 시 zip/업로드 단계로 넘어가지 않는다** (스토어 산출물의 버전이 SCM에 미반영된 상태로 배포되는 걸 막음).

4. **스토어 빌드.** `pnpm build:store` 실행 (timeout 300000ms). `BUGSHOT_STORE_BUILD=1`로 manifest의 dev용 `key`가 빠진 산출물을 만든다.
   - 실패 시 에러 보고 + 중단 (이미 push된 commit/tag는 그대로 두되 사용자에게 알림).
   - 성공 시 주요 번들 크기만 간결히 보고 (폰트 subset 로그 생략).

5. **zip 패키징.**
   ```
   cd dist && zip -r ../bugshot-v<version>.zip . && cd ..
   ```
   - 동일 이름 zip이 있으면 덮어쓸지 사용자에게 확인.
   - 완료 후 파일 절대경로 + 크기 보고.

6. **심사 요청 안내 + dev 동기화 안내.**

   ### 심사 요청 흐름
   - 크롬 웹스토어 개발자 대시보드: https://chrome.google.com/webstore/devconsole
   - 해당 항목 선택 → **패키지** 탭 → 새 zip 업로드
   - 변경 사항(스토어 등록정보 / 개인정보처리방침 / 권한 변경 사유 등) 갱신이 필요하면 같이 수정
   - 우상단 **"검토를 위해 제출"** 버튼 → 심사 요청
   - 심사 통과 시 자동 publish (며칠 ~ 1주 단위 소요)

   ### dev 동기화
   main에 새 버전 commit + tag가 생겼으므로 dev를 main으로 fast-forward 시켜야 다음 PR diff가 깔끔해진다.
   `/sync` 실행 권장 (force push라 별도 스킬에서 사용자 승인 받음).

## 주의

- **main이 아닌 브랜치에서는 절대 진행하지 않는다** (절차 0에서 차단).
- 미커밋 변경이 있으면 절대 진행하지 않는다.
- 버전 commit + tag가 origin에 push되지 못하면 zip 단계로 넘어가지 않는다.
- 빌드 전 코드 수정 금지.
- 스토어 업로드는 사용자가 대시보드에서 직접 수행한다 (자동화 금지 — 심사 제출 실수 방지).
