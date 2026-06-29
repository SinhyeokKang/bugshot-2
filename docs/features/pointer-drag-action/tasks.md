# 드래그 액션 기록 — 구현 태스크 (precision-first)

핵심: **포인터 경로는 source만, 네이티브 DnD만 source+target.** `dragTarget` 존재 = 신뢰 가능한 드롭존 신호. 자세한 근거는 design.md.

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**. manifest 무변경(pointer/drag 이벤트는 추가 권한 불요).
- 액션 레코더는 녹화(video) 모드 전용 — 변경 없음.
- lucide-react `Move` 아이콘 사용(이미 의존성 포함, import만 추가).

## 태스크

### Task 1: 순수 헬퍼 + 타입 (테스트 우선)
- **변경 대상**: `src/types/action.ts`, `src/content/action-recorder-helpers.ts`, `src/content/__tests__/action-recorder-helpers.test.ts`
- **작업 내용**:
  - `ActionEntryKind`에 `"drag"`, `ActionNode` 인터페이스, `ActionEntry.dragSource?`(drag면 항상)/`dragTarget?`(네이티브 DnD에서만) 추가.
  - `action-recorder-helpers.ts`에 `DRAG_THRESHOLD_PX = 15`, `exceedsDragThreshold(x0,y0,x1,y1,threshold)` 추가.
  - 테스트를 **먼저**: 임계 초과/미달/경계(정확히 15px)/대각선/음수 델타.
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

### Task 3: 캡처 — 포인터(source-only) + 네이티브 DnD(source+target)
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**:
  - `Kind`에 `"drag"`, `CapturedAction`에 `dragSource?`/`dragTarget?`.
  - `describeNode(el): ActionNode` 추출(recordClick 인라인 로직 재사용).
  - `recordDrag(source, target?)` → `pushAction({ kind:"drag", dragSource, dragTarget? })`(target 없으면 키 생략).
  - **포인터 상태기계**(design.md): `pointerup`에서 `elementFromPoint`로 끝 요소를 구해 **가드(endEl≠source 등)에만** 사용하고 `recordDrag(source)`로 source-only 기록. target 미부착.
  - **네이티브 상태기계**: `drop`에서만 `recordDrag(source, target)`. 드롭 없는 `dragend`는 폐기.
  - 기존 click 리스너 진입부에 `suppressNextClick` 가드.
  - 외부 static import 추가 금지(pre-arm 청크 제약).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동, Task 7) 실제 페이지 검증

### Task 4: 사이드패널 렌더 분기 (target 유무 분기)
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**: `ACTION_FILTERS`에 `"drag"`, `filterLabel`에 drag, `KindIcon`에 `case "drag"`(`Move`), `renderActionContent`에 `case "drag"` — `entry.dragTarget` 있으면 `verb.dragTo`(source+target), 없으면 `verb.drag`(source). slot은 `resolveActionNode` 기반.
- **검증**:
  - [ ] `pnpm typecheck` — `kind satisfies never` 충족
  - [ ] (수동) 포인터 드래그 → "A 드래그", 네이티브 드래그 → "A를 B로 드래그" 노출

### Task 5: 로그 뷰어 마커 + 직렬화 (target 유무 분기)
- **변경 대상**: `src/log-viewer/markers.ts`, `src/sidepanel/lib/buildLogSummary.ts`, `src/sidepanel/lib/buildActionLogJson.ts`
- **작업 내용**:
  - `markers.ts` switch에 `case "drag"` — `e.dragTarget` 유무로 `verb.dragTo`/`verb.drag`.
  - `buildActionLogSummary` drag 분기 — target 있으면 `Dragged X to Y`, 없으면 `Dragged X`.
  - `buildActionLogJson`에 `dragSource`/`dragTarget`(조건부) 직렬화.
- **검증**:
  - [ ] `pnpm typecheck` — markers switch `satisfies never` 충족
  - [ ] `buildActionLogSummary` 단위 테스트에 drag(source-only)·drag(source+target) 두 케이스 추가 후 `pnpm test` green
  - [ ] `buildActionLogJson` 테스트(있으면)에 source-only 엔트리는 `dragTarget` 키 부재 확인

### Task 6: i18n (ko·en 동시, 양쪽 파일)
- **변경 대상**: `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts`
- **작업 내용**: `actionLog.filter.drag`, `actionLog.verb.drag`(source-only), `actionLog.verb.dragTo`(source+target)를 ko·en·양 파일에 추가(design.md 표).
- **검증**:
  - [ ] `src/i18n/` 저장 시 PostToolUse 훅 `locales.test.ts` 자동 green(키 대칭·`{source}`/`{target}` 토큰 일치)
  - [ ] log-viewer i18n 키도 ko/en 대칭

### Task 7: 수동 검증 (실제 탭)
- **변경 대상**: 없음(검증 전용)
- **작업 내용**: dev 빌드 로드 후 실제 페이지에서 확인.
- **검증**:
  - [ ] 라이브러리 dnd(dnd-kit/react-beautiful-dnd) 드래그 → `drag` 1건(**source-only**, source 정확), click 0건. target은 기록 안 됨(정상).
  - [ ] 네이티브 `draggable=true` 드래그 → `drag` 1건(**source+target**, 드롭존 정확)
  - [ ] 임계 미달 클릭 → `click` 정상(회귀 없음)
  - [ ] 텍스트 선택 드래그 → `drag` 0건
  - [ ] 드래그-팬/스크롤(캔버스·맵 등 in-element 제스처) → `drag` 0건(`endEl===source` 가드)
  - [ ] **오탐 실측**: 평소 클릭 위주로 한참 조작 → 의도치 않은 `drag` 항목이 거슬리는 빈도. 잦으면 `DRAG_THRESHOLD_PX` 상향 검토.

## 테스트 계획

- **단위 테스트**:
  - `exceedsDragThreshold` — 임계 초과/미달/경계(15px)/대각선/음수 델타.
  - `resolveActionNode` — name/tag/selector/empty 4케이스.
  - `buildActionLogSummary` — drag(source-only)→`Dragged X`, drag(source+target)→`Dragged X to Y`, name·selector 폴백.
- **e2e 시나리오** (`/e2e-write` 입력 — 단, target 정확도는 합성 이벤트로 검증 불가하니 source/발생 여부 위주):
  - "녹화 모드에서 네이티브 `draggable` 요소를 드롭존에 드래그하면 액션 로그에 드래그 항목(출발·도착 둘 다)이 1개 생기고 클릭 항목은 생기지 않는다."
  - "포인터로 요소를 임계 이상 끌어 다른 요소 위에서 떼면 액션 로그에 드래그 항목(출발만)이 1개 생긴다."
  - "임계값 미만으로 누르고 떼면 액션 로그에 클릭 항목이 생긴다."
  - (픽스처에 네이티브 `draggable`+drop 핸들러 DOM, `data-testid`로 source/target 식별. src 수정은 data-testid 추가만.)
- **수동 테스트**(자동화 불가): Task 7 — 라이브러리 dnd의 고스트 동작·target 정확도·오탐 빈도는 실제 탭에서만 신뢰 가능. precision 판단(임계 조정)은 여기서.

## 구현 순서 권장

- Task 1 → 2 (순수 헬퍼·타입, 병렬) → Task 3 (캡처, 타입 의존) → Task 4·5 (렌더·직렬화, 병렬) → Task 6 (i18n) → Task 7 (수동).
- typecheck는 Task 4·5·6 완료 전까지 `satisfies never` 미충족 실패가 정상 — 모든 kind 분기를 채운 뒤 green.

## 가이드 영향

**있음** — 사용자 노출(액션 로그에 새 동작 종류). 구현 후 `/guide`로 처리, `guide/AUTHORING.md` 규칙대로:

- `guide/ko/video/issue.md`·`guide/en/video/issue.md` — "ln(액션)가 잡는 동작 종류"에 **드래그 앤 드롭** 추가("요소를 끌어다 놓는 드래그"). 포인터 드래그는 **출발 요소 위주**로 남고 네이티브 드래그는 출발·도착이 남는다는 차이는 가이드에 노출하지 않음(내부 구현 디테일 — 사용자에겐 "드래그를 기록한다"로 충분).
- `guide/ko/logs/viewer.md`·`guide/en/logs/viewer.md` — 액션 마커 종류에 드래그 추가.
- `guide/AUTHORING.md` — "ln가 잡는 동작 종류(`ActionEntryKind`)" 라인에 drag 추가(사실 스냅샷 동기화).
