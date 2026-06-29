# Konva 스크린샷 주석 오버레이 — 기술 설계

## 개요

`AnnotationOverlay.tsx`를 markerjs2 명령형 구현에서 react-konva 선언형 구현으로 재작성한다. 외부 계약(props 시그니처, webp 0.92 출력, `screenshotAnnotated` 저장 흐름)은 동일하게 유지하므로 `DraftingPanel.tsx`·`editor-store.ts`는 무변경이다. 주석 상태(도형 배열·선택·도구·색상·두께·undo/redo 히스토리)는 오버레이 컴포넌트 로컬 state로만 관리하고, 완료 시 Konva Stage를 자연 해상도 webp로 flatten해 콜백으로 넘긴다. 도형 모델·팩토리·히스토리 리듀서·프리셋은 순수 모듈로 분리해 단위 테스트한다.

## 변경 범위

### 신규 파일 (`src/sidepanel/components/annotation/`)

- **`presets.ts`** — 순수. `ANNOTATION_COLORS`(5색 hex 배열 + 기본값), `ANNOTATION_THICKNESS`({S,M,L} → strokeWidth px), `HIGHLIGHT_OPACITY`, `TEXT_FONT_SIZE`, `ARROW_POINTER` 등 상수와 도구 목록 `ANNOTATION_TOOLS`.
- **`shapes.ts`** — 순수. 도형 모델 타입(`AnnotationShape` 유니온)과 팩토리/업데이트 헬퍼. 포인터 좌표·현재 도구·스타일을 받아 도형 객체를 만들고, 드래그 중 갱신한다. Konva·React 의존 없음.
- **`history.ts`** — 순수. `AnnotationShape[]` 스냅샷 스택에 대한 undo/redo 리듀서. push/undo/redo/canUndo/canRedo.
- **`ShapeNode.tsx`** — react-konva. `AnnotationShape` 하나를 타입별 Konva 노드(`Arrow`/`Rect`/`Ellipse`/`Line`/`Text`)로 렌더. 선택·드래그·transform 이벤트를 상위로 콜백.
- **`AnnotationToolbar.tsx`** — shadcn. 도구 버튼군(ToggleGroup), 색상 스와치, 두께 S/M/L, Undo/Redo, (Done/Cancel은 오버레이가 보유). lucide 아이콘(MousePointer2/ArrowUpRight/Square/Circle/Pen/Type/Highlighter/Undo2/Redo2).
- **`TextEditorOverlay.tsx`** (또는 AnnotationOverlay 내 인라인) — 텍스트 노드 편집용 HTML `<textarea>`를 Konva Text 위에 절대배치. Konva 표준 텍스트 편집 패턴.
- **`__tests__/shapes.test.ts`**, **`__tests__/history.test.ts`**, **`__tests__/presets.test.ts`** — Vitest 단위 테스트.

### 재작성 파일

- **`src/sidepanel/components/AnnotationOverlay.tsx`** (현재 105줄, markerjs2)
  - 현재 역할: markerjs2 `MarkerArea`를 띄워 주석 후 img로 render → canvas readback → webp dataURL.
  - 변경: react-konva `Stage`/`Layer` 호스트 + `AnnotationToolbar` + Cancel/Done. props 시그니처 불변. 내부에서 `loadImage`(capture.ts)로 이미지 자연 크기 취득, 표시 스케일 계산, Stage 렌더, 완료 시 `stage.toDataURL({ mimeType:"image/webp", quality:0.92, pixelRatio })`.
  - konva/react-konva를 이 모듈에서 **static import**한다. 이 모듈은 `DraftingPanel`에서 이미 `React.lazy`로 로드되므로 konva는 별도 청크에 남는다(메인 청크 비오염).

### 소폭 변경 파일

- **`src/sidepanel/main.tsx`** (라인 16~28, getContext 패치)
  - 현재 주석이 "markerjs2가 willReadFrequently 없이…"로 markerjs2에 묶임. Konva는 hit-detection canvas에서 `getImageData`를 빈번히 써 `willReadFrequently:true`가 **오히려 유익**하다. 패치는 유지하되 주석을 Konva 기준으로 갱신한다. (코드 로직 불변, 주석만)
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
       ├─ mount: loadImage(imageUrl) → {naturalW, naturalH}
       │         displayScale = min(maxW/naturalW, maxH(70vh)/naturalH, 1)
       ├─ state: shapes[], selectedId, tool, color, thickness, history
       │   ├─ pointerdown(빈 영역, 그리기 도구): createShape(tool, pt, {color,thickness}) → draft
       │   ├─ pointermove: updateShapeDraft(draft, pt)  (펜/형광펜은 points 누적)
       │   ├─ pointerup: commit → shapes=[...shapes, draft]; history.push(shapes)
       │   ├─ 선택 도구: 노드 클릭 → selectedId; Transformer attach; drag/transform end → update + history.push
       │   └─ Delete/Backspace: selected 제거 + history.push
       ├─ Toolbar: tool/color/thickness 변경, Undo/Redo(history) 
       ├─ Cancel → onCancel()  (state 폐기)
       └─ Done → stage.toDataURL({mimeType:"image/webp",quality:0.92,pixelRatio:1/displayScale})
                 → onComplete(dataUrl)
                     → editor-store.onAnnotated(dataUrl)  (screenshotAnnotated 갱신)
                     → confirmDraft 시 dataUrlToBlob → IndexedDB "before"
```

- **표시 vs export 해상도**: Stage는 표시 스케일(축소)로 그린다. 도형 좌표는 표시 공간. export 시 `pixelRatio = 1/displayScale`을 줘 자연 해상도 webp를 얻는다(Konva가 업스케일 렌더). 별도 좌표 변환 불필요.
- **배경 이미지**: 첫 Layer에 `Konva.Image`(또는 react-konva `<Image image={htmlImg}/>`)로 깔고, 둘째 Layer에 도형. export는 Stage 전체라 배경+주석이 합쳐진다.

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
- **shadcn 우선**: 툴바는 `Button`/`ToggleGroup`(없으면 `npx shadcn@latest add toggle-group`)/`Tooltip` 등 shadcn 사용. 직접 스타일링 금지. IconButton 사이즈 `h-8 w-8`(패널/섹션 헤더 액션 규칙).
- **lazy 청크 격리**: AnnotationOverlay는 이미 `React.lazy`. konva static import가 메인 청크로 새지 않음.
- **컨테이너 쿼리**: 좁은 사이드패널 폭에서 툴바 리플로우에 `@tailwindcss/container-queries` 활용 가능.
- **lucide(UI 일반)**: 도구 아이콘은 lucide-react.

## 대안 검토

1. **marker.js 3로 업그레이드** — 같은 저자, 모던. 그러나 Linkware(백링크 강제) 또는 유료 라이선스 → 무료 확장 부적합. 탈락.
2. **Fabric.js** — MIT·헤드리스이나 React 공식 바인딩 없음 → markerjs2처럼 명령형 ref 관리 지속, 번들 더 무겁고(SVG·파싱 포함) 주석 용도엔 과함. Konva가 `react-konva` 선언형 + `Transformer` + 경량으로 더 적합. 탈락.
3. **도형 JSON 영속화로 세션 간 재편집** — UX는 좋으나 editor-store 필드 추가·IndexedDB 스키마·마이그레이션까지 번져 스코프 급증. 현재 flatten 동작이 markerjs2와 동일하고 충분 → 비목표로 제외(최소 설계 원칙).
4. **konva를 수동 dynamic import** — 불필요. 모듈 자체가 lazy라 static import로 충분. 단순함 우선.

## 위험 요소

- **번들 크기**: konva+react-konva가 별도 청크여도 수백 KB. lazy 청크라 초기 로드엔 영향 없지만 주석 진입 시 로드 지연 가능 — Suspense fallback 현행 `null` 유지(또는 경량 스피너 고려). 빌드 후 청크 분리 확인 필요.
- **pnpm minimumReleaseAge(1440)**: konva/react-konva 추가 시 publish 24h 미만 최신 버전은 직전 버전으로 resolve됨. 안정 패키지라 문제없으나 install 시 인지.
- **텍스트 인라인 편집**: Konva Text 위 HTML textarea 절대배치 — 오버레이가 스케일된 Stage 안에 있어 위치 계산(stage 좌표 → 화면 px) 주의. 표준 패턴 따르되 좁은 패널·스크롤 환경에서 정합 수동 확인.
- **export 해상도**: `pixelRatio` 오산 시 저해상도/과해상도. `1/displayScale`로 자연 해상도 일치 검증(naturalWidth == 출력 width).
- **Transformer + 회전 좌표**: rect/ellipse 회전 시 width/height/ rotation 동기화. transform end에서 scale을 width/height로 흡수하고 scale 리셋하는 Konva 표준 처리 필요(안 하면 누적 왜곡).
- **willReadFrequently 패치 의존**: main.tsx 전역 패치가 Konva hit canvas 경고도 덮는다. 패치 제거 금지(회귀). 주석만 갱신.
- **메모리/정리**: unmount 시 Stage·이미지·리스너 해제. react-konva는 언마운트로 자동 정리되나 textarea·window 키 리스너는 수동 해제.
- **빈 도형 commit**: 클릭만 하고 드래그 안 한 rect/ellipse(면적 0), 빈 텍스트 → `isEmptyShape`로 폐기. 누락 시 보이지 않는 노드 누적.
