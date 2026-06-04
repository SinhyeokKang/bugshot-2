# 사이드패널 레코더 게이팅 — 기술 설계

## 개요

세 레코더의 `recording` 기본값을 `false`로 되돌리고, "패널이 탭에 활성"을 수집의 유일한 트리거로 삼는다. activate(수집 시작)는 이미 `useBackgroundRecorder`가 패널 mount/주입 시 `setSentinel`로 처리하고 있으므로 그대로 재사용한다. 핵심 신규 작업은 두 가지다: ① `recording=false`일 때 `fetch` 래퍼가 `new Request` 재구성조차 하지 않고 원본 경로로 빠지게 하는 가드, ② 패널 닫힘/탭전환의 **확실한** stop 신호로 background `port.onDisconnect`에서 세 레코더에 stop을 보내는 것.

## 변경 범위

### `src/content/network-recorder.ts`
- 현재: `let recording = true;`(:68). `window.fetch = createPatchedFetch(originalFetch, recordHook);`(:329). XHR/sendBeacon은 `if (!recording)` 가드 보유(:361 등). `recordHook`은 `if (!recording) return () => {};`(:236)로 settle만 no-op 처리하지만, **`createPatchedFetch`는 `recording`과 무관하게 `new Request(input, init)`를 항상 실행**한다.
- 변경:
  - `let recording = true;` → `let recording = false;`
  - `createPatchedFetch(originalFetch, recordHook)` → `createPatchedFetch(originalFetch, recordHook, () => recording)` (recording 게이트 콜백 전달).

### `src/content/network-recorder-helpers.ts`
- 현재: `createPatchedFetch(originalFetch, record?)` — `record`가 있으면 항상 `new Request` 생성 후 전송(`:154-182`).
- 변경: 세 번째 선택 파라미터 `shouldRecord?: () => boolean` 추가. 함수 맨 앞에서 `if (shouldRecord && !shouldRecord()) return originalFetch.call(this, input, init);` — recording이 꺼져 있으면 **원본 input/init 그대로** 전송하고 `new Request`/`extractRequestInfo`/`record`를 모두 건너뛴다. XHR `if (!recording)` 가드와 동일한 의미를 fetch에 부여.

### `src/content/console-recorder.ts`
- `let recording = true;`(:28) → `let recording = false;`. (console 래퍼는 이미 `recording` 체크로 push를 게이트하므로 추가 변경 불필요 — 사전 확인 후 동일 패턴이면 기본값만 변경.)

### `src/content/action-recorder.ts`
- `let recording = true;`(:39) → `let recording = false;`. (DOM 이벤트 리스너의 push 경로가 `recording`으로 게이트되는지 확인 후 기본값만 변경.)

### `src/background/index.ts`
- 현재 `port.onDisconnect`(:86-89)는 `chrome.storage.session.remove(sessionKey(tabId))`와 `picker.clear`만 전송.
- 변경: 동일 핸들러에서 세 레코더에 stop 메시지 추가.
  ```ts
  port.onDisconnect.addListener(() => {
    chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "picker.clear" }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "networkRecorder.stop" }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "consoleRecorder.stop" }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "actionRecorder.stop" }).catch(() => {});
  });
  ```
  메시지 타입은 picker.ts `onMessage`가 이미 처리(`:329/341/353`)하므로 신규 타입·핸들러 불필요.

### 변경 없음 (확인만)
- `useBackgroundRecorder.ts` — mount/주입 시 activate, unmount cleanup 시 stop은 보조로 유지. cleanup이 미실행돼도 port.onDisconnect가 stop을 보장하므로 추가 변경 없음.
- `picker-control.ts` / `picker.ts` — activate/stop/sync/setSentinel/clear 경로 그대로 재사용.
- `manifest.config.ts` — 주입 설정 불변.

## 데이터 흐름

```
[content script 주입(document_start)]  recording = false (3 레코더)
        │  fetch: shouldRecord()=false → 원본 경로, new Request 없음
        │  XHR/sendBeacon: !recording 가드 → 원본 경로
        │  console/action: !recording → push 안 함
        ▼
[패널 활성화]  toolbar action / contextMenu → activateTab → sidePanel.open
        │  App.tsx: chrome.runtime.connect({ name: PANEL_PORT_PREFIX+tabId })
        │  useBackgroundRecorder.inject → activate{Network,Console,Action}Recorder(tabId)
        │     → send "….setSentinel" → picker.ts handleSetSentinel
        │     → __bugshot_*_setSentinel__ → setSentinel(): recording = true
        ▼
[수집 중]  fetch/XHR/console/action 캡처 → __bugshot_*_data__ → usePickerMessages → blob-db(pending:${tabId})
        │  페이지 이동: webNavigation.onBeforeNavigate → "….sync" (기존 cross-page 누적, 불변)
        ▼
[패널 닫힘 / 탭 전환]  패널 문서 destroy → PANEL_PORT disconnect
        │  background port.onDisconnect → tabs.sendMessage(tabId, "….stop") ×3
        │     → picker.ts handle*Stop → __bugshot_*_stop__ → recording = false; dispatch()
        ▼
[다시 무간섭]  이후 그 탭의 트래픽은 원본 경로
```

## 인터페이스 설계

```ts
// network-recorder-helpers.ts
export function createPatchedFetch(
  originalFetch: typeof fetch,
  record?: FetchRecordHook,
  shouldRecord?: () => boolean, // 추가: false면 wrap 전체를 건너뛰고 원본 경로
): typeof fetch;
```

신규 메시지 타입·store 키·union 변경은 없다(`networkRecorder.stop` 등은 기존 `PickerMessage`에 존재).

## 기존 패턴 준수

- **MAIN world self-contained**: `recording`은 각 레코더 주입 함수의 클로저 변수. `shouldRecord: () => recording`도 같은 클로저에서 생성해 직렬화 제약을 지킨다.
- **세 레코더 대칭**: network/console/action 모두 동일하게 기본값만 `false`로. 이벤트 규칙(`__bugshot_{type}_{op}__`)·picker 핸들러는 이미 대칭.
- **메시지 재사용**: `port.onDisconnect`에서 보내는 stop은 기존 메시지 타입을 그대로 사용 — `BgRequest`/`BG_REQUEST_TYPES`/union 3곳 동기화 불필요(이건 picker `PickerMessage`이지 `BgRequest`가 아님).
- **테스트 우선**: `createPatchedFetch`의 `shouldRecord` 게이트는 순수 함수 레벨이라 단위 테스트로 검증한다.

## 대안 검토

- **대안 A: `recording=true` 유지 + `port.onDisconnect`에서만 stop.** 패널을 한 번도 열지 않은 탭은 stop을 받은 적이 없어 `recording=true`로 남는다 → 게이팅 실패. 기각.
- **대안 B: content script를 on-demand 주입으로 전환(v1.1.3 방식).** manifest 상시 주입 제거. picker 등 다른 기능의 주입 타이밍·cross-page 누적까지 영향이 커지는 대규모 변경. 게이팅 목적엔 과하다. 기각.
- **채택: `recording` 기본 `false` + 패널 활성 트리거(activate) + port disconnect stop.** 기존 인프라 최대 재사용, 변경 외과적.

## 위험 요소

- **탭 전환 시 이전 탭 stop의 실제 동작은 Chrome sidePanel 구현에 의존.** 패널은 탭별 `?tabId=` path로 `setOptions`되므로(`tab-bindings.ts:40,157`) 탭 전환 시 새 path로 re-mount되며 이전 패널 문서가 destroy → `PANEL_PORT` disconnect → 이전 탭 stop이 트리거될 것으로 예상한다. 다만 이는 동작 가정이므로 **수동 검증 필수**. 만약 전환 시 이전 패널 문서가 destroy되지 않으면 비활성 탭이 `recording=true`로 남을 수 있고, 그 경우 `chrome.tabs.onActivated`에서 비활성 탭에 stop을 보내는 보완이 필요(현 설계 미포함, 검증 후 판단).
- **`recording=false`로 인한 미캡처 구간**: 패널 활성 이전 트래픽은 수집 안 됨(수용된 트레이드오프). cross-page 누적은 패널 활성 이후 구간에 대해서만 동작.
- **setSentinel 재진입**: 재activate 시 MAIN world 재주입은 `CTRL_KEY` 가드로 no-op이고 `setSentinel`만 적용되어 `recording=true`. 기존 동작과 동일, 위험 없음.
- **webNavigation sync 안전성**: `onBeforeNavigate`의 sync는 `sessionKey(tabId)` 존재(=패널 활성) 시에만 발화하고 `recording` 상태를 바꾸지 않으므로 기본값 변경과 무관.
- **회귀 감지 공백**: 현재 `recording` 게이트를 검증하는 테스트가 없다. `shouldRecord=false` 케이스 테스트를 신규 추가해 회귀를 잡는다.
