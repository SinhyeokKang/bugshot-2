# Konva 스크린샷 주석 오버레이 — 구현 태스크

## 선행 조건

- 의존성: `pnpm add konva react-konva`, `pnpm remove markerjs2`. (pnpm `minimumReleaseAge:1440` → 24h 미만 최신 버전은 직전 버전으로 resolve됨, 정상. react-konva는 react 18 peer 요구 → 프로젝트 `react ^18.3.1` 호환, 설치 후 peerDep 경고 확인.)
- shadcn `ButtonGroup`은 **이미 설치됨**(`src/components/ui/button-group.tsx`, OriginFilterBar 사용) — 재설치 불필요. ToggleGroup은 쓰지 않는다.
- 빌드는 사용자 요청/`/build` 시에만. 검증은 `pnpm typecheck`·`pnpm test` 우선.

## 태스크

### Task 1: 프리셋 상수 모듈 + 테스트
- **변경 대상**: `src/sidepanel/components/annotation/presets.ts`, `__tests__/presets.test.ts`
- **작업 내용**: `AnnotationTool`/`ThicknessKey` 타입, `ANNOTATION_COLORS`(5 hex), `DEFAULT_COLOR`, `ANNOTATION_THICKNESS`(S/M/L→px), `DEFAULT_THICKNESS`, `HIGHLIGHT_OPACITY`, `TEXT_FONT_SIZE`, `ANNOTATION_TOOLS`(도구 메타: key·아이콘 식별·i18n 키).
- **검증**:
  - [ ] 색상 5개·중복 없음·DEFAULT_COLOR가 목록에 포함
  - [ ] 두께 3키 모두 양수, S<M<L
  - [ ] `pnpm test presets` 통과

### Task 2: 도형 모델·팩토리 순수 모듈 + 테스트 (TDD interface)
- **변경 대상**: `src/sidepanel/components/annotation/shapes.ts`, `__tests__/shapes.test.ts`
- **작업 내용**: `AnnotationShape` 유니온 타입, `createShape(tool,id,pt,style)`, `updateShapeDraft(shape,pt)`, `isEmptyShape(shape)`, `applyTransform(shape,attrs)`(Transformer scale/rotation 흡수 정규화). Konva/React 의존 0.
- **검증**:
  - [ ] `createShape("rect", id, {x:10,y:10}, style)` → width/height 0, 좌표·스타일 반영
  - [ ] `updateShapeDraft`로 rect/ellipse 크기, arrow 끝점, pen/highlight points 누적 갱신
  - [ ] `isEmptyShape`: 면적 0 rect/ellipse, 빈 텍스트, 점 1개 pen → true
  - [ ] `applyTransform`: scaleX/scaleY를 width/height로 흡수(결과 scale 1 전제), rotation 반영, 반복 적용 시 누적 왜곡 없음
  - [ ] 입력 도형 불변(새 객체 반환) — 순수성
  - [ ] `pnpm test shapes` 통과

### Task 3: undo/redo 히스토리 리듀서 + 테스트 (TDD interface)
- **변경 대상**: `src/sidepanel/components/annotation/history.ts`, `__tests__/history.test.ts`
- **작업 내용**: `History<T>`(past/present/future), `initHistory`/`pushHistory`/`undo`/`redo`/`canUndo`/`canRedo`. 제네릭, 불변 갱신.
- **검증**:
  - [ ] push 후 future 비워짐, undo→present 이전 값, redo→복원
  - [ ] 빈 past에서 undo no-op, 빈 future에서 redo no-op
  - [ ] canUndo/canRedo 경계 정확
  - [ ] `pnpm test history` 통과

### Task 4: ShapeNode (react-konva 도형 렌더러)
- **변경 대상**: `src/sidepanel/components/annotation/ShapeNode.tsx`
- **작업 내용**: `AnnotationShape` 1개를 타입별 Konva 노드로 렌더(arrow→`Arrow`, rect→`Rect`, ellipse→`Ellipse`, pen→`Line`, highlight→`Line` opacity/round cap, text→`Text`). 선택/드래그/transform end 콜백 props. `draggable`은 select 도구일 때만. select 도구에서 노드 hover 시 커서 `move`(onMouseEnter/Leave로 `stage.container().style.cursor` 토글).
- **검증**:
  - [ ] 6개 타입 각각 올바른 Konva 노드로 렌더(타입 분기 누락 없음)
  - [ ] highlight는 반투명+둥근 캡, text는 fontSize 적용
  - [ ] select 도구에서 도형 hover 시 커서 move, leave 시 복귀(수동)
  - [ ] `pnpm typecheck` 통과

### Task 5: AnnotationToolbar (shadcn UI, 3단 컨텍스트 레이아웃)
- **변경 대상**: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`
- **작업 내용**: design "툴바 레이아웃" 대로 구현. **모든 버튼 아이콘 전용**(텍스트 라벨 없음, `aria-label`/`title`만). 모든 버튼 `<Button size="icon" className="h-8 w-8">`. 각 단 래퍼는 전역 탭 바와 동일 패딩 `px-4 py-4`(+동일 mb/`border-b`). ToggleGroup 금지.
  - **1단**: 도구 7종 `ButtonGroup`(활성 `bg-muted` + `data-active`, flex-wrap) + 우측 **삭제 버튼**(`Trash2`, `selectedId`일 때만 활성).
  - **2단**: 색상 5 원형 스와치 `ButtonGroup` + 두께 3 굵기 아이콘(`Minus` strokeWidth 1/2.5/4 등, aria로 S/M/L)`ButtonGroup`(두께는 arrow/rect/ellipse/pen만, text/highlight는 숨김/비활성). 그리기 도구 선택 시에만 내용 렌더하되 **행 높이는 항상 예약**(select 시 `invisible`) — 언마운트 시 이미지 수직 점프 방지.
  - **3단**: 왼쪽 Undo/Redo(`Undo2`/`Redo2`, disabled = !canUndo/!canRedo), 오른쪽 Cancel(`X`)/OK(`Check`, 도형 0개면 disabled).
  - data-testid 부착(도구별·undo/redo/delete/cancel/done).
- **검증**:
  - [ ] 모든 버튼 아이콘 전용(텍스트 없음), aria-label 존재
  - [ ] 각 단 패딩이 전역 탭 바(`px-4 py-4`)와 일치
  - [ ] 활성 도구/색상/두께 시각 표시(`bg-muted`/`data-active`), 콜백 발화
  - [ ] select 도구 선택 시 2단 내용 숨김(높이는 예약 유지), 그리기 도구 시 표시 — 도구 전환 시 이미지 수직 위치 점프 없음(수동)
  - [ ] 삭제 버튼 `selectedId` 없을 때 disabled, 있을 때 활성
  - [ ] Undo/Redo·OK disabled 상태 연동(도형 0개 OK disabled)
  - [ ] 좁은 사이드패널(~320–400px) 폭에서 3단 레이아웃 안 깨짐(수동 확인)

### Task 6: AnnotationOverlay 재작성 (Konva Stage 호스트)
- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx` (markerjs2 제거)
- **작업 내용**: props 시그니처 유지. 오버레이는 탭 컨텐츠 영역 덮음(전역 탭 비가림, `bg-black/40 backdrop-blur` 폐기), 이미지 중앙 정렬, 상단/하단 툴바 고정. **배경 분리**: 툴바 영역 `bg-background`, 가운데 canvas 영역(툴바 제외) `bg-muted/50`(PageFooter와 동일).
  - `loadImage`로 자연 크기 취득(**reject → 토스트 + `onCancel()` 자동 닫기**)→displayScale 계산.
  - **Stage는 자연 해상도로 생성**, 컨테이너 CSS `transform: scale(displayScale)` `transform-origin: top left`로만 시각 축소. 배경 `Image` Layer(원본 HTMLImage)/도형 Layer/`Transformer` Layer.
  - 포인터 이벤트로 createShape→updateShapeDraft→commit(+isEmptyShape 폐기). 활성 도구별 **커서**(arrow/rect/ellipse/pen/highlight→crosshair, text→text, select→default).
  - select 도구 클릭 선택, Transformer attach, transform end에서 `applyTransform`로 scale 흡수 후 노드 scale 리셋. Delete/Backspace + **툴바 삭제 버튼**으로 선택 도형 제거.
  - 텍스트 인라인 편집(textarea, fontSize×displayScale 정합). **blur 시 빈 문자열이면 push 없이 폐기, 내용 있으면 push 1회**.
  - history로 undo/redo + 키보드(Cmd/Ctrl+Z, Shift+Z). 선택 도형 색상/두께 변경도 history 단위.
  - Done: `stage.toDataURL({mimeType:"image/webp",quality:0.92,pixelRatio:1})`→onComplete. **도형 0개면 Done disabled**(호출 안 함). Cancel→onCancel(dirty-check 없음).
  - Suspense fallback(DraftingPanel 측)은 `null` 대신 dimmed + `Loader2` 권장(설계 위험요소 참조 — DraftingPanel 무변경 원칙과 충돌 시 오버레이 자체 로딩 표시로 대체).
  - unmount 시 window 키 리스너·textarea 정리. konva/react-konva static import.
- **검증**:
  - [ ] 6개 도구로 그리기·선택·이동·리사이즈·회전·삭제(키보드+버튼) 동작(수동, 실제 탭)
  - [ ] 도구별 커서 전환(crosshair/text/move) 정합(수동)
  - [ ] Undo/Redo 정확(추가/이동/삭제/색상변경 단위)
  - [ ] Done 결과 webp + 자연 해상도(출력 width == naturalWidth)
  - [ ] 도형 0개일 때 Done disabled
  - [ ] 이미지 로드 실패 시 토스트 + 자동 닫기
  - [ ] 재진입 시 평탄화 이미지 base 로드, 취소 시 폐기
  - [ ] `pnpm typecheck` 통과

### Task 7: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: `annotation.*` 도구명(select/arrow/rect/ellipse/pen/text/highlight)·`annotation.undo`/`annotation.redo`/`annotation.delete`·색상명(red/yellow/green/blue/black)·두께(S/M/L) aria 라벨 키 추가. ko/en 동시. 기존 cancel/done/draft.* 재사용. **Task 5 시작 전에 키를 먼저 박는다**(키 없으면 빈 라벨로 typecheck가 거짓 그린).
- **검증**:
  - [ ] ko/en 키 대칭 — 저장 시 PostToolUse 훅 `locales.test.ts` 자동 통과
  - [ ] 툴바·오버레이 모든 사용자 노출 문자열이 `t()` 경유

### Task 8: main.tsx 주석 갱신 + package.json 정리
- **변경 대상**: `src/sidepanel/main.tsx`(주석만), `package.json`
- **작업 내용**: getContext 패치 주석을 "Konva hit-detection canvas가 getImageData 사용 → 경고 억제 + hit 최적화, 렌더 canvas는 force-true가 미세 비최적이나 소형이라 무시" 기준으로 사실에 맞게 갱신(로직·패치 불변, 제거 금지). `package.json`에서 `markerjs2` 제거, `konva`/`react-konva` 존재 확인.
- **검증**:
  - [ ] `grep -rn markerjs src/ package.json` → 0건
  - [ ] `grep -n willReadFrequently src/sidepanel/main.tsx` → 1건(패치 존속)
  - [ ] `grep -rn "from \"konva\"\|react-konva" src/` → annotation/ 하위 + AnnotationOverlay만(비-lazy 경로 유입 0 = 청크 격리 가드)
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

- **단위 테스트(Vitest)**:
  - `presets.test.ts`: 색상/두께 불변식.
  - `shapes.test.ts`: createShape 초기값, updateShapeDraft 타입별 갱신, isEmptyShape 경계, 불변성.
  - `history.test.ts`: push/undo/redo/경계 no-op/canUndo·canRedo.
- **e2e 시나리오(`/e2e-write` 입력)** — **한계: Konva Stage는 단일 `<canvas>`라 도형이 DOM 노드가 아님 → "도형이 그려졌다"를 셀렉터로 직접 판정 불가.** 캔버스 외부에서 관측 가능한 신호로만 한정한다:
  - screenshot 캡처 후 연필 버튼을 누르면 주석 오버레이 컨테이너가 visible이 된다.
  - 도구 버튼을 누르면 해당 버튼이 active(`data-active`)가 된다.
  - "주석 완료(OK)"를 누르면 오버레이가 닫히고 미디어 미리보기 `<img src>`가 `data:image/webp`로 바뀐다.
  - "취소"를 누르면 오버레이가 닫히고 `<img src>`가 불변이다.
  - 주석 후 "주석 제거"(RotateCcw)를 누르면 `<img src>`가 raw로 복귀한다.
  - (data-testid 부착 대상: 오버레이 컨테이너, 각 도구/삭제/undo/redo 버튼, done/cancel, 미디어 미리보기 img. 캔버스 드래그→도형 추가는 **수동 테스트**로 강등. 굳이 e2e로 도형 수를 보려면 오버레이 컨테이너에 `data-shape-count` 같은 테스트 전용 속성 노출이 필요 — 1차엔 미채택, 필요 시 추가.)
- **수동 테스트(Chrome, 자동화 불가)**:
  - [ ] 6개 도구 그리기·이동·리사이즈·회전·삭제(키보드+버튼) 시각 정합
  - [ ] 도구별 커서 전환(crosshair/text/move)
  - [ ] 텍스트 인라인 입력 위치·크기 정합(CSS scale된 Stage 안), 빈 텍스트 blur → 폐기 / 입력→삭제→undo 경계
  - [ ] Undo/Redo 키보드(Cmd/Ctrl+Z, Shift+Z) + 선택 도형 색상 변경 → undo로 복귀
  - [ ] transform(회전/리사이즈) 후 export에서 왜곡 없음(다운로드해 확인)
  - [ ] 큰 스크린샷에서 출력 자연 해상도 유지(다운로드해 픽셀 확인)
  - [ ] 색상/두께 변경이 신규·선택 도형에 반영
  - [ ] 좁은 사이드패널 폭에서 3단 툴바 리플로우, canvas 영역 `bg-muted/50`(툴바 영역 기본 배경)·전역탭 비가림
  - [ ] 주석 완료 후 패널 닫았다 재열기 → `screenshotAnnotated` 세션 복원
  - [ ] 주석 완료 → 이슈 제출 시 IndexedDB "before" 첨부에 주석 반영
  - [ ] 오버레이 떠 있는 중 탭/패널 전환 → 안전하게 닫힘(누수 없음)
  - [ ] 빌드 후 konva가 메인 청크 아닌 별도 lazy 청크에 분리

## 구현 순서 권장

1. **Task 1·2·3 (순수 모듈 + 테스트)** — 병렬 가능, 의존 없음. `/tdd interface`로 테스트 먼저.
2. **Task 7 (i18n)** — Task 5 시작 전 선행(키 먼저). 단독 가능.
3. **Task 4 (ShapeNode)** — Task 2의 도형 타입에 의존.
4. **Task 5 (Toolbar)** — Task 1(프리셋)·Task 3(canUndo/Redo)·Task 7(i18n 키) 의존. Task 4와 병렬 가능.
5. **Task 6 (AnnotationOverlay)** — Task 2~5·7 통합. 핵심.
6. **Task 8 (정리)** — 마지막. markerjs2 제거 후 typecheck로 잔여 참조 확인 + 청크 격리 grep.

## 가이드 영향

사용자 노출 UX 변경(주석 툴바·도구·동작이 바뀜) → `/guide`로 ko·en 갱신 필요. 작성 전 `guide/AUTHORING.md` 규칙 로드.
- `guide/ko`·`guide/en`의 스크린샷 주석/마크업 관련 페이지(예: capture·screenshot 가이드) — 도구 6종·색상/두께·Undo·완료/취소 흐름으로 본문·UI 라벨 갱신. 정확한 페이지는 `/guide`에서 코드 대조로 확정.
