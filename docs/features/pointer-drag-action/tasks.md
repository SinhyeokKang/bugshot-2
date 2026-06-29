# 드래그 액션 기록 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**. manifest 무변경(pointer/drag 이벤트는 추가 권한 불요).
- 액션 레코더는 녹화(video) 모드 전용 — 변경 없음.
- lucide-react `Move`(또는 `GripVertical`) 아이콘 사용 가능 확인(이미 의존성에 포함, import만 추가).

## 태스크

### Task 1: 순수 헬퍼 + 타입 (테스트 우선)
- **변경 대상**: `src/types/action.ts`, `src/content/action-recorder-helpers.ts`, `src/content/__tests__/action-recorder-helpers.test.ts`
- **작업 내용**:
  - `ActionEntryKind`에 `"drag"`, `ActionNode` 인터페이스, `ActionEntry.dragSource?`/`dragTarget?` 추가.
  - `action-recorder-helpers.ts`에 `DRAG_THRESHOLD_PX = 10`, `exceedsDragThreshold(x0,y0,x1,y1,threshold)` 추가.
  - 테스트를 **먼저** 작성: 임계 초과/미달/대각선/음수 델타 케이스.
- **검증**:
  - [ ] `pnpm test` — `exceedsDragThreshold` 신규 테스트 green
  - [ ] `pnpm typecheck` 통과

### Task 2: 렌더 헬퍼 `resolveActionNode` (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/actionInline.ts`, `src/sidepanel/lib/__tests__/actionInline.test.ts`(없으면 신설)
- **작업 내용**: `resolveActionNode(node: ActionNode): ClickTargetView` 추가(name→tag→selector→empty 우선순위). `resolveClickTarget`을 이 함수에 위임하도록 외과적 리팩터(로직 단일화).
- **검증**:
  - [ ] name 있을 때 `mode:"name"`, name 없고 tagName 있을 때 `mode:"tag"`, selector만 있을 때 `mode:"name"`, 전무 시 `mode:"empty"` 테스트
  - [ ] `resolveClickTarget` 기존 테스트(있으면) 무회귀
  - [ ] `pnpm test` green

### Task 3: 캡처 — 포인터 휴리스틱 + 네이티브 DnD
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**:
  - `Kind`에 `"drag"`, `CapturedAction`에 `dragSource?`/`dragTarget?`.
  - `describeNode(el): ActionNode` 추출(recordClick 인라인 로직 재사용).
  - `recordDrag(source, target)` → `pushAction({ kind:"drag", ... })`.
  - 포인터 상태기계(`pointerdown`/`move`/`up`/`cancel`) + 네이티브(`dragstart`/`drop`/`dragend`), design.md "상태 기계" 절대로 구현. 모두 capture phase.
  - 기존 click 리스너 진입부에 `suppressNextClick` 가드 추가.
  - 외부 static import 추가 금지(pre-arm 청크 제약) — helpers는 기존처럼 relative import.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동, Task 7) 실제 dnd 페이지에서 drag 1건 + click 0건 확인

### Task 4: 사이드패널 렌더 분기
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**: `ACTION_FILTERS`에 `"drag"`, `filterLabel`에 drag, `KindIcon`에 `case "drag"`(`Move`), `renderActionContent`에 `case "drag"`(source/target 슬롯을 `resolveActionNode` 기반 컴포넌트로 렌더).
- **검증**:
  - [ ] `pnpm typecheck` — `kind satisfies never` 분기 충족(누락 시 컴파일 실패)
  - [ ] (수동) 액션 로그 탭에 드래그 필터·아이콘·"A를 B로 드래그" 문구 노출

### Task 5: 로그 뷰어 마커 + 직렬화
- **변경 대상**: `src/log-viewer/markers.ts`, `src/sidepanel/lib/buildLogSummary.ts`, `src/sidepanel/lib/buildActionLogJson.ts`
- **작업 내용**:
  - `markers.ts` switch에 `case "drag"`.
  - `buildActionLogSummary`에 drag 분기(`Dragged X to Y`).
  - `buildActionLogJson`에 `dragSource`/`dragTarget` 조건부 직렬화.
- **검증**:
  - [ ] `pnpm typecheck` — markers switch `satisfies never` 충족
  - [ ] `buildActionLogSummary` 단위 테스트에 drag 케이스 추가 후 `pnpm test` green
  - [ ] `buildActionLogJson` 테스트(있으면)에 drag 엔트리 직렬화 케이스

### Task 6: i18n (ko·en 동시, 양쪽 파일)
- **변경 대상**: `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts`
- **작업 내용**: `actionLog.filter.drag`, `actionLog.verb.drag`를 ko·en 양쪽·양 파일에 추가(design.md 표).
- **검증**:
  - [ ] `src/i18n/` 저장 시 PostToolUse 훅의 `locales.test.ts` 자동 green(ko/en 키 대칭·`{source}`/`{target}` 토큰 일치)
  - [ ] log-viewer i18n 키도 ko/en 대칭

### Task 7: 수동 검증 (실제 탭)
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: dev 빌드 로드 후 실제 dnd 페이지에서 확인.
- **검증**:
  - [ ] 라이브러리 dnd(dnd-kit/react-beautiful-dnd) 드래그 → `drag` 1건, source·target 정확, click 0건
  - [ ] 네이티브 `draggable=true` 드래그 → `drag` 1건
  - [ ] 임계 미달 클릭 → `click` 정상(회귀 없음)
  - [ ] 텍스트 선택 드래그 → `drag` 0건
  - [ ] 드래그 고스트/오버레이가 target으로 잘못 잡히지 않는지(잡히면 design.md 위험요소대로 후속 처리)

## 테스트 계획

- **단위 테스트**:
  - `exceedsDragThreshold` — 임계 초과/미달/경계(정확히 10px)/대각선/음수 델타.
  - `resolveActionNode` — name/tag/selector/empty 우선순위 4케이스.
  - `buildActionLogSummary` — drag 엔트리 → `Dragged X to Y`, source/target name·selector 폴백.
- **e2e 시나리오** (`/e2e-write` 입력):
  - "녹화 모드에서 리스트 아이템을 드래그해 다른 위치에 놓으면 액션 로그에 드래그 항목이 1개 생기고 클릭 항목은 생기지 않는다."
  - "임계값 미만으로 누르고 떼면(드래그 아님) 액션 로그에 클릭 항목이 생긴다."
  - (테스트 픽스처에 dnd 가능한 DOM 필요 — `data-testid`로 source/target 식별. src 수정은 data-testid 추가만 허용.)
- **수동 테스트** (자동화 불가): Task 7 — `elementFromPoint` 기반 target 식별 정확도, 드래그 고스트 회피, 실제 라이브러리 dnd 동작은 합성 이벤트로 재현이 불안정하므로 실제 탭 확인.

## 구현 순서 권장

- Task 1 → 2 (순수 헬퍼·타입, 병렬 가능) → Task 3 (캡처, Task 1 타입 의존) → Task 4·5 (렌더·직렬화, 병렬 가능, Task 1 타입 의존) → Task 6 (i18n, Task 4·5의 키 사용) → Task 7 (수동, 전부 후).
- typecheck는 Task 4·5·6 완료 전까지 `satisfies never` 미충족으로 실패가 정상 — 모든 kind 분기를 채운 뒤 green.

## 가이드 영향

**있음** — 사용자 노출(액션 로그에 새 동작 종류). 구현 후 `/guide`로 처리, `guide/AUTHORING.md` 규칙대로:

- `guide/ko/video/issue.md`·`guide/en/video/issue.md` — "ln(액션)가 잡는 동작 종류" 설명에 **드래그 앤 드롭** 추가(영문 식별자 대신 "요소를 끌어다 놓는 드래그" 풀어쓰기).
- `guide/ko/logs/viewer.md`·`guide/en/logs/viewer.md` — 액션 마커 종류에 드래그 추가.
- `guide/AUTHORING.md` — "ln가 잡는 동작 종류(`ActionEntryKind`)" 라인에 drag 추가(사실 스냅샷 동기화).
