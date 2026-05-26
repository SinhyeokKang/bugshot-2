# Cross-page 로그 누적 + Replay 30초 트림 — 기술 설계

## 개요

네트워크·콘솔 로그의 단일 누적기를 사이드패널 `editor-store`의 `networkLog`/`consoleLog`에 둔다. 레코더 sync 데이터를 받을 때 **교체가 아니라 id 기준 머지**로 쌓고, idle 표준대기 중 네비게이션이 일어나도 누적기를 리셋하지 않는다. 떠나는 페이지의 로그 꼬리는 MAIN world 레코더의 `pagehide` flush로 유실 없이 누적기에 넘긴다. Replay 캡처 시에만 누적기를 프레임 버퍼 커버 구간으로 트림해 첨부하고, video 녹화 모드는 시작 시 누적기를 클리어해 녹화 구간만 담는 현행 동작을 유지한다.

## 변경 범위

### 신규: `src/sidepanel/lib/log-merge.ts`
순수 헬퍼. 단위 테스트 동반(`__tests__/log-merge.test.ts`).
- `mergeLogItems<T extends { id: string }>(existing, incoming, getTime, maxEntries): T[]` — id dedup(incoming이 갱신본으로 덮어씀, pending→complete 반영), `getTime` 기준 오름차순 정렬, `maxEntries` 초과 시 oldest부터 제거.
- `trimByTime<T>(items, getTime, cutoff): T[]` — `getTime(item) >= cutoff` 필터.
- 상수 `NETWORK_MAX_ENTRIES = 5000`, `CONSOLE_MAX_ENTRIES = 2000` (기존 MAIN 레코더 cap과 동일).

### `src/sidepanel/hooks/usePickerMessages.ts`
- 현재: `networkRecorder.data`/`consoleRecorder.data` 핸들러가 `crypto.randomUUID()`로 새 로그를 만들어 `setNetworkLog`/`setConsoleLog`로 **교체**.
- 변경: 기존 store 로그의 `requests`/`entries`에 incoming을 `mergeLogItems`로 **머지**. `id`는 기존 로그 id 재사용(`existing?.id ?? crypto.randomUUID()`). `startedAt`=머지 결과 첫 엔트리 시각, `endedAt`=now, `captured`=머지 길이, `totalSeen`=`max(기존, incoming, 머지 길이)`, `warnings`=union.
- **프리즈 가드**: `phase`가 `drafting`/`previewing`/`done`이면 머지하지 않고 즉시 반환(캡처 후 도착한 지연 sync가 첨부 로그를 흔들지 않도록).

### `src/sidepanel/hooks/useBackgroundRecorder.ts`
- 현재: `onTabUpdated`에서 page key 변경 시 `!shouldPreserveBackgroundLogs(phase)`면 `setState({ networkLog: null, consoleLog: null })` + pending 삭제 + `clearNetworkRecorder`/`clearConsoleRecorder` 호출(idle 표준대기 = 페이지 단위 리셋).
- 변경: 이 **네비게이션 리셋 블록 제거**. page key 변경 시 `recordersStopped.current = false`만 유지하고 `status==="complete"`에서 재주입은 그대로. → idle 표준대기 중 누적기가 cross-page로 쌓인다.
- 유지: 녹화 정상 종료 억제 블록(`recording`→`drafting`), 이슈 완료 후 idle 복귀 세션 경계 리셋(`idle && shouldPreserveBackgroundLogs(prev)` → pending 삭제 + MAIN clear + 재주입). `shouldPreserveBackgroundLogs`도 이 블록에서 계속 사용.

### `src/content/network-recorder.ts`, `src/content/console-recorder.ts`
- MAIN world가 풀 네비게이션으로 파괴되기 직전 버퍼를 flush:
  ```ts
  window.addEventListener("pagehide", () => dispatch());
  ```
- `dispatch()`는 `currentSentinel` 없으면 no-op이라 가드 불필요. CustomEvent dispatch → `picker.ts`의 `__bugshot_{net,console}_data__` 리스너 → `chrome.runtime.sendMessage`가 **동기 체인**이라 teardown 전 메시지가 큐잉된다.

### `src/store/editor-store.ts`
- `startPicking`(element/screenshot), `startFreeform`이 현재 `set({ ...initial, ... })`로 `networkLog`/`consoleLog`/`networkLogAttach`/`consoleLogAttach`를 null/기본값으로 리셋한다.
- 변경: 이 두 액션에서 위 4개 로그 필드를 **보존**(누적기 유지). `set((state) => ({ ...initial, networkLog: state.networkLog, consoleLog: state.consoleLog, networkLogAttach: state.networkLogAttach, consoleLogAttach: state.consoleLogAttach, ... }))` 형태.
- `startRecording`(video)는 **변경하지 않는다** — `...initial` 리셋 유지(녹화 fresh 시작). `startVideoCapture`의 명시적 MAIN clear/pending 삭제도 그대로.
- 신규 액션: `clearNetworkLog()`, `clearConsoleLog()` — 해당 store 로그 null + `deleteNetworkLog`/`deleteConsoleLog(pending:tabId)` (Clear Log 버튼용; MAIN clear는 호출부에서).

### `src/sidepanel/30s-replay/use-30s-replay.ts`
- `capture()`에서 `frames = bufferRef.current.snapshot()` 직후, sync 호출 후 누적기를 트림:
  - `cutoff = frames[0].timestamp` (버퍼 최오래 프레임 = mp4 시작).
  - `useEditorStore.getState().networkLog`가 있으면 `trimByTime(log.requests, r => r.startTime, cutoff)`로 새 로그 구성해 `setNetworkLog`. console도 동일(`e => e.timestamp`).
  - 트림은 onRecordingComplete(→ drafting 전) 전에 수행 → 이후 지연 sync는 프리즈 가드로 무시되어 트림이 고정된다.

### `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/tabs/NetworkSubTab.tsx`
- `PageFooter` 내부를 `flex justify-end` → **`flex items-center justify-between gap-2`** 로 바꾸고 **좌측에 [Clear Log] 버튼** 추가(우측 startDraft 버튼 유지). Settings > General footer의 [Privacy Policy] 배치/패턴과 동일.
- 버튼 디자인은 **Settings > General의 [Privacy Policy] 버튼과 일치**: `Button variant="outline"` + **텍스트 라벨만**(lucide 아이콘 없음). (`SettingsTab.tsx:223-228` 참조)
- **클릭 즉시 초기화 — 별도 컨펌 다이얼로그 없음.** 핸들러(각 서브탭 해당 로그만):
  - Console: `clearConsoleLog()` + `clearConsoleRecorder(tabId)`.
  - Network: `clearNetworkLog()` + `clearNetworkRecorder(tabId)`.
- i18n 키 신규(`log.clear` 등) ko/en 동시.

## 데이터 흐름

```
[MAIN world recorder]                    [side panel]
 fetch/console 패치 → buffer               editor-store.networkLog/consoleLog (누적기)
   │  (per-page, cap 5000/2000)              ▲
   ├─ sync (서브탭 1.5s 주기 / capture)  ───┤ usePickerMessages: mergeLogItems (dedup·cap)
   └─ pagehide flush (파괴 직전) ───────────┘   (drafting+ 프리즈)
                                              │
  idle 네비게이션: 리셋 안 함 (누적 지속)        │
  이슈 완료→idle: 세션 경계 리셋               ▼
                                          첨부 시점:
                                          - element/screenshot/freeform: 누적기 그대로
                                          - video: startRecording이 비우고 녹화구간만
                                          - replay: trimByTime(frames[0].timestamp)
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
  cutoff: number,
): T[];

// src/store/editor-store.ts (신규 액션)
clearNetworkLog: () => void;  // networkLog=null + deleteNetworkLog(pending)
clearConsoleLog: () => void;  // consoleLog=null + deleteConsoleLog(pending)
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
2. **주기 sync(~3s) 폴링으로 cross-page 수집**: 별도 store 없이 주기적으로 sync해 머지. 그러나 풀 네비게이션 시 떠난 페이지의 마지막 ~폴링간격 분량이 MAIN 파괴로 유실. → `pagehide` flush로 대체해 **기각**.
3. **Replay 트림을 고정 `now - 30000`으로**: 단순하지만 프레임 버퍼가 개수 cap·게이팅으로 30초 미만일 때 로그가 mp4보다 길어짐. → `frames[0].timestamp` 기준으로 **기각**.

## 위험 요소

- **`startPicking`/`startFreeform` 로그 보존 변경**: `...initial` 일괄 리셋에서 4개 필드만 빼내는 변경. 다른 필드(selection·screenshot 등)는 반드시 리셋 유지. 회귀 시 element/screenshot 드래프트에 이전 캡처 잔상이 남을 수 있으니 실제 탭에서 모드 전환 회귀 확인 필수.
- **`pagehide` 신뢰성**: bfcache·강제 종료 등 일부 경로에서 flush 메시지가 누락될 수 있음(best-effort). 현재 페이지는 capture sync로 항상 완전 포착되므로 영향은 "떠난 페이지 꼬리"에 한정.
- **video 녹화 경계**: idle 누적기가 차 있는 상태에서 녹화 시작 시 `startRecording`의 `...initial`이 반드시 로그를 비워야 함. 이 액션을 보존 대상에 넣지 않도록 주의(보존은 picking/freeform만).
- **프리즈 가드와 서브탭 주기 sync**: 로그 탭 서브탭은 active 시 1.5s 주기 sync한다. drafting+ 단계에서 로그 탭을 보면 sync가 와도 프리즈 가드로 머지 안 됨 — 의도된 동작이나 "표시가 안 갱신됨"으로 오인되지 않도록 확인.
- **totalSeen 근사**: cross-page 합산이 부정확(머지 시 max). "captured/totalSeen" 표시가 페이지 경계에서 정확하지 않을 수 있음 — 표시 용도라 허용.
