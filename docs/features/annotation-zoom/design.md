# 어노테이션 캔버스 줌 — 기술 설계

## 개요

`AnnotationOverlay`는 이미 **Konva `Stage`를 natural 픽셀 크기로 만들고 CSS `transform: scale()`로 축소 표시**하는 구조다(`AnnotationOverlay.tsx:367-383`). Konva의 `getPointerPosition()`은 컨테이너의 `getBoundingClientRect()` / `clientWidth` 비율로 CSS transform을 자동 보정하므로, **배율을 바꿔도 포인터→이미지 좌표 변환 코드는 손댈 필요가 없다.** 도형은 전부 natural 좌표에 저장되고, export(`stage.toDataURL({ pixelRatio: 1 })`)도 Stage의 natural 크기를 그대로 쓴다.

따라서 줌은 **표시 배율 `scale` 하나를 사용자 제어로 승격**하는 문제로 축소된다. 핵심 변경 4가지:

1. `scale` 단일 state → `fit`(fit-width 기준 배율, 컨테이너 폭에서 파생) + `zoom`(사용자 선택, `null`이면 fit 추종)으로 분리. 표시 배율 = `zoom ?? fit`.
2. fit 계산을 fit-all → **fit-width**로 교체(높이 제약 제거).
3. **팬**: 선택 도구에서 빈 캔버스를 드래그하면 뷰포트가 스크롤된다.
4. 배율 변경 시 **뷰포트 중앙 앵커** 유지 — 현재 보고 있는 지점을 중심으로 확대/축소된다. 팬으로 중심이 옮겨갔으면 그 새 중심이 기준이 된다.

3과 4는 같은 좌표계(스크롤 컨테이너의 `scrollLeft/Top`) 위에서 돌아간다. 팬이 스크롤을 바꾸면 다음 확대의 앵커가 자동으로 따라오므로, 둘을 잇는 별도 상태가 필요 없다.

줌·팬 상태는 오버레이 로컬이다. 스토어·세션 영속화·메시지 패싱은 일절 추가하지 않는다.

## 변경 범위

### 신규: `src/sidepanel/components/annotation/viewport.ts`

줌·팬 계산의 순수 함수 단일 출처. DOM·React 의존 없음 → 전량 단위 테스트 대상.

- `ZOOM_PRESETS` · `MAX_ZOOM` — 프리셋 상수
- `fitWidthScale(natW, availW)` — fit-width 배율 (최대 1, 확대 안 함)
- `zoomStops(fit)` — `[fit, ...fit보다 큰 프리셋]` 오름차순
- `stepZoom(current, fit, dir)` — `[-]`/`[+]` 이웃 스톱
- `centerAnchoredScroll(m)` — 배율 변경 시 뷰포트 중앙 유지 스크롤 오프셋
- `canPan(m)` — 스크롤 여지 유무 (팬 활성 조건)
- `panScroll(origin, now)` — 드래그 델타 → 새 스크롤 오프셋
- `formatZoomPercent(scale)` — `0.3425` → `"34%"`

### 신규: `src/sidepanel/components/annotation/ZoomControl.tsx`

캔버스 우상단 플로팅 `[-][n% ▾][+]`. 표시 전용 — 상태는 전부 props. (좌상단 맞춤 버튼은 `AnnotationToolbar`가 직접 렌더)

### 변경: `src/sidepanel/components/AnnotationOverlay.tsx`

- 현재: `const [scale, setScale] = useState(1)` (`:80`) + 로컬 `measureScale`(fit-all, `:63-71`) + `window.resize` 리스너로 refit(`:119-124`).
- 변경:
  - `fit` / `zoom` 분리. `measureScale` 제거 → `fitWidthScale`로 대체.
  - `window.resize` 리스너를 **캔버스 뷰포트 엘리먼트의 `ResizeObserver`**로 교체. 사이드패널 폭은 `window.innerWidth`뿐 아니라 툴바 레이아웃에도 영향받으므로 컨테이너 실측이 정확하다. 관측한 `clientWidth/Height`는 `canPan` 판정에도 필요하므로 state에 보관한다.
  - `applyScale(next)` — 텍스트 편집 커밋 → `centerAnchoredScroll` → 스크롤 재설정 → `setZoom`.
  - 팬 핸들러 — `handlePointerDown/Move/Up`에 선택 도구 빈 곳 드래그 분기 추가.
  - `AnnotationToolbar`에 `viewportRef` / `scale` / `fit` / `onScaleChange` 전달.
  - **CSS transform 구조(`:367-383`)와 `stage.getPointerPosition()` 호출부는 건드리지 않는다.**

### 변경: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`

- 캔버스 슬롯(`:143`)을 `relative` 래퍼 + 내부 스크롤 뷰포트 2겹으로 분리하고, 래퍼에 컨트롤을 absolute 배치한다(스크롤·팬해도 컨트롤이 따라 움직이지 않게).
- 스크롤 뷰포트의 `items-center justify-center`를 제거하고 **children wrapper에 `m-auto`**를 준다. flex 중앙정렬은 콘텐츠가 컨테이너보다 클 때 왼쪽·위쪽이 잘려 스크롤로 도달할 수 없는 알려진 문제가 있는데, 확대하면 정확히 그 상황이 된다. `margin: auto`는 작을 땐 중앙, 넘칠 땐 스크롤 전 범위 도달이라는 두 요구를 동시에 만족한다.
- props 추가: `viewportRef`, `scale`, `fit`, `onScaleChange`.

### 변경: `src/sidepanel/components/annotation/shapes.ts`

- `fitScale()`(`:127-135`) 제거. 유일한 호출처가 `AnnotationOverlay`의 `measureScale`이라 이번 변경으로 고아가 된다(`viewport.ts:fitWidthScale`이 대체). `__tests__/shapes.test.ts:154-170`의 `describe("fitScale — 표시 배율")` 블록도 `viewport.test.ts`로 이관.

### 변경: `src/i18n/namespaces/editor.ts`

ko/en 동시에 키 추가:

| 키 | ko | en |
|---|---|---|
| `annotation.zoomIn` | 확대 | Zoom in |
| `annotation.zoomOut` | 축소 | Zoom out |
| `annotation.zoomLevel` | 배율 | Zoom level |
| `annotation.fitToWidth` | 화면에 맞추기 | Fit to width |
| `annotation.zoomFit` | 맞춤 | Fit |

## 데이터 흐름

```
                    ResizeObserver(viewport)
                             │
                             ▼
                   { clientWidth, clientHeight }  (state)
                             │
       image.naturalWidth ───┴──▶ fitWidthScale ──▶ fit  (state)
                                                     │
  [-] [n%▾] [+] / 맞춤 버튼 ──▶ zoom: number|null ────┤  (state)
                                                     ▼
                                        scale = zoom ?? fit
                                                     │
        ┌────────────────────────┬───────────────────┼──────────────────┐
        ▼                        ▼                   ▼                  ▼
 CSS transform:            centerAnchoredScroll   canPan(...)      ZoomControl
   scale(scale)            → viewport.scroll*     → grab 커서       라벨 %
 (Stage는 natural)                 ▲              → 팬 활성
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

- `zoom === null` ⇔ 맞춤 상태 ⇔ 좌상단 맞춤 버튼 **숨김**. `[+]`/`[-]`/콤보박스로 fit 아닌 값을 고르는 순간 `zoom`이 숫자가 되고 버튼이 등장한다.
- 맞춤 버튼·콤보박스 `맞춤` 항목은 둘 다 `setZoom(null)`. 이후 패널 폭이 바뀌면 `fit`만 갱신되어 자동 추종한다. `zoom !== null`이면 폭이 바뀌어도 표시 배율은 유지된다.
- **팬은 React state를 거치지 않는다.** 드래그 중 `viewport.scrollLeft/Top`을 직접 조작하고, 시작점은 ref에 보관한다. 매 mousemove마다 리렌더하면 Konva Stage 전체가 다시 그려져 큰 이미지에서 버벅인다.
- 다음 `applyScale`은 그 시점의 `viewport.scrollLeft/Top`을 읽으므로, 팬으로 옮겨간 중심이 자동으로 확대 앵커가 된다.

## 인터페이스 설계

### `viewport.ts`

```ts
// 콤보박스 프리셋 — fit 배율은 별도(zoomStops가 앞에 끼워 넣는다).
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
export const MAX_ZOOM = 4;

// 클릭과 팬 드래그를 가르는 이동량(px).
export const PAN_CLICK_THRESHOLD = 3;

// 이미지 폭을 가용 폭에 맞추는 배율. 확대는 안 함(최대 1) — 작은 이미지는 100%로 둔다.
export function fitWidthScale(natW: number, availW: number): number;

// [fit, ...fit보다 큰 프리셋] 오름차순. fit 미만 프리셋은 가용 폭보다 작게 만들 뿐이라 제외.
// fit과 거의 같은 프리셋(1e-6 이내)은 중복 제거 — 예: fit === 1이면 100% 항목이 fit과 합쳐진다.
export function zoomStops(fit: number): number[];

// 현재 배율에서 dir(+1/-1) 방향 이웃 스톱. 경계면 현재 값 유지.
// 반환 null = "맞춤"(= zoom state를 null로) — stops[0]은 항상 fit이다.
export function stepZoom(current: number, fit: number, dir: 1 | -1): number | null;

interface ViewportMetrics {
  clientWidth: number;
  clientHeight: number;
  contentWidth: number;  // natural px (스케일 전)
  contentHeight: number;
  scale: number;
}

// 스크롤 여지가 있으면 팬 가능. fit-width라 fit 상태에서도 세로는 넘칠 수 있으므로
// "확대했는가"가 아니라 "스크롤 여지가 있는가"로 판정한다.
export function canPan(m: ViewportMetrics): boolean;

// 배율 변경 시 뷰포트 중앙에 있던 이미지 지점이 그대로 중앙에 남도록 하는 새 스크롤 오프셋.
// 결과는 [0, 스크롤 최대치]로 클램프.
export function centerAnchoredScroll(m: {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  contentWidth: number;
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

### 팬 — `AnnotationOverlay` 핸들러

```ts
interface PanOrigin {
  scrollLeft: number;
  scrollTop: number;
  clientX: number;
  clientY: number;
  moved: boolean;   // 임계값을 넘겼는가 = 클릭이 아니라 드래그였는가
}
const panRef = useRef<PanOrigin | null>(null);

const panEnabled = image != null && canPan({
  clientWidth: vp.w, clientHeight: vp.h,
  contentWidth: natW, contentHeight: natH, scale,
});
```

`handlePointerDown` — 선택 도구 분기(`:234-237`)를 이렇게 확장한다:

```ts
if (tool === "select") {
  if (e.target !== stage) return;          // 도형 위 → Konva draggable에 맡긴다(현행)
  const el = viewportRef.current;
  if (!el || !panEnabled) {
    setSelectedId(null);                   // 스크롤 여지 없음 → 기존 동작(선택 해제)
    return;
  }
  panRef.current = {
    scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
    clientX: e.evt.clientX, clientY: e.evt.clientY, moved: false,
  };
  return;                                  // 선택 해제는 up에서 "클릭이었을 때만"
}
```

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
  if (!pan.moved) setSelectedId(null);
  stage.container().style.cursor = toolCursor(tool, panEnabled);
  return;
}
```

포인터가 캔버스 밖에서 놓이는 경우를 위해 Stage `onMouseLeave`에서도 같은 종료 처리를 한다.

커서(`toolCursor`, `:58-61`)에 팬 상태를 추가:

```ts
function toolCursor(tool: AnnotationTool | null, panEnabled: boolean): string {
  if (tool === "select") return panEnabled ? "grab" : "default";
  if (tool === null) return "default";
  return "crosshair";
}
```

### `ZoomControl.tsx`

```tsx
export function ZoomControl({
  scale,    // 현재 표시 배율 (zoom ?? fit)
  fit,      // 현재 맞춤 배율
  onChange, // null = 맞춤으로
}: {
  scale: number;
  fit: number;
  onChange: (zoom: number | null) => void;
}): JSX.Element;
```

렌더 구조:

```tsx
<ButtonGroup className="shadow-sm">
  <TooltipIconButton label={t("annotation.zoomOut")} testId="annotation-zoom-out"
    disabled={atMin} onClick={() => onChange(stepZoom(scale, fit, -1))}>
    <Minus />
  </TooltipIconButton>

  {/* shadcn Select — trigger를 ButtonGroup 안에. button-group cva가 data-slot=select-trigger를 이미 처리한다. */}
  <Select value={selectValue} onValueChange={...}>
    <SelectTrigger className="h-8 w-[76px] bg-background text-xs"
      aria-label={t("annotation.zoomLevel")} data-testid="annotation-zoom-level">
      <SelectValue>{formatZoomPercent(scale)}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="fit">{t("annotation.zoomFit")} ({formatZoomPercent(fit)})</SelectItem>
      {zoomStops(fit).slice(1).map((s) => (
        <SelectItem key={s} value={String(s)}>{formatZoomPercent(s)}</SelectItem>
      ))}
    </SelectContent>
  </Select>

  <TooltipIconButton label={t("annotation.zoomIn")} testId="annotation-zoom-in"
    disabled={atMax} onClick={() => onChange(stepZoom(scale, fit, +1))}>
    <Plus />
  </TooltipIconButton>
</ButtonGroup>
```

- `atMin` = `scale <= fit + ε`, `atMax` = `scale >= MAX_ZOOM - ε`.
- `selectValue`는 현재 배율이 fit이면 `"fit"`, 아니면 `String(scale)`. `[-]`/`[+]`가 항상 스톱 위로만 이동하므로 Select value는 언제나 항목 중 하나와 일치한다(휠 줌이 없으니 중간값이 생기지 않는다).

### `AnnotationToolbar` 캔버스 영역 (`:143`)

```tsx
<div className="relative flex min-h-0 flex-1">
  <div ref={viewportRef} className="flex flex-1 overflow-auto bg-muted">
    {children}  {/* AnnotationOverlay가 넘기는 wrapper에 m-auto */}
  </div>
  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
    <div className="pointer-events-auto">
      {scale !== fit ? (
        <TooltipIconButton label={t("annotation.fitToWidth")} testId="annotation-zoom-fit"
          className="bg-background shadow-sm" onClick={() => onScaleChange(null)}>
          <Maximize2 />
        </TooltipIconButton>
      ) : null}
    </div>
    <div className="pointer-events-auto">
      <ZoomControl scale={scale} fit={fit} onChange={onScaleChange} />
    </div>
  </div>
</div>
```

`pointer-events-none` 오버레이 레이어를 두는 이유: 컨트롤이 없는 영역에서 캔버스 그리기·팬 드래그가 막히면 안 된다.

## 기존 패턴 준수

- **CLAUDE.md — 테스트 우선**: `viewport.ts`는 전량 순수 함수. `/tdd interface`로 `viewport.test.ts`를 먼저 박고 구현한다.
- **DESIGN.md §13 — 툴바 아이콘 버튼 단일 출처**: 줌 버튼·맞춤 버튼은 `TooltipIconButton`을 쓴다. 직접 `Button`을 스타일링하지 않는다.
- **DESIGN.md §10 — ButtonGroup**: `[-][n%][+]` 조합은 `ButtonGroup` + shadcn `Select`. 새 컴포넌트를 설치하지 않는다(둘 다 이미 `src/components/ui/`에 있다).
- **i18n 동시 갱신**: `editor.ts`의 ko/en 양쪽에 키를 추가한다. `.claude/settings.json` PostToolUse 훅이 `locales.test.ts`(키 대칭)를 자동 실행한다.
- **주석 최소화**: WHY가 비자명한 곳(중앙 앵커 수식, `m-auto` 이유, 팬을 state 밖에서 처리하는 이유, Konva 좌표 자동 보정 전제)만 한 줄.

## 대안 검토

### 1. Konva `Stage`의 `scaleX/scaleY` prop으로 줌 (기각)

Stage 자체를 스케일하고 width/height를 `natW * scale`로 주는 방식. 얼핏 더 "Konva스럽다".

**기각 이유**: (a) 캔버스 backing store가 배율에 비례해 커진다 — 4M px 이미지를 400%로 보면 64M px 캔버스가 되어 메모리·렌더 비용이 폭발한다. CSS transform은 GPU 합성이라 backing store가 natural 크기로 고정된다. (b) `getPointerPosition()`이 화면 좌표를 반환하게 되어 `getRelativePointerPosition()`으로 전부 교체해야 하고, `startTextBox`의 역변환과 `applyTransform`의 좌표계 전제가 모두 흔들린다. **현행 CSS transform 구조가 이 기능에 이미 최적**이며, 좌표 코드를 한 줄도 안 건드리는 것이 이 설계의 핵심 이점이다.

### 2. fit 기준(fit = 100%) 배율 표기 (기각)

진입 시 라벨이 정확히 `100%`로 떠서 "배율을 조작하면 맞춤 버튼 등장"이 자명해진다.

**기각 이유**: 페이지 전체 캡처의 fit은 실제 34% 수준이라, fit=100% 기준에서 400%까지 올려도 실제 배율은 136%에 그치고 25%~75% 구간은 fit보다 더 축소하는 무의미한 값이 된다. 무엇보다 **"100%"가 이미지마다 다른 물리적 크기를 가리켜** 사용자가 "지금 원본 대비 얼마나 확대된 건가"를 알 수 없다. 1:1 기준을 택하고, 맞춤 버튼의 노출 조건을 "라벨이 100%가 아닐 때"가 아니라 **"현재 배율 ≠ fit 배율일 때"**로 정의하면 의도한 UX(조작 전엔 안 보임)를 그대로 얻으면서 배율 표기의 의미도 지킨다.

### 3. fit-all 유지 + 줌만 추가 (기각)

진입 화면을 안 건드리고 줌 컨트롤만 얹는 최소 변경.

**기각 이유**: 페이지 전체 캡처가 15%로 열려 사용자가 매번 확대부터 해야 한다. fit-width로 바꿔도 **차이가 나는 건 세로로 긴 이미지뿐**이고(요소·영역·화면 캡처는 폭이 지배해 두 방식의 값이 같다) 그게 정확히 이번에 줌이 필요해진 이미지다. 부수적으로 `measureScale`의 `window.innerHeight * 0.7`(툴바 3단 높이를 눈대중한 매직넘버)도 사라진다.

### 4. 팬 조작 — 손바닥 도구 / 스페이스+드래그 (기각)

- **손바닥 도구 추가**: 발견성은 가장 좋지만 툴바 1단이 이미 `overflow-x-auto`로 가로 스크롤되는 상태라 아이콘을 늘리기 부담스럽고, 팬할 때마다 도구를 전환했다 돌아와야 한다.
- **스페이스+드래그**: 도구 전환이 필요 없지만 UI에 힌트가 안 드러나 발견성이 낮다.

**채택**: 선택 도구에서 빈 캔버스 드래그. 선택 도구는 이미 "그리지 않는 모드"이므로 의미가 겹치지 않고, 도형 위 드래그(도형 이동)와 빈 곳 드래그(팬)가 자연스럽게 갈린다. 새 아이콘·새 모달리티가 0이고, `grab` 커서가 팬 가능함을 알려준다. 그리기 도구 중에는 팬이 안 되지만 스크롤·트랙패드로 커버된다.

### 5. 줌 슬라이더 (기각)

`src/components/ui/slider.tsx`가 이미 있다. 연속 배율 제어가 가능.

**기각 이유**: 사이드패널 폭이 좁아(min 320px) 슬라이더가 차지하는 가로 공간이 부담이고, 정확한 배율(100%)로 맞추기 어렵다. 프리셋 스톱 방식이 좁은 폭에 더 적합하다.

## 위험 요소

- **flex 중앙정렬 클리핑**: `items-center justify-center` + `overflow-auto`는 콘텐츠가 넘칠 때 왼쪽·위쪽이 스크롤로 도달 불가능해진다. 확대하면 반드시 그 상황이 되므로 `m-auto` 전환이 **선택이 아니라 필수**다. 회귀 확인: 400%로 확대 후 이미지 좌상단 모서리까지 스크롤·팬되는지.
- **팬 vs 선택 해제 충돌**: 선택 도구 빈 곳 클릭은 현재 즉시 선택 해제다(`:235`). 팬을 얹으면 "클릭"과 "드래그"를 `PAN_CLICK_THRESHOLD`(3px)로 갈라야 하고, 선택 해제 시점이 down → **up으로 밀린다**. 회귀 확인: 도형 선택 후 빈 곳을 *클릭*하면 여전히 선택이 풀리는지 (e2e 대상).
- **팬 중 리렌더**: 매 mousemove마다 `setState`하면 Konva Stage가 통째로 다시 그려져 큰 이미지에서 드래그가 끊긴다. 팬 시작점은 **ref**에 두고 `scrollLeft/Top`을 직접 대입한다. 커서 변경도 `stage.container().style.cursor` 직접 조작.
- **텍스트 편집 textarea 좌표 stale**: `startTextBox`(`:193-218`)가 `scale`로 화면 좌표를 역산해 `position: fixed` textarea를 띄운다. 배율이 바뀌면 그 좌표가 어긋난다. `applyScale`에서 `commitText()`를 먼저 호출해 회피한다. (참고: **패널 리사이즈 중 / 캔버스 스크롤 중 textarea가 열려 있으면 어긋나는 기존 버그**가 이미 있다 — 이번 스코프 밖이라 손대지 않는다.)
- **`stage.container()` rect 기반 좌표 보정 전제**: Konva가 CSS transform을 보정한다는 전제가 이 설계 전체를 떠받친다. `transformOrigin: "top left"`와 부모의 크기 예약 div(`width: natW * scale`) 조합을 바꾸면 좌표가 틀어진다. 배율만 바꾸고 이 구조는 유지할 것.
- **큰 캔버스 확대 시 렌더 성능**: 4M px 이미지를 400%로 CSS scale하면 합성 레이어가 커진다. GPU 합성이라 backing store는 안 커지지만, 저사양 기기에서 팬·스크롤이 버벅일 수 있다. 400% 캡을 넘기지 말 것.
- **`shapes.ts:fitScale` 제거**: 유일 호출처가 사라져 생기는 고아 제거다. `shapes.test.ts`의 해당 describe 블록도 함께 이관해야 `pnpm test`가 깨지지 않는다.
- **Select trigger 높이**: shadcn `SelectTrigger` 기본 높이는 h-9인데 `TooltipIconButton`은 h-8이다. `ButtonGroup` 안에서 높이가 안 맞으므로 trigger에 `h-8`을 명시한다.
