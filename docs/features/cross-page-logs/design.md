# Cross-page 로그 누적 + Replay 30초 트림 — 기술 설계

## 개요

네트워크·콘솔 로그의 단일 누적기를 사이드패널 `editor-store`의 `networkLog`/`consoleLog`에 둔다. 레코더 sync 데이터를 받을 때 **교체가 아니라 id 기준 머지**로 쌓고, idle 표준대기 중 네비게이션이 일어나도 누적기를 리셋하지 않는다. 떠나는 페이지의 로그 꼬리는 **`webNavigation.onBeforeNavigate`로 떠나는 탭에 즉시 sync를 트리거**해 누적기에 넘기고(주 경로), MAIN world 레코더의 `pagehide` flush를 보조로 둔다 — 둘 다 unload race에 노출되는 best-effort라 100% 보장은 아니며 SPA 라우팅은 MAIN world 유지로 자연 누적된다. Replay 캡처 시에만 누적기를 프레임 버퍼 커버 구간(하한·상한 양쪽)으로 트림해 첨부하고, video 녹화 모드는 시작 시 누적기를 클리어해 녹화 구간만 담는 현행 동작을 유지한다.

## 변경 범위

### 신규: `src/sidepanel/lib/log-merge.ts`
순수 헬퍼. 단위 테스트 동반(`__tests__/log-merge.test.ts`).
- `mergeLogItems<T extends { id: string }>(existing, incoming, getTime, maxEntries): T[]` — id dedup(incoming이 갱신본으로 덮어씀, pending→complete 반영), `getTime` 기준 오름차순 정렬, `maxEntries` 초과 시 oldest부터 제거.
- `trimByTime<T>(items, getTime, lower, upper?): T[]` — `lower <= getTime(item) <= upper` 필터(상한 생략 시 하한만). replay 트림은 `[frames[0].timestamp, captureTime]` 양쪽을 넘긴다.
- `rebuildNetworkLog(existing, mergedRequests)` / `rebuildConsoleLog(existing, mergedEntries)` — 머지된 배열로 `startedAt`(첫 엔트리 시각)·`endedAt`(now)·`captured`(머지 길이)·`totalSeen`(`max(기존, incoming, 머지 길이)`)·`warnings`(union) 메타를 재계산하는 순수 함수. usePickerMessages가 호출. 단위 테스트 표적(빈 incoming, warnings union, totalSeen max, captured ≤ totalSeen 불변).
- 상수 `NETWORK_MAX_ENTRIES = 5000`, `CONSOLE_MAX_ENTRIES = 2000` (기존 MAIN 레코더 cap과 동일).

### `src/sidepanel/hooks/usePickerMessages.ts`
- 현재: `networkRecorder.data`/`consoleRecorder.data` 핸들러가 `crypto.randomUUID()`로 새 로그를 만들어 `setNetworkLog`/`setConsoleLog`로 **교체**.
- 변경: 기존 store 로그의 `requests`/`entries`에 incoming을 `mergeLogItems`로 **머지** → `rebuildNetworkLog`/`rebuildConsoleLog`로 메타 재계산해 set. `id`는 기존 로그 id 재사용(`existing?.id ?? crypto.randomUUID()`). 메타 재계산은 순수 헬퍼(log-merge.ts)에 위치 — 핸들러는 머지+재조립만.
- **프리즈 가드**: `phase`가 `drafting`/`previewing`/`done`이면 머지하지 않고 즉시 반환(캡처 후 도착한 지연 sync가 첨부 로그를 흔들지 않도록). `isLogFrozen(phase)` 헬퍼 추가.

### `src/sidepanel/hooks/useBackgroundRecorder.ts`
- 현재: `onTabUpdated`에서 page key 변경 시 `!shouldPreserveBackgroundLogs(phase)`면 `setState({ networkLog: null, consoleLog: null })` + pending 삭제 + `clearNetworkRecorder`/`clearConsoleRecorder` 호출(idle 표준대기 = 페이지 단위 리셋).
- 변경: 이 **네비게이션 리셋 블록 제거**. page key 변경 시 `recordersStopped.current = false`만 유지하고 `status==="complete"`에서 재주입은 그대로. → idle 표준대기 중 누적기가 cross-page로 쌓인다.
- 유지: 녹화 정상 종료 억제 블록(`recording`→`drafting`), 이슈 완료 후 idle 복귀 세션 경계 리셋(`idle && shouldPreserveBackgroundLogs(prev)` → pending 삭제 + MAIN clear + 재주입). `shouldPreserveBackgroundLogs`도 이 블록에서 계속 사용.

### `src/background/index.ts` (신규: webNavigation 주 경로)
- 떠나는 페이지 꼬리 보존의 **주 경로**. `chrome.webNavigation.onBeforeNavigate`(frameId===0, 활성화 탭)에서 해당 탭에 즉시 sync를 트리거해 현재 MAIN 버퍼를 누적기로 넘긴다 — 네비게이션 커밋 전에 발화하므로 `pagehide`보다 이른 시점.
- **권한 추가**: `manifest.config.ts`의 `permissions`에 `"webNavigation"` 추가. → CLAUDE.md 게이트웨이 permissions 목록 + 문서 신선도 갱신 대상.
- **여전히 best-effort**: sync→dispatch→sendMessage→usePickerMessages 머지가 비동기 IPC라 navigation commit과의 race는 남는다. 다만 onBeforeNavigate는 커밋 전 시점이라 `pagehide`보다 도달 확률이 높다.

### `src/content/network-recorder.ts`, `src/content/console-recorder.ts` (보조: pagehide flush)
- MAIN world가 풀 네비게이션으로 파괴되기 직전 버퍼를 flush(보조 경로):
  ```ts
  window.addEventListener("pagehide", () => dispatch());
  ```
- `dispatch()`는 `currentSentinel` 없으면 no-op이라 가드 불필요. CustomEvent → `picker.ts`의 `__bugshot_{net,console}_data__` 리스너까지는 동기 전파지만, **마지막 `chrome.runtime.sendMessage`는 비동기 IPC**다. pagehide 핸들러 반환 후 페이지가 즉시 파괴되면 in-flight 메시지가 유실될 수 있어 **best-effort**(주 경로 onBeforeNavigate의 보조). 도달하면 dedup으로 중복 없이 머지된다.

### `src/store/editor-store.ts`
- 실제 액션 매핑(검증 결과): **element = `startPicking`**(278행, `...initial` 리셋), **screenshot = `startCapturing`**(283-291행 — 이미 `networkLog`/`consoleLog`를 보존 중, 단 `networkLogAttach`/`consoleLogAttach`는 `...initial`로 false 리셋), **freeform = `startFreeform`**(292행, `...initial` 리셋 + 즉시 `phase: "drafting"`), **video = `startRecording`**.
- 변경:
  - `startPicking`(element): 4개 로그 필드(`networkLog`/`consoleLog`/`networkLogAttach`/`consoleLogAttach`) **보존**. `set((state) => ({ ...initial, networkLog: state.networkLog, ... }))` 형태. 다른 필드(selection·screenshot 등)는 반드시 리셋 유지.
  - `startCapturing`(screenshot): log는 이미 보존 중 → `networkLogAttach`/`consoleLogAttach` 2개를 **추가 보존**(attach 토글 유지).
  - `startFreeform`(freeform): 4개 로그 필드 보존. **단 즉시 drafting이라** 보존만으로는 진입 직전 누적이 프리즈 가드에 막힐 수 있음 → 진입 직전 1회 sync가 머지된 뒤 drafting이 되도록 순서 보장(아래 위험 요소·`startFreeformDraft` 참조).
- `startRecording`(video)는 **변경하지 않는다** — `...initial` 리셋 유지(녹화 fresh 시작). video-capture의 명시적 MAIN clear/pending 삭제도 그대로.
- 신규 액션: `clearNetworkLog(tabId)`, `clearConsoleLog(tabId)` — 해당 store 로그 null + `deleteNetworkLog`/`deleteConsoleLog(pending:tabId)` + **`clearNetworkRecorder`/`clearConsoleRecorder(tabId)`(MAIN buffer)까지 한 곳에서 처리**(세션 경계 리셋 패턴과 동일하게 store 액션이 MAIN clear 책임을 가짐). 호출부는 tabId만 넘김.

### `src/sidepanel/30s-replay/use-30s-replay.ts`
- `capture()`에서 `frames = bufferRef.current.snapshot()` 직후 누적기를 트림:
  - **sync를 await**한다 — 현재 `syncNetworkRecorder`/`syncConsoleRecorder`는 fire-and-forget(`.catch(()=>{})`)이라 트림 시점에 최신 sync가 store에 반영됐다는 보장이 없다. capture 흐름에서 sync 완료(머지까지)를 기다린 뒤 트림.
  - `lower = frames[0].timestamp` (버퍼 최오래 프레임 = mp4 시작), `upper = captureTime`(=now). `trimByTime(log.requests, r => r.startTime, lower, upper)`로 새 로그 구성해 `setNetworkLog`. console도 동일(`e => e.timestamp`). **상·하한 양쪽** 트림.
  - 트림 **직후 즉시** `onRecordingComplete`(→ drafting)로 phase 전환 → 그 사이 idle 윈도우 없이 프리즈 가드 발효. 이후 지연 sync는 무시되어 트림이 고정된다.

### `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`
- `PageFooter` 내부를 `flex justify-end` → **`flex items-center justify-between gap-2`** 로 바꾸고 **좌측에 [Clear Log] 버튼** 추가(우측 startDraft 버튼 유지). Settings > General footer의 [Privacy Policy] 배치/패턴과 동일.
- 버튼 디자인은 **Settings > General의 [Privacy Policy] 버튼과 일치**: `Button variant="outline"` + **텍스트 라벨만**(lucide 아이콘 없음). (`SettingsTab.tsx:223-228` 참조)
- **클릭 즉시 초기화 — 별도 컨펌 다이얼로그 없음. 버튼 색상은 중립 outline 유지**(Privacy Policy와 동일, destructive 색상 안 씀 — 사용자 결정). 핸들러(각 서브탭 해당 로그만, MAIN clear는 store 액션 내부에서 처리):
  - Console: `clearConsoleLog(tabId)`.
  - Network: `clearNetworkLog(tabId)`.
- **빈 상태 disabled**: `entries.length === 0`(또는 `requests.length === 0`)이면 버튼 `disabled`. 무의미 클릭 방지.
- **tabId null 가드**: `useBoundTabId()`가 null이면 버튼 disabled(또는 store만 clear). SubTab의 sync가 쓰는 `tabIdRef.current != null` 가드와 일관.
- i18n 키 신규: **`logs.ts` namespace**(`networkLog.*`/`consoleLog.*`가 이미 모여 있는 곳)에 `networkLog.clear`/`consoleLog.clear` 추가. 라벨 = ko "로그 지우기" / en "Clear Log" (양 서브탭 동일, 탭 맥락으로 구분). ko/en 동시.

## 데이터 흐름

```
[MAIN world recorder]                    [side panel]
 fetch/console 패치 → buffer               editor-store.networkLog/consoleLog (누적기)
   │  (per-page, cap 5000/2000)              ▲
   ├─ sync (서브탭 1.5s 주기 / capture)  ───┤ usePickerMessages: mergeLogItems + rebuild
   ├─ onBeforeNavigate sync (주, BG)  ──────┤   (dedup·cap, drafting+ 프리즈)
   └─ pagehide flush (보조, best-effort) ───┘
                                              │
  idle 네비게이션: 리셋 안 함 (누적 지속)        │
  이슈 완료→idle: 세션 경계 리셋               ▼
                                          첨부 시점:
                                          - element/screenshot/freeform: 누적기 그대로
                                          - video: startRecording이 비우고 녹화구간만
                                          - replay: trimByTime(frames[0].timestamp, captureTime) 양쪽
```

## 인터페이스 설계

```ts
// src/sidepanel/lib/log-merge.ts
export const NETWORK_MAX_ENTRIES = 5000;
export const CONSOLE_MAX_ENTRIES = 2000;

export function mergeLogItems<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  getTime: (item: T) => number,
  maxEntries: number,
): T[];

export function trimByTime<T>(
  items: T[],
  getTime: (item: T) => number,
  lower: number,
  upper?: number,   // 생략 시 하한만; replay는 [lower, upper] 양쪽
): T[];

export function rebuildNetworkLog(existing: NetworkLog | null, merged: NetworkRequest[]): NetworkLog;
export function rebuildConsoleLog(existing: ConsoleLog | null, merged: ConsoleEntry[]): ConsoleLog;

// src/store/editor-store.ts (신규 액션)
clearNetworkLog: (tabId: number | null) => void;  // networkLog=null + deleteNetworkLog(pending) + clearNetworkRecorder(tabId)
clearConsoleLog: (tabId: number | null) => void;  // consoleLog=null + deleteConsoleLog(pending) + clearConsoleRecorder(tabId)
```

엔트리 timestamp 필드(이미 존재): `NetworkRequest.startTime`, `ConsoleEntry.timestamp`.

## 기존 패턴 준수

- **머지/트림은 순수 함수로 분리** + Vitest 단위 테스트 (CLAUDE.md 테스트 우선).
- **세션 영속화**: pending IDB(`pending:${tabId}`) 갱신 패턴 유지 — 머지된 로그를 매 sync마다 저장.
- **i18n 동시 갱신**: Clear Log 라벨 ko/en 둘 다.
- **IconButton/Button 사이즈**: footer 버튼은 기존 startDraft와 동일 `Button variant="outline"`(기본 size). 별도 IconButton 도입 안 함.
- **메시지 비동기 응답**: 레코더 sync/dispatch 기존 sentinel 패턴 그대로(신규 메시지 타입 없음).

## 대안 검토

1. **누적기 분리(per-page MAIN + 별도 cross-page store)**: screenshot/element/video를 현행 그대로 두고 replay만 별도 누적기를 읽는 안. 기존 모드 무변경이 장점이나, 누적기 store 신설 + 페이지 이탈 시 drain 로직 + 두 뷰 동기화로 복잡도가 크게 증가. → 사용자가 "screenshot도 cross-page 공유"를 택해 **기각**.
2. **주기 sync(~3s) 폴링으로 cross-page 수집**: 별도 store 없이 주기적으로 sync해 머지. 그러나 풀 네비게이션 시 떠난 페이지의 마지막 ~폴링간격 분량이 MAIN 파괴로 유실. → `onBeforeNavigate` sync(주) + `pagehide` flush(보조)로 대체해 **기각**. (단 둘 다 best-effort라 풀 네비게이션 꼬리 100% 보장은 못 함 — 위험 요소 참조.)
3. **Replay 트림을 고정 `now - 30000`으로**: 단순하지만 프레임 버퍼가 개수 cap·게이팅으로 30초 미만일 때 로그가 mp4보다 길어짐. → `frames[0].timestamp` 기준으로 **기각**.

## 위험 요소

- **`startPicking`/`startCapturing`/`startFreeform` 로그 보존 변경**: `...initial` 일괄 리셋에서 로그 필드만 빼내는 변경(element=4필드, screenshot=attach 2필드 추가, freeform=4필드). 다른 필드(selection·screenshot 등)는 반드시 리셋 유지. 회귀 시 element/screenshot 드래프트에 이전 캡처 잔상이 남을 수 있으니 실제 탭에서 모드 전환 회귀 확인 필수.
- **`startFreeform` 즉시 drafting + 프리즈 가드**: freeform은 진입과 동시에 `phase: "drafting"`이라, 로그를 보존해도 진입 직후부터 프리즈 가드가 머지를 막는다. `startFreeformDraft`(picker-control)의 진입 sync가 **drafting 전에** 머지되도록 순서를 보장해야 진입 직전 누적이 반영됨. 타이밍 의존이 남으면 진입 스냅샷이 부정확해질 수 있어 회귀 확인.
- **`onBeforeNavigate`/`pagehide` 신뢰성(둘 다 best-effort)**: `onBeforeNavigate` sync는 navigation commit 전 발화라 도달 확률이 높지만 sendMessage 비동기 IPC라 race 잔존. `pagehide`는 페이지 파괴 직전이라 더 약함(bfcache·강제 종료 누락). 현재 페이지는 capture sync로 항상 완전 포착되므로 영향은 "떠난 페이지 꼬리"에 한정 — PRD 성공기준도 이를 best-effort로 명시.
- **메모리 누적 비용**: cross-page 누적은 idle 표준대기가 길어질수록(패널 켜두고 장시간 방치) 5000/2000 cap까지 단조 증가하며 줄지 않는다(per-page 시절엔 풀 네비게이션마다 자연 회수됐음). 개수 cap이 사실상의 상한 — 별도 byte cap은 비목표. 30s Replay 메모리 예산과 별개 트랙.
- **sync 주기마다 풀 재정렬 비용**: 5000/2000 cap까지 차면 매 sync(1.5s 주기 + onBeforeNavigate + capture)마다 누적 배열 전체 O(n log n) 정렬 + Map 구축 반복. idle 장시간 부하. 단순성 우선이라 현 설계 수용하되, 체감 부하 시 incoming append-mostly 가정의 삽입 머지로 최적화 여지.
- **video 녹화 경계**: idle 누적기가 차 있는 상태에서 녹화 시작 시 `startRecording`의 `...initial`이 반드시 로그를 비워야 함. 이 액션을 보존 대상에 넣지 않도록 주의(보존은 picking/freeform만).
- **프리즈 가드와 서브탭 주기 sync**: 로그 탭 서브탭은 active 시 1.5s 주기 sync한다. drafting+ 단계에서 로그 탭을 보면 sync가 와도 프리즈 가드로 머지 안 됨 — 의도된 동작이나 "표시가 안 갱신됨"으로 오인되지 않도록 확인.
- **totalSeen 근사**: cross-page 합산이 부정확(머지 시 max). "captured/totalSeen" 표시가 페이지 경계에서 정확하지 않을 수 있음 — 표시 용도라 허용.
