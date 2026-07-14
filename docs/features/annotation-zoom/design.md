# 어노테이션 캔버스 줌 — 기술 설계

## 개요

`AnnotationOverlay`는 이미 **Konva `Stage`를 natural 픽셀 크기로 만들고 CSS `transform: scale()`로 축소 표시**하는 구조다(`AnnotationOverlay.tsx:367-383`). Konva의 `getPointerPosition()`은 컨테이너의 `getBoundingClientRect()` / `clientWidth` 비율로 CSS transform을 자동 보정하므로, **배율을 바꿔도 포인터→이미지 좌표 변환 코드는 손댈 필요가 없다.** 도형은 전부 natural 좌표에 저장되고, export(`stage.toDataURL({ pixelRatio: 1 })`)도 Stage의 natural 크기를 그대로 쓴다.

따라서 줌은 **표시 배율 `scale` 하나를 사용자 제어로 승격**하는 문제로 축소된다. 핵심 변경 3가지:

1. `scale` 단일 state → `fit`(fit-width 기준 배율, 컨테이너 폭에서 파생) + `zoom`(사용자 선택, `null`이면 fit 추종)으로 분리. 표시 배율 = `zoom ?? fit`.
2. fit 계산을 fit-all → **fit-width**로 교체(높이 제약 제거).
3. 배율 변경 시 뷰포트 중앙 앵커 유지를 위해 캔버스 스크롤 컨테이너의 `scrollLeft/Top`을 재계산.

줌 상태는 오버레이 로컬 state다. 스토어·세션 영속화·메시지 패싱은 일절 추가하지 않는다.

## 변경 범위

### 신규: `src/sidepanel/components/annotation/zoom.ts`

줌 계산의 순수 함수 단일 출처. DOM·React 의존 없음 → 전량 단위 테스트 대상.

- `ZOOM_PRESETS` — 프리셋 배열
- `fitWidthScale(natW, availW)` — fit-width 배율 (최대 1, 확대 안 함)
- `zoomStops(fit)` — `[fit, ...fit보다 큰 프리셋]` 오름차순
- `stepZoom(current, fit, dir)` — `[-]`/`[+]` 이웃 스톱
- `centerAnchoredScroll(m)` — 배율 변경 시 뷰포트 중앙 유지 스크롤 오프셋
- `formatZoomPercent(scale)` — `0.3425` → `"34%"`

### 신규: `src/sidepanel/components/annotation/ZoomControl.tsx`

캔버스 우상단 플로팅 `[-][n% ▾][+]` + 좌상단 맞춤 버튼. 표시 전용 — 상태는 전부 props.

### 변경: `src/sidepanel/components/AnnotationOverlay.tsx`

- 현재: `const [scale, setScale] = useState(1)` + `measureScale(img)`(fit-all) + `window.resize` 리스너로 refit.
- 변경: `fit` / `zoom` 분리. `measureScale`(로컬 함수) 제거 → `fitWidthScale`로 대체. `window.resize` 리스너를 캔버스 뷰포트 엘리먼트의 `ResizeObserver`로 교체(사이드패널 폭은 `window.innerWidth`뿐 아니라 툴바 레이아웃에도 영향받으므로 컨테이너 실측이 정확하다).
- 배율 변경 핸들러 `applyScale(next)`: 열려 있는 텍스트 편집을 커밋하고, `centerAnchoredScroll`로 뷰포트 스크롤을 재설정한다.
- 뷰포트 엘리먼트 ref를 `AnnotationToolbar`에 넘긴다.

### 변경: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`

- 캔버스 슬롯(`:143`)을 `relative` 래퍼 + 내부 스크롤 뷰포트 2겹으로 분리하고, 래퍼에 `ZoomControl`을 absolute 배치한다(스크롤해도 컨트롤이 따라 움직이지 않게).
- 스크롤 뷰포트의 `items-center justify-center`를 제거하고 **children wrapper에 `m-auto`**를 준다. flex 중앙정렬은 콘텐츠가 컨테이너보다 클 때 왼쪽·위쪽이 잘려 스크롤로 도달할 수 없는 알려진 문제가 있는데, 확대하면 정확히 그 상황이 된다. `margin: auto`는 작을 땐 중앙, 넘칠 땐 스크롤 전 범위 도달이라는 두 요구를 동시에 만족한다.
- props 추가: `viewportRef`, `scale`, `fit`, `onScaleChange`.

### 변경: `src/sidepanel/components/annotation/shapes.ts`

- `fitScale()` 제거. 유일한 호출처가 `AnnotationOverlay`의 `measureScale`이라 이번 변경으로 고아가 된다(`zoom.ts:fitWidthScale`이 대체). 대응해 `__tests__/shapes.test.ts`의 `describe("fitScale — 표시 배율")` 블록도 `zoom.test.ts`로 이관.

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
  image.naturalWidth ──▶ fitWidthScale(natW, availW) ──▶ fit  (state)
                                                          │
  [-] [n%▾] [+] / 맞춤 버튼 ──▶ zoom: number | null ───────┤  (state)
                                                          ▼
                                            scale = zoom ?? fit
                                                          │
                    ┌─────────────────────────────────────┼──────────────────────┐
                    ▼                                     ▼                      ▼
      CSS transform: scale(scale)          centerAnchoredScroll()      ZoomControl 라벨
      (Stage는 natural 크기 유지)          → viewport.scrollLeft/Top    formatZoomPercent
                    │
                    ▼
      Konva getPointerPosition()이 rect/clientWidth로 자동 보정
                    │
                    ▼
      도형은 항상 natural 좌표 → export도 natural 해상도 (줌 무관)
```

- `zoom === null` ⇔ 맞춤 상태 ⇔ 좌상단 맞춤 버튼 **숨김**. 사용자가 `[+]`/`[-]`/콤보박스로 fit 아닌 값을 고르는 순간 `zoom`이 숫자가 되고 버튼이 등장한다.
- 맞춤 버튼·콤보박스 `맞춤` 항목은 둘 다 `setZoom(null)`. 이후 패널 폭이 바뀌면 `fit`만 갱신되어 자동 추종한다.
- `zoom !== null`인 상태에서 패널 폭이 바뀌면 `fit`만 갱신되고 표시 배율은 그대로 유지된다(PRD 엣지 케이스).

## 인터페이스 설계

### `zoom.ts`

```ts
// 콤보박스 프리셋 — fit 배율은 별도(zoomStops가 앞에 끼워 넣는다).
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export const MAX_ZOOM = 4;

// 이미지 폭을 가용 폭에 맞추는 배율. 확대는 안 함(최대 1) — 작은 이미지는 100%로 둔다.
export function fitWidthScale(natW: number, availW: number): number;

// [fit, ...fit보다 큰 프리셋] 오름차순. fit 미만 프리셋은 가용 폭보다 작게 만들 뿐이라 제외.
// fit과 거의 같은 프리셋(1e-6 이내)은 중복 제거 — 예: fit === 1이면 100% 항목이 fit과 합쳐진다.
export function zoomStops(fit: number): number[];

// 현재 배율에서 dir(+1/-1) 방향 이웃 스톱. 경계면 현재 값 유지.
// 반환 null = "맞춤"(= zoom state를 null로) — stops[0]은 항상 fit이다.
export function stepZoom(current: number, fit: number, dir: 1 | -1): number | null;

// 배율 변경 시 뷰포트 중앙에 있던 이미지 지점이 그대로 중앙에 남도록 하는 새 스크롤 오프셋.
// contentWidth/Height는 natural px(스케일 전). 결과는 [0, 스크롤 최대치]로 클램프.
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

### `ZoomControl.tsx`

```tsx
export function ZoomControl({
  scale,   // 현재 표시 배율 (zoom ?? fit)
  fit,     // 현재 맞춤 배율
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
- 맞춤 버튼은 `ZoomControl`과 별개 노드(좌상단 배치)라 `AnnotationToolbar`가 직접 렌더한다:

```tsx
{scale !== fit ? (
  <TooltipIconButton label={t("annotation.fitToWidth")} testId="annotation-zoom-fit"
    className="bg-background shadow-sm" onClick={() => onScaleChange(null)}>
    <Maximize2 />
  </TooltipIconButton>
) : null}
```

### `AnnotationToolbar` 캔버스 영역 (`:143`)

```tsx
<div className="relative flex min-h-0 flex-1">
  <div ref={viewportRef} className="flex flex-1 overflow-auto bg-muted">
    {children}  {/* AnnotationOverlay가 넘기는 wrapper에 m-auto */}
  </div>
  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
    <div className="pointer-events-auto">{/* 맞춤 버튼 (조건부) */}</div>
    <div className="pointer-events-auto"><ZoomControl ... /></div>
  </div>
</div>
```

`pointer-events-none` 오버레이 레이어를 두는 이유: 컨트롤이 없는 영역에서 캔버스 그리기 드래그가 막히면 안 된다.

### `AnnotationOverlay` state

```ts
const [fit, setFit] = useState(1);
const [zoom, setZoom] = useState<number | null>(null);
const scale = zoom ?? fit;
const viewportRef = useRef<HTMLDivElement>(null);

// fit 실측 — image 로드 후 + 뷰포트 리사이즈 시.
useLayoutEffect(() => {
  const el = viewportRef.current;
  if (!el || !image) return;
  const measure = () => setFit(fitWidthScale(image.naturalWidth, el.clientWidth - VIEWPORT_PADDING));
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(el);
  return () => ro.disconnect();
}, [image]);

const applyScale = (next: number | null) => {
  commitText();                       // 열린 textarea 좌표 stale 방지
  const el = viewportRef.current;
  const nextScale = next ?? fit;
  if (el && image) {
    const s = centerAnchoredScroll({
      scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
      clientWidth: el.clientWidth, clientHeight: el.clientHeight,
      contentWidth: image.naturalWidth, contentHeight: image.naturalHeight,
      oldScale: scale, newScale: nextScale,
    });
    // 새 배율의 레이아웃이 반영된 뒤 스크롤해야 클램프가 맞다.
    requestAnimationFrame(() => {
      el.scrollLeft = s.scrollLeft;
      el.scrollTop = s.scrollTop;
    });
  }
  setZoom(next);
};
```

## 기존 패턴 준수

- **CLAUDE.md — 테스트 우선**: `zoom.ts`는 전량 순수 함수. `/tdd interface`로 `zoom.test.ts`를 먼저 박고 구현한다.
- **DESIGN.md §13 — 툴바 아이콘 버튼 단일 출처**: 줌 버튼·맞춤 버튼은 `TooltipIconButton`을 쓴다. 직접 `Button`을 스타일링하지 않는다.
- **DESIGN.md §10 — ButtonGroup**: `[-][n%][+]` 조합은 `ButtonGroup` + shadcn `Select`. 새 컴포넌트를 설치하지 않는다(둘 다 이미 `src/components/ui/`에 있다).
- **i18n 동시 갱신**: `editor.ts`의 ko/en 양쪽에 키를 추가한다. `.claude/settings.json` PostToolUse 훅이 `locales.test.ts`(키 대칭)를 자동 실행한다.
- **주석 최소화**: WHY가 비자명한 곳(중앙 앵커 수식, `m-auto` 이유, Konva 좌표 자동 보정 전제)만 한 줄.

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

### 4. 줌 슬라이더 (기각)

`src/components/ui/slider.tsx`가 이미 있다. 연속 배율 제어가 가능.

**기각 이유**: 사이드패널 폭이 좁아(min 320px) 슬라이더가 차지하는 가로 공간이 부담이고, 정확한 배율(100%)로 맞추기 어렵다. 프리셋 스톱 방식이 좁은 폭에 더 적합하다.

## 위험 요소

- **flex 중앙정렬 클리핑**: `items-center justify-center` + `overflow-auto`는 콘텐츠가 넘칠 때 왼쪽·위쪽이 스크롤로 도달 불가능해진다. 확대하면 반드시 그 상황이 되므로 `m-auto` 전환이 **선택이 아니라 필수**다. 회귀 확인: 400%로 확대 후 이미지 좌상단 모서리까지 스크롤되는지.
- **텍스트 편집 textarea 좌표 stale**: `startTextBox`(`AnnotationOverlay.tsx:193-218`)가 `scale`로 화면 좌표를 역산해 `position: fixed` textarea를 띄운다. 배율이 바뀌면 그 좌표가 어긋난다. `applyScale`에서 `commitText()`를 먼저 호출해 회피한다. (참고: **패널 리사이즈 중 textarea가 열려 있으면 어긋나는 기존 버그**가 이미 있다 — 이번 스코프 밖이라 손대지 않는다.)
- **`stage.container()` rect 기반 좌표 보정 전제**: Konva가 CSS transform을 보정한다는 전제가 이 설계 전체를 떠받친다. `transformOrigin: "top left"`와 부모의 크기 예약 div(`width: natW * scale`) 조합을 바꾸면 좌표가 틀어진다. 배율만 바꾸고 이 구조는 유지할 것.
- **큰 캔버스 확대 시 렌더 성능**: 4M px 이미지를 400%로 CSS scale하면 합성 레이어가 커진다. GPU 합성이라 backing store는 안 커지지만, 저사양 기기에서 스크롤이 버벅일 수 있다. 400% 캡을 넘기지 말 것.
- **`shapes.ts:fitScale` 제거**: 유일 호출처가 사라져 생기는 고아 제거다. `shapes.test.ts`의 해당 describe 블록도 함께 이관해야 `pnpm test`가 깨지지 않는다.
- **Select trigger 높이**: shadcn `SelectTrigger` 기본 높이는 h-9인데 `TooltipIconButton`은 h-8이다. `ButtonGroup` 안에서 높이가 안 맞으므로 trigger에 `h-8`을 명시한다.
