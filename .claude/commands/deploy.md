---
description: 웹스토어 배포 (main 가드 → tag push → 스토어 빌드 → zip → 심사 요청 안내)
---

Chrome 웹스토어 배포 흐름. main 브랜치에서만 실행. 버전 bump는 이미 `/merge` 단계에서 PR에 포함돼 main에 들어와 있다고 가정하고, `/deploy`는 그 버전을 가리키는 tag를 origin에 push + 스토어 빌드 산출물 패키징 + 크롬 웹스토어 심사 요청 가이드까지 한 번에 진행한다.

## 워크플로우 위치

```
1. dev 기준 pull → 작업 (/pull → 코드 작성 → /build로 검증)
2. dev push (/push)
3. /merge — dev 위에서 버전 bump 커밋 + dev → main squash PR
4. main 체크아웃 + git pull → /deploy ← 여기 (tag만 push)
5. dev 동기화 (force push, /deploy 마지막 안내 따라 수동 실행)
```

## 사전 가정

- main 브랜치 프로텍션은 그대로 유효해도 무방. **tag push는 branch ref가 아니라서 보호 규칙을 우회 없이 통과**한다 (tag protection rule이 별도로 걸려 있지 않은 한).
- `package.json`의 버전은 `/merge`에서 bump된 후 main에 squash 머지된 상태여야 한다. 그렇지 않으면 이번 배포는 직전 배포와 같은 버전이 되고, Chrome 웹스토어가 거부한다.

## 절차

0. **브랜치 가드** — `git branch --show-current`로 현재 브랜치 확인. `main`이 아니면 즉시 중단:
   > deploy는 main에서만 실행합니다. `git checkout main && git pull` 후 다시 시도하세요.

1. **사전 점검 (병렬 실행)**
   - `git status` — 미커밋 변경 확인. 있으면 "먼저 커밋하세요" 안내 후 중단.
   - `git fetch origin main && git status -uno` — main이 origin/main과 동기 상태인지. 뒤처지면 `git pull` 안내 후 중단.
   - `node -p "require('./package.json').version"` — 배포할 버전 확인
   - `git tag -l "v$(node -p \"require('./package.json').version\")"` — 같은 tag가 이미 존재하는지
   - `git log --oneline -10` — 직전 머지 흐름

2. **버전/태그 검증.**
   - `package.json` 버전이 직전 배포 버전과 같으면 (= `/merge`에서 bump를 깜빡한 경우) 즉시 중단:
     > 현재 버전이 직전 배포와 동일합니다. `/merge`에서 버전 bump를 빠뜨렸거나 같은 버전을 재배포하려는 상황입니다. 의도된 거면 dev에서 bump 후 다시 `/merge` → `/deploy` 하세요.
   - 같은 이름의 tag가 이미 있으면 (로컬이든 origin이든) 중단하고 알린다. 사용자가 의도적으로 재배포하는 거면 tag 삭제 후 재시도하라고 안내.

3. **tag 생성 + push.**
   ```
   git tag v<version>
   git push origin v<version>
   ```
   - branch가 아닌 tag ref만 push하므로 main 브랜치 보호 규칙과 무관하게 통과한다.
   - 거부 시 (예: tag protection rule이 별도로 걸려 있는 경우): 즉시 중단하고 안내한다. zip 단계로 넘어가지 않는다.

4. **스토어 빌드.** `pnpm build:store` 실행 (timeout 300000ms). `BUGSHOT_STORE_BUILD=1`로 manifest의 dev용 `key`가 빠진 산출물을 만든다.
   - 실패 시 에러 보고 + 중단 (이미 push된 tag는 그대로 두되 사용자에게 알림 — 같은 버전 재시도하려면 tag 삭제 후 재실행).
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
   `/merge` 직후 dev가 squash 머지로 인해 main과 분기돼 있다. 아직 `/sync`를 안 했다면 지금이라도 실행 권장 (force push라 별도 스킬에서 사용자 승인 받음).

## 주의

- **main이 아닌 브랜치에서는 절대 진행하지 않는다** (절차 0에서 차단).
- 미커밋 변경이 있으면 절대 진행하지 않는다.
- 버전 bump는 이 스킬의 책임이 아니다. `/merge`에서 처리. `/deploy`에서 `pnpm version` 실행 금지.
- 같은 버전 tag가 이미 origin에 있으면 강제 덮어쓰기(`git push -f origin v<version>`) 금지 — 의도가 명확할 때만 사용자가 직접 처리.
- tag push가 실패하면 zip 단계로 넘어가지 않는다 (스토어 산출물의 버전이 SCM에 미반영된 상태로 배포되는 걸 막음).
- 빌드 전 코드 수정 금지.
- 스토어 업로드는 사용자가 대시보드에서 직접 수행한다 (자동화 금지 — 심사 제출 실수 방지).
