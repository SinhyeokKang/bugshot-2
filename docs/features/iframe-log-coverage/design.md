# iframe 로그 커버리지 확장 — 기술 설계

## 개요

레코더(MAIN world)와 로그 브리지(ISOLATED world) content script를 `all_frames: true`로 모든 프레임에 주입한다. 요소 선택(picker)은 top frame 전용으로 유지해야 하므로, 현재 `picker.ts` 한 파일에 섞여 있는 **로그 브리지 코드를 별도 content script(`recorder-bridge.ts`)로 분리**하고 그것만 `all_frames: true`로 등록한다. `picker.ts`는 기존대로 top frame(`all_frames` 미지정)에 남긴다.

데이터 흐름은 거의 변하지 않는다. 각 프레임의 브리지가 `chrome.runtime.sendMessage`로 로그를 보내면, 사이드패널 수신부는 메시지가 같은 탭에서 왔는지만 확인하고(`sender.tab?.id`) 기존 `mergeLogItems`로 병합한다. 프레임 식별자를 페이로드에 넣지 않으며, 단일 타임라인 병합에는 기존 `id`로 충분하다.

## 변경 범위

### 1. `manifest.config.ts` (content_scripts)
**현재 역할**: content_scripts 배열에 `picker.ts`(ISOLATED, `document_idle`)와 `recorders-entry.ts`(MAIN, `document_start`) 2개 등록. 둘 다 `all_frames` 미지정.

**변경 내용**:
- `recorders-entry.ts` 엔트리에 `all_frames: true` 추가.
- 새 엔트리 `recorder-bridge.ts` 추가: `world` 미지정(ISOLATED), `run_at: "document_idle"`, `all_frames: true`, `matches: ["<all_urls>"]`, `exclude_matches: ["https://bugshot.gitbook.io/*"]`.
- `picker.ts` 엔트리는 **그대로** (all_frames 미지정 = top frame only).

```
content_scripts: [
  { matches: ["<all_urls>"], exclude_matches: [...], js: ["src/content/picker.ts"], run_at: "document_idle" },                    // 변경 없음 (top only)
  { matches: ["<all_urls>"], exclude_matches: [...], js: ["src/content/recorder-bridge.ts"], run_at: "document_idle", all_frames: true },  // 신규
  { matches: ["<all_urls>"], exclude_matches: [...], js: ["src/content/recorders-entry.ts"], run_at: "document_start", world: "MAIN", all_frames: true },  // all_frames 추가
]
```

### 2. `src/content/recorder-bridge.ts` (신규 파일, ISOLATED world)
**역할**: `picker.ts`에서 분리한 로그 브리지. 모든 프레임에 주입되어 자기 프레임의 MAIN world 레코더와 통신한다.

**이동 대상** (현 `picker.ts`에서 발췌):
- `postToRuntime`(picker.ts:60) — 브리지 전용 헬퍼(picker는 `sendResponse` 패턴이라 미사용).
- Network 브리지: `handleNetData`, `handleSetSentinel`, stop/sync/clear 핸들러(picker.ts:69–112 구간).
- Console 브리지: `handleConsoleData`, `handleSetConsoleSentinel`, stop/sync/clear(picker.ts:113–154).
- Action 브리지: `handleActionData`, `handleSetActionSentinel`, stop/sync/clear(picker.ts:155–202).
- `chrome.runtime.onMessage` 핸들러에서 recorder 관련 case만: `networkRecorder.setSentinel|stop|sync|clear`, `consoleRecorder.*`, `actionRecorder.*`(picker.ts:335–360 구간).

이 브리지는 sentinel을 받아 MAIN world 레코더에 `__bugshot_*_setSentinel__` CustomEvent로 전달하고, MAIN이 dispatch한 `__bugshot_*_data__<sentinel>` CustomEvent를 받아 `chrome.runtime.sendMessage`로 사이드패널에 보낸다. 코드 로직은 이동만 하며 변경하지 않는다.

### 3. `src/content/picker.ts`
**현재 역할**: 요소 선택(picker) + 로그 브리지 혼재.
**변경 내용**: 위 2번으로 이동한 브리지 코드·recorder onMessage case 제거. picker 관련 코드(`picker.*` case, 오버레이, elementFromPoint, area select 등)만 남긴다. onMessage 핸들러에서 recorder case를 들어내고 picker case만 유지.

### 4. `src/sidepanel/picker-control.ts`
**현재 역할**: `chrome.tabs.sendMessage(tabId, ...)`로 content script에 명령. `ensureContentScript`/`ensureMainWorldRecorders`로 주입 보장. `activateNetworkRecorder`/`activateConsoleRecorder`/`activateActionRecorder`가 sentinel 발행.
**변경 내용**: **거의 없음**. `chrome.tabs.sendMessage(tabId, msg)`는 `frameId`를 지정하지 않으므로 `all_frames: true` 적용 후 **자동으로 탭의 모든 프레임의 `recorder-bridge.ts`에 전달**된다 → 각 프레임 레코더가 같은 sentinel로 활성화된다. 단:
- `ensureContentScript`가 `ping`을 top frame에 보내 존재를 확인하는데(picker-control.ts:24), 이건 picker.ts(top only)의 `ping` 응답에 의존. recorder-bridge 분리 후 `ping` 핸들러가 어느 쪽에 남는지 확인 필요 — **`ping`은 picker.ts에 유지**(top frame 보장 용도). 브리지는 별도 보장 불필요(content_scripts 정적 등록이라 페이지 로드 시 자동 주입).
- `ensureMainWorldRecorders`(picker-control.ts:55)가 MAIN world 레코더를 programmatic 주입으로 보강하는 경우, `all_frames` 동등 동작을 위해 주입 타깃 검토 필요(아래 위험 요소 참조).

### 5. `src/sidepanel/hooks/usePickerMessages.ts`
**현재 역할**: `chrome.runtime.onMessage`로 recorder.data 수신, `sender.tab?.id`로 내 탭 필터, `mergeLogItems`로 병합 후 store + IndexedDB 저장.
**변경 내용**: **거의 없음**. iframe 브리지가 보낸 메시지도 `sender.tab.id`는 동일 탭이라 통과하고, 기존 병합 경로를 그대로 탄다. (프레임 식별자를 쓰지 않으므로 핸들러 수정 불필요.) 단 6번의 webNav 재broadcast를 sidepanel 주도로 구현할 경우, background의 `frameCommitted` 알림을 받아 보유 sentinel을 재발행하는 핸들러를 추가한다(아래 6번 참조).

### 6. `src/background/index.ts` — 동적/지연 iframe 커버리지 (webNav 재broadcast)
**현재 역할**: `onBeforeNavigate`/`onCommitted` 리스너가 `frameId !== 0`(main frame)만 처리 — iframe 네비게이션은 무시.
**문제**: sentinel은 `activate*Recorder` 호출 시 **1회 broadcast**된다(picker-control.ts:331). 캡처 시작 **이후** 생성·커밋되는 iframe(Stripe Checkout 클릭 후 동적 생성, lazy-load 광고/위젯)은 브리지·MAIN 레코더가 `document_start`+`all_frames`로 주입돼도 **이미 지나간 broadcast를 못 받아 `recording=false` dormant로 남는다** → 로그 유실. PRD 성공 기준(동적 결제 iframe)을 직접 위협.
**변경 내용**: `onCommitted`에 **iframe(`frameId !== 0`) 분기**를 추가한다. 해당 탭에 활성 캡처 세션이 있으면(`chrome.storage.session`의 `sessionKey(tabId)` 존재) 그 프레임에 sentinel을 재전달해 새 iframe 레코더를 활성화한다. 두 가지 라우팅 중 택1:
- **(권장) sidepanel 주도**: background가 sidepanel에 `{type:"frameCommitted", tabId, frameId}` 알림 → sidepanel(usePickerMessages)이 보유 중인 sentinel로 `chrome.tabs.sendMessage(tabId, {networkRecorder.setSentinel,...}, {frameId})` 재전송. sentinel을 sidepanel이 소유하므로 자연스럽다.
- (대안) background 보유: sidepanel이 `activate*Recorder` 시 background에 `tabId→sentinel` 등록 → background가 onCommitted(iframe)에서 직접 `chrome.tabs.sendMessage(tabId, setSentinel, {frameId})`. 메시지 1왕복 줄지만 background가 sentinel 상태를 들고 있어야 함.

**재발행 안전성**(코드 검증): `setSentinel`(console-recorder.ts:246 / network:560 / action:268)은 `recording = true`만 설정하고 **buffer를 비우지 않는다**(clearBuffer는 별도 `clearHandler` 전용). 따라서 기존 프레임이 동일 sentinel을 재수신해도 누적 로그가 보존된다. 신규 프레임만 dormant→active로 전환된다. `handleSetSentinel`(브리지)에 "현재 sentinel과 동일하면 재dispatch 스킵" 가드를 두면 중복 CustomEvent도 막을 수 있다(선택).

### 7. 타입·store·log-merge·UI
**변경 없음**. `ConsoleEntry`/`NetworkRequest`/`ActionEntry`, `editor-store`, `mergeLogItems`, `ConsoleSubTab`/`NetworkSubTab`/`ActionSubTab`, log-viewer 모두 그대로. 단일 타임라인 병합·trim·세션 영속화가 프레임 수와 무관하게 동작한다. **시간축 정렬 안전성**: 세 레코더 모두 `Date.now()`(epoch) 기준으로 timestamp/startTime을 찍으므로(console:53, network:239 등), cross-origin 프레임 간에도 동일 시계라 `mergeLogItems`의 시간 정렬이 어긋나지 않는다(`performance.now` 미사용).

## 데이터 흐름

```
[iframe A: MAIN]                [iframe A: ISOLATED]          [top: MAIN/ISOLATED]
recorders-entry.ts              recorder-bridge.ts             동일 구조
 (console/net/action 후크)        (sentinel 수신·data 중계)
        │ CustomEvent(__bugshot_*_data__<sentinel>)  │
        └──────────────────────────────►─────────────┘
                                          │ chrome.runtime.sendMessage({type:"*.data", payload})
                                          ▼
                          [sidepanel] usePickerMessages.onMessage
                            ├─ sender.tab.id === myTabId 확인 (프레임 무관, 탭만)
                            ├─ mergeLogItems(existing, incoming, getTime, MAX)  ← id dedup + 시간정렬
                            ├─ editor-store.setNetworkLog/...
                            └─ saveNetworkLog(`pending:${tabId}`, log)  (IndexedDB)
```

sentinel 발행(역방향): `picker-control.activateNetworkRecorder(tabId)` → `chrome.tabs.sendMessage(tabId, {type:"networkRecorder.setSentinel", sentinel})` → (all_frames) **broadcast 시점에 존재하는** 모든 프레임 `recorder-bridge.ts` 수신 → 각 프레임이 MAIN 레코더에 `__bugshot_net_setSentinel__` dispatch.

동적/지연 iframe 재발행: `background.onCommitted(frameId !== 0, 세션 존재)` → (sidepanel 주도) `frameCommitted` 알림 → sidepanel이 보유 sentinel로 `chrome.tabs.sendMessage(tabId, setSentinel, {frameId})` 재전송 → **캡처 시작 이후 뜬 iframe** 브리지가 sentinel 수신 → MAIN 레코더 dormant→active. 기존 프레임은 buffer 보존(setSentinel이 비우지 않음).

## 인터페이스 설계

신규 타입·시그니처 변경 **없음**. 기존 `PickerMessage`(src/types/picker.ts)의 recorder 관련 메시지를 그대로 재사용한다. `recorder-bridge.ts`는 기존 `picker.ts`의 브리지 함수 시그니처를 그대로 가져간다(이동만).

manifest content_scripts 엔트리 타입(`@crxjs/vite-plugin` manifest 스키마)에 `all_frames?: boolean` 사용.

## 기존 패턴 준수

- **sentinel 활성화 모델**(ARCHITECTURE.md): 레코더는 `document_start`에 주입되지만 sentinel 전까지 `recording=false`로 dormant. 모든 프레임에 주입돼도 트리거 전 비용 없음.
- **cross-page 로그 누적**(ARCHITECTURE.md): `onBeforeNavigate`(주) + `pagehide`(보조) sync, `onCommitted`에서 `shouldClearLogs` 판정, `frameId !== 0` 필터(background/index.ts:112,133)로 main frame 네비만 초기화. iframe 네비는 영향 없음 — **유지**.
- **content script 메시지 비동기 응답**: 브리지의 `postToRuntime`는 fire-and-forget(`sendMessage().catch()`), picker의 onMessage는 `sendResponse`. 분리 후에도 각자 패턴 유지.
- **i18n**: UI 변경이 없어 `src/i18n/` 변경 없음.

## 대안 검토

**대안 A — picker.ts 분리 없이 `all_frames: true` + iframe 가드** (채택 안 함)
`picker.ts` 자체에 `all_frames: true`를 주고, picker 로직만 `if (window.top !== window) return` 가드로 iframe에서 비활성화하는 방법. 파일 분리를 피할 수 있으나, picker의 onMessage(`picker.*` case)가 iframe에서도 등록되고 `chrome.tabs.sendMessage(tabId)`가 모든 프레임에 broadcast되므로 모든 picker case에 프레임 가드를 빠짐없이 넣어야 한다. 오버레이·elementFromPoint·area-select 상태가 iframe 인스턴스에서 의도치 않게 동작할 위험이 있어, **책임이 섞인 채 회귀 표면이 넓다**. 브리지 분리(채택안)가 경계가 명확하고 picker 동작 회귀 위험이 낮다.

**대안 B — `frameId`를 데이터 모델에 추가** (채택 안 함)
필터 UI 후속 과제를 미리 대비해 entry에 `frameId`를 싣는 방법. 사용자가 필터 UI를 이번 스코프에서 명시적으로 제외했고, CLAUDE.md "요청하지 않은 미래 대비 추상화 금지" 원칙에 따라 보류한다. 후속 필터가 필요해지면 그때 `sender.frameId`/`sender.url`을 수신부에서 주입한다(`pageUrl`은 이미 저장돼 있어 1차 그룹핑 키로 재사용 가능).

**대안 C — Jam 방식의 `webNavigation.onCommitted` + 프레임별 `executeScript`** (부분 채택)
정적 content script 대신 프레임 커밋마다 동적 *주입*하는 방식은 채택하지 않는다(정적 `all_frames: true`가 주입은 더 단순하게 커버). 다만 Jam이 `onCommitted`를 쓰는 핵심 이유 — **캡처 시작 이후 생성된 iframe의 활성화** — 는 정적 주입만으로 해결되지 않으므로, `onCommitted(frameId !== 0)`에서 **주입이 아닌 sentinel 재발행**만 차용한다(변경범위 6번). 즉 "주입은 정적, 활성화는 webNav 보강"의 하이브리드다.

## 위험 요소

- **서드파티 iframe 간섭 회귀**: 레코더가 결제·임베드 iframe의 `fetch`/`XHR`/`console`을 wrap한다. `network-recorder.ts`는 이미 XHR `try/catch` + 무조건 `originalSend` 호출, fetch wrap 실패 격리를 갖추었으나 회귀 위험이 0은 아니다. **Stripe·YouTube embed·지도 위젯 등 실제 탭에서 동작 확인 필수**(수동 테스트).
- **`ensureMainWorldRecorders` 주입 범위**: picker-control.ts:55의 programmatic 보강 주입이 top frame만 타깃하면, 정적 content_scripts(`all_frames: true`)로 주입된 iframe 레코더와 별개로 동작. 정적 등록이 이미 모든 프레임을 커버하므로 보강 주입은 top frame 보장용으로 충분하나, **중복 주입 시 `CTRL_KEY` 가드**(`recorders-entry`의 `if (window[CTRL_KEY]) return`)로 idempotent함을 확인.
- **MAX_ENTRIES 탭 통합 cap**: 로그 버퍼 cap(network 5000 / console 2000 / action 1000)은 탭 전체 통합 기준. iframe이 많고 광고 로그가 폭증하면 FIFO로 **top frame 초반 로그가 밀려날 수 있다**. 이번 스코프에선 cap 구조를 변경하지 않고 위험만 인지(필터/프레임별 cap은 후속 과제).
- **noise**: 광고/트래커 iframe 로그가 단일 타임라인에 섞여 메인 신호 가독성이 떨어질 수 있다. 사용자가 필터 UI 제외를 선택했으므로 수용하되, 후속 필터 과제의 트리거로 본다.
- **꼬리 유실 표면 증가**: `all_frames` 확장 시 프레임 수만큼 `pagehide` flush가 생겨 네비 직전 로그 꼬리 유실 표면이 커진다. [log-tail-reliability](../log-tail-reliability/) 과제(레코더 trailing throttle 실시간 스트리밍 + `visibilitychange` flush)와 **병행 권장** — 변경 파일이 겹치지 않으므로(이 과제는 manifest + 브리지, 그쪽은 레코더 내부) 독립 PR로 진행하되 같은 사이클에 다루면 iframe 확장의 유실 증가를 상쇄한다.
- **`ping`/존재 확인 — 정정**: `ping`은 **background service worker**(`src/background/messages.ts`)가 처리하며, **picker.ts에는 `ping` case가 없다**(switch `default: return`으로 흘러 응답 채널이 닫히며 `ensureContentScript`의 `pingOk`가 통과). 즉 ping은 "picker.ts onMessage 리스너 등록 여부"를 부수적으로 검출할 뿐 명시적 핸들러가 아니다. **중요**: `ensureContentScript`는 picker.ts(top only) 존재만 확인하지 **recorder-bridge.ts(all_frames) 주입 완료를 보장하지 않는다**. 정적 content_script는 페이지 로드 시 주입되므로 활성 탭에선 대개 준비돼 있으나, 늦게 생성된 iframe 브리지는 그렇지 않다 → 그 커버리지는 변경범위 6번(webNav 재발행)이 담당한다.
- **두 ISOLATED 리스너 응답 계약**: 분리 후 top frame에 picker.ts와 recorder-bridge.ts가 **공존**하며 둘 다 `chrome.runtime.onMessage`를 등록한다. 각 메시지에 정확히 한 리스너만 `sendResponse`하도록, picker.ts는 `recorder.*` 메시지를 `default: return`(무응답)으로, recorder-bridge.ts는 `picker.*`를 `default: return`으로 흘려야 한다. 그래야 포트 충돌·응답 경쟁이 없다(현재 picker.ts:374가 처리 case 끝에서 무조건 `sendResponse({ok:true})`하므로, 분리 시 도메인 밖 메시지가 default로 빠지는지 확인 필수).
- **출처 구분 불가 (알려진 UX 한계)**: Network/Action 로그는 `pageUrl`을 UI에 노출하지 않아(Console만 아코디언에 링크), iframe 로그가 섞이면 동일 path(`/api/track`)의 출처를 화면에서 구분할 수 없다. 이번 스코프는 "UI 변경 0"을 유지하므로 이 한계를 수용하되, **출시 직후 출처 표시/필터 후속 과제 착수를 전제**로 한다. 데이터 모델엔 `pageUrl`이 이미 있어 후속 추가 비용은 낮다.
- **iframe 네비게이션 꼬리는 pagehide 단독 의존**: `onBeforeNavigate`/`onCommitted` sync는 `frameId !== 0`로 iframe을 제외하므로, iframe 자체 네비 직전 로그 꼬리는 이중 안전망 중 **`pagehide` flush 단독**에만 의존한다 — `log-tail-reliability`가 "갭1: 가장 불안정"으로 지목한 경로다. iframe 네비는 top frame보다 꼬리 유실 확률이 높으며, `log-tail-reliability`(throttle 실시간 스트리밍) 병행 시 완화된다.
- **pagehide 중복 flush**: 프레임마다 `pagehide` flush가 동작. 같은 entry가 sync/stop/pagehide/재발행으로 여러 번 dispatch될 수 있으나 `mergeLogItems`의 id dedup이 흡수한다(**동일 프레임 buffer의 재전송** dedup — 서로 다른 프레임은 각자 `crypto.randomUUID`라 애초에 충돌 없음).
