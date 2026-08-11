# 레코더 게이트·무결성 (audit-refactor-3) — 구현 태스크

## 선행 조건

- **착수 전 필독**: CLAUDE.md "pre-arm 버퍼링 (동기 IIFE 빌드 제약)"·"iframe 로그 커버리지", `docs/ARCHITECTURE.md` 210·212·214·216·226·238행, `scripts/check-prearm-chunk.mjs` 주석.
- **POSTMORTEM 소환**(CLAUDE.md 요구 회로): `docs/POSTMORTEM.md:559-567`(MAIN world 레코더가 원본 `XHR.open`보다 먼저 기록하면 idle에서도 페이지 요청을 깨뜨린다 — 이번 배치가 같은 함수를 건드린다), `:973`(standalone 번들 복제 사전·pre-arm 청크 계열), `:258-260`(레코더가 document capture로 듣는 이벤트를 다른 코드가 끊어 액션 로그가 통째로 빌 뻔한 전례).
- 새 의존성 없음. 권한·env·manifest 변경 없음.
- 빌드는 `/build` 또는 명시 요청 시에만. 타입 확인은 `pnpm typecheck`.

## 태스크

### Task 1: `recorder-globals.ts` — document_start 내장 스냅샷 (항목 8 선행)

- **변경 대상**: `src/content/recorder-globals.ts` (신규)
- **작업 내용**: 모듈 평가 시점에 `JSON.parse`/`JSON.stringify`/`URLSearchParams`/`EventTarget.prototype.{addEventListener,removeEventListener,dispatchEvent}`/`CustomEvent`를 캡처해 export. 부수효과 없음. **`src/content/` 밖 import 0**.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 파일에 `@/`로 시작하는 런타임 import가 없다(`import type`만 허용)
  - [ ] `grep -rn "recorder-globals" src/` 결과가 `src/content/` 안으로만 한정된다

### Task 2: `maskBody` 마스킹 무결성 (항목 8)

- **변경 대상**: `src/content/network-recorder-helpers.ts:98-146`
- **작업 내용**: `maskBody`·`maskJsonBody`의 `JSON.parse`/`JSON.stringify`/`new URLSearchParams`를 Task 1 스냅샷으로 교체. 시그니처·반환 동작 불변.
- **검증**:
  - [ ] 신규 유닛: `globalThis.JSON.parse`를 throw로 바꾼 뒤에도 `maskBody('{"token":"x"}', "application/json")`이 `***` 마스킹을 유지
  - [ ] 신규 유닛: `globalThis.JSON.stringify`를 오염시켜도 결과가 정상
  - [ ] 신규 유닛: `globalThis.URLSearchParams`를 오염시켜도 urlencoded 분기의 `password=***` 마스킹 유지
  - [ ] 기존 `network-recorder-helpers.test.ts` 전부 통과

### Task 3: sentinel 다중 등록 레지스트리 (항목 6-a)

- **변경 대상**: `src/content/sentinel-registry.ts`(신규), `src/content/network-recorder.ts:576-637`, `src/content/console-recorder.ts:275-336`, `src/content/action-recorder.ts:560-623`(각 파일의 sentinel 블록)
- **작업 내용**: `createSentinelRegistry(cap = 8)` 순수 함수 작성. 각 레코더에서 `currentSentinel` 단일 슬롯 + `detachSentinelListeners()`를 레지스트리로 교체 — `dispatch()`는 등록된 모든 sentinel로 발화, `stop`/`sync`/`clear` 리스너는 sentinel별로 유지, 캡 evict 시 그 sentinel의 리스너 3종을 해제. 같은 sentinel 재등록은 멱등 no-op(`rebroadcastSentinelsToFrame` 대응).
- **검증**:
  - [ ] 신규 유닛(`sentinel-registry.test.ts`): 멱등 add / FIFO evict / `list()` 순서 / `evicted()` 반환
  - [ ] `pnpm typecheck` 통과
  - [ ] 코드 리뷰: `detachSentinelListeners`가 세 파일 모두에서 사라졌다
  - [ ] e2e `logs-iframe.spec.ts`(같은 sentinel 재발행) 통과
  - [ ] e2e `log-capture.spec.ts`(arm→stop→재arm) 통과

### Task 4: 이벤트 API 스냅샷 적용 (항목 6-b)

- **변경 대상**: `src/content/network-recorder.ts`·`console-recorder.ts`·`action-recorder.ts`의 모든 `document.addEventListener`/`removeEventListener`/`document.dispatchEvent`/`new CustomEvent` 호출
- **작업 내용**: Task 1 스냅샷 경유로 교체. **`window.addEventListener("pagehide")`·`document.addEventListener("visibilitychange")`·`window.addEventListener("error"/"unhandledrejection")`도 포함** — 페이지가 후킹하면 flush·에러 캡처가 죽는다.
- **검증**:
  - [ ] `grep -n "document.addEventListener\|document.dispatchEvent\|new CustomEvent" src/content/{network,console,action}-recorder.ts` 결과 0
  - [ ] e2e `log-capture.spec.ts`·`logs-error-warn.spec.ts`·`logs-cross-page.spec.ts` 통과
  - [ ] 수동: 페이지가 `EventTarget.prototype.addEventListener`를 후킹해도 로그가 계속 잡힌다

### Task 5: ctrl 전역을 불투명 마커로 (항목 7)

- **변경 대상**: `src/content/network-recorder.ts:646`, `console-recorder.ts:350`, `action-recorder.ts:632`
- **작업 내용**: `= { setSentinel, clearBuffer }` → `= true`. 각 파일 첫 줄의 중복 가드(`if ((window as any)[CTRL_KEY]) return;`)는 그대로 동작.
- **검증**:
  - [ ] `grep -rn "__bugshot_.*_ctrl__" src/ e2e/` 결과가 각 파일의 선언·가드뿐(외부 소비처 0 재확인)
  - [ ] e2e `log-capture.spec.ts` 통과(중복 초기화 가드가 여전히 동작)

### Task 6: pre-arm 유예 시한 (항목 9)

- **변경 대상**: `src/content/network-recorder.ts`·`console-recorder.ts`·`action-recorder.ts`(각 init + `setSentinel`)
- **작업 내용**: `capturing`이 `readPreArmFlag()` 유래로 켜진 경우에만 `PREARM_GRACE_MS = 15000` 타이머 설치. 만료 시 `capturing = false` + 버퍼 clear(+ console은 `restoreConsoleWrap(console, ewState)`). `setSentinel`에서 타이머 해제.
- **검증**:
  - [ ] e2e `logs-prearm.spec.ts` 2케이스 통과(정상 pre-arm은 무영향)
  - [ ] 수동: 패널을 열지 않은 채 페이지에서 `sessionStorage.setItem("__bugshot_recorder_active__","1")` 후 reload → 15초 뒤 `chrome://extensions`에 확장 attribution 경고가 더 누적되지 않는다
  - [ ] 수동: 위 상태에서 패널을 열면 정상 arm된다(타이머 만료 후에도 `setSentinel`이 살아 있음)

### Task 7: console counters/timers 라벨 캡 (항목 15)

- **변경 대상**: `src/content/console-recorder.ts:175-225`
- **작업 내용**: `counters`·`timers` Map에 `MAX_LABELS = 200` 상한 — 초과 시 가장 오래된 키 삭제(insertion order 이용). `console.count`의 카운트 누적·`console.time`의 시작 시각 기록은 게이트 밖에 유지(설계 결론).
- **검증**:
  - [ ] 수동/e2e: 미armed 페이지에서 임의 라벨 500개로 `console.count` 호출 후 Map 크기가 200을 넘지 않는다(개발자도구 heap 또는 arm 후 로그 관찰)
  - [ ] 수동: `console.time("a")` → arm → `console.timeEnd("a")`가 여전히 정확한 ms를 찍는다(`"?"`가 아님)
  - [ ] e2e `log-capture.spec.ts` 통과

### Task 8: action input dedup throttle (항목 16)

- **변경 대상**: `src/content/action-recorder.ts:261-267`
- **작업 내용**: dedup 분기의 `return` 직전에 `throttle.schedule()` 추가.
- **검증**:
  - [ ] e2e(신규 또는 `action-log-scope.spec.ts` 확장): 입력 필드에 연속 타이핑 후 **다른 액션 없이** 사이드패널 액션 로그의 값이 최신 입력으로 갱신된다
  - [ ] 수동: 긴 문자열 타이핑 중 패널 메시지 폭주·프리즈가 없다(위험 요소 6)

### Task 9: `statusKind` 병기 — 타입·레코더 (항목 31 전반부)

- **변경 대상**: `src/types/network.ts`, `src/content/network-recorder.ts:200-208,399-406,443-459`
- **작업 내용**: `NetworkStatusKind` union + `NetworkRequest.statusKind?` 추가. 레코더가 `statusText`는 **그대로 두고** `statusKind`를 병기.
  - XHR: `error`→`networkError` / `abort`→`aborted` / `timeout`→`timeout`
  - sendBeacon: `queued`/`queueFull`
  - fetch 실패: `error instanceof Error`가 **아닐 때만** `networkError`(현행 `isStatusHidden` 판정과 정확히 일치)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm build && pnpm check:prearm` → `✓ pre-arm 청크 정상`(type-only import라 청크 무영향 확인)
  - [ ] e2e `log-capture.spec.ts`·`websocket-log.spec.ts` 통과

### Task 10: `isStatusHidden` 하위호환 강화 (항목 31 중반부)

- **변경 대상**: `src/lib/network-status.ts:5-9`
- **작업 내용**: `statusKind === "networkError"` 우선, `statusKind`가 `undefined`일 때만 기존 `statusText === "Network Error"` 폴백.
- **검증**:
  - [ ] 신규 유닛(`network-status.test.ts` 확장): `statusKind:"networkError"` → true / `statusKind` 없고 `statusText:"Network Error"` → true(옛 저장 로그) / `statusKind:"aborted"` → false / `statusKind:"timeout"` → false
  - [ ] 기존 6케이스 전부 통과

### Task 11: UI 번역 + 두 사전 (항목 31 후반부)

- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx:504-513`, `src/i18n/namespaces/logs.ts`(ko·en), `src/log-viewer/i18n.ts`(`koDict`·`enDict`), `src/sidepanel/lib/aiLogsManual.ts:46`
- **작업 내용**: `networkLog.display.{queued,queueFull,aborted,timeout}` 4키를 **네 곳 모두** 추가. 상태 줄을 "`statusKind` 있으면 라벨, 없으면 `${status} ${statusText}`"로 분기. `aiLogsManual`의 networkLog 필드 목록에 `statusKind` 한 줄 추가.
- **검증**:
  - [ ] i18n 훅(`src/i18n/` 저장 시 자동 실행)이 ko/en 대칭·placeholder 검사 통과
  - [ ] `pnpm test`의 `src/log-viewer/__tests__/i18n.test.ts` 통과(복제 사전 값 일치)
  - [ ] 수동: ko 로케일에서 sendBeacon 요청 상세가 `0 Queued`가 아닌 번역 라벨로 보인다
  - [ ] 수동: CORS 실패 행이 여전히 "실패 · 상태 가려짐" + `blockedHint`로 보인다

### Task 12: arm 경계 XHR 유령 pending 제거 (항목 35)

- **변경 대상**: `src/content/network-recorder.ts:308-315`
- **작업 내용**: `recordXhrSend` 진입 직후 `meta`가 없으면 즉시 return(엔트리 push·`totalSeen++` 스킵). `XHR.send`(:295-306)의 try/catch + `originalSend` 항상 호출 구조는 **그대로 유지**(POSTMORTEM 2026-07-23).
- **검증**:
  - [ ] 수동: 패널을 열기 직전 `xhr.open()`한 뒤 arm 후 `send()` → 네트워크 로그에 `url:""` 빈 pending 행이 생기지 않는다
  - [ ] 수동: 정상 arm 상태의 XHR은 여전히 pending→complete로 전이한다
  - [ ] e2e `log-capture.spec.ts`·`network-body-search.spec.ts` 통과

### Task 13: network `pushEntry` 첫 줄 게이트 (항목 67)

- **변경 대상**: `src/content/network-recorder.ts:122-125`
- **작업 내용**: `if (!capturing) return;` 추가. 호출부 4곳의 기존 게이트는 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] e2e `log-capture.spec.ts`·`logs-origin-filter.spec.ts` 통과(적재 자체가 안 막혔는지)

### Task 14: 부수 정리 (항목 77)

- **변경 대상**: `src/content/action-recorder.ts:258`(주석), `src/content/picker.ts:621-659`(`handleClear`)
- **작업 내용**: 주석의 "recording 게이트" → `capturing` 게이트로 정정. `handleClear`에서 `selectionUpdateTimer`(`picker.ts:1181`) 취소 + null화.
- **검증**:
  - [ ] `grep -n "recording 게이트" src/content/action-recorder.ts` 결과 0
  - [ ] e2e `picker-guard.spec.ts`·`style-edit-flow.spec.ts` 통과(선택 해제 후 잔여 타이머 부작용 없음)

### Task 15: 문서 정합 (항목 66 + 6·9 반영)

- **변경 대상**: `docs/ARCHITECTURE.md:167`·`:212`·`:214`
- **작업 내용**:
  - `:167` — "임의 iframe 스크립트의 무인증 postMessage 등록을 **차단한다**"를 코드 보장 수준으로 완화("픽커 없는 iframe의 우발적 등록을 거른다 — 악의적 페이지에 대한 인증은 아니다, 아래 경고 참조"). `:169` 경고 블록은 이미 정확하므로 유지.
  - `:212` — 위조 주입 수용 서술에 "수집 무력화는 sentinel 다중 등록으로 막는다"를 추가.
  - `:214` — "미armed origin에 일절 간섭하지 않는다"를 "페이지가 pre-arm 플래그를 위조하지 않는 한"으로 한정하고 `PREARM_GRACE_MS` 유예를 명시.
- **검증**:
  - [ ] `frame-geometry.ts:86-91`(`postMessage(..., "*")`)과 `:167` 서술이 모순되지 않는다
  - [ ] `:214` 서술이 Task 6 구현과 일치한다

## 테스트 계획

### 단위 테스트 (유닛으로 고정 가능한 것 — `*.test.ts`, node 환경)

레코더 IIFE 본체(`networkRecorderScript` 등)는 export되지 않아 유닛 대상이 아니다. **순수 헬퍼로 뽑히는 것만** 유닛으로 고정한다.

- `src/content/__tests__/network-recorder-helpers.test.ts` (확장) — `maskBody`가 전역 `JSON.parse`/`JSON.stringify`/`URLSearchParams` 오염에도 마스킹을 유지(항목 8). 오염 복구를 `afterEach`로 보장.
- `src/content/__tests__/sentinel-registry.test.ts` (신규) — 멱등 add / FIFO evict / `list()` 순서 / `evicted()`(항목 6).
- `src/lib/__tests__/network-status.test.ts` (확장) — `statusKind` 우선 + `statusText` 폴백 하위호환(항목 31, Task 10).
- 항목 15의 라벨 캡을 순수 함수(`capLabelMap` 류)로 뽑으면 유닛 추가 — 뽑지 않고 인라인으로 두면 수동 확인으로 남는다(외과적 범위 판단은 구현 시점).

### e2e 시나리오 (`/e2e-write` 입력)

- 액션 로그: **입력 필드에 연속 타이핑만 하고 다른 액션을 하지 않으면**, 2초 안에 사이드패널 액션 로그의 마지막 입력 값이 최신 문자열로 갱신된다(항목 16).
- 네트워크 로그: **`navigator.sendBeacon`을 호출하면**, 해당 행 상세의 상태가 원문 `Queued`가 아니라 현재 로케일 라벨로 표시된다(항목 31).
- 네트워크 로그: **CORS로 차단된 fetch를 발생시키면**, 상태가 "실패 · 상태 가려짐"과 힌트로 표시된다(항목 31 회귀 — `isStatusHidden` 생존).
- pre-arm 회귀: 기존 `e2e/logs-prearm.spec.ts` 2케이스가 **수정 없이** 통과한다(항목 9가 정상 경로를 안 건드림).
- iframe: 기존 `e2e/logs-iframe.spec.ts`가 통과한다(항목 6의 같은-sentinel 재발행 멱등).

### 수동 테스트 (Chrome, 브라우저 실동작 의존 — 자동화 불가)

> 확인 전 `pnpm build` 선행 필요(dist stale 방지).

- [ ] 페이지 콘솔에서 `document.dispatchEvent(new CustomEvent("__bugshot_net_setSentinel__",{detail:{sentinel:"evil"}}))` 실행 → **네트워크 로그 수집이 계속된다**(수정 전에는 무음 사망). console·action도 동일 확인.
- [ ] 페이지 콘솔에서 `window.__bugshot_net_ctrl__` → `true`(함수 없음), `.clearBuffer` 호출 불가.
- [ ] 페이지가 `JSON.parse = () => { throw 1 }` 후 `fetch("/x",{method:"POST",headers:{"content-type":"application/json"},body:'{"password":"p"}'})` → 로그 본문의 `password`가 `***`.
- [ ] 페이지가 `EventTarget.prototype.addEventListener`를 후킹해 이름을 로깅해도 sentinel 문자열이 노출되지 않고 수집이 유지된다.
- [ ] 미armed origin에서 `sessionStorage.setItem("__bugshot_recorder_active__","1")` + reload → 15초 후 wrap 철수(`chrome://extensions` 경고 누적 중단), 이후 패널을 열면 정상 arm.
- [ ] arm 직전 `open()` → arm 후 `send()`한 XHR이 빈 pending 행을 남기지 않는다.
- [ ] `console.time("a")`(미armed) → arm → `console.timeEnd("a")`가 정확한 ms를 찍는다.
- [ ] 네트워크 상세의 상태 라벨이 ko/en 양쪽에서 번역되고, **내보낸 logs.html의 네트워크 탭에서도** 같은 라벨로 보인다(복제 사전 확인).
- [ ] 1-depth iframe이 있는 페이지에서 iframe 로그가 계속 잡히고 출처 필터가 정상 동작한다.

## 구현 순서 권장

1. **Task 1**(스냅샷 모듈) — Task 2·4의 선행.
2. **Task 2**(항목 8), **Task 3**(레지스트리), **Task 9~11**(statusKind 3단), **Task 8**(항목 16), **Task 12**(항목 35), **Task 13**(항목 67), **Task 14**(항목 77) — **서로 독립, 병렬 가능**. 단 Task 9 → 10 → 11은 순서 의존.
3. **Task 4**(이벤트 스냅샷 적용) — Task 1·3 이후. 세 레코더의 리스너를 전부 훑으므로 Task 3과 같은 블록을 건드린다. **Task 3 다음에 붙여서** 충돌을 피한다.
4. **Task 5**(ctrl 마커), **Task 6**(pre-arm 유예), **Task 7**(라벨 캡) — Task 3·4 이후(같은 파일 상단/하단 블록).
5. **Task 15**(문서) — 마지막. Task 3·6의 실제 구현 결과를 반영해야 하므로 코드 확정 후.
6. 전 구간 후: `pnpm typecheck` → `pnpm test` → (필요 시)`pnpm build` → `pnpm check:prearm` → `/e2e-write`로 신규 시나리오 green → 레코더 관련 e2e 스위트 전체.

## 가이드 영향

**없음.** 사용자 노출 변화 3건(16·31·35)을 `guide/ko`·`guide/en`과 대조한 결과, 가이드는 네트워크 상태 라벨(`Queued`/`Aborted`/`Timeout`)이나 액션 로그의 실시간 갱신 주기를 서술하지 않는다(`guide/ko/logs/live.md`·`viewer.md` 확인, 해당 문자열 grep 0건). 다만 `guide/ko/assets/logs-live-2.jpg` 등 네트워크 서브탭 스크린샷이 상태 라벨을 담고 있으면 `/guide-shots`의 stale 탐지 대상이 될 수 있으므로, 구현 후 한 번 돌려 확인한다.
