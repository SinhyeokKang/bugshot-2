# 전체 화면 캡처 — 기술 설계

## 개요

새 캡처 코드를 만들지 않는다. **기존 드래그 완료 경로를 뷰포트 전체 rect로 재사용**한다.

`area-select.ts`의 드래그 완료(`onMouseUp`, L164-185)는 이미 이 순서로 동작한다: 리스너 제거 → 오버레이 엘리먼트 제거 → blocker 숨김 → `deps.onSelected(rect, viewport)`. 그리고 `picker.ts`의 `onSelected` 콜백(L940-949)이 `picker.areaSelected`를 사이드패널로 postMessage하고, 사이드패널이 `captureAndCrop`으로 captureVisibleTab → 크롭 → `onAreaCaptured` → drafting까지 처리한다.

따라서 필요한 건 **"오버레이를 걷고 뷰포트 전체 rect로 `onSelected`를 부르는" 진입점 하나**뿐이다. 캡처·크롭·phase 전이는 기존 코드가 그대로 담당한다. 이 설계의 핵심 이점은 **오버레이 정리가 캡처 요청보다 먼저 끝나는 순서 보장을 드래그 경로와 공유**한다는 것이다(오버레이가 스크린샷에 찍히는 사고를 구조적으로 차단).

여기에 브라우저 줌 대응으로 크롭 rect 클램프 가드를 추가한다.

## 변경 범위

### 1. `src/types/picker.ts` — 메시지 타입 추가
- **현재 역할**: 사이드패널 ↔ content script 메시지 union(`PickerMessage`) 정의.
- **변경**: `picker.cancelAreaSelect`(L98) 아래에 한 줄 추가.
  ```ts
  | { type: "picker.selectFullViewport" }
  ```

### 2. `src/content/area-select.ts` — 전체 뷰포트 선택 함수 추가
- **현재 역할**: shadow DOM에 dim 4분면 + 선택 사각형 + 크기 라벨을 그리고 마우스 드래그로 rect를 만든다. `startAreaSelect` / `cancelAreaSelect` / `attachAreaBlockerListener` export.
- **변경**: `cancelAreaSelect`(L81-85) 옆에 대칭 함수를 추가. 정리 3단계는 `cancelAreaSelect`와 동일하고, `onCancelled` 대신 뷰포트 전체 rect로 `onSelected`를 부른다.
  ```ts
  export function selectFullViewport(handle: AreaSelectHandle): void {
    removeListeners(handle);
    cleanupElements(handle);
    handle._deps.onBlockerRequest("hide");
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    handle._deps.onSelected({ x: 0, y: 0, ...viewport }, viewport);
  }
  ```

### 3. `src/content/picker.ts` — 메시지 핸들러
- **현재 역할**: picker 메시지 라우팅(L253-258 switch), overlay·mode 상태 관리, `handleStartAreaSelect`(L921-962) / `handleCancelAreaSelect`(L964-).
- **변경**: switch에 case 추가 + 핸들러 함수 추가.
  ```ts
  case "picker.selectFullViewport":
    handleSelectFullViewport();
    break;
  ```
  ```ts
  function handleSelectFullViewport(): void {
    if (!areaHandle) return;              // 드래그 완료/취소 직후 레이스 → no-op
    selectFullViewport(areaHandle);       // onSelected 콜백이 areaHandle=null·postToRuntime·handleClear 처리
  }
  ```
  `handleStartAreaSelect`가 등록한 `onSelected` 콜백(L940-949)이 그대로 실행되므로 `areaHandle = null`, `postToRuntime({type:"picker.areaSelected", ...})`, `mode = "idle"`, `handleClear()`를 **중복 작성하지 않는다**.

### 4. `src/sidepanel/picker-control.ts` — 송신 함수
- **현재 역할**: 사이드패널 → content script 메시지 송신 (`startAreaCapture` L529, `cancelAreaCapture` L622 등). 내부 `send(tabId, msg, frameId)` 헬퍼는 실패를 삼키고 `undefined` 반환.
- **변경**: `cancelAreaCapture` 옆에 추가. area-select는 top frame 한정이므로 `frameId: 0`.
  ```ts
  export async function captureFullViewport(tabId: number): Promise<void> {
    await send(tabId, { type: "picker.selectFullViewport" }, 0);
  }
  ```
  store를 직접 만지지 않는다 — phase 전이는 `picker.areaSelected` 수신부가 담당(기존 드래그와 동일).

### 5. `src/sidepanel/lib/crop-rect.ts` — **신규 파일**, 순수 함수
- **역할**: 크롭 rect를 캡처 이미지 경계 안으로 클램프. 브라우저 줌 ≠ 100%일 때 `viewport CSS px × DPR`이 실제 캡처 이미지 크기와 어긋나 크롭이 경계를 넘고 가장자리에 투명 픽셀이 생기는 것을 막는다.
  ```ts
  export interface CropRect { x: number; y: number; width: number; height: number }

  export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect;
  ```
  - `x`/`y`를 `[0, imgWidth/imgHeight]`로 클램프
  - `width`/`height`를 남은 영역 안으로 자르고 최소 1px 보장
  - 이미지 크기가 0 이하면 rect를 그대로 반환(방어)

### 6. `src/sidepanel/hooks/usePickerMessages.ts` — 크롭 가드 적용
- **현재 역할**: picker 메시지 수신(L166 `picker.areaSelected`), `captureAndCrop`(L352-371), `captureAndInsertInline`(L397-430), 로컬 `cropImage`(L373-395).
- **변경**: `cropImage` 안에서 이미지 로드 직후 `clampCropRect`를 적용한다. `captureAndCrop`·`captureAndInsertInline` 둘 다 `cropImage`를 경유하므로 **한 곳만 고치면 두 경로가 함께 보호**된다.
  ```ts
  const img = await loadImage(dataUrl);
  const r = clampCropRect(rect, img.naturalWidth, img.naturalHeight);
  // 이하 canvas 크기·drawImage에 rect 대신 r 사용
  ```
  DPR 곱셈(`captureAndCrop` L357)·webp 0.92 인코딩은 그대로 둔다.

### 7. `src/sidepanel/tabs/IssueTab.tsx` — UI
- **현재 역할**: phase 라우팅(L94-101 `capturing` → `CapturingState`), `CapturingState`(L318-333)는 `EmptyShell`(L475, `action?: React.ReactNode`)에 [취소] 버튼 하나만 넘긴다.
- **변경**:
  - `CapturingState`에 `onFullScreen: () => void` prop 추가. `action`에 버튼 2개를 `flex gap-2` 컨테이너로 넘긴다. **[취소](좌, `variant="outline"`) — [전체 화면 캡처](우, `variant="default"` + lucide `Maximize` 아이콘)**. 우측이 주 액션 자리(shadcn 관례)이고 default variant로 위계를 준다.
  - `data-testid`: 취소 `capturing-cancel`(현재 없음 — 신규), 전체 화면 `capture-full-screen`.
  - 라우팅에서 `onFullScreen={() => void captureFullViewport(tabId)}` 연결.

### 8. `src/i18n/namespaces/issue.ts` — 라벨
- `issue.capturing.fullScreen` — ko `"전체 화면 캡처"` / en `"Capture screen"`. ko/en 동시 추가(PostToolUse 훅이 `locales.test.ts`로 대칭 검사).

## 데이터 흐름

```
[사이드패널] CapturingState [전체 화면 캡처] 클릭
  → captureFullViewport(tabId)
  → chrome.tabs.sendMessage(tabId, {type:"picker.selectFullViewport"}, {frameId:0})
        │
[content/picker.ts] handleSelectFullViewport()
  → areaHandle 없으면 no-op / 있으면 selectFullViewport(areaHandle)
        │
[content/area-select.ts] selectFullViewport()
  → removeListeners → cleanupElements(dim·rect·label 제거) → onBlockerRequest("hide")   ← 오버레이가 여기서 걷힘
  → deps.onSelected({x:0,y:0,width:innerWidth,height:innerHeight}, viewport)
        │
[content/picker.ts] onSelected 콜백 (기존)
  → postToRuntime({type:"picker.areaSelected", rect, viewport}) + mode="idle" + handleClear()
        │
[사이드패널] usePickerMessages L166 → captureAndCrop(rect, viewport)   ← 기존 코드, 수정 없음
  → sendBg({type:"captureVisibleTab"}) → background messages.ts → captureThrottle → chrome.tabs.captureVisibleTab
  → cropImage(dataUrl, rect × DPR)  ← clampCropRect 가드 추가
  → useEditorStore.onAreaCaptured(dataUrl, viewport) → phase: "drafting"
```

**오버레이 정리가 `postToRuntime`보다 먼저 끝난다**는 게 캡처 오염을 막는 유일한 장치다. 이 순서는 드래그 경로에서 이미 검증됐고, 새 경로가 같은 함수 체인을 타므로 별도 보장이 필요 없다.

## 인터페이스 설계

```ts
// src/types/picker.ts (PickerMessage union에 추가)
| { type: "picker.selectFullViewport" }

// src/content/area-select.ts
export function selectFullViewport(handle: AreaSelectHandle): void;

// src/sidepanel/picker-control.ts
export async function captureFullViewport(tabId: number): Promise<void>;

// src/sidepanel/lib/crop-rect.ts (신규)
export interface CropRect { x: number; y: number; width: number; height: number }
export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect;

// src/sidepanel/tabs/IssueTab.tsx (내부 컴포넌트 시그니처 변경)
function CapturingState(props: { onCancel: () => void; onFullScreen: () => void }): JSX.Element;
```

## 기존 패턴 준수

- **captureVisibleTab 단일 관문**: 캡처 API 직접 호출을 추가하지 않는다. `sendBg({type:"captureVisibleTab"})` → background `messages.ts` → `capture-throttle` 경유(POSTMORTEM 2026-06-29 — 호출처가 큐를 우회하면 쿼터 초과 재발).
- **area-select는 top frame 한정**: `picker-control.ts:545` 주석대로 broadcast하지 않고 `frameId: 0`으로만 보낸다.
- **i18n ko/en 동시 갱신**: `src/i18n/` Edit 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행해 키 비대칭을 차단한다.
- **UI는 shadcn `Button`**: 직접 스타일링 금지. 기본 `size="default"`(h-9), 아이콘 `size-4`(DESIGN.md).
- **테스트 우선**: 신규 순수 함수(`clampCropRect`)는 테스트를 먼저 쓴다(CLAUDE.md 작업 원칙).
- **세션 영속화 영향 없음**: `capturing` phase는 기존대로 `onAreaCaptured`에서만 벗어난다. `useEditorSessionSync`(L211-218, L254-260)와 `App.tsx`(L154-157)의 `screenshot + capturing` 정리 분기는 그대로 유효하다.

## 대안 검토

1. **크롭 없이 captureVisibleTab 원본을 그대로 사용** — "뷰포트 전체니까 자를 필요 없다"는 발상. 기각: (a) 사이드패널이 캡처 시점을 직접 잡게 되어 오버레이 정리 순서 보장이 깨진다, (b) captureVisibleTab 기본 출력이 PNG라 기존 webp 0.92 재인코딩 경로와 갈라져 첨부 용량·포맷이 모드별로 달라진다.
2. **빈 클릭(드래그 10px 미만) = 전체 캡처** — `area-select.ts:172`가 현재 no-op이라 공짜로 얹을 수 있다. 기각: 발견성이 0이고, 페이지를 무심코 클릭했을 때 원치 않는 캡처가 나간다.
3. **페이지 오버레이 안에 in-page 버튼/힌트** — 시선이 페이지에 있으니 더 가깝다. 기각: 오버레이 UI·스타일·캡처 직전 숨김 처리가 추가로 필요해 복잡도가 커진다. 반면 사이드패널의 "캡처 영역을 선택하세요"는 현재 **유일한 안내문**이라 사용자가 반드시 보는 자리다.
4. **idle 화면에 캡처 모드 버튼 추가** — 가장 단순. 기각: 진입 화면 버튼 증식을 피하는 것이 이 기능의 전제다.

## 위험 요소

- **오버레이가 스크린샷에 박힘**: `selectFullViewport`에서 정리(리스너·엘리먼트·blocker) 뒤에 `onSelected`를 호출하는 순서를 반드시 지킨다. 순서를 뒤집으면 dim 4분면이 그대로 캡처된다.
- **captureVisibleTab rate-limit**: 30s Replay 폴링과 같은 1초 창에 겹치면 실패할 수 있다. 기존 동작대로 `captureAndCrop`이 `reset()`으로 idle 복귀 → 사용자가 재시도. e2e는 `capture.spec.ts`의 `captureUntilDrafting` 헬퍼(1초+ 간격 재시도)를 재사용해야 flake를 피한다.
- **스크롤바**: `window.innerWidth`는 스크롤바 폭을 포함한다. 캡처 이미지에 스크롤바가 함께 담길 수 있다 — 클램프 가드가 빈 픽셀은 막지만 스크롤바 자체는 남는다. 드래그로 전체를 그렸을 때와 동일한 결과이므로 허용하되 수동 확인 항목에 둔다.
- **`clampCropRect` 회귀 범위**: `cropImage`는 인라인 캡처(`captureAndInsertInline`)도 함께 쓴다. 클램프는 "경계를 넘는 rect만 자르는" 동작이라 정상 범위 rect에는 무영향이어야 한다 — 단위 테스트로 항등성(경계 내부 rect는 그대로)을 고정한다.
- **레이스**: 드래그 완료 → `areaSelected` 발화 → 사이드패널이 drafting으로 전이하는 사이에 버튼이 클릭되면 content script의 `areaHandle`이 이미 null이라 no-op이고, CapturingState도 곧 언마운트된다. 이중 캡처는 발생하지 않는다.
