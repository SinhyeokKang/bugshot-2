# 어노테이션 캔버스 줌 — 구현 태스크

## 선행 조건

- 새 의존성 없음. `ButtonGroup`·`Select`·`TooltipIconButton`·`slider` 모두 이미 존재한다. **`npx shadcn add` 실행 금지.**
- manifest 권한 변경 없음. 새 메시지·스토리지·외부 fetch 없음 → `docs/privacy.{ko,en}.md`·`docs/PERMISSION.md` 갱신 트리거 아님.
- 착수 전 `docs/POSTMORTEM.md`를 `annotation|canvas|konva|scale` 로 grep해 과거 함정 확인(현재 해당 항목 없음).

## 태스크

### Task 1: `zoom.ts` 순수 함수 (TDD)

- **변경 대상**: `src/sidepanel/components/annotation/zoom.ts` (신규), `src/sidepanel/components/annotation/__tests__/zoom.test.ts` (신규)
- **작업 내용**: `/tdd interface`로 테스트를 먼저 쓰고 구현한다. `ZOOM_PRESETS`, `MAX_ZOOM`, `fitWidthScale`, `zoomStops`, `stepZoom`, `centerAnchoredScroll`, `formatZoomPercent`. 시그니처는 design.md "인터페이스 설계" 그대로.
- **검증**:
  - [ ] `fitWidthScale(1074, 368)` ≈ 0.343 / `fitWidthScale(200, 368)` === 1 (확대 안 함) / `fitWidthScale(0, 368)` === 1 (0 나눗셈 가드)
  - [ ] `zoomStops(0.343)` === `[0.343, 0.5, 0.75, 1, 1.5, 2, 3, 4]` — fit 미만인 0.25가 빠진다
  - [ ] `zoomStops(1)` === `[1, 1.5, 2, 3, 4]` — fit과 같은 100% 프리셋이 중복 제거된다
  - [ ] `stepZoom(0.343, 0.343, +1)` === 0.5 / `stepZoom(0.5, 0.343, -1)` === null (맞춤으로) / `stepZoom(4, fit, +1)` === 4 (상한 유지)
  - [ ] `centerAnchoredScroll`: 중앙점 natural 좌표가 배율 변경 전후로 보존된다. 스크롤 여지가 없는 축은 0으로 클램프된다
  - [ ] `formatZoomPercent(0.3425)` === `"34%"`
  - [ ] `pnpm test` 통과

### Task 2: `shapes.ts:fitScale` 제거 + 테스트 이관

- **변경 대상**: `src/sidepanel/components/annotation/shapes.ts`, `src/sidepanel/components/annotation/__tests__/shapes.test.ts`
- **작업 내용**: `fitScale()`(`shapes.ts:127-135`) 삭제. `shapes.test.ts:154-170`의 `describe("fitScale — 표시 배율")` 블록 삭제(대응 커버리지는 Task 1의 `fitWidthScale` 케이스가 가진다). **Task 3 전에 하면 타입 에러가 나므로 Task 3과 같은 단위로 처리한다.**
- **검증**:
  - [ ] `grep -rn "fitScale" src/` 결과 0건
  - [ ] `pnpm typecheck` 통과

### Task 3: `AnnotationOverlay` state 분리 + fit-width + 중앙 앵커

- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx`
- **작업 내용**:
  - `const [scale, setScale] = useState(1)` (`:80`) → `fit` / `zoom` 2개로 분리, `const scale = zoom ?? fit`.
  - 로컬 `measureScale`(`:63-71`) 제거. `viewportRef`를 두고 `useLayoutEffect` + `ResizeObserver`로 `fit = fitWidthScale(natW, viewport.clientWidth - VIEWPORT_PADDING)` 실측. 기존 `window.resize` 리스너(`:119-124`) 제거.
  - `applyScale(next: number | null)` 추가 — `commitText()` → `centerAnchoredScroll` → `requestAnimationFrame`에서 `viewport.scrollLeft/Top` 세팅 → `setZoom(next)`. (design.md 코드 참조)
  - `AnnotationToolbar`에 `viewportRef` / `scale` / `fit` / `onScaleChange={applyScale}` 전달.
  - **CSS transform 구조(`:367-383`)와 `stage.getPointerPosition()` 호출부는 건드리지 않는다.** 좌표 보정은 Konva에 위임된 채로 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 페이지 전체 캡처를 어노테이션 진입 → 라벨이 fit-width 배율(대략 30%대)로 뜨고, 현행보다 이미지가 크게 보인다
  - [ ] 요소 캡처(작은 이미지) 진입 화면이 현행과 동일하다 (100%)

### Task 4: `ZoomControl` 컴포넌트

- **변경 대상**: `src/sidepanel/components/annotation/ZoomControl.tsx` (신규)
- **작업 내용**: design.md 렌더 구조대로 `ButtonGroup` + `TooltipIconButton`(Minus/Plus) + shadcn `Select`. `SelectTrigger`에 `h-8` 명시. testId: `annotation-zoom-out` / `annotation-zoom-level` / `annotation-zoom-in`.
- **검증**:
  - [ ] 맞춤 상태에서 `[-]` disabled, 400%에서 `[+]` disabled
  - [ ] 콤보박스 목록에 fit 미만 프리셋이 없다 (fit 34%면 25% 항목 없음)
  - [ ] `[-]`/`[+]` 버튼 높이가 Select trigger와 같다 (h-8)

### Task 5: 툴바 캔버스 영역 레이아웃 + 컨트롤 배치

- **변경 대상**: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`
- **작업 내용**:
  - 캔버스 슬롯(`:143`)을 `relative` 래퍼 + 내부 스크롤 뷰포트(`ref={viewportRef}`)로 분리.
  - **`items-center justify-center` 제거 → children wrapper에 `m-auto`.** (확대 시 좌·상단 클리핑 방지 — design.md 위험 요소 1)
  - `pointer-events-none` absolute 레이어에 좌상단 맞춤 버튼(`scale !== fit`일 때만) / 우상단 `ZoomControl` 배치. 각 컨트롤 노드에만 `pointer-events-auto`.
  - props 추가: `viewportRef`, `scale`, `fit`, `onScaleChange`.
- **검증**:
  - [ ] 400% 확대 후 이미지 **좌상단 모서리까지** 스크롤로 도달 가능 (클리핑 회귀 확인)
  - [ ] 캔버스를 스크롤해도 줌 컨트롤·맞춤 버튼이 제자리에 고정
  - [ ] 컨트롤이 없는 캔버스 영역에서 드래그 그리기가 막히지 않는다
  - [ ] 맞춤 상태에서 맞춤 버튼이 보이지 않고, 배율을 바꾸면 나타난다

### Task 6: i18n 키

- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: ko/en 양쪽에 `annotation.zoomIn` / `zoomOut` / `zoomLevel` / `fitToWidth` / `zoomFit` 추가 (design.md 표).
- **검증**:
  - [ ] PostToolUse 훅의 `locales.test.ts`(ko/en 키 대칭) 자동 통과

### Task 7: e2e 시나리오

- **변경 대상**: `e2e/annotation-overlay.spec.ts`
- **작업 내용**: 아래 "e2e 시나리오"를 spec으로. `/e2e-write`로 처리.
- **검증**:
  - [ ] 기존 케이스 2개 그대로 green
  - [ ] 신규 케이스 green

## 테스트 계획

### 단위 테스트 (`src/sidepanel/components/annotation/__tests__/zoom.test.ts`)

| 함수 | 케이스 |
|---|---|
| `fitWidthScale` | 넓은 이미지 축소 / 작은 이미지 1로 클램프 / natW=0 가드 |
| `zoomStops` | fit 미만 프리셋 제외 / fit==1 중복 제거 / 항상 오름차순, `stops[0] === fit` |
| `stepZoom` | fit→다음 프리셋 / 최저 프리셋→null(맞춤) / 상한·하한 경계 유지 / 부동소수 ε 비교 |
| `centerAnchoredScroll` | 중앙 natural 좌표 보존 / 확대·축소 양방향 / 스크롤 여지 없는 축 0 클램프 / 최대치 클램프 |
| `formatZoomPercent` | 반올림 |

### e2e 시나리오 (`/e2e-write` 입력)

- 페이지 전체 캡처로 어노테이션에 진입하면, 줌 라벨이 100% 미만으로 표시되고 맞춤 버튼은 보이지 않는다.
- `[+]`를 누르면 줌 라벨의 배율이 커지고, 좌상단 맞춤 버튼이 나타난다.
- 맞춤 버튼을 누르면 줌 라벨이 진입 시 배율로 돌아가고, 맞춤 버튼이 다시 사라진다.
- 맞춤 상태에서 `[-]`는 disabled다.
- 줌 라벨 콤보박스를 열고 `100%`를 고르면 라벨이 `100%`가 된다.
- 확대(100%)한 상태에서 캔버스를 드래그해 사각형을 그리고 완료하면, 결과 이미지의 크기가 **원본 캡처와 같다**(export 해상도가 배율에 영향받지 않음).
- 기존 케이스(도구 선택 → 취소 복귀 / 도형 그린 뒤 done → annotated webp 전이)가 그대로 통과한다.

### 수동 테스트 (Chrome)

- [ ] 긴 페이지(예: 위키백과 문서)를 페이지 전체 캡처 → 어노테이션 진입 → 100%로 확대해 본문 텍스트가 읽히는지
- [ ] 그 상태에서 화살표를 특정 요소에 찍고 완료 → 미리보기 이미지의 같은 위치에 화살표가 있는지 (좌표 정합)
- [ ] 확대·축소 시 화면 중앙에 보던 지점이 중앙에 남는지 (중앙 앵커)
- [ ] 400%에서 이미지 좌상단·우하단 모서리까지 스크롤로 도달되는지
- [ ] 텍스트 박스 입력 도중 `[+]`를 누르면 입력이 커밋되고 좌표 어긋난 textarea가 남지 않는지
- [ ] 배율을 조작한 뒤 사이드패널 폭을 바꿔도 배율이 유지되는지 / 맞춤 상태면 자동 추종하는지
- [ ] 다크 모드에서 플로팅 컨트롤이 캔버스(bg-muted) 위에서 식별되는지
- [ ] 400% 확대 상태에서 스크롤이 버벅이지 않는지 (4M px 캔버스 합성 부하)

## 구현 순서 권장

```
Task 1 (zoom.ts + 테스트)  ─┐
Task 6 (i18n)              ─┼─▶ Task 4 (ZoomControl) ─┐
                            │                          ├─▶ Task 5 (툴바 레이아웃) ─▶ Task 7 (e2e)
Task 2+3 (fitScale 제거 +  ─┘                          │
          Overlay state)  ─────────────────────────────┘
```

- **Task 1·6은 서로 독립** — 병렬 가능.
- **Task 2와 3은 한 단위** — `fitScale`을 지우면 `AnnotationOverlay`가 즉시 타입 에러다.
- Task 4는 Task 1(`zoomStops`/`stepZoom`)과 Task 6(i18n 키)에 의존.
- Task 5는 Task 3(props)·Task 4(컴포넌트) 둘 다 필요.
- Task 7은 전부 끝난 뒤.

## 가이드 영향

사용자 노출 UX 변경이다. `/implement` 후 `/guide`로 처리한다 (작성 전 `guide/AUTHORING.md` 필독).

- `guide/ko/screenshot/annotation.md` · `guide/en/screenshot/annotation.md` — 줌 컨트롤(`[-][n%][+]`)·맞춤 버튼 설명 추가. 페이지 전체 캡처를 어노테이션할 때 확대해서 정확한 위치에 주석을 다는 흐름을 안내.
