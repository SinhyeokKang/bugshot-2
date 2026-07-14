# 어노테이션 캔버스 줌 — 구현 태스크

## 선행 조건

- 새 의존성 없음. `ButtonGroup`·`Select`·`TooltipIconButton` 모두 이미 존재한다. **`npx shadcn add` 실행 금지.**
- manifest 권한 변경 없음. 새 메시지·스토리지·외부 fetch 없음 → `docs/privacy.{ko,en}.md`·`docs/PERMISSION.md` 갱신 트리거 아님.
- 착수 전 `docs/POSTMORTEM.md`를 `annotation|canvas|konva|scale` 로 grep해 과거 함정 확인(현재 해당 항목 없음).

## 태스크

### Task 1: `viewport.ts` 순수 함수 (TDD)

- **변경 대상**: `src/sidepanel/components/annotation/viewport.ts` (신규), `src/sidepanel/components/annotation/__tests__/viewport.test.ts` (신규)
- **작업 내용**: `/tdd interface`로 테스트를 먼저 쓰고 구현한다. `ZOOM_PRESETS`, `MAX_ZOOM`, `PAN_CLICK_THRESHOLD`, `fitWidthScale`, `fitAllScale`, `zoomStops`, `stepZoom`, `centerAnchoredScroll`, `panScroll`, `formatZoomPercent`. 시그니처는 design.md "인터페이스 설계" 그대로. (`canPan`은 순수 함수로 만들지 않는다 — 스크롤 가능 여부는 DOM에서 직접 읽는다)
- **검증**:
  - [ ] `fitWidthScale(1074, 390)` ≈ 0.363 / `fitWidthScale(200, 390)` === 1 (확대 안 함)
  - [ ] **0/음수 가드**: `fitWidthScale(0, 390)` === 1 / `fitWidthScale(1074, 0)` === 1 / `fitWidthScale(1074, -32)` === 1 (첫 렌더 `clientWidth=0` → 음수 배율 방지). `fitAllScale`도 동일
  - [ ] `fitAllScale`은 이관 전 `shapes.ts:fitScale`과 같은 값을 낸다 (기존 케이스 재사용)
  - [ ] `zoomStops(0.363, 0.15)` === `[0.15, 0.363, 0.5, 0.75, 1, 1.5, 2, 3, 4]` — fitAll이 맨 앞, 0.25(fit 미만)는 빠진다
  - [ ] `zoomStops(0.363, 0.363)` === `[0.363, 0.5, …]` — fitAll === fit이면 중복 제거(조망 항목 없음)
  - [ ] `zoomStops(1, 1)` === `[1, 1.5, 2, 3, 4]` — fit과 같은 100% 프리셋이 중복 제거된다
  - [ ] `stepZoom`: fit → 다음 프리셋 / fit → `-1` 방향은 fitAll(있으면) 아니면 fit 유지 / `stepZoom(4, stops, +1)` === 4 (상한 유지) / stops에 없는 값이어도 가장 가까운 이웃으로 수렴
  - [ ] `centerAnchoredScroll`: 중앙점 natural 좌표가 배율 변경 전후로 보존된다 / 확대·축소 양방향 / 스크롤 여지 없는 축은 0으로 클램프 / 최대치 클램프 / `oldScale = 0`이면 `{0, 0}` (NaN 방어)
  - [ ] `panScroll`: 오른쪽·아래로 끌면 `scrollLeft`/`scrollTop`이 **줄어든다** (부호) / 양축 동시
  - [ ] `formatZoomPercent(0.3425)` === `"34%"`
  - [ ] `pnpm test` 통과

### Task 2: i18n 키

- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: ko/en 양쪽에 `annotation.zoomIn` / `zoomOut` / `zoomLevel` / `fitToWidth` / `zoomFit` / `zoomFitAll` / `canvasViewport` 추가 (design.md 표).
- **검증**:
  - [ ] PostToolUse 훅의 `locales.test.ts`(ko/en 키 대칭) 자동 통과

### Task 3: 툴바 캔버스 영역 — 스크롤 뷰포트 골격

**Task 4·5가 `viewportRef`가 실제 DOM에 붙어 있는 걸 전제하므로 먼저 한다.** (컨트롤 배치는 Task 8)

- **변경 대상**: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`, `src/sidepanel/components/AnnotationOverlay.tsx`
- **작업 내용**:
  - 캔버스 슬롯(`AnnotationToolbar.tsx:143`)을 `relative` 래퍼 + 내부 스크롤 뷰포트로 분리. 뷰포트에 `ref={viewportRef}` 부착.
  - **`items-center justify-center` 제거 → children wrapper(`AnnotationOverlay.tsx:367`의 크기 예약 div)에 `m-auto shrink-0`.** (확대 시 좌·상단 클리핑 방지 — design.md 위험 요소 1)
  - 뷰포트에 `tabIndex={0}` + `aria-label={t("annotation.canvasViewport")}` + `data-testid="annotation-canvas-viewport"` + `overscroll-contain` + `[scrollbar-gutter:stable]`.
  - props 추가: `viewportRef`. `AnnotationOverlay`는 `useRef<HTMLDivElement>(null)`를 만들어 넘긴다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 현행 진입 화면(fit-all)이 그대로 보인다 — 이 태스크는 배율을 안 바꾼다
  - [ ] 뷰포트에 Tab으로 포커스가 가고 화살표키로 스크롤된다 (콘텐츠가 넘칠 때)

### Task 4: `AnnotationOverlay` — fit/fitAll/zoom 분리 + fit-width + 중앙 앵커 + 초기 도구 select

- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx`, `src/sidepanel/components/annotation/shapes.ts`, `src/sidepanel/components/annotation/__tests__/shapes.test.ts`
- **작업 내용**:
  - `shapes.ts:fitScale`(`:127-135`) 제거 → `viewport.ts:fitAllScale`로 이관 완료(Task 1). `shapes.test.ts:154-171`의 `describe("fitScale — 표시 배율")` 블록 삭제(커버리지는 Task 1이 인수). **`fitScale`을 지우면 `AnnotationOverlay`가 즉시 타입 에러이므로 이 태스크와 한 단위다.**
  - `const [scale, setScale] = useState(1)` (`:80`) → `fit` / `fitAll` / `zoom` state로 분리, `const scale = zoom ?? fit`.
  - 로컬 `measureScale`(`:63-71`) 제거. `useLayoutEffect` + `ResizeObserver`(콜백은 `requestAnimationFrame` 스케줄)로 뷰포트 `clientWidth/Height`를 state에 담고, `fit = fitWidthScale(natW, clientWidth)` / `fitAll = fitAllScale(natW, natH, clientWidth, clientHeight)`. 기존 `window.resize` 리스너(`:119-124`) 제거.
  - **`tool` 초기값 `null` → `"select"`.** (`handlePointerDown:233`의 `if (!tool) return;`이 진입 직후 팬을 죽인다.) `AnnotationToolbar:74`의 `showStyleRow`는 이미 select를 제외하고 있어 **조건 재정의 불필요** — 초기 화면 동일.
  - `applyScale(next: number | null)` — `commitText()` → `next === fit`이면 `null`로 정규화 → `centerAnchoredScroll` 계산 → **`setZoom` 먼저** → `useLayoutEffect([scale])`에서 `pendingScrollRef`의 스크롤 적용. **순서를 뒤집으면 브라우저가 스크롤을 클램프해 중앙 앵커가 깨진다** (design.md `applyScale` 섹션).
  - **리사이즈로 `fit > zoom`이 되면 `zoom`을 `null`로 되돌린다** (맞춤 복귀).
  - **CSS transform 구조(`:367-383`)와 `stage.getPointerPosition()` 호출부는 건드리지 않는다.** 좌표 보정은 Konva에 위임된 채로 유지.
- **검증**:
  - [ ] `grep -rn "fitScale" src/` 결과 0건 (`fitAllScale`은 제외하고 셀 것)
  - [ ] `pnpm typecheck` / `pnpm test` 통과
  - [ ] 페이지 전체 캡처 어노테이션 진입 → 라벨이 fit-width 배율(30%대)로 뜨고, 현행보다 이미지가 크게 보인다
  - [ ] 요소 캡처(폭·높이 모두 작은 이미지) 진입 화면이 현행과 동일하다 (100%)
  - [ ] 확대·축소 시 화면 중앙에 보던 지점이 중앙에 남는다 (확대 방향에서 좌상단으로 튀지 않는다)
  - [ ] 진입 시 선택 도구가 활성이고, 스타일 행(색상·두께)은 현행처럼 숨겨져 있다
  - [ ] 패널 폭을 좁혀 fit이 zoom을 추월하면 맞춤 상태로 돌아간다
  - [ ] **기존 `e2e/annotation-overlay.spec.ts` 2케이스가 그대로 green** (fit 계산 변경의 회귀 가드)

### Task 5: `AnnotationOverlay` — 팬 (선택 도구 빈 곳 드래그) + 커서 소유권

- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx`, `src/sidepanel/components/annotation/ShapeNode.tsx`
- **작업 내용**:
  - Stage 이벤트 바인딩을 `onMouseDown/Move/Up` → **`onPointerDown/Move/Up` + `onPointerCancel`**로 전환. `handlePointerMove`(`:251`)·`handlePointerUp`(`:259`)은 현재 **인자가 없으므로** `(e: KonvaEventObject<PointerEvent>)`를 받도록 시그니처를 바꾼다.
  - `panRef: useRef<PanOrigin | null>` 추가. **state가 아니라 ref** — 매 pointermove 리렌더는 Konva Stage를 통째로 다시 그려 큰 이미지에서 드래그가 끊긴다.
  - 팬 활성 판정은 **DOM 직접 읽기**: `el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth`. 커서용 파생 state `panEnabled`는 `useLayoutEffect`로 갱신(deps: scale·뷰포트 크기·image).
  - `handlePointerDown`(`:228-249`)의 `tool === "select"` 분기 확장: `e.target !== stage`면 그대로 반환(도형 위 → Konva draggable에 위임). `e.target === stage`면 팬 가능할 때 팬 시작(+`setPointerCapture`), 아니면 기존대로 즉시 선택 해제.
  - **그리기 도구도 `setDraftShape` 직전에 `setPointerCapture`.** 드래그가 캔버스 밖이나 플로팅 컨트롤 위를 지나가도 도형이 커밋된다.
  - `handlePointerMove` 맨 앞에 팬 분기: `panScroll`로 `viewport.scrollLeft/Top` **직접 대입**. 이동량이 `PAN_CLICK_THRESHOLD`를 넘으면 `moved = true` + 커서 `grabbing`.
  - `handlePointerUp`: 팬 종료 + `releasePointerCapture`. **`moved === false`면 선택 해제**(빈 곳 클릭의 기존 동작을 up으로 옮긴 것). `onPointerCancel`도 같은 종료 처리. **`onMouseLeave` 종료 처리는 두지 않는다** — pointer capture가 드래그를 잡아둔다.
  - `toolCursor`(`:58-61`)에 `panEnabled` 인자 추가 → select + panEnabled면 `grab`. **커서 재적용 `useEffect`(`:127-130`)의 deps에 `panEnabled`를 넣을 것** — 빠뜨리면 확대해도 커서가 `default`로 stale하다.
  - `ShapeNode`: `hoverCursor`(`:66-70`)의 leave가 `"default"` **하드코딩**(`:80`)이라 팬 커서를 덮어쓴다. `restCursor`(leave 시 복구할 커서) / `cursorLocked`(팬 진행 중이면 커서 갱신 스킵) prop 추가.
- **검증**:
  - [ ] 페이지 전체 캡처 진입 직후(선택 도구·맞춤 상태, 확대 안 함)에도 세로가 넘치므로 팬이 동작한다
  - [ ] **도형 선택 후 빈 곳 클릭 → 선택이 풀린다** (팬 도입으로 인한 회귀 없음)
  - [ ] 빈 곳 드래그 → 화면이 이동하고 선택은 유지된다
  - [ ] 도형 위 드래그 → 도형이 이동한다 (팬 아님)
  - [ ] 이미지가 화면에 다 들어오면 커서가 `default`이고 드래그해도 아무 일 없다
  - [ ] **팬 드래그 중 캔버스 밖에서 마우스를 놓아도** 팬이 정상 종료되고, 밖으로 나갔다 돌아와도 드래그가 이어진다
  - [ ] **그리기 드래그가 플로팅 컨트롤 위를 지나가도** 도형이 커밋된다 (Task 8 이후 재확인)
  - [ ] **도형 위를 지나간 뒤에도 빈 곳 커서가 `grab`으로 복구**되고, 팬 중 도형 위를 지나도 `grabbing`이 유지된다

### Task 6: 텍스트 편집 중 스크롤·줌 커밋

- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx`
- **작업 내용**: 뷰포트 `scroll` 이벤트(`{ passive: true }`)에서 편집 중 textarea를 `commitText()`. `commitText`가 `editing == null` 가드로 **idempotent**한지 확인 — textarea `onBlur`(`:437`)가 줌 버튼 클릭 시 먼저 발화하므로 `applyScale`의 `commitText()`와 이중 호출된다.
- **검증**:
  - [ ] 텍스트 입력 중 캔버스를 스크롤·팬하면 입력이 커밋되고, 좌표가 어긋난 textarea가 남지 않는다
  - [ ] 텍스트 입력 중 `[+]`를 눌러도 도형이 **1개만** 생긴다 (이중 커밋 없음)

### Task 7: `ZoomControl` 컴포넌트

- **변경 대상**: `src/sidepanel/components/annotation/ZoomControl.tsx` (신규)
- **작업 내용**: design.md 렌더 구조대로 `ButtonGroup` + `TooltipIconButton`(Minus/Plus) + shadcn `Select`.
  - **`SelectTrigger`에 `h-8 w-[76px] border-border bg-transparent px-2 text-xs` 필수.** `select.tsx`에는 `data-slot`이 **하나도 없어** `button-group.tsx:8`의 셀렉터가 안 걸린다 — 폭을 안 주면 base의 `w-full`로 터진다.
  - 대비: `ButtonGroup`에 `rounded-md bg-background/90 shadow-md backdrop-blur-sm` (다크에서 `--input` == `--muted`라 기본 테두리가 묻힌다).
  - `atMin`은 `stops[0]` 기준, `atMax`는 `MAX_ZOOM` 기준. `selectValue`는 `zoom === null` → `"fit"`, `zoom === fitAll` → `"all"`, 아니면 `String(zoom)`.
  - testId: `annotation-zoom-out` / `annotation-zoom-level` / `annotation-zoom-in`.
- **검증**:
  - [ ] 맞춤 상태(fitAll 항목 없는 이미지)에서 `[-]` disabled, 400%에서 `[+]` disabled
  - [ ] 세로로 긴 이미지에선 `[-]`가 `전체`까지 한 단계 더 내려간다
  - [ ] 콤보박스 목록에 fit 미만·fitAll 초과 프리셋이 없다 (fit 36%면 25% 항목 없음)
  - [ ] `[-]`/`[+]` 버튼 높이가 Select trigger와 같고(h-8), trigger가 `w-full`로 터지지 않는다
  - [ ] 라이트·다크 모두에서 컨트롤이 스크린샷 픽셀 위에서 식별된다

### Task 8: 툴바 — 플로팅 컨트롤 배치

- **변경 대상**: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`
- **작업 내용**:
  - Task 3의 `relative` 래퍼 안에 `pointer-events-none` absolute 레이어 추가. 좌상단 맞춤 버튼(**`zoom !== null`일 때만** — `scale !== fit`이 아니다) / 우상단 `ZoomControl`. 각 컨트롤 노드에만 `pointer-events-auto`.
  - 맞춤 버튼 아이콘은 `Minimize2`(실제 동작이 축소라 `Maximize2`는 오독된다). testId `annotation-zoom-fit`. `TooltipIconButton` import 추가(이 파일엔 아직 없다).
  - props 추가: `scale`, `zoom`, `fit`, `fitAll`, `onScaleChange`.
- **검증**:
  - [ ] 400% 확대 후 이미지 **좌상단 모서리까지** 팬·스크롤로 도달 가능 (클리핑 회귀 확인)
  - [ ] 캔버스를 팬·스크롤해도 줌 컨트롤·맞춤 버튼이 제자리에 고정
  - [ ] 컨트롤이 없는 캔버스 영역에서 드래그 그리기·팬이 막히지 않는다
  - [ ] 맞춤 상태에서 맞춤 버튼이 보이지 않고, 배율을 바꾸면 나타난다
  - [ ] 패널 폭 320px에서 좌상단 버튼과 우상단 컨트롤이 겹치지 않는다

### Task 9: e2e 시나리오

- **변경 대상**: `e2e/annotation-zoom.spec.ts` (**신규 파일**)
- **작업 내용**: 아래 "e2e 시나리오"를 spec으로. `/e2e-write`로 처리.
  - **기존 `annotation-overlay.spec.ts`에 얹지 않는다** — 그 spec의 `beforeAll`은 `basic.html`에 240×180 영역 캡처라 `fit === 1`·팬 불가여서 줌·팬 시나리오를 하나도 태울 수 없다. 새 spec은 **스크롤(페이지 전체) 캡처 경로**(`capture-methods.spec.ts:39-59` 패턴 — `scroll-capture.html` fixture + `bringToFront` + 패널 버튼 `locator.evaluate(el => el.click())`)로 진입하고, `afterAll`에서 fixture 탭을 정리한다(GOTCHAS 8).
- **검증**:
  - [ ] 기존 `annotation-overlay.spec.ts` 2케이스 그대로 green
  - [ ] 신규 spec green

## 테스트 계획

### 단위 테스트 (`src/sidepanel/components/annotation/__tests__/viewport.test.ts`)

| 함수 | 케이스 |
|---|---|
| `fitWidthScale` | 넓은 이미지 축소 / 작은 이미지 1로 클램프 / **natW=0·availW=0·availW<0 가드** |
| `fitAllScale` | 이관 전 `fitScale`과 동일 값 / 0·음수 가드 |
| `zoomStops` | fitAll 선두 삽입 / fitAll==fit 중복 제거 / fit 미만·fitAll 초과 프리셋 제외 / fit==1 중복 제거 / 항상 오름차순 |
| `stepZoom` | fit→다음 프리셋 / fit→fitAll(조망) / 상한·하한 경계 유지 / stops에 없는 current(리사이즈 경합) 수렴 / 부동소수 ε 비교 |
| `centerAnchoredScroll` | 중앙 natural 좌표 보존 / 확대·축소 양방향 / 스크롤 여지 없는 축 0 클램프 / 최대치 클램프 / **oldScale=0 → {0,0}** |
| `panScroll` | 부호(오른쪽 드래그 → scrollLeft 감소) / 양축 동시 |
| `formatZoomPercent` | 반올림 |

### e2e 시나리오 (`/e2e-write` 입력 — 신규 `e2e/annotation-zoom.spec.ts`)

> **환경 주의**: e2e viewport는 480×720(`e2e/fixtures/extension.ts:160`)이고 패널도 480px 폭이라, 스크롤 캡처 이미지의 fit-width는 문서 예시(36%)가 아니라 **90%대**가 나올 수 있다. **절대 배율(`< 100%`)로 단언하지 말고 상대 비교·버튼 상태로 판정**할 것.
> 드래그 좌표는 `canvas.boundingBox()`가 아니라 **뷰포트(`annotation-canvas-viewport`) boundingBox와 canvas box의 교집합** 안에서 잡는다 — 긴 이미지의 canvas box는 화면 밖까지 뻗어 있어 0.7 비율 좌표가 뷰포트를 벗어난다.

- 페이지 전체 캡처로 어노테이션에 진입하면, 맞춤 버튼(`annotation-zoom-fit`)이 보이지 않고 `[-]`(`annotation-zoom-out`)가 disabled가 아니다(세로가 넘쳐 `전체` 스톱이 존재).
- `[+]`를 누르면 줌 라벨의 배율이 **커지고**(진입 시 라벨 문자열과 비교), 좌상단 맞춤 버튼이 나타난다.
- 맞춤 버튼을 누르면 줌 라벨이 진입 시 배율로 **돌아가고**, 맞춤 버튼이 다시 사라진다.
- 줌 라벨 콤보박스를 열고 `100%`를 고르면 라벨이 `100%`가 된다.
- `[+]`를 반복해 400%에 도달하면 라벨이 `400%`이고 `[+]`가 disabled다.
- **선택 도구로 캔버스 빈 곳을 드래그하면 `annotation-canvas-viewport`의 `scrollTop`이 변한다.** (진입 직후 = 확대 없이도)
- **rect 도구로 도형을 그린 뒤 → 선택 도구로 전환 → 도형 위를 클릭하면 선택된다(`annotation-delete` enabled) → 빈 곳을 클릭하면 선택이 해제된다(`annotation-delete` disabled).** (팬 도입 회귀 가드. 그리기 직후엔 도형이 **자동 선택되지 않으므로**(`handlePointerUp`이 `setSelectedId`를 안 건드림) 반드시 클릭으로 선택하는 단계를 거쳐야 한다. 도형 클릭은 `SELECT_HIT_WIDTH = 24` natural px 슬롭 안이어야 하므로 rect 테두리 좌표를 계산해 찍는다.)
- **선택된 도형을 드래그하면 도형이 이동하고 뷰포트는 스크롤되지 않는다** (`scrollTop` 불변).
- **팬 드래그를 캔버스 밖에서 놓아도** 팬이 정상 종료되고 이후 클릭이 정상 동작한다 (pointer capture 가드).
- 확대(100%)한 상태에서 캔버스를 드래그해 사각형을 그리고 완료하면, 결과 이미지의 `naturalWidth`가 **원본 캡처와 같다**(export 해상도가 배율에 영향받지 않음 — `media-preview-img`의 `naturalWidth`로 판정).
- 기존 `annotation-overlay.spec.ts`(도구 선택 → 취소 복귀 / 도형 그린 뒤 done → annotated webp 전이)가 그대로 통과한다.

### 수동 테스트 (Chrome)

- [ ] 긴 페이지(예: 위키백과 문서)를 페이지 전체 캡처 → 어노테이션 진입 → 진입 직후(선택 도구·맞춤 상태)에 빈 곳 드래그로 아래쪽까지 이동되는지
- [ ] 100%로 확대해 본문 텍스트가 읽히는지
- [ ] 팬으로 특정 영역을 중앙에 놓고 `[+]` → **그 영역을 중심으로** 확대되는지 (중앙 앵커 + 팬 연동)
- [ ] 그 상태에서 화살표를 특정 요소에 찍고 완료 → 미리보기 이미지의 같은 위치에 화살표가 있는지 (좌표 정합)
- [ ] 400%에서 이미지 좌상단·우하단 모서리까지 팬으로 도달되는지
- [ ] 콤보박스 `전체` → 세로로 긴 이미지가 한 화면에 다 들어오는지. 그 상태에서 팬이 비활성(`default` 커서)인지
- [ ] 폭이 좁고 세로로 긴 요소 캡처(예: 긴 폼·사이드바)가 100%로 열리고, `전체`로 조망 가능한지
- [ ] 선택 도구 커서가 팬 가능할 때 `grab`, 드래그 중 `grabbing`, 팬 불가하면 `default`인지. **도형 위를 지나간 뒤에도 `grab`이 복구**되는지
- [ ] 텍스트 박스 입력 도중 `[+]`·스크롤·팬을 하면 입력이 커밋되고 좌표 어긋난 textarea가 남지 않는지 (도형이 1개만 생기는지)
- [ ] 그리기 드래그를 캔버스 밖·줌 컨트롤 위로 끌고 나가도 도형이 커밋되는지
- [ ] 배율을 조작한 뒤 사이드패널 폭을 바꿔도 배율이 유지되는지 / 맞춤 상태면 자동 추종하는지 / fit이 zoom을 추월하면 맞춤으로 복귀하는지
- [ ] 패널 폭을 천천히 드래그해 늘였다 줄일 때 배율이 **진동하지 않는지** (ResizeObserver ↔ 스크롤바 루프)
- [ ] 다크 모드에서 플로팅 컨트롤이 캔버스·스크린샷 픽셀 위에서 식별되는지
- [ ] 키보드만으로: Tab으로 뷰포트 포커스 → 화살표키로 이미지 하단까지 스크롤되는지
- [ ] 400% 확대 상태에서 팬 드래그가 버벅이지 않는지 (4M px 캔버스 합성 부하)

## 구현 순서 권장

```
Task 1 (viewport.ts + 테스트) ─┐
                               ├─▶ Task 4 (fitScale 이관 + fit/zoom 분리 + 초기 select) ─▶ Task 5 (팬 + 커서) ─▶ Task 6 (텍스트 커밋) ─┐
Task 3 (뷰포트 골격 + ref) ────┘                                                                                                      ├─▶ Task 8 (컨트롤 배치) ─▶ Task 9 (e2e)
Task 2 (i18n) ─────────────────────────▶ Task 7 (ZoomControl) ──────────────────────────────────────────────────────────────────────┘
```

- **Task 1·2·3은 서로 독립** — 병렬 가능.
- **Task 3이 Task 4·5보다 먼저**다. `viewportRef`가 DOM에 붙어 있지 않으면 `clientWidth`도 `scrollHeight`도 읽을 수 없어 fit 계산·팬 판정이 불가능하다.
- **Task 4는 `shapes.ts:fitScale` 제거를 포함한 한 단위** — 따로 지우면 즉시 타입 에러다.
- Task 5는 Task 4의 뷰포트 크기 state·`scale`에 의존.
- Task 7은 Task 1(`zoomStops`/`stepZoom`)과 Task 2(i18n 키)에 의존.
- Task 8은 Task 4·5(props)와 Task 7(컴포넌트)이 모두 필요.
- Task 9는 전부 끝난 뒤.

## 가이드 영향

사용자 노출 UX 변경이다. `/implement` 후 `/guide`로 처리한다 (작성 전 `guide/AUTHORING.md` 필독).

- `guide/ko/screenshot/annotation.md` · `guide/en/screenshot/annotation.md` — 줌 컨트롤(`[-][n%][+]`)·맞춤 버튼·`전체` 프리셋·팬(선택 도구 빈 곳 드래그)·키보드 화살표키 스크롤 설명 추가. 페이지 전체 캡처를 어노테이션할 때 이동·확대해서 정확한 위치에 주석을 다는 흐름을 안내.

## e2e 영향

**있음.** 신규 spec `e2e/annotation-zoom.spec.ts` 작성 필요 (Task 9). `/e2e-write`로 처리.
