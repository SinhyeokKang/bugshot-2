# 디바이스 뷰포트 — 기술 설계

## 개요

top 문서 안에 같은 URL을 `src=`로 로드하는 iframe(`#__bugshot_device_frame__`)을 만들고, 원본 `body` 자식을 스타일시트 한 장으로 숨긴 뒤 그 iframe을 선택한 폭으로 렌더한다. top-level origin이 유지되므로 래퍼는 same-origin이고 쿠키·스토리지가 살아있으며, `<all_urls>` content_scripts가 래퍼 안에도 그대로 주입돼 picker·로그 레코더가 전부 동작한다.

**설계의 축은 "상태를 어디에 두지 않을 것인가"다.** 모드의 단일 출처는 top 문서에 그 iframe이 존재하는지 여부뿐이고, 사이드패널 스토어에도 `chrome.storage`에도 모드 플래그를 두지 않는다. 이렇게 하면 탭 reload·URL 이동·확장 reload로 래퍼가 사라질 때 UI가 조용히 desync되는 축이 아예 생기지 않는다(브리프의 위험 (d)가 구조적으로 제거된다). 대신 사이드패널은 필요할 때마다 top 문서에 물어본다.

같은 원리로 **뷰포트 값을 파생하는 코드가 사이드패널 상태를 안 읽는다.** `getTopViewport`가 주입하는 함수가 스스로 래퍼를 찾아보고, 있으면 래퍼 크기를 없으면 `window.innerWidth/innerHeight`를 반환한다. 호출부 5개(element·screenshot·freeform·video·replay)가 무변경으로 올바른 값을 받는다.

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
| `src/content/area-select.ts:114` | `selectFullViewport`가 rect를 `{0,0,innerWidth,innerHeight}`로 하드코딩 | 래퍼가 있으면 `getDeviceFrameRect()`로 교체. `viewport`(크롭 배율 기준)는 top 유지 |
| `src/sidepanel/picker-control.ts:811-824` | `getTopViewport`가 top `innerWidth/innerHeight` 반환 | 주입 함수가 래퍼를 먼저 찾도록 교체. 시그니처·호출부 무변경 |
| `src/sidepanel/recorder-control.ts` | clear 3종 (frameId 미지정 broadcast) | `stopRecordersInFrame(tabId, frameId)` 신설 |
| `src/sidepanel/hooks/usePickerMessages.ts:206-223` | `picker.areaSelected` → `captureAndCrop(rect, viewport)` | 크롭은 `msg.viewport`, 메타는 `getTopViewport(tabId)`로 분리 |
| `src/sidepanel/capture.ts` | `captureAndCrop(rect, viewport)` | 메타 viewport를 별도 인자로 받는다 |
| `src/sidepanel/tabs/DebugTab.tsx:73-92` | 서브탭 바 | `sub === "issue" && !hideSubTabs`일 때 `<DeviceViewportBar>` 행 렌더 |
| `src/sidepanel/tabs/IssueTab.tsx:552-563` | `capture-method-fullpage` 버튼 | 모드 ON이면 `ariaDisabled` + 잠금 툴팁 |
| `src/sidepanel/App.tsx:362-372` | `iframeUnsupported` 다이얼로그 | 모드 ON이면 body 문구를 `app.iframeUnsupported.bodyDeviceMode`로 교체 |
| `src/background/index.ts:123`·`:145-163` | 네비게이션 로그 관리가 `frameId !== 0`이면 early return | 래퍼 frameId를 frameId 0과 동등 취급 |
| `src/background/tab-bindings.ts` | — | `deviceFrameByTab: Map<number, number>` 등록·조회 |
| `src/types/picker.ts` | `PickerMessage` union | `device.*` 메시지 3종 추가 |
| `src/i18n/namespaces/app.ts`·`issue.ts` | ko/en 사전 | 신규 키(ko/en 동시) |

### 손 안 대는 곳

- `src/sidepanel/lib/environmentRows.ts`, `buildReportData.ts`, `buildIssueMarkdown.ts`, `liteSnapshot.ts`, `src/sidepanel/tabs/DraftingPanel.tsx` — **`Device` 행을 신설하지 않기로 했으므로 전부 무변경.** `Viewport` 행 값이 `getTopViewport` 한 지점에서 바뀌므로 하류가 자동으로 따라온다.
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
   │  ② 최초 1회 확인 다이얼로그
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
   ├─▶ [래퍼 프레임 / picker.ts]  window.frameElement.id === "__bugshot_device_frame__"
   │        postToRuntime({ type: "device.frameReady" })
   │            → background: deviceFrameByTab.set(tabId, sender.frameId)
   │            → sidepanel: (알림만)
   │
   └─▶ stopRecordersInFrame(tabId, 0)      ← 숨겨진 원본 문서의 레코더 정지
       webNavigation.onCommitted(frameId≠0) → frameCommitted
            → rebroadcastSentinelsToFrame(래퍼)  ← 기존 경로, 무변경
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
   ├─ element     usePickerMessages.ts:160-167, :409-410
   ├─ screenshot  usePickerMessages.ts:206-223 (신규 경로)
   ├─ freeform    picker-control.ts:844
   ├─ video       video-recorder 메타
   └─ replay      use-30s-replay 메타
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
   └─ DeviceViewportBar 언마운트 → { type: "device.unwatch" }
```

`innerWidth`가 아니라 `documentElement.clientWidth`를 쓴다 — 세로 스크롤바 15~17px을 빼지 않으면 래퍼가 가용 폭에 딱 맞을 때 가로 스크롤이 생긴다.

`chrome.windows.onBoundsChanged`는 **쓰지 않는다.** 창 bounds만 주고 사이드패널 리사이즈에는 발화하지 않는다. 폴링도 하지 않는다.

## 인터페이스 설계

### 메시지 (`src/types/picker.ts`)

```ts
// 사이드패널 → top 프레임 (frameId 0 지정 송신)
| { type: "device.set"; width: number | null }   // null = 전체(래퍼 제거)
| { type: "device.state" }
| { type: "device.watch"; on: boolean }

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

/** 래퍼·스타일을 제거하고 원본을 복원한다. 멱등. */
export function unmountDeviceFrame(): void;
```

**은닉은 스타일시트 한 장으로 한다.** 개별 요소의 인라인 스타일을 저장·복원하지 않으므로 복원이 무손실이고, 캡처 중 DOM이 바뀌어도 규칙이 계속 적용된다.

```css
html { overflow: hidden !important; }
body { margin:0 !important; padding:0 !important; height:100vh !important;
       overflow:hidden !important; background:#171717 !important;
       display:flex !important; justify-content:center !important; }
body > *:not(#__bugshot_device_frame__) { display: none !important; }
#__bugshot_device_frame__ { border:0 !important; display:block !important; height:100% !important; }
```

`visibility: hidden`이 아니라 `display: none`을 쓴다 — 레이아웃이 살아 있으면 원본 문서의 옵저버·측정 코드가 계속 돌아 유령 로그가 늘어난다.

래퍼는 `document.body` 직속이다. **shadow root 안에 넣으면 안 된다** — `frame-geometry.ts:106`의 `findChildIframe`이 `document.querySelectorAll("iframe")`만 훑으므로 미등록이 되고, 그러면 `elementFromPoint`가 shadow retargeting으로 host를 돌려줘 `iframeUnsupported` 안내조차 안 뜬 채 **shadow host가 조용히 선택된다**(`picker.ts:1075`, `:1095-1105`).

`src`는 반드시 `location.href`다. **`srcdoc`/`about:blank` 금지** — `<all_urls>` 미매치라 content script가 안 붙어 로그·picker가 통째로 죽는다(`e2e/GOTCHAS.md:28`).

### 로드 검증 (XFO/CSP 감지)

```ts
const ok = await new Promise<boolean>((resolve) => {
  const timer = setTimeout(() => resolve(false), timeoutMs);
  frame.addEventListener("load", () => {
    clearTimeout(timer);
    try {
      resolve(frame.contentDocument?.location.href === location.href);
    } catch {
      resolve(false);   // cross-origin으로 밀린 경우
    }
  }, { once: true });
});
```

XFO `DENY` / CSP `frame-ancestors 'none'`이면 Chrome이 `load`를 발화하되 문서는 `about:blank`로 남는다 → href 비교가 실패를 잡는다. same-origin이라 `SAMEORIGIN`·`frame-ancestors 'self'`는 정상 통과하므로 실패는 소수 사이트에 한정된다.

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
2. 최초 1회 확인 다이얼로그(폭이 null→숫자로 갈 때만. 해제는 `settings-ui-store`에 `deviceReloadWarned: boolean` 하나)
3. `syncAndSettleLogs(tabId)` — 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다
4. `store.clearNetworkLog/clearConsoleLog/clearActionLog(tabId)` + 3종 persist `discard()` — 모드 전환은 네비게이션이 아니라 `logClear`가 안 온다. 강제한다
5. `sendPickerTop(tabId, { type: "device.set", width })`
6. `ok === false`면 토스트 + 상태를 `전체`로 되돌린다
7. `width != null`이면 `stopRecordersInFrame(tabId, 0)`

### `src/sidepanel/recorder-control.ts`

```ts
/** 지정 프레임의 로그 레코더 3종만 정지. 기존 clear 3종은 frameId 미지정 broadcast라 그대로 못 쓴다. */
export async function stopRecordersInFrame(tabId: number, frameId: number): Promise<void>;
```

`chrome.tabs.sendMessage(tabId, msg, { frameId })`로 보낸다. 레코더 재활성 경로(`activateNetworkRecorder` 등 3종)가 `sendAll` broadcast라 top이 되살아나므로, **`picker-control`에 모듈 레벨 `deviceModeTabs: Set<number>` 캐시를 두고 activate 직후 재차 stop을 건다.** 이 캐시는 사이드패널 인스턴스 내부(탭 스코프)에 머물고 진실 소스가 아니다 — 틀려도 `getTopViewport`·`device.state`는 항상 페이지에서 다시 읽는다.

### `DeviceViewportBar`

```tsx
export function DeviceViewportBar({ tabId }: { tabId: number | null }): JSX.Element | null;
```

`TabsList`와 동일한 시각 언어(`h-9 rounded-lg bg-muted p-1`, `grid grid-cols-5`)를 쓰되 Radix `Tabs`가 아니라 **`ToggleGroup`(shadcn, `type="single"`)** 로 만든다. Radix Tabs는 패널을 지배하는 컨트롤이라 의미가 안 맞고, 이 행은 서브탭 바 아래의 별개 컨트롤이다.

- 첫 세그먼트 라벨은 `전체`/`Full`. `끔`이 아니다 — 사용자가 고르는 건 "브라우저 폭 전체"라는 뷰포트 선택지 하나이고, 그래야 행 전체가 동질해진다.
- 가용 폭 초과 세그먼트: `aria-disabled` + `opacity-50` + 툴팁. `disabled` 속성이 아니라 `aria-disabled`를 쓴다(DESIGN.md §14 — shadcn base의 `disabled:pointer-events-none`이 hover·툴팁을 죽인다). `ReplayButton`이 같은 선례다.
- `locked`면 행 전체 `aria-disabled`.
- `tabId == null`이거나 미지원 탭이면 `null` 반환(행 자체 미렌더).

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
| 영역(드래그) 캡처 | **그대로** | rect·viewport 모두 top CSS px이고 크롭 배율은 이미지에서 유도한다(`capture.ts:127`). top blocker가 iframe 위 드래그도 가로챈다 |
| 화면(뷰포트) 캡처 | **보정** | `area-select.ts:114`의 rect를 래퍼 rect로 교체. 안 하면 좌우 여백이 찍힌다 |
| 페이지 전체 캡처 | **잠금** | 오케스트레이터가 frameId 0 고정(`scroll-capture.ts:41`)이라 모드 ON이면 "조용한 1타일"이 된다 — 에러도 truncated 배지도 안 뜬다. 1차에서는 명시적으로 잠근다 |

**크롭 배율용 viewport와 메타용 viewport를 분리한다.** 지금은 `picker.areaSelected`의 `msg.viewport` 하나가 둘 다를 맡는데, 크롭은 top 기준이어야 정확하고(`img.naturalWidth / viewport.width`) 메타는 디바이스 폭이어야 한다. `captureAndCrop(rect, cropViewport, metaViewport)`로 인자를 하나 늘리고, `metaViewport`는 `getTopViewport(tabId)`로 받는다. 모드 OFF에서는 두 값이 같아 무해하다.

## 래퍼 내부 네비게이션 = top 네비게이션

`tab-bindings.ts:317-332`의 세션·로그 리셋 그물이 전부 `tab.url` 변화에 걸려 있다. B안은 top URL을 안 바꾸므로 래퍼 안의 이동이 이 그물을 통째로 통과한다 — 그대로 두면 같은 조작인데 모드 ON/OFF에서 로그 범위가 달라져 리포트 재현성이 깨진다.

**해결**: background가 래퍼 frameId를 알고 top처럼 취급한다.

```ts
// background/tab-bindings.ts
const deviceFrameByTab = new Map<number, number>();
export function setDeviceFrame(tabId: number, frameId: number | null): void;
export function isTopLikeFrame(tabId: number, frameId: number): boolean;  // 0 || 래퍼
```

- 등록: 래퍼 안의 `picker.ts`가 `window.frameElement?.id === DEVICE_FRAME_ID`로 자기 정체를 알고(same-origin이라 `frameElement` 접근 가능) `device.frameReady`를 발화 → background가 `sender.frameId`로 기록
- 해제: `device.set { width: null }` 성공 시, 그리고 `onCommitted(frameId: 0)`에서 무조건
- 소비: `background/index.ts:123`의 `if (details.frameId !== 0) return`과 `:145`의 frameId≠0 early return을 `isTopLikeFrame`으로 교체

이러면 래퍼 안의 이동에서도 3종 `sync` 꼬리 확보 + cross-origin/reload `logClear`가 동일하게 돈다.

## 모드 전이 게이트

| 위험 | 게이트 |
|---|---|
| (a) 로그 혼입 — 엔트리에 frameId 필드가 없어(`console-recorder.ts:29-37`) 전이 전후를 구분할 수 없다 | 전이 직전 3종 `sync` + settle → store clear 강제 |
| (b) draft·선택 요소 파괴 — 래퍼 재로드로 frameId가 재발급되면 `sameElementKey`(`element-key.ts:8-10`)가 어긋나 `applyStyles/applyClasses/applyText`가 **조용히 no-op**된다(반환값 미확인 — `StylePropEditors.tsx:44-45`). `rebindStylingSession`은 URL(pageKey)만 보므로(`picker-control.ts:483-487`) 이 그물이 전이를 못 잡는다 | **`phase !== "idle"`이면 컨트롤 전체 잠금.** 전이 자체를 막아 (b)를 원천 제거한다. `element-key.ts`에 세대 축을 넣는 안은 소비처가 많아 비용이 크다 |
| (c) 녹화·리플레이 중 전이 — 한 스트림 안 해상도 불연속(`video-recorder.ts:17`), 30s 버퍼가 토글만으로 `clear()`(`use-30s-replay.ts:106`) | (b)와 같은 잠금이 함께 막는다(`phase === "recording"`) |
| (d) 세션 복원 desync | **모드를 영속하지 않으므로 발생 축이 없다.** 사이드패널이 마운트될 때 `device.state`로 페이지에 물어본다 |

## pre-arm 상호작용

`__bugshot_recorder_active__` 플래그는 origin+탭 스코프 `sessionStorage`(`recorder-prearm.ts:4`)라 same-origin인 래퍼도 읽는다 → 래퍼가 `document_start`부터 `capturing = true`가 되어 로드 초반부터 버퍼에 적재한다. **이건 원하는 동작이다** — 래퍼가 곧 테스트 대상이고, 그 페이지의 초기 로그야말로 반응형 디버깅에서 필요한 것이다.

경계 우회 위험은 남는다: `preArm: true` 마커가 붙은 엔트리는 `logClear` 경계를 우회한다(`log-prearm-filter.ts:8`). 다만 전이 시 사이드패널 store를 직접 clear하고 top 레코더를 stop하므로, clear 이후 도착하는 preArm 엔트리는 전부 래퍼 것이다. 회귀 그물은 `e2e/logs-prearm.spec.ts`가 맡는다.

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

1. **`getTopViewport`의 의미 변경이 5개 모드에 동시 파급된다.** 시그니처는 그대로지만 반환값 의미가 "브라우저 뷰포트"에서 "캡처 대상 뷰포트"로 바뀐다. 주석을 반드시 갱신하고, 모드 OFF에서 값이 이전과 동일함을 유닛으로 고정한다.
2. **프레임 id 문자열이 두 곳에 복제된다**(`device-frame.ts` 상수 / `getTopViewport`의 인라인 리터럴). 직렬화 제약상 불가피하므로 동기화 테스트를 반드시 붙인다.
3. **`e2e/logs-origin-filter.spec.ts:41-42`의 전제가 모드 ON에서 붕괴한다** — same-origin이라 `OriginFilterBar` 버튼이 1개로 합쳐진다. 모드 OFF 기본이라 기존 spec은 green이지만, 신규 spec에서 이 전제를 재사용하지 않는다.
4. **`e2e/api-hosts-env-row.spec.ts:94-96`이 호스트 정렬 순서를 하드코딩한다.** 모드 ON에서 재로드로 요청 수가 2배가 되면 동률 호스트 정렬이 뒤집힐 수 있다(`apiHostRow.ts:49`, `:54-55`). 모드 OFF 기본이므로 기존 spec은 안전하지만 신규 spec에서 순서를 단언하지 않는다.
5. **iframe 프레임 프로토콜은 회귀 밀집 구간이다.** `docs/POSTMORTEM.md:350`이 "iframe picker·OAuth는 e2e 커버가 없는 영역 — 리포트 처방을 '유닛 green'을 근거로 적용하지 말 것"이라고 못박았다. 이 기능은 그 구간을 정면으로 지난다.
6. **`display: none`으로 숨긴 원본 문서의 타이머·폴링은 계속 돈다.** 레코더 stop이 로그는 막지만 CPU는 계속 쓴다. 재로드된 래퍼와 합쳐 리소스가 약 2배가 된다.
7. **`check:prearm`의 검출 한계.** `scripts/check-prearm-chunk.mjs:39`의 `includes("recorders-entry")` 부분 문자열 매칭이 새 파일 이름과 충돌하지 않는지 확인한다(`device-frame`은 충돌하지 않는다).
8. **top blocker의 pointerEvents 핸드오프가 래퍼에도 적용된다.** 래퍼가 `frame-geometry.ts` registry에 등록되므로 picker가 래퍼 위에서 핸드오프한다 — 이건 의도된 동작이지만, 등록 실패 시 래퍼 자체가 `iframeUnsupported`로 거부돼 **모드 ON에서 아무 요소도 못 고르는** 상태가 된다. e2e로 반드시 고정한다.
