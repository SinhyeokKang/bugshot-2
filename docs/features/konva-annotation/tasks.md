# Konva 스크린샷 주석 오버레이 — 구현 태스크

## 선행 조건

- 의존성: `pnpm add konva react-konva`, `pnpm remove markerjs2`. (pnpm `minimumReleaseAge:1440` → 24h 미만 최신 버전은 직전 버전으로 resolve됨, 정상.)
- shadcn `ToggleGroup` 필요 시 설치: `npx shadcn@latest add toggle-group` → `src/components/ui/`에 생성 확인(루트 오생성 주의).
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
- **작업 내용**: `AnnotationShape` 유니온 타입, `createShape(tool,id,pt,style)`, `updateShapeDraft(shape,pt)`, `isEmptyShape(shape)`. Konva/React 의존 0.
- **검증**:
  - [ ] `createShape("rect", id, {x:10,y:10}, style)` → width/height 0, 좌표·스타일 반영
  - [ ] `updateShapeDraft`로 rect/ellipse 크기, arrow 끝점, pen/highlight points 누적 갱신
  - [ ] `isEmptyShape`: 면적 0 rect/ellipse, 빈 텍스트, 점 1개 pen → true
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
- **작업 내용**: `AnnotationShape` 1개를 타입별 Konva 노드로 렌더(arrow→`Arrow`, rect→`Rect`, ellipse→`Ellipse`, pen→`Line`, highlight→`Line` opacity/round cap, text→`Text`). 선택/드래그/transform end 콜백 props. `draggable`은 select 도구일 때만.
- **검증**:
  - [ ] 6개 타입 각각 올바른 Konva 노드로 렌더(타입 분기 누락 없음)
  - [ ] highlight는 반투명+둥근 캡, text는 fontSize 적용
  - [ ] `pnpm typecheck` 통과

### Task 5: AnnotationToolbar (shadcn UI)
- **변경 대상**: `src/sidepanel/components/annotation/AnnotationToolbar.tsx`
- **작업 내용**: 도구 ToggleGroup(7), 색상 스와치 5, 두께 S/M/L, Undo/Redo 버튼(disabled = !canUndo/!canRedo). lucide 아이콘. IconButton `h-8 w-8`. 좁은 폭 리플로우(container query/flex-wrap). 모든 라벨 i18n(aria/title).
- **검증**:
  - [ ] 활성 도구/색상/두께 시각 표시, 콜백 발화
  - [ ] Undo/Redo disabled 상태 연동
  - [ ] 좁은 사이드패널 폭에서 깨지지 않음(수동 확인)

### Task 6: AnnotationOverlay 재작성 (Konva Stage 호스트)
- **변경 대상**: `src/sidepanel/components/AnnotationOverlay.tsx` (markerjs2 제거)
- **작업 내용**: props 시그니처 유지. `loadImage`로 자연 크기 취득→displayScale 계산. `Stage`/배경 `Image` Layer/도형 Layer/`Transformer`. 포인터 이벤트로 createShape→updateShapeDraft→commit(+isEmptyShape 폐기). select 도구 클릭 선택, Transformer attach, transform end에서 scale→width/height 흡수 후 scale 리셋. Delete/Backspace 삭제. 텍스트 인라인 편집(textarea). history로 undo/redo + 키보드(Cmd/Ctrl+Z, Shift+Z). Done: `stage.toDataURL({mimeType:"image/webp",quality:0.92,pixelRatio:1/displayScale})`→onComplete(도형 0개면 호출 생략). Cancel→onCancel. unmount 시 window 키 리스너·textarea 정리. konva/react-konva static import.
- **검증**:
  - [ ] 6개 도구로 그리기·선택·이동·리사이즈·회전·삭제 동작(수동, 실제 탭)
  - [ ] Undo/Redo 정확
  - [ ] Done 결과 webp + 자연 해상도(출력 width == naturalWidth)
  - [ ] 재진입 시 평탄화 이미지 base 로드, 취소 시 폐기
  - [ ] `pnpm typecheck` 통과

### Task 7: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: `annotation.*` 도구명(select/arrow/rect/ellipse/pen/text/highlight)·`annotation.undo`/`annotation.redo`/`annotation.delete`·색상/두께 aria 라벨 키 추가. ko/en 동시. 기존 cancel/done/draft.* 재사용.
- **검증**:
  - [ ] ko/en 키 대칭 — 저장 시 PostToolUse 훅 `locales.test.ts` 자동 통과
  - [ ] 툴바·오버레이 모든 사용자 노출 문자열이 `t()` 경유

### Task 8: main.tsx 주석 갱신 + package.json 정리
- **변경 대상**: `src/sidepanel/main.tsx`(주석만), `package.json`
- **작업 내용**: getContext 패치 주석을 "Konva hit-detection canvas의 willReadFrequently 최적화/경고 억제" 기준으로 갱신(로직 불변). `package.json`에서 `markerjs2` 제거, `konva`/`react-konva` 존재 확인.
- **검증**:
  - [ ] `grep -rn markerjs src/ package.json` → 0건
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

- **단위 테스트(Vitest)**:
  - `presets.test.ts`: 색상/두께 불변식.
  - `shapes.test.ts`: createShape 초기값, updateShapeDraft 타입별 갱신, isEmptyShape 경계, 불변성.
  - `history.test.ts`: push/undo/redo/경계 no-op/canUndo·canRedo.
- **e2e 시나리오(`/e2e-write` 입력)**:
  - screenshot 캡처 후 연필 버튼을 누르면 주석 오버레이(Stage)가 뜬다.
  - 화살표 도구로 캔버스를 드래그하면 도형이 1개 추가된다.
  - "주석 완료"를 누르면 오버레이가 닫히고 미디어 미리보기 이미지가 갱신(주석 반영)된다.
  - "취소"를 누르면 미디어 이미지가 변하지 않는다.
  - 주석 후 "주석 제거"(RotateCcw)를 누르면 원본으로 돌아간다.
  - (data-testid 추가 대상: 주석 오버레이 컨테이너, 각 도구 버튼, done/cancel, 미디어 미리보기 img.)
- **수동 테스트(Chrome, 자동화 불가)**:
  - [ ] 6개 도구 그리기·이동·리사이즈·회전·삭제 시각 정합
  - [ ] 텍스트 인라인 입력 위치 정합(스케일된 Stage 안)
  - [ ] Undo/Redo 키보드(Cmd/Ctrl+Z, Shift+Z)
  - [ ] 큰 스크린샷에서 출력 자연 해상도 유지(다운로드해 픽셀 확인)
  - [ ] 색상/두께 변경이 신규·선택 도형에 반영
  - [ ] 좁은 사이드패널 폭에서 툴바 리플로우
  - [ ] 빌드 후 konva가 메인 청크 아닌 별도 lazy 청크에 분리

## 구현 순서 권장

1. **Task 1·2·3 (순수 모듈 + 테스트)** — 병렬 가능, 의존 없음. `/tdd interface`로 테스트 먼저.
2. **Task 4 (ShapeNode)** — Task 2의 도형 타입에 의존.
3. **Task 5 (Toolbar)** — Task 1(프리셋)·Task 3(canUndo/Redo) 의존. Task 4와 병렬 가능.
4. **Task 7 (i18n)** — Task 5/6의 키 사용처와 함께. 먼저 키만 박아도 OK.
5. **Task 6 (AnnotationOverlay)** — Task 2~5·7 통합. 핵심.
6. **Task 8 (정리)** — 마지막. markerjs2 제거 후 typecheck로 잔여 참조 확인.

## 가이드 영향

사용자 노출 UX 변경(주석 툴바·도구·동작이 바뀜) → `/guide`로 ko·en 갱신 필요. 작성 전 `guide/AUTHORING.md` 규칙 로드.
- `guide/ko`·`guide/en`의 스크린샷 주석/마크업 관련 페이지(예: capture·screenshot 가이드) — 도구 6종·색상/두께·Undo·완료/취소 흐름으로 본문·UI 라벨 갱신. 정확한 페이지는 `/guide`에서 코드 대조로 확정.
