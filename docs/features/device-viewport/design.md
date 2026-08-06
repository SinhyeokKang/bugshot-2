# 디바이스 뷰포트 — 기술 설계

## 개요

top 문서 안에 같은 URL을 `src=`로 로드하는 iframe(`#__bugshot_device_frame__`)을 만들고, 원본 `body` 자식을 스타일시트 한 장으로 숨긴 뒤 그 iframe을 선택한 폭으로 렌더한다. 최초 문서는 top과 same-origin이라 그 origin의 쿠키·스토리지를 그대로 쓰고, 이후 cross-origin 이동에서는 목적지 origin의 쿠키·스토리지를 정상 사용한다. `<all_urls>` content scripts가 두 경우 모두 주입되며, 래퍼 계보는 DOM 접근이 아니라 Chrome `frameId`/`documentId`로 추적한다.

**설계의 축은 "상태를 어디에 두지 않을 것인가"다.** 모드의 단일 출처는 top 문서에 그 iframe이 존재하는지 여부뿐이고, 사이드패널 스토어나 storage에 ON/OFF 플래그를 두지 않는다. background의 `chrome.storage.session`에는 로그·navigation 라우팅용 frame binding만 보존하며 UI 상태로 사용하지 않는다. 사이드패널은 필요할 때마다 top 문서에 물어본다.

같은 원리로 **뷰포트 값을 파생하는 코드가 사이드패널 상태를 안 읽는다.** `getTopViewport`가 주입하는 함수가 스스로 래퍼를 찾아보고, 있으면 래퍼 크기를 없으면 `window.innerWidth/innerHeight`를 반환한다. `getTopViewport` **호출부 3개**(element·screenshot·freeform)가 무변경으로 올바른 값을 받는다.

**영상·30s Replay는 이 경로에 없다.** `video-recorder.ts:111-117`과 `30s-replay/use-30s-replay.ts:153`은 `chrome.tabs.get(tabId)`의 `tab.width/height`를 쓰므로, 그대로 두면 모드 ON에서 영상 리포트의 `Viewport`만 브라우저 폭으로 남는다. 두 곳을 `getTopViewport`로 교체해 캡처 5종을 한 출처로 모은다(Task 4).

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/content/device-frame.ts` | 래퍼 생성·제거·로드 검증. top 문서 DOM만 다루는 순수 DOM 모듈. `picker.ts`가 import |
| `src/sidepanel/lib/device-presets.ts` | 프리셋 상수 + 가용 폭 판정 순수 함수. 유닛 테스트 대상 |
| `src/sidepanel/components/DeviceViewportBar.tsx` | 세그먼티드 컨트롤 UI |
| `src/sidepanel/hooks/useDeviceViewport.ts` | 현재 폭·가용 폭 조회, 전환 오케스트레이션 |
| `src/content/__tests__/device-frame.test.ts` | jsdom — 스타일 주입·복원 왕복 |
| `src/sidepanel/lib/__tests__/device-presets.test.ts` | node — 가용 폭 판정 |
| `src/sidepanel/components/__tests__/DeviceViewportBar.test.tsx` | jsdom — 잠금·비활성 조건 |
| `e2e/device-viewport.spec.ts` | 신규 e2e |

**manifest는 건드리지 않는다.** 브리프가 지적한 배열 순서 위험 4곳(`picker-control.ts:35-36`의 index 0 하드코딩, `:64-74`의 recorder-bridge find, `:86-90`의 MAIN find, `scripts/check-prearm-chunk.mjs:39`)을 전부 회피한다. 래퍼 로직은 이미 `all_frames`로 주입돼 있는 `picker.ts`(content_scripts[0])에 메시지 핸들러로 얹는다. `recorders-entry` 청크 그래프와도 무관하므로 pre-arm 동기 IIFE 형태가 유지된다.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/content/picker.ts` | 요소 선택·캡처 준비 content script | `device.*` 메시지 3종 핸들러 추가(전부 `window === window.top` 게이트). 래퍼 안에서 자기 정체를 알리는 `device.frameReady` 발화 |
| `src/content/area-select.ts:110-118` | `selectFullViewport`가 rect를 `{x:0,y:0,...viewport}`로 하드코딩(:116) | 래퍼가 있으면 `deviceFrameRect()`로 교체 — **스프레드를 풀어야 한다**(중앙 정렬이라 `x` 오프셋이 0이 아니다). `viewport`(크롭 배율 기준, :114)는 top 유지 |
| `src/content/area-select.ts:200-216` | 드래그 확정 rect | 래퍼가 있으면 rect를 래퍼 영역으로 **클램핑**. 안 하면 여백이 결과에 들어간다 |
| `src/sidepanel/picker-control.ts:811-824` | `getTopViewport`가 top `innerWidth/innerHeight` 반환 | 주입 함수가 래퍼를 먼저 찾도록 교체. 시그니처·기존 호출부 3개 무변경 |
| `src/sidepanel/video-recorder.ts:111-117` | `chrome.tabs.get()`의 `tab.width/height`로 viewport 메타 | `getTopViewport(tabId)`로 교체 |
| `src/sidepanel/30s-replay/use-30s-replay.ts:153` | 동일 | 동일 |
| `src/sidepanel/recorder-control.ts` | clear/activate 3종 (frameId 미지정 broadcast) | document 지정 stop/start + 래퍼 서브트리 전환 신설 |
| `src/sidepanel/hooks/usePickerMessages.ts:206-223`·`:423` | `captureAndCrop(rect, viewport)` — **`capture.ts`가 아니라 이 파일의 모듈 프라이빗 함수**(`capture.ts`의 export는 `cropImage`뿐) | 크롭은 `msg.viewport`, 메타는 `getTopViewport(tabId)`로 분리. 변경이 이 파일 안에서 끝난다 |
| `src/sidepanel/tabs/DebugTab.tsx:73-94` | 서브탭 바 `<div>`(`CollapsingTabsList` 74-93) | 그 wrapper 안쪽에 `mt-2`로 `<DeviceViewportBar>` 행을 넣는다 — 별도 bordered 행이면 상단 크롬이 138→207px가 되고 idle 화면은 `overflow-hidden`+`justify-center`라 밀리는 게 아니라 잘린다 |
| `src/sidepanel/tabs/IssueTab.tsx:552-561` | `capture-method-fullpage` 버튼(`ariaDisabled={busy}` :554) | 모드 ON이면 `ariaDisabled` + 잠금 사유를 별도 `TooltipContent`로. **`label`을 바꾸면 안 된다** — `TooltipIconButton.tsx:42,54`에서 `label` 하나가 `aria-label`과 툴팁을 겸하므로 접근명까지 오염된다(선례: `mode-freeform` `IssueTab.tsx:371-389`) |
| `src/sidepanel/tabs/DraftingPanel.tsx:576-678` | `ReproEnvironmentSection` | 모드 ON 읽기전용 인디케이터 1개. `device.state.width != null`에서 파생하므로 전역 상태를 안 만든다 |
| `src/sidepanel/App.tsx:362-376` | `iframeUnsupported` 다이얼로그(`:367`이 body) | 모드 ON이면 body 문구를 `app.iframeUnsupported.bodyDeviceMode`로 교체 |
| `src/background/index.ts:120`·`:123`·`:145-186` | `onBeforeNavigate`/`onCommitted`의 frameId 게이트 + `navUrlPromise` | 아래 "래퍼 내부 네비게이션" 절 — 두 분기를 모두 태우고 `navUrlPromise` 키를 `tabId:frameId`로 |
| `src/background/tab-bindings.ts` | — | frameId/documentId binding의 session 보존·복구 + parent 계보 조회 |
| `src/types/messages.ts`·`bgRequestTypes.ts` | `BgRequest` union + `BG_REQUEST_TYPES` 화이트리스트 | `device.frameReady`는 이 게이트를 통과 못 한다 — 아래 절 참조 |
| `src/types/picker.ts` | `PickerMessage` union | `device.*` 메시지 3종 추가 |
| `src/i18n/namespaces/app.ts`·`issue.ts` | ko/en 사전 | 신규 키(ko/en 동시) |

### 손 안 대는 곳

- `src/sidepanel/lib/environmentRows.ts`, `buildReportData.ts`, `buildIssueMarkdown.ts`, `liteSnapshot.ts` — **`Device` 행을 신설하지 않기로 했으므로 전부 무변경.** `Viewport` 행 값이 상류에서 바뀌므로 하류가 자동으로 따라온다. `DraftingPanel.tsx`는 인디케이터 때문에 예외적으로 변경 대상이지만, 그건 **행이 아니라 렌더 전용 표시**라 리포트 본문·마크다운 3경로에는 안 닿는다.
- `src/store/editor-store.ts` — `EDITOR_SNAPSHOT_KEYS`에 아무것도 더하지 않는다.
- `manifest.config.ts` — 권한·content_scripts 전부 무변경.

## 데이터 흐름

### 모드 ON

```
[사용자] 세그먼트 "390" 클릭
   │
   ▼
useDeviceViewport.select(390)
   │  ① phase !== "idle" 이면 무시 (버튼이 이미 비활성)
   │  ② 최초 ON 진입 1회 확인 다이얼로그 → [계속] 시 local persist
   │  ③ syncAndSettleLogs(tabId)            ← 떠나는 로그 꼬리 확보
   │  ④ store.clearNetworkLog/Console/Action ← 모드 경계 (네비게이션이 아니라 logClear가 안 온다)
   │
   ▼
sendPickerTop(tabId, { type: "device.set", width: 390 })
   │
   ▼  [top 문서 / picker.ts]
device-frame.ts::mountDeviceFrame(390)
   │  <style id="__bugshot_device_style__">  body 자식 은닉 + 레이아웃
   │  <iframe id="__bugshot_device_frame__" src={location.href} style="width:390px">
   │  load 대기(≤3s) → contentDocument.location.href === location.href ?
   │        아니면 → unmount + { ok:false, reason:"blocked" }
   ▼
{ ok: true, width: 390, available: {...} }
   │
   ├─▶ [최초 래퍼 문서 / picker.ts]  window.frameElement.id === "__bugshot_device_frame__"
   │        postToRuntime({ type: "device.frameReady" })
   │            → background 전용 리스너: frameId를 storage.session에 등록
   │            → 이후 cross-origin 이동은 frameId 지속 + documentId 갱신으로 추적
   │
   ├─▶ 모든 document recorder stop 응답 확인
   │            → 래퍼 documentId + 하위 documentId만 start 응답 확인
   │   webNavigation.onCommitted(frameId≠0) → frameCommitted{frameId: 래퍼}
   │        → rebroadcastSentinelsToFrame(래퍼)  ← 기존 경로, 무변경
   │
   └─▶ [phase === "picking"이면] restartPickerInFrame(tabId, 래퍼 frameId)
          ← registry 등록 보장. 아래 "래퍼 registry 등록" 절
```

### 뷰포트 값 파생 (모드 무관 단일 경로)

```
getTopViewport(tabId)
   └─ chrome.scripting.executeScript({ target:{tabId}, func })
        func: () => {
          const f = document.getElementById("__bugshot_device_frame__");
          return f ? { width: f.clientWidth, height: f.clientHeight }
                   : { width: innerWidth, height: innerHeight };
        }
   │
   ├─ element     usePickerMessages.ts:160-167, :409-410   ← 기존 호출부
   ├─ screenshot  usePickerMessages.ts:206-223             ← 신규 경로
   ├─ freeform    picker-control.ts:844                    ← 기존 호출부
   ├─ video       video-recorder.ts:111-117                ← chrome.tabs.get → getTopViewport 교체 필요
   └─ replay      30s-replay/use-30s-replay.ts:153         ← 동일
```

`func`는 직렬화·재평가되므로 클로저가 안 살아남는다(`CLAUDE.md` — `chrome.scripting.executeScript({func})`). 위 함수는 self-contained라 제약을 만족한다. 상수 `"__bugshot_device_frame__"`은 문자열 리터럴로 **인라인**해야 하고, `device-frame.ts`의 상수와 **복제**된다 — 동기화는 `picker-control` 유닛 테스트가 두 값을 대조해 고정한다(선례: `log-merge.ts` ↔ `trailing-throttle.ts` 복제+동기화 테스트 패턴).

### 가용 폭 추적

```
DeviceViewportBar 마운트
   └─ sendPickerTop(tabId, { type: "device.state" })
        → { width: number|null, available: { width, height } }
             available.width = document.documentElement.clientWidth  ← 세로 스크롤바 제외
   └─ picker.ts (top): window.addEventListener("resize")
        → postToRuntime({ type: "device.availableChanged", available })
   └─ DeviceViewportBar 언마운트 → { type: "device.watch", on: false }
```

`innerWidth`가 아니라 `documentElement.clientWidth`를 쓴다 — 세로 스크롤바 15~17px을 빼지 않으면 래퍼가 가용 폭에 딱 맞을 때 가로 스크롤이 생긴다.

`chrome.windows.onBoundsChanged`는 **쓰지 않는다.** 창 bounds만 주고 사이드패널 리사이즈에는 발화하지 않는다. 폴링도 하지 않는다.

## 인터페이스 설계

### 메시지 (`src/types/picker.ts`)

`PickerMessage`에 **5종**을 더한다(수신 3 + push 2). 이 union은 이미 양방향이 섞여 있으므로(`types/picker.ts:131-136`이 push 타입) 컨벤션에 맞고, 응답 타입만 union 밖 별도 인터페이스로 둔다(`PrepareCaptureResponse` 선례).

```ts
// 사이드패널 → top 프레임 (frameId 0 지정 송신)
| { type: "device.set"; width: number | null }   // null = 전체(래퍼 제거)
| { type: "device.state" }
| { type: "device.watch"; on: boolean }          // on:false가 unwatch. 별도 타입을 두지 않는다

// 응답
export interface DeviceSetResponse {
  ok: boolean;
  // "blocked": XFO/CSP로 래퍼가 자기 URL을 못 실었다 (이미 롤백 완료)
  reason?: "blocked";
  width: number | null;
  available: { width: number; height: number };
}
export interface DeviceStateResponse {
  width: number | null;
  available: { width: number; height: number };
}

// content → 사이드패널·background (push)
| { type: "device.availableChanged"; available: { width: number; height: number } }
| { type: "device.frameReady" }   // 래퍼 프레임 자신이 발화. sender.frameId가 래퍼 frameId
```

**배선 제약 4개** — 전부 기존 코드가 강제한다.

1. **`device.set`은 반드시 비동기 응답이다.** mount 로드 대기(≤3s)가 있으므로 `case`에서 `void (async () => { … sendResponse(res) })(); return true;` 형태여야 한다(유일한 선례 `picker.collectTokens` `picker.ts:236-247`). `break`로 떨어뜨리면 스위치 밖 `:341`의 `sendResponse({ok:true})`가 먼저 나가고 두 번째 응답이 "message port closed"로 죽는다.
2. **각 case 첫 줄에 `if (window !== window.top) return;`**(선례 `annotation.show/setTool/hide` `picker.ts:321,325,334`). frameId 0 지정 송신이면 이론상 불필요하지만, 한 번이라도 broadcast 경로가 섞이면 래퍼가 같은 메시지에 두 번째 응답을 쏜다.
3. **`send`는 export되지 않는다**(`picker-control.ts:105`, 모듈 내부 전용). `sendPickerTop`을 picker-control 안에 두고 `deviceSet`/`deviceState`/`deviceWatch` export 래퍼를 노출한다(현행 `navigatePicker`·`prepareCapture` 패턴).
4. **`send`는 전달 실패를 `undefined`로 삼킨다**(`:114-116`). 호출부는 `undefined`(content script 미도달)와 `{ok:false}`(XFO 차단)를 **구분해서** 다뤄야 한다 — `ok === false`만 보면 `undefined`가 성공으로 새어나간다.

### `device.frameReady`가 background에 닿게 하는 배선

`background/index.ts:188-189`가 `if (!BG_REQUEST_TYPES.has(message.type)) return false;`로 화이트리스트 게이트를 건다(등록 누락으로 Asana 요청이 런타임 전량 차단된 회귀 전례가 주석에 남아 있다). 게다가 `messages.ts:198`의 `handleMessage(message, _sender)`는 **sender를 아예 안 읽는다** — 이 함수는 요청/응답 디스패처라 fire-and-forget push를 섞는 게 의미상 어색하다.

**따라서 background에 push 전용 `chrome.runtime.onMessage` 리스너를 하나 더 단다.** 기존 게이트를 안 흔들고 `sender.frameId`/`sender.tab.id`를 바로 읽는다.

`deviceFrameByTab`의 권위값은 `chrome.storage.session`에 `{ frameId }`로 보존하고 메모리 Map은 복제 캐시로만 쓴다. Chrome은 frame 생애 동안 navigation을 넘어 `frameId`를 유지하고 문서가 바뀔 때 `documentId`를 교체하므로, 최초 same-origin 등록 뒤 cross-origin redirect·링크 이동도 DOM 접근 없이 추적한다. SW 시작 시 복원 promise를 만들고 `webNavigation` 처리를 탭별 순서 큐에서 그 promise 뒤에 연결한다. 성능보다 정확성을 우선해 복구 전 이벤트를 동기 기본값으로 판정하지 않는다. top `onCommitted`, 탭 제거, 명시적 OFF에서는 저장값과 Map을 함께 지운다.

### 래퍼 registry 등록 (위험 8의 실제 배선)

`picker.start`는 **broadcast 1회뿐이고 재시도가 없다** — 그 시점에 리스너가 붙어 있는 프레임에만 배달되므로 **이후 생성된 프레임에는 절대 도달하지 않는다**. `ensureContentScript`의 ping도 `{frameId: 0}` 고정(`picker-control.ts:25`)이라 래퍼에 content script가 안 붙었어도 통과하고 재주입이 안 돈다. 등록에 실패하면 래퍼가 `isRegisteredChildFrame`을 통과 못 해 클릭이 `picker.ts:1080-1094`의 거부 경로로 가고, **모드 ON에서 아무 요소도 못 고르는** 상태가 된다.

`phase !== "idle"` 잠금 덕에 mount는 항상 `picker.start`보다 앞서므로 순서 자체는 성립하지만, mount 성공과 래퍼 content script의 `onMessage` 등록(document_idle) 사이에 창이 남는다. **mount 성공 직후 래퍼 frameId를 향해 `picker.start`를 `res?.ok`까지 재시도 송신한다** — 정확히 `restartPickerInFrame`(`picker-control.ts:286-303`, 10회×200ms) 패턴이고 래퍼 frameId는 `device.frameReady`로 이미 안다.

**broadcast는 절대 쓰지 않는다** — `setFrameToken`(`frame-geometry.ts:73`)이 `picker.start`마다 `childFrames` WeakSet을 새 인스턴스로 갈아치우므로, 실수로 broadcast하면 top registry가 통째로 비워져 방금 등록된 래퍼가 날아간다.

### `src/content/device-frame.ts`

```ts
export const DEVICE_FRAME_ID = "__bugshot_device_frame__";
export const DEVICE_STYLE_ID = "__bugshot_device_style__";

/** 현재 래퍼 폭. 없으면 null. 모드의 단일 출처. */
export function currentDeviceWidth(): number | null;

/** 래퍼의 top 좌표계 rect. 없으면 null. area-select가 화면 캡처 rect로 쓴다. */
export function deviceFrameRect(): { x: number; y: number; width: number; height: number } | null;

/** 가용 폭·높이 (documentElement.clientWidth/clientHeight). */
export function availableViewport(): { width: number; height: number };

/**
 * 래퍼를 만들고 로드를 검증한다. 이미 있으면 폭만 갱신(재로드 없음).
 * 검증 실패(XFO/CSP)면 스스로 unmount하고 false를 반환한다.
 */
export function mountDeviceFrame(width: number, timeoutMs?: number): Promise<boolean>;

/** 래퍼·스타일을 제거한다. 멱등. */
export function unmountDeviceFrame(): void;

/** 드래그 rect를 래퍼 영역 안으로 클램핑. 래퍼가 없으면 rect 그대로. 순수 함수 — 유닛 대상. */
export function clampToDeviceFrame(rect: Rect, frame: Rect | null): Rect;
```

**`전체` 복귀는 unmount 후 `location.reload()`까지 간다.** DOM 제거만 하면 원본 문서가 모드 진입 시점 상태로 남아, 모드 ON에서 한 로그인·장바구니 조작이 복귀 화면에 안 보인다. 진입·해제를 대칭으로 두면 상태 불일치 축이 사라진다. 최초 ON 진입 경고는 이 양방향 재로드와, 원본·래퍼 문서가 모드 ON 동안 함께 실행되어 timer·WebSocket·polling·자동저장·결제 동작이 중복될 수 있음을 명시한다.

**은닉은 스타일시트 한 장으로 한다.** 개별 요소의 인라인 스타일을 저장·복원하지 않으므로 복원이 무손실이고, 캡처 중 DOM이 바뀌어도 규칙이 계속 적용된다.

```css
html { overflow: hidden !important; }
body { margin:0 !important; padding:0 !important; height:100vh !important;
       overflow:hidden !important; background:hsl(0 0% 96.1%) !important;
       display:flex !important; justify-content:center !important; }
body > *:not(#__bugshot_device_frame__) { display: none !important; }
#__bugshot_device_frame__ { border:0 !important; display:block !important; height:100% !important; }

@media (prefers-color-scheme: dark) {
  body { background:hsl(0 0% 14.9%) !important; }
}
```

**여백 색을 `#171717`로 고정하지 않는다.** content에 주입하는 CSS는 토큰 표 세 벌 중 하나이고(`docs/DESIGN.md:27`), 기존 주입 CSS는 `@media (prefers-color-scheme: dark)`로 라이트/다크 `hsl()` 리터럴을 복제한다(`content/overlay.ts:201`, 일치 검사는 `src/styles/__tests__/tokens.test.ts:145`). 단색 near-black을 쓰면 라이트 테마 페이지에 검은 슬래브가 깔리고 그게 영역 캡처·탭 녹화·30s Replay에 그대로 찍힌다. 값은 `--muted` 계열을 따르고, 이 파일이 **네 번째 사본**이 되므로 `tokens.test.ts` 등록 여부를 구현 시 판단한다.

`visibility: hidden`이 아니라 `display: none`을 쓴다 — 레이아웃이 살아 있으면 원본 문서의 옵저버·측정 코드가 계속 돌아 유령 로그가 늘어난다.

래퍼는 `document.body` 직속이다. **shadow root 안에 넣으면 안 된다** — `frame-geometry.ts:106`의 `findChildIframe`이 `document.querySelectorAll("iframe")`만 훑으므로 미등록이 되고, 그러면 `elementFromPoint`가 shadow retargeting으로 host를 돌려줘 `iframeUnsupported` 안내조차 안 뜬 채 **shadow host가 조용히 선택된다**(`picker.ts:1075`, `:1095-1105`).

`src`는 반드시 `location.href`다. **`srcdoc`/`about:blank` 금지** — `<all_urls>` 미매치라 content script가 안 붙어 로그·picker가 통째로 죽는다(`e2e/GOTCHAS.md:28`).

### 로드 검증 (XFO/CSP 감지)

top content script의 DOM load 신호와 background의 `webNavigation` 신호를 함께 쓴다. 초기 same-origin 문서는 href 일치로 성공하고, cross-origin redirect는 최초 등록한 frameId의 `onCommitted`로 성공한다. `onErrorOccurred`가 도착하거나 3초 안에 어느 성공 신호도 없고 blank 문서만 남을 때만 XFO/CSP 차단으로 롤백한다. redirect와 차단을 같은 reason으로 합치지 않는다.

### `src/sidepanel/lib/device-presets.ts`

```ts
export interface DevicePreset {
  /** 세그먼트 라벨이자 뷰포트 폭. null = 전체. */
  width: number;
  labelKey: string;
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { width: 390, labelKey: "issue.device.w390" },
  { width: 430, labelKey: "issue.device.w430" },
  { width: 768, labelKey: "issue.device.w768" },
  { width: 1024, labelKey: "issue.device.w1024" },
];

/** 가용 폭 안에 들어가는가. availableWidth가 null(미조회)이면 낙관적으로 true. */
export function isPresetAvailable(width: number, availableWidth: number | null): boolean;
```

`availableWidth`가 null일 때 `true`를 돌려주는 건 의도된 선택이다 — 조회 실패나 초기 프레임에 모든 세그먼트가 흐려지는 깜빡임을 막고, 실제로 안 들어가면 `mountDeviceFrame` 이후 `availableChanged`가 정정한다.

### `src/sidepanel/hooks/useDeviceViewport.ts`

```ts
export interface DeviceViewportState {
  width: number | null;              // 현재 폭 (null = 전체)
  availableWidth: number | null;     // 가용 폭
  locked: boolean;                   // phase !== "idle" || unsupported
  busy: boolean;                     // 전환 진행 중
  select: (width: number | null) => Promise<void>;
}
export function useDeviceViewport(tabId: number | null): DeviceViewportState;
```

`select()`가 하는 일(순서 고정):

1. `locked || busy`면 즉시 반환
2. 최초 ON 진입 1회 확인 다이얼로그. `[계속]`을 누르면 `settings-ui-store.deviceReloadWarned = true`를 `chrome.storage.local`에 즉시 영속한다. 체크박스는 없다. 이 스토어는 현재 **version 9**(`settings-ui-store.ts:242`)이므로 `migrateSettingsUi`(`:131-151`) 기본값 `false` 등록 + version 10 bump가 함께 가야 한다. 문구는 진입·해제 재로드와 원본·래퍼 동시 실행의 중복 요청·자동저장·결제 위험을 모두 말한다.
3. `syncAndSettleLogs(tabId)` — 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다
4. `store.clearNetworkLog/clearConsoleLog/clearActionLog(tabId)` + 3종 persist `discard()` — 모드 전환은 네비게이션이 아니라 `logClear`가 안 온다. 강제한다
5. `sendPickerTop(tabId, { type: "device.set", width })`
6. `ok === false`면 토스트 + 상태를 `전체`로 되돌린다
7. `width != null`이면 현재 tab의 모든 recorder document에 stop을 보내 응답을 확인한 뒤, background가 추적한 래퍼 서브트리 documentId에만 start를 보내 응답을 확인한다. 하나라도 실패하면 모드를 롤백한다.

### `src/sidepanel/recorder-control.ts`

```ts
/** 현재 문서 전부를 정지한 뒤 지정 document 서브트리만 활성화한다. 각 단계는 응답 확인식이다. */
export async function activateRecordersInDeviceTree(tabId: number, documentIds: string[]): Promise<boolean>;
```

정확도가 우선이므로 broadcast 후 top만 재정지하는 경쟁 구조는 쓰지 않는다. background의 `frameId`/`documentId`/`parentFrameId` 계보로 현재 문서를 열거하고, `chrome.tabs.sendMessage(..., { documentId })`로 전부 stop ACK를 받은 뒤 래퍼와 그 자손만 start ACK를 받는다. 전환 중 새 문서가 commit되면 같은 계보 판정으로 래퍼 자손만 활성화하고 나머지는 정지 상태를 재확인한다. sidepanel 모듈 캐시는 두지 않는다.

### `DeviceViewportBar`

```tsx
export function DeviceViewportBar({ tabId }: { tabId: number | null }): JSX.Element | null;
```

**`TabsList` + `TabsTrigger`로 만든다** — `ToggleGroup`이 아니다. 코드베이스의 세그먼트 토글 정규 선례가 `StyleEditorPanel.tsx:239`의 `<TabsList className="grid h-9 w-full grid-cols-N">`(`TabsContent` 없이 store 값으로 구동)이고, `ToggleGroup`은 앱 사용처가 0인 미사용 primitive라 그 `segment` variant(`toggle.tsx:15-16`의 `border-input rounded-none -ml-px`)는 TabsList pill과 시각 언어가 전혀 다르다. ToggleGroup에 `h-9 rounded-lg bg-muted p-1`을 손으로 칠하면 TabsList 룩의 **네 번째 사본**이 되고 "직접 스타일링 금지"와 충돌한다. Tabs를 쓰면 부수적으로 `type="single"`의 재클릭 해제(`value=""`) 축도 사라진다.

- 첫 세그먼트 라벨은 `전체`/`Full`. `끔`이 아니다 — 사용자가 고르는 건 "브라우저 폭 전체"라는 뷰포트 선택지 하나이고, 그래야 행 전체가 동질해진다.
- **폭 예산이 빠듯하다.** 320px 패널에서 세그먼트당 텍스트 가용 폭이 ≈28.8px인데 `1024`(text-sm 4자리)가 ≈31px다. `grid grid-cols-5`에 gap이 남지 않게 하고 트리거 좌우 패딩을 줄여야 한다. Task 7에서 **320/360/400px 3점**을 검증한다.
- 가용 폭 초과 세그먼트: `aria-disabled` + `opacity-50` + 툴팁. `disabled` 속성이 아니라 `aria-disabled`를 쓴다(DESIGN.md §14 — shadcn base의 `disabled:pointer-events-none`이 hover·툴팁을 죽인다). Radix Tabs는 `aria-disabled`를 동작 가드로 해석하지 않으므로 `onValueChange`와 오케스트레이터 `select()` 양쪽에서 locked/busy/초과 값을 거부한다.
- `locked`면 행 전체 `aria-disabled`.
- **`busy`면 선택 세그먼트에 `Loader2 motion-reduce:animate-none`** + 행 전체 `aria-disabled`·`aria-busy=true` + live status. XFO 사이트는 롤백까지 최대 3초라 무피드백 구간이 생긴다.
- 세그먼트 접근명은 숫자가 아니라 `aria-label`로 "너비 390픽셀"류를 준다. 비활성 사유는 `aria-describedby`로 병행(Radix Tooltip은 focus에서도 열린다).
- `tabId == null` 또는 미지원 탭이면 `null`을 반환해 행을 렌더하지 않는다. PRD의 기존 미지원 캡처 진입 정책과 맞춘다.

### 모드 ON 인디케이터

`hideSubTabs`는 `phase === styling|drafting|previewing|done`(`DebugTab.tsx:27-31`)이라, 뷰포트 행이 서브탭 바에 붙는 이상 **캡처 직후부터 제출까지 통째로 사라진다.** 전역 배지를 2차로 미뤘으므로 그 구간에 ON 신호가 0이 되고, `Device` 행 신설도 기각했으므로 리포트 표면에도 신호가 없다.

1차는 **`DraftingPanel`의 재현 환경 근처에 읽기전용 표시 1개**로 갈음한다. 폭이 우연히 프리셋과 같은 전체 상태와 혼동하지 않도록 `device.state.width != null`로 ON을 판정하고 `뷰포트 390px`처럼 현재 폭을 표시한다. 접근명과 `data-testid="device-viewport-indicator"`를 제공한다.

## 기존 패턴 준수

| 규칙 | 이 기능에서 |
|---|---|
| `executeScript({func})`는 클로저가 안 살아남는다 | `getTopViewport`의 새 func은 self-contained. 프레임 id 문자열을 인라인하고 동기화 테스트로 고정 |
| pre-arm 청크는 외부 static import 0 | `recorders-entry` 그래프를 안 건드린다. `device-frame.ts`는 `picker.ts`가 import |
| manifest content_scripts 배열 순서 | 변경 없음. 신규 엔트리를 추가하지 않는다 |
| i18n ko/en 동시 갱신 | `app.ts`·`issue.ts` 양쪽. log-viewer 사전(`src/log-viewer/i18n.ts`)은 이 기능의 키를 안 쓰므로 무변경 |
| store가 `sidepanel/tabs`를 import하지 않는다 | `device-presets.ts`를 `sidepanel/lib/`에 둔다 |
| 신규 인터페이스는 테스트 먼저 | `device-presets.ts`·`device-frame.ts`가 대상. 브라우저 실동작(래퍼 로드·미디어쿼리)은 e2e |
| 세션 영속화 | **하지 않는다.** `EDITOR_SNAPSHOT_KEYS` 무변경 |
| 미지원 탭 게이트 | `useTabUnsupported` 재사용 |
| `aria-disabled` over `disabled` | 툴팁이 살아야 하는 모든 잠금 지점 |

## 캡처 3축에서의 동작

| 방식 | 판정 | 근거 |
|---|---|---|
| 영역(드래그) 캡처 | **클램핑** | rect·viewport 모두 top CSS px이고 크롭 배율은 이미지에서 유도한다(`capture.ts:127`). top blocker가 iframe 위 드래그도 가로채므로 크롭 자체는 정확하지만, 사용자가 래퍼 밖 여백까지 드래그할 수 있다 → 확정 rect(`area-select.ts:200-216`)를 래퍼 영역으로 클램핑한다 |
| 화면(뷰포트) 캡처 | **보정** | `area-select.ts:116`의 rect를 래퍼 rect로 교체. 안 하면 좌우 여백이 찍힌다. 중앙 정렬이라 `x`가 0이 아니므로 `{x:0,y:0,...viewport}` 스프레드를 풀어야 한다 |
| 페이지 전체 캡처 | **잠금** | 오케스트레이터가 frameId 0 고정(`scroll-capture.ts:41`)이라 모드 ON이면 "조용한 1타일"이 된다 — 에러도 truncated 배지도 안 뜬다. 1차에서는 명시적으로 잠근다 |

**크롭 배율용 viewport와 메타용 viewport를 분리한다.** 지금은 `picker.areaSelected`의 `msg.viewport` 하나가 둘 다를 맡는데, 크롭은 top 기준이어야 정확하고(`img.naturalWidth / viewport.width`) 메타는 디바이스 폭이어야 한다. `captureAndCrop(rect, cropViewport, metaViewport)`로 인자를 하나 늘리고, `metaViewport`는 `getTopViewport(tabId)`로 받는다. 모드 OFF에서는 두 값이 같아 무해하다.

`captureAndCrop`은 **`capture.ts`가 아니라 `usePickerMessages.ts:423`의 모듈 프라이빗 함수**다(`capture.ts`의 export는 `cropImage`뿐이고 호출부도 `:222` 한 곳). 따라서 이 변경은 `usePickerMessages.ts` 안에서 끝난다. 같은 파일의 `captureAndInsertInline`(`:442`)은 `cropImage`만 쓰고 메타를 안 쓰므로 무변경이고, 두 함수의 시그니처가 비대칭이 되므로 주석으로 이유를 남긴다.

## 래퍼 내부 네비게이션 = top 네비게이션

`tab-bindings.ts:317-332`의 세션·로그 리셋 그물이 전부 `tab.url` 변화에 걸려 있다. B안은 top URL을 안 바꾸므로 래퍼 안의 이동이 이 그물을 통째로 통과한다 — 그대로 두면 같은 조작인데 모드 ON/OFF에서 로그 범위가 달라져 리포트 재현성이 깨진다.

**해결**: background가 래퍼 frameId를 알고 top처럼 취급한다.

```ts
// background/tab-bindings.ts
type DeviceFrameBinding = { frameId: number; documentId: string };
const deviceFrameByTab = new Map<number, DeviceFrameBinding>();
export async function setDeviceFrame(tabId: number, binding: DeviceFrameBinding | null): Promise<void>;
export function isTopLikeFrame(tabId: number, frameId: number): boolean;  // 0 || 래퍼
```

- 최초 등록: 같은 URL을 연 래퍼의 `picker.ts`만 `window.frameElement?.id === DEVICE_FRAME_ID`를 확인해 `device.frameReady`를 발화 → background가 `sender.frameId`/`sender.documentId`를 Map과 `chrome.storage.session`에 기록
- 문서 이동: Chrome이 frame 생애 동안 유지하는 `frameId`를 권위값으로 삼고 `onCommitted.documentId`를 갱신한다. cross-origin 문서는 `frameElement`를 읽거나 재인증할 필요가 없다. `parentFrameId`/`parentDocumentId`로 래퍼 자손 계보도 갱신한다
- SW 복구: 시작 시 storage 복원 promise 뒤에 navigation 이벤트를 탭별 큐잉한다. 복구 전에 Map이 비었다고 top-only로 판정하지 않는다
- 해제: `device.set { width: null }` 성공 시, top `onCommitted`, 탭 제거에서 Map과 storage를 함께 제거
- 소비: **아래 "무엇을 갈아끼우고 무엇을 그대로 두는가"**

### 무엇을 갈아끼우고 무엇을 그대로 두는가

`onCommitted` 리스너(`background/index.ts:143-186`)는 **두 책임이 얽혀 있어 boolean 하나로 뭉갤 수 없다.** `:145`의 자식 분기는 단순 early return이 아니라 **iframe 전용 `frameCommitted` 재발행 블록**(`:146-162`)이다.

| 축 | 처리 |
|---|---|
| `frameCommitted` push | **항상 실제 `details.frameId`로 보낸다.** 자식 분기(`:146-162`)를 래퍼에도 그대로 태운다 |
| 로그 라이프사이클 (`:129-140` 3종 sync, `:174-185` logClear) | `isTopLikeFrame(tabId, frameId)`을 적용해 래퍼를 top처럼 취급 |

래퍼를 top 분기로 보내면 두 가지가 조용히 깨진다:

1. `rebroadcastSentinelsToFrame`·`restartPickerInFrame`이 래퍼를 못 겨냥해 **래퍼 안 로그 레코더가 dormant**가 되고, picking 중 래퍼 재로드 시 클릭이 유실된다. (b)에서 짚은 유일한 사후 등록 경로가 죽는 것이다.
2. `:170`이 `frameId: 0`을 **하드코딩**해 push하므로 래퍼의 documentId가 frameId 0 슬롯에 들어간다(`usePickerMessages.ts:271`). 이후 진짜 top이 보낸 `picker.selected`/`cancelled`/`areaSelected`가 `isStalePickerDocument`(`:85-92`)에 걸려 **전부 드롭**된다 — 완전 무반응 회귀다.

### `navUrlPromise` 키 확장

`navUrlPromise`(`background/index.ts:120`)는 tabId 단일 키이고 이전 URL을 `chrome.tabs.get(tabId).url`로 뽑는다(`:126`). **래퍼가 이동해도 top URL은 안 바뀌므로 `prev`가 영원히 mount 시점 URL로 고정된다** — 래퍼 안 A→B→C 이동에서 두 번째 판정이 B가 아니라 A 기준으로 돌아 `shouldClearLogs`가 오판한다. top과 래퍼가 겹쳐 navigate하면 엔트리가 서로를 덮는 문제도 있다.

키를 `${tabId}:${frameId}`로 바꾸고, 래퍼의 prev URL은 `tabs.get`이 아니라 직전 `onCommitted` URL을 별도 추적한다.

**게이트는 탭별 순서 큐로 직렬화한다.** storage 복구와 각 navigation 처리를 같은 promise chain에 연결해 `navUrlPromise` 갱신과 `frameCommitted` 순서를 보존한다. 즉시성보다 SW 재기동 뒤 올바른 래퍼 판정을 우선한다.

이러면 래퍼 안의 이동에서도 3종 `sync` 꼬리 확보 + cross-origin/reload `logClear`가 동일하게 돌면서, iframe 재발행 경로도 살아남는다.

## 모드 전이 게이트

| 위험 | 게이트 |
|---|---|
| (a) 로그 혼입 — 엔트리에 frameId 필드가 없어(`console-recorder.ts:29-37`) 전이 전후를 구분할 수 없다 | 전이 직전 3종 `sync` + settle → store clear 강제 |
| (b) draft·선택 요소 파괴 — 래퍼 재로드로 frameId가 재발급되면 `sameElementKey`(`element-key.ts:8-10`)가 어긋나 `applyStyles/applyClasses/applyText`가 **조용히 no-op**된다(반환값 미확인 — `tabs/styleEditor/StylePropEditors.tsx:45`가 `void`로 무시). `rebindStylingSession`은 URL(pageKey)만 보므로(`picker-control.ts:474-487`) 이 그물이 전이를 못 잡는다 | **`phase !== "idle"`이면 컨트롤 전체 잠금.** 전이 자체를 막아 (b)를 원천 제거한다. `element-key.ts`에 세대 축을 넣는 안은 소비처가 많아 비용이 크다 |
| (c) 녹화·리플레이 중 전이 — 한 스트림 안 해상도 불연속(`video-recorder.ts:111-117`), 30s 버퍼가 토글만으로 `clear()`(`30s-replay/use-30s-replay.ts:56`, cleanup은 `:110`) | (b)와 같은 잠금이 함께 막는다(`phase === "recording"`) |
| (d) 세션 복원 desync | **모드를 영속하지 않으므로 발생 축이 없다.** 사이드패널이 마운트될 때 `device.state`로 페이지에 물어본다 |

## pre-arm 상호작용

`__bugshot_recorder_active__` 플래그는 origin 스코프 `sessionStorage`(`recorder-prearm.ts:4`)라 최초 same-origin 래퍼는 읽지만 cross-origin 목적지는 그 origin의 별도 저장소를 본다. 따라서 정확성 계약은 pre-arm 플래그가 아니라 `onCommitted` 뒤 documentId 지정 start ACK다. cross-origin 문서의 commit 이전 극초기 로그는 수집하지 못할 수 있으며, 이를 없애려면 origin을 넘는 사전 활성 신호가 필요하므로 잔여 위험으로 둔다.

경계 우회 위험은 남는다: `preArm: true` 마커가 붙은 엔트리는 `logClear` 경계를 우회한다(`sidepanel/lib/log-prearm-filter.ts:8`). 다만 전이 시 사이드패널 store를 직접 clear하고 top 레코더를 stop하므로, clear 이후 도착하는 preArm 엔트리는 전부 래퍼 것이다. 회귀 그물은 `e2e/logs-prearm.spec.ts`가 맡는다.

## 2-depth 안내 문구 분기

거부 발화점은 `picker.ts:1070-1094` 한 곳이고, 모드 ON에서 손자 프레임 거부는 **이미 이 경로로 흐른다 — 추가 배선 0**. 현행 ko 문구가 "…다른 요소를 선택하거나 **스크린샷 모드**를 사용해 주세요"로 끝나는데, 모드 ON의 진짜 액션은 "디바이스 모드를 끄면 선택 가능"이다.

가장 싼 분기 지점은 `App.tsx:367` 렌더 시점이다. 스토어가 아니라 `useDeviceViewport(tabId).width`를 읽어 문구만 교체한다. content script 프로토콜 변경 0, i18n 키 2개(ko/en). `messages.ts:347-350`의 `fire()`에 reason을 싣는 안은 **발화 지점인 content script가 자신이 래퍼 안인지 모르므로** 더 비싸다.

## 대안 검토

### 렌더링 기법

| 기법 | `innerWidth` | 미디어쿼리 | `vw`/`100vh` | `fixed` | 판정 |
|---|:---:|:---:|:---:|:---:|---|
| `<html>` 고정 width + `transform: scale` | ✗ | ✗ | ✗ | ✗✗ transform된 조상이 containing block이 되어 **`fixed` 동작 자체가 깨진다** | 기각 |
| CSS `zoom` | ✗ | ✗ | ✗ | ✗ | 기각 |
| `chrome.tabs.setZoom` | ✓ | ✓ | ✓ | ✓ | **높이 독립 지정 불가.** 1512×800 창에서 390px 폭을 만들면 높이가 206px + 3.9배 확대 렌더가 된다 |
| **iframe 래핑** | ✓ | ✓ | ✓ | ✓ | **채택** |

`transform`/`zoom`은 미디어쿼리가 안 터진다 — 브레이크포인트가 안 바뀌면 "작게 그린 데스크톱 화면"일 뿐이라 반응형 검증 도구로서 무의미하다.

### 별도 확장 페이지(`chrome-extension://`)에 iframe

기각. `chrome-extension:`이 `SUPPORTED_SCHEMES`에 없어(`url-support.ts:1`) 캡처 5종·로그 서브탭·30s Replay·영상이 전부 잠기고, content_scripts가 `<all_urls>` 매칭이라 확장 페이지 top에는 picker도 레코더도 안 붙는다. 되살리려면 지원 URL 판정·주입 매칭·origin 기준이라는 단일 출처 3개를 동시에 흔들어야 하고, DNR/`webRequest` 신규 권한 + XFO/CSP 제거 justification이 심사에 걸린다.

### 래퍼 코드를 별도 content script로 주입

기각. `manifest.content_scripts`에 엔트리를 더하면 `picker-control.ts:64-74`의 `i > 0 && all_frames && world !== "MAIN"` find가 recorder-bridge 대신 새 엔트리를 잡아 **로그 브리지 자가복구가 조용히 죽는다.** `:35-36`의 index 0 하드코딩, `:86-90`의 MAIN find, `scripts/check-prearm-chunk.mjs:39`의 부분 문자열 매칭까지 4곳이 동시에 걸린다. `picker.ts`에 메시지 핸들러로 얹으면 이 축이 통째로 사라진다.

### 재현 환경에 `Device` 행 신설

기각(사용자 결정). 기존 `Viewport` 행에 디바이스 값을 오버라이트한다. 대가로 리포트를 받는 사람은 "1512 창에서 390으로 에뮬레이트"인지 "실제 390 기기"인지 구분하지 못하지만, 이 기능은 Web 디버깅 한정이므로 수용한다. 이 결정으로 재현 환경 빌더 3벌(`DraftingPanel.tsx:576-678`, `environmentRows.ts:34-58`, `buildReportData.ts:11-30`)과 `buildIssueMarkdown.ts`의 md/html/meta 3경로, `EditorSnapshot` 확장이 **전부 불필요**해진다.

### 모드 상태를 `chrome.storage.session`에 영속

기각. 복원 경로(`useEditorSessionSync.ts:112-155`)가 페이지 DOM을 전혀 검증하지 않으므로, 탭 reload로 래퍼가 사라져도 "ON"이 살아남아 UI/DOM이 완전 desync된다. 반대로 `shouldPreserveSession`(`tab-bindings.ts:71-80`)은 `captureMode`/`phase`만 보므로 deactivate 분기에서 모드가 통째로 소실된다. 페이지 DOM을 단일 출처로 두면 두 문제가 동시에 없어진다.

## 위험 요소

1. **`getTopViewport`의 의미 변경이 캡처 5종에 동시 파급된다.** 시그니처는 그대로지만 반환값 의미가 "브라우저 뷰포트"에서 "캡처 대상 뷰포트"로 바뀐다. 주석을 반드시 갱신하고, 모드 OFF에서 값이 이전과 동일함을 유닛으로 고정한다. 영상·리플레이는 여기에 **새로 편입**되는 경로라 회귀 표면이 가장 넓다.
2. **프레임 id 문자열이 두 곳에 복제된다**(`device-frame.ts` 상수 / `getTopViewport`의 인라인 리터럴). 직렬화 제약상 불가피하므로 동기화 테스트를 반드시 붙인다. **상수를 import하면 typecheck·유닛이 전부 green인데 런타임에만 `ReferenceError`로 죽고, `picker-control.ts:820`의 `catch`가 그걸 삼켜 조용히 `null`로 폴백한다** — 이 기능에서 가장 탐지하기 어려운 회귀 축이다(`docs/ARCHITECTURE.md:465`가 "inject 경로 리팩터 시 실제 탭 수동 회귀 필수"라고 못박은 그 지점).
3. **`e2e/logs-origin-filter.spec.ts:41-42`의 전제는 최초 same-origin 래퍼에서만 합쳐진다.** cross-origin 이동 뒤에는 목적지 origin 버튼이 별도로 생긴다. 모드 OFF 기본이라 기존 spec은 green이고 신규 spec은 두 상태를 구분한다.
4. **`e2e/api-hosts-env-row.spec.ts:94-96`이 호스트 정렬 순서를 하드코딩한다.** 모드 ON에서 재로드로 요청 수가 2배가 되면 동률 호스트 정렬이 뒤집힐 수 있다(카운트 누적 `apiHostRow.ts:49`, 정렬 `:54-56`). 모드 OFF 기본이므로 기존 spec은 안전하지만 신규 spec에서 순서를 단언하지 않는다.
5. **iframe 프레임 프로토콜은 회귀 밀집 구간이다.** `docs/POSTMORTEM.md:371`이 "iframe picker·OAuth는 e2e 커버가 없는 영역 — 리포트 처방을 '유닛 green'을 근거로 적용하지 말 것"이라고 못박았다. 이 기능은 그 구간을 정면으로 지난다.
6. **`display: none`으로 숨긴 원본 문서의 타이머·폴링은 계속 돈다.** 레코더 stop이 로그는 막지만 CPU는 계속 쓴다. 재로드된 래퍼와 합쳐 리소스가 약 2배가 된다.
7. **`check:prearm`의 검출 한계.** `scripts/check-prearm-chunk.mjs:39`의 `includes("recorders-entry")` 부분 문자열 매칭이 새 파일 이름과 충돌하지 않는지 확인한다(`device-frame`은 충돌하지 않는다).
8. **top blocker의 pointerEvents 핸드오프가 래퍼에도 적용된다.** 래퍼가 `frame-geometry.ts` registry에 등록되므로 picker가 래퍼 위에서 핸드오프한다 — 이건 의도된 동작이지만, 등록 실패 시 래퍼 자체가 `iframeUnsupported`로 거부돼 **모드 ON에서 아무 요소도 못 고르는** 상태가 된다. 배선은 위 "래퍼 registry 등록" 절, e2e로 반드시 고정한다.
9. **최초 same-origin 래퍼와 top은 origin 필터에서 구분되지 않는다.** 다만 전 document stop ACK 뒤 래퍼 서브트리만 start하므로 top 로그는 수집되지 않는다. cross-origin 이동 뒤에는 목적지 origin으로 구분된다.
10. **`ensureMainWorldRecorders`(`picker-control.ts:85-101`)는 `allFrames`가 없어 top만 재주입한다**(`ensureRecorderBridge`는 `allFrames: true`). 래퍼에는 MAIN world 레코더의 **자가복구 경로가 없고** 정적 content_scripts 주입 + pre-arm 플래그에만 의존한다. 실동작은 하지만 복구 그물이 한 겹 얇다. `allFrames: true`로 넓히는 것은 모드 OFF에서도 전 프레임 재주입이 되는 범위 외 회귀라 1차에서 하지 않는다.
