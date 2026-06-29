# 드래그 액션 기록 — 기술 설계

## 개요

액션 레코더(MAIN world, `action-recorder.ts`)에 두 캡처 경로를 추가한다: (1) `pointerdown/move/up` 휴리스틱(이동 거리 임계 + 가드), (2) 네이티브 `dragstart/drop/dragend`. 둘 다 동일한 `drag` 엔트리(source·target 두 endpoint)로 정규화한다. `ActionEntryKind`에 `"drag"`를 추가하고, endpoint를 담을 `ActionNode`(접근성 이름·역할·selector·tag) 구조를 신설한다. 이후 type→render→summary→marker→i18n→JSON export의 모든 `kind` 분기에 drag 케이스를 더한다. 데이터 전송(bridge)·머지·스토어는 `kind`를 검사하지 않는 제네릭이라 무변경.

## 변경 범위

### 캡처 (MAIN world)

- **`src/content/action-recorder.ts`** — 현재 click/input/keypress/toggle/select/navigation 후킹.
  - `Kind` 리터럴 유니온에 `"drag"` 추가.
  - `CapturedAction`에 `dragSource?`/`dragTarget?` 필드 추가(아래 인터페이스).
  - `describeNode(el): ActionNode` 헬퍼 추출 — 기존 `recordClick`의 인라인 로직(accessibleName→truncateName, implicitRole, buildLightSelector, tagName, tagType)을 재사용해 endpoint 1개를 기술.
  - **포인터 휴리스틱**: `pointerdown`/`pointermove`/`pointerup`/`pointercancel` 리스너(capture phase) 추가. 모듈 상태 `dragCandidate`/`dragging`/`suppressNextClick`.
  - **네이티브 DnD**: `dragstart`/`drop`/`dragend` 리스너(capture phase) 추가. 모듈 상태 `pendingNativeDrag`.
  - `recordDrag(source, target)` — `pushAction({ kind: "drag", dragSource, dragTarget, ... })`.
  - **기존 click 리스너 수정(회귀 지점)**: 핸들러 진입부에 `if (suppressNextClick) { suppressNextClick = false; return; }` 가드 추가.
- **`src/content/action-recorder-helpers.ts`** — 순수 헬퍼 추가:
  - `exceedsDragThreshold(x0, y0, x1, y1, threshold): boolean` — 제곱 거리 비교(`dx*dx+dy*dy > t*t`).
  - 상수 `DRAG_THRESHOLD_PX = 10` export.

### 타입

- **`src/types/action.ts`** — 정본 타입.
  - `ActionEntryKind`에 `| "drag"` 추가.
  - `ActionNode` 인터페이스 신설.
  - `ActionEntry`에 `dragSource?: ActionNode`/`dragTarget?: ActionNode` 추가.

### 렌더 — 사이드패널

- **`src/sidepanel/components/ActionLogContent.tsx`** — 4개 분기:
  - `ACTION_FILTERS` 배열에 `"drag"` 추가, `filterLabel`에 `t("actionLog.filter.drag")`.
  - `KindIcon` switch에 `case "drag"`(lucide `Move` 또는 `GripVertical`).
  - `renderActionContent` switch에 `case "drag"` — `renderVerb(t("actionLog.verb.drag"), { source: <NodeTarget node={entry.dragSource} />, target: <NodeTarget node={entry.dragTarget} /> })`.
  - (선택) `kindColor`/`kindBgColor` 중립 유지 — 특별 색 불필요.
- **`src/sidepanel/lib/actionInline.ts`** — `resolveActionNode(node: ActionNode): ClickTargetView` 추가(기존 `resolveClickTarget`의 로직을 `.name` 기준으로 미러). 중복 제거를 위해 `resolveClickTarget`을 `resolveActionNode({ name: entry.target, ... })`로 위임시키는 외과적 리팩터 권장.

### 렌더 — 로그 뷰어

- **`src/log-viewer/markers.ts`** — `switch (e.kind)`에 `case "drag"` — `t("actionLog.verb.drag", { source, target })`로 마커 라벨(source/target은 `node.name ?? node.selector ?? ""`).

### 직렬화

- **`src/sidepanel/lib/buildLogSummary.ts`** — `buildActionLogSummary`에 drag 분기: `Dragged ${srcName} to ${tgtName}`(name = `node.name ?? node.selector ?? "element"`). AI 재현 단계 입력.
- **`src/sidepanel/lib/buildActionLogJson.ts`** — 필드별 직렬화이므로 `...(e.dragSource ? { dragSource: e.dragSource } : {})`, `...(e.dragTarget ? { dragTarget: e.dragTarget } : {})` 추가. (제네릭 아님 — 명시 추가 필요.)

### i18n (양쪽 파일, ko·en 동시)

- **`src/i18n/namespaces/logs.ts`** — `actionLog.filter.drag`, `actionLog.verb.drag` 추가(ko·en).
- **`src/log-viewer/i18n.ts`** — 동일 키 추가(ko·en). log-viewer는 별도 i18n 사본.

  | 키 | ko | en |
  |---|---|---|
  | `actionLog.filter.drag` | `드래그` | `Drag` |
  | `actionLog.verb.drag` | `{source}을(를) {target}(으)로 드래그` | `Dragged {source} to {target}` |

  > josa `을(를)`/`(으)로`는 slot(칩) 뒤에 붙는다 — 기존 `actionLog.verb.navigate`(`{target}(으)로 이동`)와 동일 패턴이라 정합.

### 무변경 (제네릭 통과 확인)

- `src/content/recorder-bridge.ts`, `recorders-entry.ts` — entries 그대로 forward.
- `src/sidepanel/hooks/usePickerMessages.ts` — `actionRecorder.data` 머지 제네릭.
- `src/sidepanel/lib/log-merge.ts` — `mergeLogItems`/`rebuildActionLog` 제네릭.

## 데이터 흐름

```
[MAIN world] action-recorder.ts
  pointer 경로: pointerdown→(move>10px)→pointerup
                 → elementFromPoint(target) → recordDrag(source,target)
                 → suppressNextClick=true (다음 click 1회 스킵)
  native 경로:  dragstart(source 보류)→drop(target)→recordDrag
                 dragend(drop 없음)→보류 폐기
        │ pushAction({kind:"drag", dragSource, dragTarget})
        ▼ CustomEvent __bugshot_action_data__<sentinel>
[ISOLATED] recorder-bridge.ts ──postToRuntime──▶ runtime
[sidepanel] usePickerMessages → mergeLogItems → editor-store.actionLog
        ├─▶ ActionLogContent (필터·아이콘·문구)
        ├─▶ markers.ts (로그 뷰어 타임라인 마커)
        ├─▶ buildActionLogSummary → buildAiDraftPrompt (AI 재현 단계)
        └─▶ buildActionLogJson (JSON export)
```

## 인터페이스 설계

```typescript
// src/types/action.ts
export type ActionEntryKind =
  | "click" | "navigation" | "input" | "keypress" | "toggle" | "select"
  | "drag"; // dragSource→dragTarget

// 드래그 endpoint 1개. click 캡처가 모으는 요소 식별 정보와 동일 범주.
export interface ActionNode {
  name?: string;     // 접근성 이름 (truncateName 적용)
  role?: string;     // implicitRole
  selector?: string; // buildLightSelector
  tagName?: string;
  tagType?: string;
}

export interface ActionEntry {
  // ...기존 필드...
  dragSource?: ActionNode; // drag 전용
  dragTarget?: ActionNode; // drag 전용
}
```

```typescript
// src/content/action-recorder-helpers.ts
export const DRAG_THRESHOLD_PX = 10;
export function exceedsDragThreshold(
  x0: number, y0: number, x1: number, y1: number, threshold: number,
): boolean;
```

```typescript
// src/sidepanel/lib/actionInline.ts
export function resolveActionNode(node: ActionNode): ClickTargetView;
```

```typescript
// action-recorder.ts 내부 (MAIN world, IIFE 스코프)
interface DragCandidate { el: Element; x: number; y: number; pointerId: number; }
let dragCandidate: DragCandidate | null;
let dragging: boolean;
let suppressNextClick: boolean;
let pendingNativeDrag: ActionNode | null;
function describeNode(el: Element): ActionNode;
function recordDrag(source: ActionNode, target: ActionNode): void;
```

### 포인터 휴리스틱 상태 기계

- `pointerdown`(capture): `suppressNextClick = false`(리셋); `e.isPrimary && e.button === 0` 아니면 return; `isOwnUi` skip; `dragCandidate = { el, x, y, pointerId }`; `dragging = false`.
- `pointermove`(capture): `dragCandidate` 없거나 pointerId 불일치면 return; `!dragging && exceedsDragThreshold(...)` → `dragging = true`.
- `pointerup`(capture): pointerId 일치 시 — `dragging`이면 `targetEl = document.elementFromPoint(e.clientX, e.clientY)`; **가드 통과 시에만** `recordDrag` + `suppressNextClick = true`. 후보 클리어.
  - 가드: `targetEl` 존재 && `!isOwnUi(targetEl)` && `targetEl !== dragCandidate.el` && `getSelection()?.isCollapsed !== false`(텍스트 선택 제외).
- `pointercancel`(capture): 후보 클리어.

### 네이티브 DnD 상태 기계

- `dragstart`(capture): `isOwnUi` skip; `pendingNativeDrag = describeNode(e.target)`.
- `drop`(capture): `pendingNativeDrag` 있고 `!isOwnUi(e.target)`면 `recordDrag(pendingNativeDrag, describeNode(e.target))`; 클리어.
- `dragend`(capture): `pendingNativeDrag` 남아 있으면(드롭 없음) 폐기 클리어.

## 기존 패턴 준수

- **pre-arm 자가완결 청크 제약**: 새 코드는 `action-recorder.ts`(이미 IIFE)와 `action-recorder-helpers.ts`(로컬 relative import, 인라인 번들됨)에만 추가 — 외부 static import 0 유지. async loader 유입 금지(pre-arm 무력화 회귀 주의).
- **`satisfies never` 망라**: `kind` switch의 `default` 분기가 `satisfies never`라, `"drag"` 추가 시 ActionLogContent·markers의 모든 switch에 케이스를 더하지 않으면 typecheck 실패 — 누락 자동 검출됨(설계상 안전망).
- **i18n 동시 갱신**: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`(ko/en 키 대칭·placeholder 토큰 일치)를 자동 실행. `{source}`/`{target}` 토큰이 ko·en 양쪽에 동일하게 있어야 통과.
- **녹화 모드 전용**: 액션 레코더는 `video-capture.ts`에서 video 모드에만 activate — drag도 그 활성 조건을 그대로 상속(별도 게이트 불필요).
- **테스트 우선**: `exceedsDragThreshold`·`resolveActionNode`를 먼저 `__tests__`에 작성 후 구현.

## 대안 검토

1. **drag를 새 kind가 아닌 click의 변형(플래그)으로 기록** — ripple은 줄지만, source·target 2개 endpoint를 click의 단일 target 스키마에 욱여넣어야 하고 필터·아이콘·문구가 click과 섞여 UX가 모호해진다. 새 `drag` kind가 `satisfies never` 안전망과도 맞물려 더 명확. → 기각.
2. **rrweb식 포인터 좌표 스트림 + 리플레이**(Jam 방식) — 드래그를 시각 재생으로 보여줄 수 있으나, 좌표 스트림 직렬화·리플레이 뷰어가 필요한 대형 작업이고 BugShot은 이미 30s Replay(video)로 "보여주기"를 커버한다. 의미 단위 step 1건이 비용 대비 효과가 크다. → 기각.
3. **포인터 휴리스틱만(네이티브 DnD 제외)** — `draggable=true` 네이티브 드래그는 브라우저가 pointermove를 억제해 놓친다. 두 경로 비용 차가 작아(리스너 3개) 둘 다 채택. → 기각.
4. **이동 거리·방향(dx/dy) 포함** — 재현에 필수 정보 아님(어디서→어디로가 핵심). 최소 설계 원칙상 제외. → 기각.

## 위험 요소

- **suppressNextClick 누수**: drag 후 click이 발화되지 않는 케이스(일부 라이브러리)에서 플래그가 다음 진짜 click을 잘못 삼킬 수 있음 → `pointerdown` 진입부에서 무조건 리셋해 1 제스처 범위로 한정. 회귀 테스트(임계 미달 click은 정상 기록) 필수.
- **`elementFromPoint`가 드래그 고스트/오버레이를 맞힘**: dnd 라이브러리가 포인터 아래 드래그 프리뷰 노드를 띄우면 target이 실제 드롭존이 아닌 고스트가 될 수 있음. 1차 구현은 `elementFromPoint` 단순 사용 + `target !== source` 가드. 실제 탭(dnd-kit·react-beautiful-dnd)에서 target 식별 정확도를 수동 검증하고, 고스트가 잡히면 `pointer-events:none`이 아닌 오버레이 회피 로직(예: 일시적으로 후보 고스트 hidden 후 재측정)을 후속 고려 — 1차 스코프 밖.
- **텍스트 선택 오탐**: `getSelection().isCollapsed` 가드로 1차 차단. 단 selection API가 비표준 위젯에서 비어 있을 수 있어 100%는 아님 — `target !== source` 가드와 병행.
- **capture phase 리스너 추가로 인한 성능**: pointermove는 고빈도. 핸들러는 후보 없으면 즉시 return, 있으면 거리 비교 1회만 — throttle 불요(상태 비교만). 단 `dragging`이 이미 true면 추가 계산 없이 return.
- **privacy.md 영향**: drag는 기존 click 캡처와 **동일 데이터 범주**(요소 접근성 이름·selector)이고 **동일 sink**(액션 로그)라 새 수집·전송 동작 아님 → privacy.md 갱신 불요로 판단. `/push` privacy 게이트에서 재확인.
- **iframe**: 액션 레코더는 `all_frames` 주입이라 iframe 내부 드래그도 잡지만, `elementFromPoint`는 각 프레임 document 기준이라 cross-frame 드래그(프레임 경계 넘는 드롭)는 target이 프레임 내부로만 해석됨 — 기존 액션 origin 처리와 동일 한계, 신규 회귀 아님.
