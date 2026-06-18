# 로그 레코더 Pre-arm 버퍼링 — 구현 태스크

## 선행 조건
- 새 권한·env·의존성 없음. 순수 코드 변경.
- 회귀 민감 영역(`chrome.scripting.executeScript({world:"MAIN"})` 직렬화, console `captureStack`)이라 **실탭 회귀 확인 필수**(아래 수동 테스트).

## 태스크

### Task 1: pre-arm 게이트 헬퍼 + 단위 테스트
- **변경 대상**: 신규 `src/content/recorder-prearm.ts`, 신규 `src/content/__tests__/recorder-prearm.test.ts`
- **작업 내용**: `PREARM_FLAG_KEY`, 순수 `isPreArmFlag(value)`, 부수효과 래퍼 `readPreArmFlag`/`setPreArmFlag`/`clearPreArmFlag`(try/catch) 구현. 테스트는 `isPreArmFlag`만 대상(순수).
- **검증**:
  - [ ] `isPreArmFlag("1")===true`, `null/""/"0"/"true"===false`
  - [ ] `pnpm test` 통과
  - [ ] `pnpm typecheck` 통과

### Task 2: network-recorder pre-arm 적용
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**: init에 `const preArm = readPreArmFlag(); let capturing = preArm;` 추가. `recordHook` 게이트를 `if (!capturing) return`로 교체. `setSentinel`에 `capturing=true; setPreArmFlag(); if (buffer.length) throttle.schedule();` 추가. `stopHandler`에 `capturing=false; clearPreArmFlag();` 추가.
- **검증**:
  - [ ] `preArm=false`(플래그 없음)일 때 sentinel 전 요청이 버퍼에 안 쌓임(기존 동작)
  - [ ] `preArm=true`일 때 sentinel 전 요청이 버퍼에 쌓이고, `setSentinel` 후 dispatch에 포함
  - [ ] `pnpm typecheck` 통과

### Task 3: console-recorder pre-arm 적용 (+ error/warn 조기 후킹)
- **변경 대상**: `src/content/console-recorder.ts`
- **작업 내용**: `preArm`/`capturing` 도입, `pushEntry` 게이트를 `capturing` 기준으로 교체. `preArm===true`이면 init에서 `installEw()` 호출(error/warn을 `document_start`에 후킹). `setSentinel`에 `capturing=true; setPreArmFlag();` + 버퍼 소급 flush, stop에 `capturing=false; clearPreArmFlag()`. `installEw` 멱등 가드(`ewState.installed`)로 arm 시 재설치 방지 확인.
- **검증**:
  - [ ] `preArm=true`에서 sentinel 전 `console.log/info/debug` 및 `console.error/warn`이 버퍼에 쌓임
  - [ ] `preArm=false`에서 error/warn 후킹이 설치되지 않음(현행 attribution 오염 회피 유지)
  - [ ] stop 후 `uninstallEw` 호출돼 원복
  - [ ] `pnpm typecheck` 통과

### Task 4: action-recorder pre-arm 적용
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `preArm`/`capturing` 도입, `pushAction` 및 input dedup 분기 게이트를 `capturing` 기준으로 교체. `setSentinel`에 `capturing=true; setPreArmFlag();` + 버퍼 소급 flush 추가(기존 `entryNavOnBind` 보충 로직·`entryNavEmitted` 가드 유지). `stopHandler`에 `capturing=false; clearPreArmFlag()` 추가.
- **검증**:
  - [ ] `preArm=true`에서 sentinel 전 클릭/입력이 버퍼에 쌓이고 flush에 포함
  - [ ] 진입 네비(`load`) 레코드가 pre-arm 캡처분과 중복되지 않음(`entryNavEmitted` 가드)
  - [ ] `pnpm typecheck` 통과

### Task 5: privacy.md 대조
- **변경 대상**: `docs/privacy.md` (대조 후 필요 시)
- **작업 내용**: 캡처 시작 시점이 active origin에서 `document_start`로 앞당겨지는 동작 반영 여부 판단. 데이터 종류·전송 조건(sentinel 없으면 전송 0)은 불변이나 "기존 권한의 새 캡처 타이밍" 게이트에 해당 → 문구 보완 필요 시 시행일 갱신.
- **검증**:
  - [ ] privacy.md의 로그 캡처 설명과 새 동작 정합 확인(수정 또는 "변경 불요" 결론 기록)

## 테스트 계획

- **단위 테스트**: `recorder-prearm.test.ts` — `isPreArmFlag`의 truthy/falsy 케이스("1"/null/""/"0"/임의값).
- **e2e 시나리오** (`/e2e-write` 입력 후보):
  - "active origin에서 페이지를 새로고침하면, 로드 중 발생한 network 요청이 로그 탭에 나타난다." (테스트 페이지가 로드 즉시 fetch 1건 발사 → 패널 arm 상태에서 reload → 로그 목록에 그 요청 포함 판정)
  - "bugshot을 한 번도 arm하지 않은 origin에서는 reload해도 로드 중 요청이 로그에 쌓이지 않는다." (음성 케이스, 판정 가능하면)
- **수동 테스트** (자동화 곤란 — MAIN world IIFE·V8 스택·실탭 의존):
  - [ ] console error/warn 조기 후킹: 로드 즉시 `console.error`를 찍는 페이지를 active 상태에서 새로고침 → 초반 에러가 로그에 잡히고, **스택/소스 attribution이 깨지지 않는지** 확인(`captureStack` slice 회귀).
  - [ ] 페이지 Sentry/에러 모니터링이 있는 사이트에서 조기 후킹이 페이지 에러 트래킹을 깨지 않는지.
  - [ ] bugshot 미사용 origin에서 무부하 유지(후킹은 있으나 적재 0) 체감 확인.
  - [ ] sandboxed iframe(예: 광고 프레임)에서 sessionStorage throw로 pre-arm 안전 비활성·콘솔 에러 없음.

## 구현 순서 권장
- Task 1 먼저(헬퍼·테스트). 이후 Task 2/3/4는 서로 독립이라 병렬 가능(같은 `capturing` 패턴 반복). Task 3은 error/warn 조기 후킹이 얽혀 회귀 위험이 가장 큼 — 단독 커밋 권장.
- Task 5(privacy.md 대조)는 구현 후 마지막. 코드 변경과 별개 커밋(`docs(privacy): ...`).

## 가이드 영향
없음 — 사용자 노출 UI·조작 플로우 변경 없음(로그 탭에 보이는 결과의 완전성만 향상). guide/ko·en 갱신 불필요. (단 privacy.md는 Task 5에서 별도 대조.)
