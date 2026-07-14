# 어노테이션 캔버스 줌 — 기술 설계

## 개요

`AnnotationOverlay`는 이미 **Konva `Stage`를 natural 픽셀 크기로 만들고 CSS `transform: scale()`로 축소 표시**하는 구조다(`AnnotationOverlay.tsx:367-383`). Konva의 `getPointerPosition()`은 컨테이너의 `getBoundingClientRect()` / `clientWidth` 비율로 CSS transform을 자동 보정하므로, **배율을 바꿔도 포인터→이미지 좌표 변환 코드는 손댈 필요가 없다.** 도형은 전부 natural 좌표에 저장되고, export(`stage.toDataURL({ pixelRatio: 1 })`)도 Stage의 natural 크기를 그대로 쓴다.

> **전제의 근거** (konva 10.3.0, `node_modules/konva/lib/Stage.js:649-664`):
> ```js
> const rect = this.content.getBoundingClientRect();
> return { top: rect.top, left: rect.left,
>          scaleX: rect.width / this.content.clientWidth || 1,
>          scaleY: rect.height / this.content.clientHeight || 1 };
> ```
> `setPointersPositions`(`:610-643`)가 `x = (evt.clientX - left) / scaleX`로 역보정한다. `getBoundingClientRect()`는 조상의 CSS transform을 반영하고 `clientWidth`는 레이아웃 폭이므로, `transform: scale(s)`가 정확히 `scaleX = s`로 상쇄된다. **scale 전용일 때만 성립** — rotate/skew가 끼면 rect가 바운딩박스가 되어 깨진다. konva 업그레이드 시 이 함수를 재확인할 것.

따라서 줌은 **표시 배율 `scale` 하나를 사용자 제어로 승격**하는 문제로 축소된다. 핵심 변경 5가지:

1. `scale` 단일 state → `fit`(fit-width 기준 배율) + `fitAll`(전체 조망 배율) + `zoom`(사용자 의도)으로 분리. `zoom`은 **`ZoomLevel = number | "all" | null`** — `null`은 fit 추종, `"all"`은 fitAll 추종, 숫자는 고정 배율이다. 표시 배율 = `resolveScale(zoom, fit, fitAll)`. **`"all"`을 숫자로 저장하면 리사이즈 시 fitAll 추종이 끊기므로 의도를 저장한다.**
2. 진입 배율을 fit-all → **fit-width**로 교체(높이 제약 제거). fit-all은 콤보박스의 `전체` 프리셋으로만 남는다.
3. **팬**: 선택 도구에서 빈 캔버스를 드래그하면 뷰포트가 스크롤된다. **오버레이는 선택 도구가 활성인 채로 진입**한다.
4. 배율 변경 시 **뷰포트 중앙 앵커** 유지 — 현재 보고 있는 지점을 중심으로 확대/축소된다. 팬으로 중심이 옮겨갔으면 그 새 중심이 기준이 된다.
5. 팬·그리기 드래그를 **pointer capture**로 감싸 캔버스 밖에서도 끊기지 않게 한다.

3과 4는 같은 좌표계(스크롤 컨테이너의 `scrollLeft/Top`) 위에서 돌아간다. 팬이 스크롤을 바꾸면 다음 확대의 앵커가 자동으로 따라오므로, 둘을 잇는 별도 상태가 필요 없다.

줌·팬 상태는 오버레이 로컬이다. 스토어·세션 영속화·메시지 패싱은 일절 추가하지 않는다.

## 변경 범위

### 신규: `src/sidepanel/components/annotation/viewport.ts`

줌·팬 계산의 순수 함수 단일 출처. DOM·React 의존 없음 → 전량 단위 테스트 대상.

- `ZOOM_PRESETS` · `MAX_ZOOM` · `PAN_CLICK_THRESHOLD` — 상수
- `fitWidthScale(natW, availW)` — fit-width 배율 (최대 1, 확대 안 함)
- `fitAllScale(natW, natH, availW, availH)` — fit-all 배율 (`shapes.ts:fitScale`을 그대로 이관)
- `ZoomLevel` · `resolveScale` · `normalizeZoom` — 줌 의도 ↔ 표시 배율 변환
- `zoomStops(fit, fitAll)` — `[fitAll?, fit, ...fit보다 큰 프리셋]` 오름차순
- `stepZoom(current, stops, dir)` — `[-]`/`[+]` 이웃 스톱
- `centerAnchoredScroll(m)` — 배율 변경 시 뷰포트 중앙 유지 스크롤 오프셋
- `panScroll(origin, now)` — 드래그 델타 → 새 스크롤 오프셋
- `formatZoomPercent(scale)` — `0.3425` → `"34%"`

팬 활성 판정(`canPan`)은 순수 함수로 만들지 않는다 — 스크롤 가능 여부의 진실은 브라우저에 있고(`el.scrollHeight > el.clientHeight`), 스크롤바 폭·서브픽셀 반올림 때문에 계산으로 복제하면 경계에서 어긋난다. DOM을 직접 읽는다.

### 신규: `src/sidepanel/components/annotation/ZoomControl.tsx`

캔버스 우상단 플로팅 `[-][n% ▾][+]`. 표시 전용 — 상태는 전부 props. (좌상단 맞춤 버튼은 `AnnotationToolbar`가 직접 렌더)

### 변경: `src/sidepanel/components/AnnotationOverlay.tsx`

- 현재: `const [scale, setScale] = useState(1)` (`:80`) + 로컬 `measureScale`(fit-all, `:63-71`) + `window.resize` 리스너로 refit(`:119-124`).
- 변경:
  - `fit` / `fitAll` / `zoom` 분리. `measureScale` 제거 → `viewport.ts`의 두 함수로 대체.
  - **`tool` 초기값을 `null` → `"select"`로.** 도구를 `null`로 되돌리는 경로가 없어지므로 타입도 `AnnotationTool`로 좁힌다(`null` 분기가 전부 고아가 된다). 현행은 `handlePointerDown`(`:233`)이 `if (!tool) return;`으로 먼저 빠져나가 진입 직후 팬이 죽는다. `AnnotationToolbar`의 `showStyleRow`(`:74`)는 이미 `(tool !== null && tool !== "select") || hasSelection`이라 **select에서도 스타일 행이 숨겨진다** — 초기 화면은 현행과 동일하다(조건 재정의 불필요).
  - `window.resize` 리스너를 **캔버스 뷰포트 엘리먼트의 `ResizeObserver`**로 교체. 사이드패널 폭은 `window.innerWidth`뿐 아니라 툴바 레이아웃에도 영향받으므로 컨테이너 실측이 정확하다. 관측한 `clientWidth/Height`는 fit·fitAll 계산에 쓴다. **콜백은 `requestAnimationFrame`으로 스케줄**한다(선례: `src/components/ui/collapsing-tabs.tsx:44-50`).
  - `applyScale(next)` — 텍스트 편집 커밋 → `setZoom` → **DOM 반영 후** 중앙 앵커 스크롤 재설정.
  - 팬 핸들러 — `handlePointerDown/Move/Up`에 선택 도구 빈 곳 드래그 분기 추가. **pointer capture** 사용.
  - 뷰포트 `scroll` 이벤트에서 편집 중 textarea 커밋.
  - `AnnotationToolbar`에 `viewportRef` / `scale` / `fit` / `fitAll` / `onScaleChange` 전달.
  - children wrapper(`:367`의 크기 예약 div)에 `m-auto shrink-0` 추가.
  - **CSS transform 구조(`:367-383`)와 `stage.getPointerPosition()` 호출부는 건드리지 않는다.**

### 변경: `src/sidepanel/components/annotation/ShapeNode.tsx`

`hoverCursor`(`:66-70`)가 `onMouseLeave`에서 커서를 **`"default"`로 하드코딩** 복구한다(`:80`). 팬 도입 후엔 도형 위를 한 번 지나가면 빈 곳 커서가 `grab`이 아니라 `default`로 남고, 팬 드래그 중 도형 위를 지나면 `grabbing`이 `move`로 깨진다.

- `restCursor: string` prop 추가 — leave 시 `"default"` 대신 이 값으로 복구.
- 팬 진행 중이면 enter/leave 커서 갱신을 스킵. `AnnotationOverlay`가 `cursorLocked: boolean` prop으로 넘긴다 — 값은 `panning` **state**다(ref를 렌더에서 읽으면 팬이 리렌더를 안 일으켜 항상 stale).

### 변경: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`

- 캔버스 슬롯(`:143`)을 `relative` 래퍼 + 내부 스크롤 뷰포트 2겹으로 분리하고, 래퍼에 컨트롤을 absolute 배치한다(스크롤·팬해도 컨트롤이 따라 움직이지 않게).
- 스크롤 뷰포트의 `items-center justify-center`를 제거하고 **children wrapper에 `m-auto`**를 준다. flex 중앙정렬은 콘텐츠가 컨테이너보다 클 때 왼쪽·위쪽이 잘려 스크롤로 도달할 수 없는 알려진 문제가 있는데, 확대하면 정확히 그 상황이 된다. `margin: auto`는 작을 땐 중앙, 넘칠 땐 스크롤 전 범위 도달이라는 두 요구를 동시에 만족한다.
- 뷰포트에 `tabIndex={0}` + `aria-label` + `data-testid="annotation-canvas-viewport"`. tabIndex가 있어야 키보드 화살표키 스크롤이 산다(마우스 없이 확대 후 이미지 하단에 도달할 유일한 경로).
- 뷰포트에 `overscroll-contain`(코드베이스 관례 — `SubmitFieldsDialog.tsx:285` 등)과 `scrollbar-gutter: stable`(아래 위험 요소 참조).
- 맞춤 버튼용 `TooltipIconButton` import 추가 (이 파일의 기존 액션 버튼은 raw `Button` + `title` 레거시라 import가 없다).
- props 추가: `viewportRef`, `scale`, `fit`, `fitAll`, `onScaleChange`.

### 변경: `src/sidepanel/components/annotation/shapes.ts`

- `fitScale()`(`:127-135`) 제거 → `viewport.ts:fitAllScale`로 **이관**(로직 동일, 이름만 명확화). 유일한 호출처가 `AnnotationOverlay`의 `measureScale`이었다. `__tests__/shapes.test.ts:154-171`의 `describe("fitScale — 표시 배율")` 블록도 `viewport.test.ts`로 이관.

### 변경: `src/i18n/namespaces/editor.ts`

ko/en 동시에 키 추가:

| 키 | ko | en |
|---|---|---|
| `annotation.zoomIn` | 확대 | Zoom in |
| `annotation.zoomOut` | 축소 | Zoom out |
| `annotation.zoomLevel` | 배율 | Zoom level |
| `annotation.zoomFit` | 너비 맞춤 | Fit width |
| `annotation.zoomFitAll` | 이미지 전체 | Whole image |
| `annotation.canvasViewport` | 캔버스 | Canvas |

## 데이터 흐름

```
                    ResizeObserver(viewport) → rAF
                             │
                             ▼
                   { clientWidth, clientHeight }  (state)
                             │
   image.naturalWidth/Height ┴──▶ fitWidthScale ──▶ fit     (state)
                             └──▶ fitAllScale   ──▶ fitAll  (state)
                                                     │
  [-] [n%▾] [+] / 맞춤 버튼 ──▶ zoom: ZoomLevel ──────┤  (state)
                                (number | "all" | null)
                                                     ▼
                                    scale = resolveScale(zoom, fit, fitAll)
                                                     │
        ┌────────────────────────┬───────────────────┼──────────────────┐
        ▼                        ▼                   ▼                  ▼
 CSS transform:            centerAnchoredScroll   scrollHeight >    ZoomControl
   scale(scale)            → viewport.scroll*     clientHeight?     라벨 % / 스톱
 (Stage는 natural)                 ▲              → grab 커서
        │                          │              → 팬 활성
        │                          │                   │
        │                          └───────────────────┤
        │                     팬 드래그 ──▶ panScroll ─┘
        │                     (viewport.scrollLeft/Top 직접 조작)
        ▼
 Konva getPointerPosition()이 rect/clientWidth로 자동 보정
        │
        ▼
 도형은 항상 natural 좌표 → export도 natural 해상도 (줌·팬 무관)
```

- **`zoom === null` ⇔ 맞춤 상태 ⇔ 좌상단 맞춤 버튼 숨김.** 판정의 단일 출처는 `zoom === null`이지 `scale === fit`이 **아니다** — 패널 리사이즈로 `fit`이 우연히 `zoom`과 같아지면 버튼은 사라지는데 이후 refit은 안 따라가는 유령 상태가 된다. 렌더 조건·`atMin` 판정 모두 `zoom`을 본다.
- `applyScale`은 `next === fit`이면 **`null`로 정규화**한다. 그래야 위 불변식이 깨지지 않는다.
- 맞춤 버튼·콤보박스 `맞춤` 항목은 둘 다 `applyScale(null)`. 이후 패널 폭이 바뀌면 `fit`만 갱신되어 자동 추종한다. `zoom !== null`이면 폭이 바뀌어도 표시 배율은 유지된다.
- **리사이즈로 `fit >= zoom`이 되는 경우**(zoom=0.5 고정 후 패널을 넓혀 fit=0.6): 현재 배율이 `zoomStops`에 없는 값이 되어 Select value가 어떤 항목과도 안 맞는다. **`fit`이 숫자 `zoom`을 따라잡으면(등호 포함) `zoom`을 `null`로 되돌린다**(맞춤 복귀). 등호를 빼면 `fit === zoom`인 유령 상태 — 맞춤과 구별되지 않는데 refit만 못 따라가는 — 가 남는다. **`zoom === "all"`은 대상이 아니다**: `fitAll <= fit`은 항상 참이라 숫자 비교로 뭉뚱그리면 사용자가 고른 `전체`가 매번 맞춤으로 튕긴다.
- **팬은 React state를 거치지 않는다.** 드래그 중 `viewport.scrollLeft/Top`을 직접 조작하고, 시작점은 ref에 보관한다. 매 mousemove마다 리렌더하면 Konva Stage 전체가 다시 그려져 큰 이미지에서 버벅인다.
- 다음 `applyScale`은 그 시점의 `viewport.scrollLeft/Top`을 읽으므로, 팬으로 옮겨간 중심이 자동으로 확대 앵커가 된다.

## 인터페이스 설계

### `viewport.ts`

```ts
// 콤보박스 프리셋 — fit·fitAll 배율은 별도(zoomStops가 앞에 끼워 넣는다).
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export const MAX_ZOOM = 4;

// 클릭과 팬 드래그를 가르는 이동량(px).
export const PAN_CLICK_THRESHOLD = 3;

// 배율 비교용 부동소수 허용치.
export const ZOOM_EPS = 1e-6;

// 사용자 배율의 "의도". fit/fitAll은 뷰포트 크기에서 파생되므로 그때의 숫자가 아니라 의도를 저장한다.
export type ZoomLevel = number | "all" | null;

export function resolveScale(zoom: ZoomLevel, fit: number, fitAll: number): number;

// 스톱 배율(number)을 ZoomLevel로 접는다 — fit/fitAll과 같으면 추종 상태로.
export function normalizeZoom(next: number, fit: number, fitAll: number): ZoomLevel;

// 이미지 폭을 가용 폭에 맞추는 배율. 확대는 안 함(최대 1) — 작은 이미지는 100%로 둔다.
// natW <= 0 또는 availW <= 0이면 1을 반환한다(첫 렌더의 clientWidth=0 → 음수 배율 방지).
export function fitWidthScale(natW: number, availW: number): number;

// 이미지 전체를 가용 영역에 담는 배율(조망용). shapes.ts:fitScale 이관.
// 인자가 0/음수면 1.
export function fitAllScale(natW: number, natH: number, availW: number, availH: number): number;

// [fitAll?, fit, ...fit보다 큰 프리셋] 오름차순.
// - fitAll이 fit과 거의 같으면(1e-6 이내) 생략 — 가로가 지배하는 이미지는 조망 항목이 무의미하다.
// - fit과 fitAll 사이의 프리셋은 제외(축소 선택지는 fitAll 하나로 족하다).
// - fit과 거의 같은 프리셋도 중복 제거 — 예: fit === 1이면 100% 항목이 fit과 합쳐진다.
export function zoomStops(fit: number, fitAll: number): number[];

// stops 배열에서 current의 dir(+1/-1) 방향 이웃. 경계면 current 유지.
// 항상 number를 반환한다 — "맞춤으로 되돌리기"(zoom=null) 정규화는 applyScale의 몫이다.
// current가 stops에 없는 값이어도(리사이즈 경합) 가장 가까운 이웃으로 수렴한다.
export function stepZoom(current: number, stops: number[], dir: 1 | -1): number;

// 배율 변경 시 뷰포트 중앙에 있던 이미지 지점이 그대로 중앙에 남도록 하는 새 스크롤 오프셋.
// 결과는 [0, 스크롤 최대치]로 클램프. oldScale <= 0이면 { 0, 0 }.
export function centerAnchoredScroll(m: {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  contentWidth: number;   // natural px (스케일 전)
  contentHeight: number;
  oldScale: number;
  newScale: number;
}): { scrollLeft: number; scrollTop: number };

// 팬 드래그 — 포인터가 움직인 만큼 콘텐츠를 끌어오므로 스크롤은 반대 방향으로 간다.
export function panScroll(
  origin: { scrollLeft: number; scrollTop: number; clientX: number; clientY: number },
  now: { clientX: number; clientY: number },
): { scrollLeft: number; scrollTop: number };

// 0.3425 → "34%"
export function formatZoomPercent(scale: number): string;
```

`centerAnchoredScroll` 수식:

```
cx = (scrollLeft + clientWidth  / 2) / oldScale     // 중앙점의 natural x
cy = (scrollTop  + clientHeight / 2) / oldScale
next.scrollLeft = clamp(cx * newScale - clientWidth  / 2, 0, contentWidth  * newScale - clientWidth)
next.scrollTop  = clamp(cy * newScale - clientHeight / 2, 0, contentHeight * newScale - clientHeight)
```

콘텐츠가 뷰포트보다 작아 스크롤이 없는 축은 최대치가 음수가 되므로 `Math.max(0, ...)`로 0에 클램프된다.

`panScroll` 수식 (부호 주의 — 오른쪽으로 끌면 `scrollLeft`는 줄어든다):

```
next.scrollLeft = origin.scrollLeft - (now.clientX - origin.clientX)
next.scrollTop  = origin.scrollTop  - (now.clientY - origin.clientY)
```

브라우저가 `scrollLeft/Top` 대입값을 알아서 클램프하므로 여기서는 클램프하지 않는다.

### `applyScale` — 순서가 중요하다

```ts
const applyScale = (next: number | null) => {
  const el = viewportRef.current;
  const stage = stageRef.current;
  if (editing) commitText();                       // 좌표 stale 방지

  const normalized = next != null && Math.abs(next - fit) < 1e-6 ? null : next;
  const oldScale = scale;
  const newScale = normalized ?? fit;
  if (!el || !stage || oldScale === newScale) { setZoom(normalized); return; }

  const anchor = centerAnchoredScroll({
    scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
    clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    contentWidth: natW, contentHeight: natH,
    oldScale, newScale,
  });
  setZoom(normalized);
  pendingScrollRef.current = anchor;               // 새 크기가 DOM에 반영된 뒤 적용
};

// scale이 바뀌어 레이아웃이 갱신된 직후 스크롤을 세팅한다.
useLayoutEffect(() => {
  const el = viewportRef.current;
  const pending = pendingScrollRef.current;
  if (!el || !pending) return;
  pendingScrollRef.current = null;
  el.scrollLeft = pending.scrollLeft;
  el.scrollTop = pending.scrollTop;
}, [scale]);
```

**`setZoom`이 먼저다.** 스크롤을 먼저 대입하면 그 시점 콘텐츠는 아직 옛 배율 크기라, 확대 방향에서 목표 `scrollLeft/Top`이 현재 `scrollWidth - clientWidth`를 초과해 **브라우저가 즉시 클램프**해 버린다. 이후 콘텐츠가 커져도 스크롤은 복구되지 않아 중앙 앵커가 좌상단으로 튄다.

### 팬 — `AnnotationOverlay` 핸들러

현재 `handlePointerMove`(`:251`)·`handlePointerUp`(`:259`)은 **인자가 없다**(`() => {...}`). 팬은 `e.evt.clientX/Y`가 필요하므로 둘 다 `(e: KonvaEventObject<PointerEvent>)`로 바꾸고, Stage 바인딩도 `onMouseDown/Move/Up` → **`onPointerDown/Move/Up`**으로 전환한다(pointer capture를 쓰려면 pointer 이벤트여야 한다).

```ts
interface PanOrigin {
  scrollLeft: number;
  scrollTop: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  moved: boolean;   // 임계값을 넘겼는가 = 클릭이 아니라 드래그였는가
}
const panRef = useRef<PanOrigin | null>(null);
```

팬 활성 판정은 DOM에서 직접 읽는다 (스크롤바·서브픽셀 때문에 계산 복제가 어긋난다):

```ts
const canPan = (el: HTMLElement) =>
  el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
```

커서 표시용으로는 파생 state가 필요하다 — `scale`·뷰포트 크기·이미지가 바뀔 때 `useLayoutEffect`에서 위 판정을 돌려 `panEnabled` state를 갱신한다.

`handlePointerDown` — 선택 도구 분기(`:234-237`)를 이렇게 확장한다:

```ts
if (tool === "select") {
  if (e.target !== stage) return;          // 도형 위 → Konva draggable에 맡긴다(현행)
  const el = viewportRef.current;
  if (!el || !canPan(el)) {
    setSelectedId(null);                   // 스크롤 여지 없음 → 기존 동작(선택 해제)
    return;
  }
  pointerTarget(stage).setPointerCapture(e.evt.pointerId);   // stage.content — 아래 주의 참조
  panRef.current = {
    scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
    clientX: e.evt.clientX, clientY: e.evt.clientY,
    pointerId: e.evt.pointerId, moved: false,
  };
  return;                                  // 선택 해제는 up에서 "클릭이었을 때만"
}
```

그리기 도구도 `setDraftShape` 직전에 같은 `setPointerCapture`를 건다. 그래야 드래그가 캔버스 밖이나 **플로팅 줌 컨트롤 위를 지나가도** `pointermove`/`pointerup`이 Stage로 계속 전달돼 도형이 커밋된다.

> **캡처 타깃은 `stage.content`여야 한다 — `stage.container()`가 아니다.** Konva는 container 안에 만든 자식 `.konvajs-content` div에 리스너를 바인딩한다(`Stage.js:300-309`의 `this.content.addEventListener`). 포인터 캡처는 이벤트를 캡처 타깃으로 리타깃하고 그 **조상**으로만 전파하므로, container에 걸면 자손인 content가 `pointermove`/`pointerup`을 영영 못 받아 **팬은 물론 그리기까지 죽는다.** 좌표는 `setPointersPositions`(`Stage.js:610-643`)가 content rect 기준으로 계산하므로 캔버스 밖 좌표에서도 정상이다.

`handlePointerMove` — 맨 앞에 팬 분기:

```ts
const pan = panRef.current;
if (pan) {
  const el = viewportRef.current;
  if (!el) return;
  const dx = e.evt.clientX - pan.clientX;
  const dy = e.evt.clientY - pan.clientY;
  if (!pan.moved && Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD) {
    pan.moved = true;
    stage.container().style.cursor = "grabbing";
  }
  const s = panScroll(pan, { clientX: e.evt.clientX, clientY: e.evt.clientY });
  el.scrollLeft = s.scrollLeft;
  el.scrollTop = s.scrollTop;
  return;
}
```

`handlePointerUp` — 팬 종료. 임계값을 못 넘겼으면 클릭으로 간주해 선택 해제:

```ts
const pan = panRef.current;
if (pan) {
  panRef.current = null;
  stage.container().releasePointerCapture(pan.pointerId);
  if (!pan.moved) setSelectedId(null);
  stage.container().style.cursor = toolCursor(tool, panEnabled);
  return;
}
```

pointer capture가 드래그를 잡아두므로 **`onMouseLeave` 종료 처리는 두지 않는다.** 캔버스를 벗어나도 `pointerup`은 Stage로 온다. (capture는 `pointercancel`에서도 해제 — 안전망으로 `onPointerCancel`에 같은 종료 처리를 건다.)

커서(`toolCursor`, `:58-61`)에 팬 상태를 추가:

```ts
function toolCursor(tool: AnnotationTool, panEnabled: boolean): string {
  if (tool === "select") return panEnabled ? "grab" : "default";
  return "crosshair";
}
```

**커서 재적용 `useEffect`(`:127-130`)의 deps에 `panEnabled`를 추가해야 한다.** 현재 deps는 `[tool, image]`뿐이라, 확대해서 팬이 가능해져도 커서가 `default`로 stale하고 맞춤 복귀 후엔 `grab`이 남는다.

`ShapeNode`에는 `restCursor={toolCursor(tool, panEnabled)}` / `cursorLocked={panning}`을 넘긴다 (위 "변경 범위" 참조). **`cursorLocked`를 `panRef.current`에서 읽으면 안 된다** — 팬은 리렌더를 일으키지 않으므로 렌더 시점의 ref 값은 항상 stale(`false`)이고 잠금이 무력해진다. 팬 시작/종료에만 바뀌는 `panning` state를 쓴다(제스처당 리렌더 2회).

### 텍스트 편집 중 스크롤 — 커밋으로 회피

`startTextBox`(`:193-218`)는 `rect.left + x * scale`로 `position: fixed` textarea를 띄우므로, 배율뿐 아니라 **스크롤 위치가 바뀌어도** 좌표가 어긋난다. 현행은 캔버스에 스크롤이 거의 없어 드러나지 않았지만 fit-width + 팬으로 상시화된다.

```ts
useEffect(() => {
  const el = viewportRef.current;
  if (!el || !editing) return;
  const onScroll = () => commitText();
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => el.removeEventListener("scroll", onScroll);
}, [editing, commitText]);
```

`commitText`는 `editing == null` 가드로 idempotent해야 한다 — textarea의 `onBlur={commitText}`(`:437`)가 줌 버튼 클릭 시 먼저 발화하므로, `applyScale`의 `commitText()`와 이중 호출되면 도형이 2개 생긴다.

### `ZoomControl.tsx`

```tsx
export function ZoomControl({
  scale,    // 현재 표시 배율 = resolveScale(zoom, fit, fitAll)
  zoom,     // null이면 맞춤 상태 — atMin 판정의 진실
  fit,
  fitAll,
  onChange, // null = 맞춤으로
}: {
  scale: number;
  zoom: number | null;
  fit: number;
  fitAll: number;
  onChange: (zoom: number | null) => void;
}): JSX.Element;
```

렌더 구조:

```tsx
const stops = zoomStops(fit, fitAll);
const atMin = scale <= stops[0] + 1e-6;
const atMax = scale >= MAX_ZOOM - 1e-6;

<ButtonGroup className="rounded-md bg-background/90 shadow-md backdrop-blur-sm">
  <TooltipIconButton label={t("annotation.zoomOut")} testId="annotation-zoom-out"
    disabled={atMin} onClick={() => onChange(stepZoom(scale, stops, -1))}>
    <Minus />
  </TooltipIconButton>

  <Select value={selectValue} onValueChange={...}>
    <SelectTrigger className="h-8 w-auto gap-1 bg-transparent px-2 text-xs"
      aria-label={t("annotation.zoomLevel")} data-testid="annotation-zoom-level">
      <SelectValue>{formatZoomPercent(scale)}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {fitAll < fit - 1e-6 && (
        <SelectItem value="all">{t("annotation.zoomFitAll")} ({formatZoomPercent(fitAll)})</SelectItem>
      )}
      <SelectItem value="fit">{t("annotation.zoomFit")} ({formatZoomPercent(fit)})</SelectItem>
      {stops.filter((s) => s > fit + 1e-6).map((s) => (
        <SelectItem key={s} value={String(s)}>{formatZoomPercent(s)}</SelectItem>
      ))}
    </SelectContent>
  </Select>

  <TooltipIconButton label={t("annotation.zoomIn")} testId="annotation-zoom-in"
    disabled={atMax} onClick={() => onChange(stepZoom(scale, stops, +1))}>
    <Plus />
  </TooltipIconButton>
</ButtonGroup>
```

- `selectValue`는 `zoom === null`이면 `"fit"`, `zoom`이 `fitAll`이면 `"all"`, 아니면 `String(zoom)`. `[-]`/`[+]`가 항상 스톱 위로만 이동하므로 Select value는 언제나 항목 중 하나와 일치한다(휠 줌이 없으니 중간값이 생기지 않는다).
- **`SelectTrigger`에 `h-8 w-auto`는 필수다.** `src/components/ui/select.tsx`는 구버전 forwardRef shadcn이라 **`data-slot` 속성이 하나도 없고**, `button-group.tsx:8`의 `[&>[data-slot=select-trigger]…]` 셀렉터가 **매칭되지 않는다.** 즉 `w-fit`·라운딩 복구가 자동으로 걸리지 않는다. **폭은 `w-auto`로 명시해 라벨 길이에 맞춘다**(고정폭이면 `34%`와 `400%`가 같은 칸을 쓰느라 여백이 남는다). base는 `h-9 w-full rounded-md border-input`(`select.tsx:18`)이므로 폭·높이를 명시하지 않으면 `w-full`로 터진다. `text-xs`·`px-2`는 h-8에 맞춘 보정(선례: `StylePropEditors.tsx:520`).
- **대비**: 다크 모드의 `--input`과 `--muted`가 같은 값이라 기본 `border-input` 테두리가 캔버스 배경에 묻힌다. 게다가 fit-width라 컨트롤은 거의 항상 스크린샷 픽셀 위에 얹힌다. `bg-background/90 backdrop-blur-sm shadow-md` + `border-border`로 올린다(선례: `TrimTimeline.tsx:104`).

### `AnnotationToolbar` 캔버스 영역 (`:143`)

```tsx
<div className="relative flex min-h-0 flex-1">
  <div ref={viewportRef} tabIndex={0} aria-label={t("annotation.canvasViewport")}
    data-testid="annotation-canvas-viewport"
    className="flex flex-1 overflow-auto overscroll-contain bg-muted [scrollbar-gutter:stable]">
    {children}  {/* AnnotationOverlay가 넘기는 wrapper에 m-auto shrink-0 */}
  </div>
  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
    {zoom !== null ? (
      <TooltipIconButton label={t("annotation.zoomFit")} testId="annotation-zoom-fit"
        className="pointer-events-auto bg-background/90 shadow-md backdrop-blur-sm"
        onClick={() => onScaleChange(null)}>
        <Minimize2 />
      </TooltipIconButton>
    ) : <span />}
    <div className="pointer-events-auto">
      <ZoomControl scale={scale} zoom={zoom} fit={fit} fitAll={fitAll} onChange={onScaleChange} />
    </div>
  </div>
</div>
```

- `pointer-events-none` 오버레이 레이어를 두는 이유: 컨트롤이 없는 영역에서 캔버스 그리기·팬 드래그가 막히면 안 된다. (선례: `TrimTimeline.tsx:60-121`)
- 맞춤 버튼 노출 조건은 `zoom !== null` — `scale !== fit`이 아니다(위 "데이터 흐름" 참조).
- 아이콘은 `Minimize2`. `Maximize2`는 lucide 관용상 "확대/전체화면"으로 읽히는데 실제 동작은 대개 축소(400% → 36%)라 오독된다.
- `justify-between`을 유지하려면 맞춤 버튼이 없을 때도 좌측 자리를 차지하는 노드가 필요하다(`<span />`).

## 기존 패턴 준수

- **CLAUDE.md — 테스트 우선**: `viewport.ts`는 전량 순수 함수. `/tdd interface`로 `viewport.test.ts`를 먼저 박고 구현한다.
- **DESIGN.md §13 — 툴바 아이콘 버튼 단일 출처**: 줌 버튼·맞춤 버튼은 `TooltipIconButton`을 쓴다. 직접 `Button`을 스타일링하지 않는다.
- **DESIGN.md §10 — ButtonGroup**: `[-][n%][+]` 조합은 `ButtonGroup` + shadcn `Select`. 새 컴포넌트를 설치하지 않는다(둘 다 이미 `src/components/ui/`에 있다).
- **i18n 동시 갱신**: `editor.ts`의 ko/en 양쪽에 키를 추가한다. `.claude/settings.json` PostToolUse 훅이 `locales.test.ts`(키 대칭)를 자동 실행한다.
- **주석 최소화**: WHY가 비자명한 곳(중앙 앵커 수식·`setZoom` 선행 이유, `m-auto` 이유, 팬을 state 밖에서 처리하는 이유, Konva 좌표 자동 보정 전제)만 한 줄.

## 대안 검토

### 1. Konva `Stage`의 `scaleX/scaleY` prop으로 줌 (기각)

Stage 자체를 스케일하고 width/height를 `natW * scale`로 주는 방식. 얼핏 더 "Konva스럽다".

**기각 이유**: (a) 캔버스 backing store가 배율에 비례해 커진다 — 4M px 이미지를 400%로 보면 64M px 캔버스가 되어 메모리·렌더 비용이 폭발한다. Konva는 **hit canvas까지 같은 크기로 하나 더** 만들므로 비용은 두 배다. CSS transform은 GPU 합성이라 backing store가 natural 크기로 고정된다. (b) `getPointerPosition()`이 화면 좌표를 반환하게 되어 `getRelativePointerPosition()`으로 전부 교체해야 하고, `startTextBox`의 역변환과 `applyTransform`의 좌표계 전제가 모두 흔들린다. **현행 CSS transform 구조가 이 기능에 이미 최적**이며, 좌표 코드를 한 줄도 안 건드리는 것이 이 설계의 핵심 이점이다.

**트레이드오프**: CSS scale은 캔버스를 텍스처로 취급하므로 이미지뿐 아니라 **화살표·박스 stroke도 bilinear 업스케일**된다(Konva scale이었다면 crisp하게 재렌더). 400%에서 도형 테두리가 다소 부드럽게 보이지만, 64M px 메모리보다는 낫다.

### 2. fit 기준(fit = 100%) 배율 표기 (기각)

진입 시 라벨이 정확히 `100%`로 떠서 "배율을 조작하면 맞춤 버튼 등장"이 자명해진다.

**기각 이유**: 페이지 전체 캡처의 fit은 실제 36% 수준이라, fit=100% 기준에서 400%까지 올려도 실제 배율은 144%에 그친다. 무엇보다 **"100%"가 이미지마다 다른 물리적 크기를 가리켜** 사용자가 "지금 원본 대비 얼마나 확대된 건가"를 알 수 없다. 1:1 기준을 택하고, 맞춤 버튼의 노출 조건을 "라벨이 100%가 아닐 때"가 아니라 **"`zoom !== null`일 때"**로 정의하면 의도한 UX(조작 전엔 안 보임)를 그대로 얻으면서 배율 표기의 의미도 지킨다.

### 3. fit-all 유지 + 줌만 추가 (기각)

진입 화면을 안 건드리고 줌 컨트롤만 얹는 최소 변경.

**기각 이유**: 페이지 전체 캡처가 15%로 열려 사용자가 매번 확대부터 해야 한다. 부수적으로 `measureScale`의 `window.innerHeight * 0.7`(툴바 3단 높이를 눈대중한 매직넘버)도 사라진다.

**단, 영향 범위는 페이지 전체 캡처에 국한되지 않는다** — 폭이 좁고 세로로 긴 요소·영역 캡처(300×2000 등)도 진입 배율이 28% → 100%로 바뀌어 이미지 대부분이 화면 밖이 된다. 이를 수용하는 대신 **fit-all을 콤보박스 `전체` 프리셋으로 남겨** 조망 수단을 보전한다(prd.md 엣지 케이스 참조).

### 4. 팬 조작 — 손바닥 도구 / 스페이스+드래그 (기각)

- **손바닥 도구 추가**: 발견성은 가장 좋지만 아이콘이 하나 늘어난다. 툴바 1단의 현재 자연 폭은 `px-4(32) + select(32) + gap(8) + 6×32(192) + gap(8) + delete(32)` = **304px**로 최소 패널 폭 320px에 겨우 들어간다. 하나만 더 넣으면(336px) **320px에서 즉시 가로 스크롤**이다. 게다가 팬할 때마다 도구를 전환했다 돌아와야 한다.
- **스페이스+드래그**: 도구 전환이 필요 없지만 UI에 힌트가 안 드러나 발견성이 낮다.

**채택**: 선택 도구에서 빈 캔버스 드래그. 선택 도구는 이미 "그리지 않는 모드"이므로 의미가 겹치지 않고, 도형 위 드래그(도형 이동)와 빈 곳 드래그(팬)가 자연스럽게 갈린다. 새 아이콘·새 모달리티가 0이고, `grab` 커서가 팬 가능함을 알려준다. **진입 시 선택 도구를 활성화**하므로 첫 화면에서 바로 커서로 발견된다. 그리기 도구 중에는 팬이 안 되지만 스크롤·트랙패드·화살표키로 커버된다.

### 5. 줌 슬라이더 (기각)

`src/components/ui/slider.tsx`가 이미 있다. 연속 배율 제어가 가능.

**기각 이유**: 사이드패널 폭이 좁아(min 320px) 슬라이더가 차지하는 가로 공간이 부담이고, 정확한 배율(100%)로 맞추기 어렵다. 프리셋 스톱 방식이 좁은 폭에 더 적합하다.

## 위험 요소

- **flex 중앙정렬 클리핑**: `items-center justify-center` + `overflow-auto`는 콘텐츠가 넘칠 때 왼쪽·위쪽이 스크롤로 도달 불가능해진다. 확대하면 반드시 그 상황이 되므로 `m-auto` 전환이 **선택이 아니라 필수**다. children wrapper에 `shrink-0`도 함께 준다(확대 시 flex item이 눌리지 않게). 회귀 확인: 400%로 확대 후 이미지 좌상단 모서리까지 스크롤·팬되는지.
- **팬 vs 선택 해제 충돌**: 선택 도구 빈 곳 클릭은 현재 즉시 선택 해제다(`:235`). 팬을 얹으면 "클릭"과 "드래그"를 `PAN_CLICK_THRESHOLD`(3px)로 갈라야 하고, 선택 해제 시점이 down → **up으로 밀린다**. 회귀 확인: 도형 선택 후 빈 곳을 *클릭*하면 여전히 선택이 풀리는지 (e2e 대상).
- **커서 소유권이 두 파일에 갈려 있다**: `ShapeNode.tsx:66-70,79-80`이 `stage.container().style.cursor`를 직접 쓰고 leave 시 `"default"`로 하드코딩 복구한다. `toolCursor`만 고치면 도형 위를 한 번 지나간 뒤 `grab`이 사라지고, 팬 중 도형 위를 지나면 `grabbing`이 `move`로 깨진다. `restCursor`/`cursorLocked` prop으로 소유권을 오버레이에 통일할 것.
- **드래그가 캔버스를 벗어남**: Konva의 mouse 이벤트는 stage content div에 바인딩되므로(`Stage.js:_bindContentEvents`), 포인터가 캔버스 밖으로 나가면 `mousemove`가 끊긴다. 확대 상태에서 가장자리로 끄는 건 가장 흔한 팬 동작이고, 그리기 드래그가 플로팅 컨트롤(`pointer-events-auto`) 위를 지나가면 `draftShape`가 커밋되지 않고 남는다. **pointer capture로 해결**한다(선례: `TrimTimeline.tsx:73`, `ProgressBar.tsx:34`).
- **팬 중 리렌더**: 매 pointermove마다 `setState`하면 Konva Stage가 통째로 다시 그려져 큰 이미지에서 드래그가 끊긴다. 팬 시작점은 **ref**에 두고 `scrollLeft/Top`을 직접 대입한다. 커서 변경도 `stage.container().style.cursor` 직접 조작.
- **ResizeObserver ↔ 스크롤바 진동 루프**: `fit`이 `clientWidth`에서 파생되는데, 세로 스크롤바 등장/소멸이 `clientWidth`를 ~10px 바꾼다(`globals.css:71-73`이 클래식 스크롤바를 명시). 폭이 줄면 fit이 작아져 콘텐츠 높이도 줄고, 스크롤바가 사라지면 폭이 다시 는다 → 배율 진동. `main.tsx:9-14`가 RO 에러를 전역에서 삼키므로 **조용히 떤다.** `scrollbar-gutter: stable`로 폭을 고정하고, RO 콜백을 `requestAnimationFrame`으로 스케줄한다(`collapsing-tabs.tsx:44-50` 선례).
- **텍스트 편집 textarea 좌표 stale**: `startTextBox`(`:193-218`)가 `scale`·컨테이너 rect로 화면 좌표를 역산해 `position: fixed` textarea를 띄운다. 배율·스크롤이 바뀌면 어긋난다. `applyScale`의 `commitText()` + 뷰포트 `scroll` 리스너 커밋으로 회피. `commitText`의 idempotency(`editing == null` 가드) 확인 필수 — textarea `onBlur`(`:437`)와 이중 호출된다.
- **줌 컨트롤이 캔버스 우상단을 영구 점유**: 플로팅 컨트롤(~110×32px)과 좌상단 맞춤 버튼이 덮는 픽셀에는 도형을 찍을 수 없다. 팬이 가능한 이미지는 밀어서 피할 수 있으나 팬 불가한 작은 이미지(요소 캡처)에서는 피할 수 없다. **수용한다**(prd.md 허용 리스크).
- **`stage.container()` rect 기반 좌표 보정 전제**: Konva가 CSS transform을 보정한다는 전제가 이 설계 전체를 떠받친다(위 "개요"의 근거 인용). `transformOrigin: "top left"`와 부모의 크기 예약 div(`width: natW * scale`) 조합을 바꾸면 좌표가 틀어진다. 배율만 바꾸고 이 구조는 유지할 것.
- **큰 캔버스 확대 시 렌더 성능**: 4M px 이미지를 400%로 CSS scale하면 합성 레이어가 커진다. GPU 합성이라 backing store는 안 커지지만, 저사양 기기에서 팬·스크롤이 버벅일 수 있다. 400% 캡을 넘기지 말 것.
- **첫 렌더의 `clientWidth === 0`**: ResizeObserver 콜백 전에는 뷰포트 크기가 0이다. `fitWidthScale`/`fitAllScale`에 `availW/availH <= 0 → 1` 가드가 없으면 **음수 배율**(`transform: scale(-0.03)` — 이미지 반전)과 `centerAnchoredScroll`의 `0으로 나누기`(NaN)가 나온다.
- **`shapes.ts:fitScale` 제거**: `viewport.ts:fitAllScale`로 이관. `shapes.test.ts:154-171`의 해당 describe 블록도 함께 옮겨야 `pnpm test`가 깨지지 않는다.
