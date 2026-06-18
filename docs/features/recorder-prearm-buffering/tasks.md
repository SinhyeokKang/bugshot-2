# 로그 레코더 Pre-arm 버퍼링 — 구현 태스크

## 선행 조건
- 새 권한·env·의존성 없음. 순수 코드 변경.
- 회귀 민감 영역(`chrome.scripting.executeScript({world:"MAIN"})` 직렬화, console `captureStack`)이라 **실탭 회귀 확인 필수**(아래 수동 테스트).
- 핵심 전제: reload는 `logClear`→`lastLogClearAt` 필터를 유발하므로, pre-arm 엔트리는 `preArm` 마커로 사이드패널 필터를 우회해야 보존된다(design.md "logClear 충돌" 참조).

## 태스크

### Task 1: pre-arm 게이트 + 필터 헬퍼 + 단위 테스트
- **변경 대상**: 신규 `src/content/recorder-prearm.ts`, 신규 `src/sidepanel/log-prearm-filter.ts`, 신규 `__tests__` 2개
- **작업 내용**:
  - `recorder-prearm.ts`: `PREARM_FLAG_KEY`, 순수 `isPreArmFlag(value)`, 부수효과 `readPreArmFlag`/`setPreArmFlag`(try/catch). **`clearPreArmFlag`는 두지 않는다**(자연 소멸).
  - `log-prearm-filter.ts`: 순수 `shouldDropPreArmEntry(timestamp, lastLogClearAt, isPreArm)`.
  - 테스트: `isPreArmFlag`(truthy/falsy), `shouldDropPreArmEntry`(경계값 — pre-arm이면 과거여도 false, 비-pre-arm 과거면 true, lastLogClearAt=0이면 항상 false).
- **검증**:
  - [ ] `isPreArmFlag("1")===true`, `null/""/"0"/"true"===false`
  - [ ] `shouldDropPreArmEntry(50, 100, true)===false`, `(50,100,false)===true`, `(50,0,false)===false`, `(150,100,false)===false`
  - [ ] `pnpm test` 통과, `pnpm typecheck` 통과

### Task 2: pre-arm 마커 데이터 모델
- **변경 대상**: `src/types/network.ts`, `src/types/console.ts`, `src/types/action.ts`
- **작업 내용**: `NetworkRequest`/`ConsoleEntry`/`ActionEntry`에 선택 필드 `preArm?: boolean` 추가. payload 타입(`src/types/picker.ts`)은 이 배열을 그대로 전달하므로 변경 불필요(확인만).
- **검증**:
  - [ ] `pnpm typecheck` 통과(기존 생성부에서 optional이라 깨지지 않음)

### Task 3: network-recorder pre-arm 적용
- **변경 대상**: `src/content/network-recorder.ts`
- **작업 내용**: init에 `const preArm = readPreArmFlag(); let capturing = preArm;`. `recordHook` 게이트(182-183)를 `if (!capturing) return`로 교체, `recording===false`로 적재 시 엔트리에 `preArm: true` 마킹. `setSentinel`에 `capturing=true; setPreArmFlag(); if (buffer.length) throttle.schedule();`. `stopHandler`는 기존 유지(플래그·capturing 무변경).
- **검증**:
  - [ ] `preArm=false`일 때 sentinel 전 요청이 버퍼에 안 쌓임(기존 동작)
  - [ ] `preArm=true`일 때 sentinel 전 요청이 `preArm:true`로 쌓이고 `setSentinel` 후 dispatch에 포함
  - [ ] `pnpm typecheck` 통과

### Task 4: action-recorder pre-arm 적용
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `preArm`/`capturing`/마커 도입, `pushAction`(52-53)·input dedup 분기(157-158) 게이트를 `capturing` 기준으로 교체. `setSentinel`(384-401)에 `capturing=true; setPreArmFlag();` + 소급 flush, 기존 `entryNavOnBind`·`entryNavEmitted` 가드 유지. `stopHandler` 기존 유지.
- **검증**:
  - [ ] `preArm=true`에서 sentinel 전 클릭/입력이 `preArm:true`로 쌓이고 flush에 포함
  - [ ] 진입 네비(`load`) 레코드가 pre-arm 캡처분과 중복되지 않음(`entryNavEmitted` 가드)
  - [ ] `pnpm typecheck` 통과

### Task 5: console-recorder pre-arm 적용 (+ error/warn 조기 후킹) — 단독 커밋
- **변경 대상**: `src/content/console-recorder.ts`
- **작업 내용**: `preArm`/`capturing`/마커 도입, `pushEntry` 게이트(52-53)를 `capturing` 기준으로 교체. `preArm===true`이면 init에서 `installConsoleWrap(console, ewState, …)` 호출(error/warn을 `document_start`에 후킹 — `ewState.installed` 멱등 가드로 `setSentinel` 재호출 무시). **uninstall 경로 보강**: pagehide(282)에 `restoreConsoleWrap(console, ewState)` 추가(sentinel 미도착 시 stopHandler 없이도 원복). `setSentinel`에 `capturing=true; setPreArmFlag();` + 소급 flush.
- **검증**:
  - [ ] `preArm=true`에서 sentinel 전 `console.log/info/debug` 및 `console.error/warn`이 `preArm:true`로 쌓임
  - [ ] `preArm=false`에서 error/warn 후킹이 설치되지 않음(현행 attribution 오염 회피 유지)
  - [ ] pagehide 시 `restoreConsoleWrap` 호출돼 원복(멱등, stop과 중복 안전)
  - [ ] `pnpm typecheck` 통과

### Task 6: usePickerMessages 필터 우회
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `networkRecorder.data`/`consoleRecorder.data`/`actionRecorder.data` 머지의 `lastLogClearAt` 필터(191-192, 215-216, 238-240)를 `shouldDropPreArmEntry(ts, lastLogClearAt, !!entry.preArm)` 기준으로 교체. pre-arm 엔트리는 reload 경계 과거여도 보존.
- **검증**:
  - [ ] `lastLogClearAt>0`이고 엔트리 `preArm:true`면 보존, `preArm` 없고 과거면 폐기(기존 동작)
  - [ ] reload 직후 pre-arm flush 엔트리가 화면에 남음(수동/e2e)
  - [ ] `pnpm typecheck` 통과

### Task 7: privacy.md 대조
- **변경 대상**: `docs/privacy.md` (대조 후 필요 시)
- **작업 내용**: 캡처 시작 시점이 active origin에서 `document_start`로 앞당겨지는 동작 반영 여부 판단. 데이터 종류·전송 조건(sentinel 없으면 전송 0) 불변이나 "기존 권한의 새 캡처 타이밍" 게이트 해당 → 필요 시 시행일 갱신.
- **검증**:
  - [ ] privacy.md 로그 캡처 설명과 새 동작 정합 확인(수정 또는 "변경 불요" 결론 기록)

## 테스트 계획

- **단위 테스트**: `recorder-prearm.test.ts`(`isPreArmFlag`), `log-prearm-filter.test.ts`(`shouldDropPreArmEntry` 경계값). action-recorder의 `entryNavEmitted` 중복 방지가 pre-arm 캡처 load와 setSentinel 보충 load 사이에서도 유지되는지 헬퍼 단위로 확인(추출 가능 시).
- **e2e 시나리오**(`/e2e-write` 입력 후보 — 결정론적 marker 기반):
  - "active origin에서 reload 시, 테스트 페이지가 `document_start`에서 발사한 **고유 marker URL fetch**가 로그 탭(`[data-entry-id]`)에 나타난다." (셀렉터 기존: `subtab-network`, `data-entry-id`, origin filter 모두 실재. marker로 logClear 경합과 무관하게 결정론적 판정)
  - (음성, 판정 가능 시) "미사용 origin에서는 reload해도 marker 요청이 로그에 안 쌓인다." — 고정 대기 후 count 0.
- **수동 테스트**(자동화 곤란 — MAIN world IIFE·V8 스택·실탭 의존):
  - [ ] **console error/warn 조기 후킹**(Task 5 핵심 회귀): 로드 즉시 `console.error`를 찍는 페이지를 active 상태에서 새로고침 → 초반 에러가 잡히고 **스택/소스 attribution이 안 깨지는지**(`captureStack` slice).
  - [ ] 페이지 Sentry/에러 모니터링 있는 사이트에서 조기 후킹이 페이지 에러 트래킹을 안 깨는지.
  - [ ] pagehide 시 error/warn wrap 원복 확인(sentinel 미도착 후 네비 시 native console 복원).
  - [ ] bugshot 미사용 origin 무부하 유지(후킹 있으나 적재 0).
  - [ ] sandboxed iframe에서 sessionStorage throw로 pre-arm 안전 비활성·콘솔 에러 없음.
  - [ ] flush 후 `totalSeen` 카운트 배지 정합(pre-arm 적재분 포함).

## 구현 순서 권장
- Task 1(헬퍼·테스트) → Task 2(타입 마커) 먼저. 이후 Task 3/4/5는 서로 독립이라 병렬 가능. **Task 5(console error/warn 조기 후킹)는 회귀 위험이 가장 커 단독 커밋**. Task 6(필터 우회)은 Task 2(마커 필드) 의존 — 마커 없이는 우회 불가. Task 7은 마지막, 코드와 별개 커밋(`docs(privacy): ...`).

## 가이드 영향
없음 — 사용자 노출 UI·조작 플로우 변경 없음(로그 탭 결과의 완전성만 향상). 사용자 노출 "녹화 중" UI(`RecordingState`)는 video 캡처 phase 전용이라 무관. guide/ko·en 갱신 불필요. (privacy.md는 Task 7에서 별도 대조.)
