# Konva 스크린샷 주석 오버레이 — 기술 설계

## 개요

`AnnotationOverlay.tsx`를 markerjs2 명령형 구현에서 react-konva 선언형 구현으로 재작성한다. 외부 계약(props 시그니처, webp 0.92 출력, `screenshotAnnotated` 저장 흐름)은 동일하게 유지하므로 `DraftingPanel.tsx`·`editor-store.ts`는 무변경이다. 주석 상태(도형 배열·선택·도구·색상·두께·undo/redo 히스토리)는 오버레이 컴포넌트 로컬 state로만 관리하고, 완료 시 Konva Stage를 webp로 flatten해 콜백으로 넘긴다. **Stage는 이미지 자연 해상도로 생성하고 화면에는 CSS transform으로만 축소 표시**하므로 export는 `pixelRatio=1`로 무손실 자연 해상도(배경 화질 퇴행 없음). 도형 모델·팩토리·히스토리 리듀서·프리셋은 순수 모듈로 분리해 단위 테스트한다.

## 변경 범위

### 신규 파일 (`src/sidepanel/components/annotation/`)

- **`presets.ts`** — 순수. `ANNOTATION_COLORS`(5색 hex 배열 + 기본값), `ANNOTATION_THICKNESS`({S,M,L} → strokeWidth px), `HIGHLIGHT_OPACITY`, `TEXT_FONT_SIZE`, `ARROW_POINTER` 등 상수와 도구 목록 `ANNOTATION_TOOLS`.
- **`shapes.ts`** — 순수. 도형 모델 타입(`AnnotationShape` 유니온)과 팩토리/업데이트 헬퍼. 포인터 좌표·현재 도구·스타일을 받아 도형 객체를 만들고, 드래그 중 갱신한다. Konva·React 의존 없음.
- **`history.ts`** — 순수. `AnnotationShape[]` 스냅샷 스택에 대한 undo/redo 리듀서. push/undo/redo/canUndo/canRedo.
- **`ShapeNode.tsx`** — react-konva. `AnnotationShape` 하나를 타입별 Konva 노드(`Arrow`/`Rect`/`Ellipse`/`Line`/`Text`)로 렌더. 선택·드래그·transform 이벤트를 상위로 콜백.
- **`AnnotationToolbar.tsx`** — shadcn. **3단 컨텍스트 레이아웃**(아래 "툴바 레이아웃" 참조). **모든 버튼은 아이콘 전용**(텍스트 라벨 없음, 라벨은 `aria-label`/`title`로만). 도구·색상은 shadcn `ButtonGroup`(`@/components/ui/button-group`)으로 묶고, 각 항목은 `Button size="icon" className="h-8 w-8"` + 활성 시 `bg-muted` + `data-active`. 아이콘: 도구 MousePointer2/ArrowUpRight/Square/Circle/Pen/Type/Highlighter, 삭제 Trash2, undo/redo Undo2/Redo2, **Cancel `X` / OK `Check`**, **두께 S/M/L = 굵기 다른 가로선 아이콘**(lucide에 stroke-width 아이콘이 없으므로 `Minus`를 strokeWidth 1/2.5/4로 렌더하거나 높이 다른 막대 글리프; aria로 S/M/L 구분). 색상은 컬러 채운 원형 스와치(아이콘 대용). ToggleGroup은 실사용 0건이라 쓰지 않고 ButtonGroup 패턴을 따른다.
- **`TextEditorOverlay.tsx`** (또는 AnnotationOverlay 내 인라인) — 텍스트 노드 편집용 HTML `<textarea>`를 Konva Text 위에 절대배치. Konva 표준 텍스트 편집 패턴.
- **`__tests__/shapes.test.ts`**, **`__tests__/history.test.ts`**, **`__tests__/presets.test.ts`** — Vitest 단위 테스트.

### 재작성 파일

- **`src/sidepanel/components/AnnotationOverlay.tsx`** (현재 105줄, markerjs2)
  - 현재 역할: markerjs2 `MarkerArea`를 띄워 주석 후 img로 render → canvas readback → webp dataURL.
  - 변경: react-konva `Stage`/`Layer` 호스트 + `AnnotationToolbar` + Cancel/Done. props 시그니처 불변. 내부에서 `loadImage`(capture.ts)로 이미지 자연 크기 취득(**reject 시 토스트 에러 + `onCancel()`로 자동 닫기**), displayScale 계산, **Stage는 자연 해상도로 생성하고 컨테이너 CSS `transform: scale(displayScale)`로만 시각 축소**, 완료 시 `stage.toDataURL({ mimeType:"image/webp", quality:0.92, pixelRatio:1 })`(자연 해상도 무손실). 도형 0개면 Done disabled → onComplete 호출 안 함.
  - konva/react-konva를 이 모듈에서 **static import**한다. 이 모듈은 `DraftingPanel`에서 이미 `React.lazy`로 로드되므로 konva는 별도 청크에 남는다(메인 청크 비오염). 단 이 격리는 **AnnotationOverlay·ShapeNode·annotation/* 외의 비-lazy 코드가 konva를 import하지 않을 때만** 성립 — 회귀 가드로 Task 8에 grep 검사 둔다. (순수 모듈 presets/shapes/history는 konva 의존 0이라 다른 곳에서 import해도 무방.)

### 소폭 변경 파일

- **`src/sidepanel/main.tsx`** (라인 16~28, getContext 패치)
  - 현재 주석이 "우리 canvas는 getImageData를 안 써서 부작용 없음"인데, markerjs2 제거 후 **이 문장이 거짓**이 된다(Konva hit-detection canvas는 `getImageData`를 빈번히 호출). 패치는 유지하되(제거 시 경고 회귀) 주석을 사실에 맞게 교체: "Konva hit canvas는 getImageData 사용 → 경고 억제 + readback 최적화. 렌더 canvas는 readback이 없어 `willReadFrequently:true`가 미세하게 비최적이나(GPU 경로 회피 신호), 사이드패널 소형 캔버스라 무시 가능." (코드 로직 불변, 주석만)
- **`src/i18n/namespaces/editor.ts`** — `annotation.*` 키 추가(도구명·undo/redo·삭제·색상/두께 aria 라벨). ko/en 동시. 기존 `annotation.cancel`/`annotation.done`, `draft.addAnnotation`/`editAnnotation`/`removeAnnotation`는 재사용.
- **`package.json`** — `markerjs2` 제거, `konva`·`react-konva` 추가.

### 무변경 (계약 유지로 영향 없음)

- `DraftingPanel.tsx` (라인 50 lazy import, 473~483 렌더) — props 동일.
- `editor-store.ts` `onAnnotated`(505) / `confirmDraft`(724~761) — `screenshotAnnotated` dataURL 그대로 소비.
- `capture.ts` `loadImage`(91) — 재사용.
- `downloadCapture.ts` `imageExtFromDataUrl` — webp MIME 그대로.
- `blob-db.ts` `dataUrlToBlob` — webp dataURL 그대로.

## 데이터 흐름

```
DraftingPanel (annotating && screenshotRaw)
  └─ <AnnotationOverlay imageUrl={screenshotAnnotated ?? screenshotRaw} onComplete onCancel/>
       ├─ mount: loadImage(imageUrl) → {naturalW, naturalH}   (reject → toast + onCancel())
       │         displayScale = min(maxW/naturalW, maxH(70vh)/naturalH, 1)  // 시각 축소용(CSS)
       ├─ state: shapes[], selectedId, tool, color, thickness, history
       │   ├─ pointerdown(빈 영역, 그리기 도구): createShape(tool, id, pt, {color,thickness}) → draft
       │   ├─ pointermove: updateShapeDraft(draft, pt)  (펜/형광펜은 points 누적)
       │   ├─ pointerup: commit → isEmptyShape면 폐기, 아니면 shapes 추가 + history.push(shapes)
       │   ├─ 선택 도구: 노드 클릭 → selectedId; Transformer attach;
       │   │              transform end → applyTransform(shape, attrs)로 scale 흡수 + history.push
       │   ├─ 텍스트: 클릭 → textarea 인라인 편집 → blur 시 빈 문자열이면 폐기(push X), 내용 있으면 push
       │   └─ Delete/Backspace: selected 제거 + history.push
       ├─ Toolbar: tool/color/thickness 변경, Undo/Redo(history)
       ├─ Cancel → onCancel()  (state 폐기, dirty-check 없음 — 주석은 경량 작업)
       └─ Done(도형>0일 때만 활성) → stage.toDataURL({mimeType:"image/webp",quality:0.92,pixelRatio:1})
                 → onComplete(dataUrl)
                     → editor-store.onAnnotated(dataUrl)  (screenshotAnnotated 갱신)
                     → confirmDraft 시 dataUrlToBlob → IndexedDB "before"
```

- **표시 vs export 해상도**: Stage는 **자연 해상도**(`width=naturalW, height=naturalH`)로 생성하고, 도형 좌표도 자연 좌표계. 화면 축소는 **Stage 컨테이너 CSS `transform: scale(displayScale)`**(+`transform-origin: top left`)로만 한다. export는 `pixelRatio=1` → 배경·도형 모두 무손실 자연 해상도(markerjs2 원본 직접 drawImage와 동등, 리샘플링 0). 포인터 좌표는 Konva가 컨테이너 스케일을 반영해 자연 좌표로 변환하므로 별도 변환 불필요(텍스트 textarea fontSize는 `fontSize*displayScale`로 시각 정합).
- **배경 이미지**: 첫 Layer에 react-konva `<Image image={htmlImg}/>`(원본 HTMLImage, 자연 픽셀)를 깔고, 둘째 Layer에 도형, 셋째에 Transformer. export는 Stage 전체라 배경+주석이 합쳐진다.

### 툴바 레이아웃 (3단 컨텍스트)

오버레이는 **사이드패널의 탭 컨텐츠 영역만 덮고**(상단 전역 탭 바는 가리지 않음 — 현행 `absolute inset-0`은 DraftingPanel 컨텐츠 기준, `bg-black/40 backdrop-blur`는 폐기), 이미지 Stage는 **중앙 정렬**, 툴바는 **오버레이 상단/하단에 고정**한다. **배경색 분리**: 툴바 영역(상단 1·2단 + 하단 3단)은 기본 배경(`bg-background`), **이미지가 깔리는 가운데 canvas 영역(툴바 제외 전부)은 회색 `bg-muted/50`** — 다이얼로그/PageFooter(`Section.tsx:30` `bg-muted/50`)와 동일. 좁은 사이드패널(~320–400px)에선 한 줄에 다 못 들어가므로 상단 툴바를 1·2단으로 나눈다. 컨테이너 쿼리로 "넓어지면 펼침"은 사이드패널 폭에선 거의 발동 안 하므로 **고정 다단**으로 간다.

```
╔═══════════════════════════════════════════════╗
║  [ Issue ] [ Logs ] [ Settings ]   ← 전역 탭 (가리지 않음)
╠═══════════════════════════════════════════════╣
║┌─────────────────────────────────────────────┐║ ← 오버레이 시작 (bg-white)
║│ [↖][→][▭][○][✎][T][▮]          [🗑]  (1단: bg-background)│║
║│ [●][●][●][●][●]   [▁][▃][▇]   (2단: 높이 항상 예약) │║
║├─────────────────────────────────────────────┤║
║│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│║ ← canvas 영역
║│▓▓▓▓▓▓▓▓┌───────────────────────┐▓▓▓▓▓▓▓▓▓▓▓▓▓│║   bg-muted/50
║│▓▓▓▓▓▓▓▓│                       │▓▓▓▓▓▓▓▓▓▓▓▓▓│║
║│▓▓▓▓▓▓▓▓│   이미지 Stage         │← 중앙 정렬▓▓▓│║
║│▓▓▓▓▓▓▓▓│   (CSS scale 축소,     │  max-h 70vh▓│║
║│▓▓▓▓▓▓▓▓│    자연 해상도 캔버스)   │▓▓▓▓▓▓▓▓▓▓▓▓▓│║
║│▓▓▓▓▓▓▓▓│            →(화살표 주석)│▓▓▓▓▓▓▓▓▓▓▓▓▓│║
║│▓▓▓▓▓▓▓▓└───────────────────────┘▓▓▓▓▓▓▓▓▓▓▓▓▓│║
║│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│║
║├─────────────────────────────────────────────┤║
║│  [⟲][⟳]                          [✕][✓]      │║ ← 3단 (bg-background)
║└─────────────────────────────────────────────┘║ ← 오버레이 끝
╚═══════════════════════════════════════════════╝
   ※ ▓ = canvas 영역 bg-muted/50(PageFooter·다이얼로그와 동일). 툴바는 bg-background
   ※ 모든 버튼 아이콘 전용(라벨은 aria/title). 두께 ▁▃▇=가는/중간/굵은 선
   ※ 🗑 = 도형 선택 시만 활성 / ✓(OK) = 도형>0일 때만 활성
   ※ 2단은 select 도구 시 내용만 숨기고 높이 예약 → 이미지 수직 점프 방지
```

- **단 컨테이너 간격**: 각 툴바 단(1·2·3단)의 래퍼는 **전역 탭 바 컨테이너와 동일한 패딩·하단 간격**을 쓴다 — `App.tsx:187`의 `<div className="border-b px-4 py-4">` 기준으로 `px-4 py-4`(+ 단 구분에 `border-b`/동일 mb). 전역 탭 바와 시각 리듬을 맞춘다.
- **1단(최상단)**: 도구 7종 ButtonGroup(활성 도구 `bg-muted` + `data-active`, 좁으면 flex-wrap) + 우측에 **선택 도형 삭제 버튼**(`Trash2`, `annotation.delete`). 도형이 선택됐을 때(`selectedId != null`)만 활성, 아니면 disabled. 클릭 = 선택 도형 제거 + history.push. 키보드 `Delete`/`Backspace`와 동일 동작(버튼은 마우스 사용자용 명시적 어포던스).
- **2단**: 색상 5 스와치 ButtonGroup + 두께 굵기 아이콘 ButtonGroup. 그리기 도구(select 아님) 선택 시에만 **내용**을 렌더하되, **행 높이는 항상 예약**한다(select 도구일 땐 `invisible`/빈 컨테이너로 동일 높이 유지). ⚠️ 그냥 조건부 언마운트하면 상단 툴바 블록 높이가 변해 가운데 canvas 영역 높이가 바뀌고 **이미지 수직 중심이 점프**한다 — 높이 예약으로 차단. (두께는 stroke 도구 arrow/rect/ellipse/pen에만 노출, text/highlight 선택 시 두께 그룹은 비활성/숨김이되 이 역시 1단·2단 전체 높이는 불변.)
- **3단(최하단)**: 왼쪽 Undo/Redo(`disabled = !canUndo/!canRedo`), 오른쪽 Cancel/OK(도형 0개면 OK disabled). 기존 하단 액션바(`annotation.cancel`/`annotation.done`) 위치 계승.

### 커서 인터랙션

활성 도구에 따라 Stage 컨테이너 커서를 바꿔 "지금 무엇을 할 수 있는지"를 시각 피드백한다. Konva 노드의 hover/이벤트로 동적 갱신.

| 상태 | 커서 | 비고 |
|---|---|---|
| 그리기 도구(arrow/rect/ellipse) 활성, 빈 캔버스 위 | `crosshair` | 드래그로 그림 |
| 펜/형광펜 활성 | `crosshair` | 자유 드로잉 |
| 텍스트 도구 활성 | `text` | 클릭해 입력 |
| 선택 도구 활성, 빈 영역 | `default` | |
| 선택 도구 활성, 도형 위 hover | `move` | 드래그 이동 가능 신호 |
| 선택된 도형의 Transformer 핸들 위 | Konva 기본(리사이즈 `nwse/nesw-resize`, 회전 `crosshair`) | Transformer가 자동 처리 |
| 드로잉 진행 중(pointerdown~up) | `crosshair` 유지 | |

- 구현: 그리기 도구 선택 시 컨테이너에 `cursor-crosshair`(text는 `cursor-text`), 선택 도구는 노드 `onMouseEnter/Leave`에서 `stage.container().style.cursor`를 `move`/`default` 토글. Transformer 핸들 커서는 라이브러리 기본값 사용.

## 인터페이스 설계

```typescript
// AnnotationOverlay.tsx (props 불변)
interface AnnotationOverlayProps {
  imageUrl: string;
  onComplete: (annotatedUrl: string) => void;
  onCancel: () => void;
}

// presets.ts
export type AnnotationTool =
  | "select" | "arrow" | "rect" | "ellipse" | "pen" | "text" | "highlight";
export type ThicknessKey = "S" | "M" | "L";
export const ANNOTATION_COLORS: readonly string[]; // 5 hex
export const DEFAULT_COLOR: string;
export const ANNOTATION_THICKNESS: Record<ThicknessKey, number>; // px stroke
export const DEFAULT_THICKNESS: ThicknessKey;
export const HIGHLIGHT_OPACITY: number;
export const TEXT_FONT_SIZE: number;

// shapes.ts
export interface ShapeBase { id: string; color: string; strokeWidth: number; }
export interface ArrowShape   extends ShapeBase { type: "arrow"; points: number[]; }
export interface RectShape    extends ShapeBase { type: "rect"; x: number; y: number; width: number; height: number; rotation?: number; }
export interface EllipseShape extends ShapeBase { type: "ellipse"; x: number; y: number; width: number; height: number; rotation?: number; }
export interface PenShape     extends ShapeBase { type: "pen"; points: number[]; }
export interface HighlightShape extends ShapeBase { type: "highlight"; points: number[]; }
export interface TextShape    extends ShapeBase { type: "text"; x: number; y: number; text: string; fontSize: number; }
export type AnnotationShape =
  | ArrowShape | RectShape | EllipseShape | PenShape | HighlightShape | TextShape;

export interface ShapeStyle { color: string; strokeWidth: number; }
// 포인터 시작점 + 도구 + 스타일 → 초기 도형 (id는 인자로 주입해 순수성 유지)
export function createShape(tool: Exclude<AnnotationTool, "select">, id: string, pt: { x: number; y: number }, style: ShapeStyle): AnnotationShape;
// 드래그 중 두 번째 점/현재 포인터로 도형 갱신 (rect/ellipse/arrow: 크기, pen/highlight: points push)
export function updateShapeDraft(shape: AnnotationShape, pt: { x: number; y: number }): AnnotationShape;
// 빈 도형 판정(텍스트 빈 문자열, 면적 0 등) — commit 시 폐기 결정
export function isEmptyShape(shape: AnnotationShape): boolean;
// Transformer transform end의 scale/rotation을 width/height로 흡수해 정규화 (scale 리셋 전제).
// 컴포넌트에 묻지 말고 순수 함수로 추출 → 회전/리사이즈 누적 왜곡을 단위 테스트로 가드.
export function applyTransform(
  shape: AnnotationShape,
  attrs: { x: number; y: number; scaleX: number; scaleY: number; rotation: number },
): AnnotationShape;

// history.ts
export interface History<T> { past: T[]; present: T; future: T[]; }
export function initHistory<T>(present: T): History<T>;
export function pushHistory<T>(h: History<T>, next: T): History<T>;
export function undo<T>(h: History<T>): History<T>;
export function redo<T>(h: History<T>): History<T>;
export function canUndo(h: History<unknown>): boolean;
export function canRedo(h: History<unknown>): boolean;
```

> `id` 생성은 컴포넌트에서 주입(`crypto.randomUUID()`)해 `createShape`를 순수하게 유지(테스트 결정성). Workflow 스크립트 제약과 무관하게, 프로덕션 코드는 `crypto.randomUUID()` 사용 가능.

## 기존 패턴 준수

- **테스트 우선(CLAUDE.md)**: `shapes.ts`/`history.ts`/`presets.ts`는 신규 인터페이스 → `/tdd interface`로 테스트 먼저. 테스트는 대상과 같은 디렉터리 `__tests__/*.test.ts`, Vitest.
- **i18n 동시 갱신**: `src/i18n/namespaces/editor.ts` ko/en 동시. Edit/Write 시 PostToolUse 훅이 `locales.test.ts` 자동 실행 → 키 대칭·placeholder 검사.
- **shadcn 우선**: 툴바는 `ButtonGroup`(`@/components/ui/button-group`, **이미 설치됨** — OriginFilterBar 선례) + `Button`/`Tooltip` 사용. 직접 스타일링 금지. 프로젝트엔 `IconButton`이 없으므로 `<Button size="icon" className="h-8 w-8">`로 명시(CVA 기본 h-9 w-9를 override). 도구 버튼은 OriginFilterBar처럼 `size="sm" variant="outline"` + 활성 `bg-muted`.
- **lazy 청크 격리**: AnnotationOverlay는 이미 `React.lazy`. konva static import가 메인 청크로 새지 않음(Task 8 grep 가드).
- **고정 다단 레이아웃**: `@tailwindcss/container-queries`의 "넓어지면 펼침"은 사이드패널 폭(~400px)에선 거의 발동 안 함(실사용처 LogAttachmentCards 1곳도 그 폭에선 1열). 컨테이너 쿼리 대신 위 3단 고정 레이아웃 + flex-wrap으로 간다.
- **lucide(UI 일반)**: 도구 아이콘은 lucide-react.

## 대안 검토

1. **marker.js 3로 업그레이드** — 같은 저자, 모던. 그러나 Linkware(백링크 강제) 또는 유료 라이선스 → 무료 확장 부적합. 탈락.
2. **Fabric.js** — MIT·헤드리스이나 React 공식 바인딩 없음 → markerjs2처럼 명령형 ref 관리 지속, 번들 더 무겁고(SVG·파싱 포함) 주석 용도엔 과함. Konva가 `react-konva` 선언형 + `Transformer` + 경량으로 더 적합. 탈락.
3. **도형 JSON 영속화로 세션 간 재편집** — UX는 좋으나 editor-store 필드 추가·IndexedDB 스키마·마이그레이션까지 번져 스코프 급증. markerjs2는 `restoreState`로 세션 내 재편집이 됐으나 그 능력 자체가 핵심 가치는 아니고, 최종 산출물(flatten webp)은 동일 → 재편집은 비목표로 제외(최소 설계 원칙).
4. **konva를 수동 dynamic import** — 불필요. 모듈 자체가 lazy라 static import로 충분. 단순함 우선.

## 위험 요소

- **번들 크기**: konva+react-konva가 별도 청크여도 수백 KB. lazy 청크라 초기 로드엔 영향 없지만 주석 진입 시 로드 지연 가능 — Suspense fallback을 `null` 대신 **dimmed 배경 + 중앙 `Loader2 animate-spin`**으로(TiptapEditor가 placeholder를 주는 선례) "빈 클릭→무반응" 인지 방지. 빌드 후 청크 분리 확인 필요.
- **pnpm minimumReleaseAge(1440)**: konva/react-konva 추가 시 publish 24h 미만 최신 버전은 직전 버전으로 resolve됨. 안정 패키지라 문제없으나 install 시 인지. react-konva는 react 18 peer 요구 → 프로젝트 `react ^18.3.1`과 호환(설치 후 peerDep 경고 확인).
- **텍스트 인라인 편집**: Konva Text 위 HTML textarea 절대배치 — Stage 컨테이너가 CSS `scale(displayScale)`로 축소됐으므로 textarea의 위치(`getBoundingClientRect` 기반)와 **fontSize에 displayScale을 곱해야** 시각 정합. 좁은 패널·스크롤 환경에서 수동 확인.
- **export 해상도**: Stage를 자연 해상도로 생성 + `pixelRatio=1`이라 출력 = naturalWidth 보장(검증: naturalWidth == 출력 width). 업스케일 리샘플링 경로가 없어 화질 회귀 위험 제거.
- **대형 이미지 export 메모리**: 자연 해상도 Stage(예: 4K)는 그 크기의 offscreen scene canvas를 할당 → 메모리 스파이크. markerjs2 현 구현(naturalWidth canvas)도 동일해 회귀는 아니나, Konva `maxStageDimension`/캔버스 크기 상한 인지.
- **Transformer + 회전 좌표**: rect/ellipse 회전·리사이즈 시 width/height/rotation 동기화. transform end에서 scale을 width/height로 흡수하고 scale 리셋하는 처리를 **`applyTransform` 순수 함수로 추출**해 단위 테스트로 누적 왜곡을 가드(컴포넌트에 묻으면 테스트 사각).
- **willReadFrequently 패치 의존**: main.tsx 전역 패치가 Konva hit canvas 경고도 덮는다. 패치 제거 금지(회귀). 주석만 갱신.
- **메모리/정리**: unmount 시 Stage·이미지·리스너 해제. react-konva는 언마운트로 자동 정리되나 textarea·window 키 리스너는 수동 해제.
- **빈 도형 commit**: 클릭만 하고 드래그 안 한 rect/ellipse(면적 0), 빈 텍스트 → `isEmptyShape`로 폐기. 누락 시 보이지 않는 노드 누적.
- **2단 toggle 레이아웃 시프트**: 2단(색상·두께)을 조건부 언마운트하면 상단 툴바 높이가 변해 canvas 영역·이미지 수직 위치가 점프한다. 2단 행 높이를 **항상 예약**(select 시 `invisible`)해 차단. 이미지 크기 자체는 displayScale이 `70vh` 뷰포트 기준이라 불변이지만, 중앙 정렬 기준 영역 변화로 위치가 튀므로 예약이 필요.
