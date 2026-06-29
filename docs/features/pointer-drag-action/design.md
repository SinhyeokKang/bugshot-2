# 드래그 액션 기록 — 기술 설계 (precision-first)

## 개요

액션 레코더(MAIN world, `action-recorder.ts`)에 두 캡처 경로를 추가하되, **신뢰 가능한 신호만 자신 있게 기록**한다(precision 우선).

- **포인터 휴리스틱**(`pointerdown/move/up`, 라이브러리 dnd 커버): **source만 기록.** 드롭 지점 target은 dnd-kit·react-beautiful-dnd가 포인터 아래에 띄우는 드래그 고스트/오버레이(body-level portal·`position:fixed` 클론) 때문에 `elementFromPoint`가 실제 드롭존이 아닌 고스트를 맞혀 신뢰할 수 없다. `elementFromPoint`는 **"요소 간 이동이 있었나"를 판정하는 가드로만** 쓰고(팬·스크롤·텍스트선택 제외), 그 결과 노드를 target으로 **기록하지 않는다.**
- **네이티브 HTML5 DnD**(`dragstart`+`drop`, `draggable=true` 커버): **source + target 기록.** `drop` 이벤트의 `e.target`은 브라우저가 실제 드롭존으로 정확히 셋팅하므로 신뢰 가능.

즉 **`dragTarget`의 존재 여부가 곧 신뢰 신호**다 — 있으면 네이티브 경로의 검증된 드롭존, 없으면 포인터 경로의 source-only. 틀린 target을 자신 있게 기록해 개발자를 오도하는 것(침묵보다 나쁨)을 구조적으로 차단한다.

`ActionEntryKind`에 `"drag"`를 추가하고 endpoint를 담을 `ActionNode`를 신설한다. 이후 type→render→summary→marker→i18n→JSON export의 모든 `kind` 분기에 drag 케이스를 더한다. 데이터 전송(bridge)·머지·스토어는 `kind`를 검사하지 않는 제네릭이라 무변경.

## 변경 범위

### 캡처 (MAIN world)

- **`src/content/action-recorder.ts`** — 현재 click/input/keypress/toggle/select/navigation 후킹.
  - `Kind` 리터럴 유니온에 `"drag"` 추가.
  - `CapturedAction`에 `dragSource?`/`dragTarget?` 필드 추가.
  - `describeNode(el): ActionNode` 헬퍼 추출 — 기존 `recordClick`의 인라인 로직(accessibleName→truncateName, implicitRole, buildLightSelector, tagName, tagType)을 재사용해 endpoint 1개를 기술.
  - **포인터 휴리스틱**(source-only): `pointerdown`/`pointermove`/`pointerup`/`pointercancel` 리스너(capture phase). 모듈 상태 `dragCandidate`/`dragging`/`suppressNextClick`. `pointerup`에서 `elementFromPoint`로 끝 요소를 구해 **가드에만** 사용하고 `recordDrag(source)` (target 미부착).
  - **네이티브 DnD**(source+target): `dragstart`/`drop`/`dragend` 리스너(capture phase). 모듈 상태 `pendingNativeDrag`. `drop`에서 `recordDrag(source, target)`.
  - `recordDrag(source: ActionNode, target?: ActionNode)` — `pushAction({ kind:"drag", dragSource, dragTarget })`(target 없으면 `dragTarget` 생략).
  - **기존 click 리스너 수정(회귀 지점)**: 진입부에 `if (suppressNextClick) { suppressNextClick = false; return; }`.
- **`src/content/action-recorder-helpers.ts`** — 순수 헬퍼 추가:
  - `exceedsDragThreshold(x0, y0, x1, y1, threshold): boolean` — 제곱 거리 비교(`dx*dx+dy*dy > t*t`).
  - 상수 `DRAG_THRESHOLD_PX = 15` export(precision 우선 — 10보다 sloppy-click 경계 오탐을 더 줄임. 대가는 아주 짧은 드래그 일부 손실).

### 타입

- **`src/types/action.ts`** — 정본 타입.
  - `ActionEntryKind`에 `| "drag"`.
  - `ActionNode` 인터페이스 신설.
  - `ActionEntry`에 `dragSource?: ActionNode`(drag면 항상)/`dragTarget?: ActionNode`(**네이티브 DnD에서만**) 추가.

### 렌더 — 사이드패널

- **`src/sidepanel/components/ActionLogContent.tsx`** — 4개 분기:
  - `ACTION_FILTERS` 배열에 `"drag"`, `filterLabel`에 `t("actionLog.filter.drag")`.
  - `KindIcon` switch에 `case "drag"`(lucide `Move`).
  - `renderActionContent` switch에 `case "drag"` — **target 유무로 분기**:
    - `entry.dragTarget` 있으면 `renderVerb(t("actionLog.verb.dragTo"), { source, target })`,
    - 없으면 `renderVerb(t("actionLog.verb.drag"), { source })`.
    - source/target slot은 `resolveActionNode(node)` 기반 컴포넌트로 렌더.
- **`src/sidepanel/lib/actionInline.ts`** — `resolveActionNode(node: ActionNode): ClickTargetView` 추가(기존 `resolveClickTarget` 로직을 `.name` 기준으로 미러). 중복 제거를 위해 `resolveClickTarget`을 `resolveActionNode({ name: entry.target, ... })`로 위임시키는 외과적 리팩터 권장.

### 렌더 — 로그 뷰어

- **`src/log-viewer/markers.ts`** — `switch (e.kind)`에 `case "drag"` — `e.dragTarget` 유무로 `actionLog.verb.dragTo`/`actionLog.verb.drag` 선택(source/target은 `node.name ?? node.selector ?? ""`).

### 직렬화

- **`src/sidepanel/lib/buildLogSummary.ts`** — `buildActionLogSummary`에 drag 분기:
  - target 있으면 `Dragged ${src} to ${tgt}`, 없으면 `Dragged ${src}`(name = `node.name ?? node.selector ?? "element"`). AI 재현 단계 입력.
- **`src/sidepanel/lib/buildActionLogJson.ts`** — 필드별 직렬화. `...(e.dragSource ? { dragSource: e.dragSource } : {})`, `...(e.dragTarget ? { dragTarget: e.dragTarget } : {})` 추가(target은 조건부라 source-only 엔트리엔 키 자체가 빠짐 — 신뢰 신호가 JSON에도 그대로 반영).

### i18n (양쪽 파일, ko·en 동시)

- **`src/i18n/namespaces/logs.ts`**, **`src/log-viewer/i18n.ts`** — 동일 키 추가(log-viewer는 별도 사본).

  | 키 | ko | en |
  |---|---|---|
  | `actionLog.filter.drag` | `드래그` | `Drag` |
  | `actionLog.verb.drag` | `{source} 드래그` | `Dragged {source}` |
  | `actionLog.verb.dragTo` | `{source}을(를) {target}(으)로 드래그` | `Dragged {source} to {target}` |

  > `verb.drag`(source-only)는 포인터 경로, `verb.dragTo`(source+target)는 네이티브 DnD 경로. josa `을(를)`/`(으)로`는 slot(칩) 뒤에 붙는다 — 기존 `actionLog.verb.navigate`(`{target}(으)로 이동`)와 동일 패턴.

### 무변경 (제네릭 통과 확인)

- `src/content/recorder-bridge.ts`, `recorders-entry.ts` — entries 그대로 forward.
- `src/sidepanel/hooks/usePickerMessages.ts` — `actionRecorder.data` 머지 제네릭.
- `src/sidepanel/lib/log-merge.ts` — `mergeLogItems`/`rebuildActionLog` 제네릭.

## 데이터 흐름

```
[MAIN world] action-recorder.ts
  포인터(source-only): pointerdown→(move>15px)→pointerup
       endEl = elementFromPoint  ── 가드 전용(요소 간 이동/텍스트선택 판정) ──
       → recordDrag(source)                      // dragTarget 없음
       → suppressNextClick=true (다음 click 1회 스킵)
  네이티브(source+target): dragstart(source 보류)→drop(target)→recordDrag(source,target)
                           dragend(drop 없음)→보류 폐기
        │ pushAction({kind:"drag", dragSource, dragTarget?})
        ▼ CustomEvent __bugshot_action_data__<sentinel>
[ISOLATED] recorder-bridge.ts ──postToRuntime──▶ runtime
[sidepanel] usePickerMessages → mergeLogItems → editor-store.actionLog
        ├─▶ ActionLogContent (dragTarget 유무로 문구 분기)
        ├─▶ markers.ts (로그 뷰어 타임라인 마커)
        ├─▶ buildActionLogSummary → buildAiDraftPrompt (AI 재현 단계)
        └─▶ buildActionLogJson (dragTarget 조건부 직렬화)
```

## 인터페이스 설계

```typescript
// src/types/action.ts
export type ActionEntryKind =
  | "click" | "navigation" | "input" | "keypress" | "toggle" | "select"
  | "drag"; // dragSource(항상) + dragTarget(네이티브 DnD에서만)

export interface ActionNode {
  name?: string;     // 접근성 이름 (truncateName 적용)
  role?: string;     // implicitRole
  selector?: string; // buildLightSelector
  tagName?: string;
  tagType?: string;
}

export interface ActionEntry {
  // ...기존 필드...
  dragSource?: ActionNode; // drag면 항상
  dragTarget?: ActionNode; // 신뢰 가능한 드롭존(네이티브 DnD)일 때만. 없으면 포인터 경로 source-only.
}
```

```typescript
// src/content/action-recorder-helpers.ts
export const DRAG_THRESHOLD_PX = 15;
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
function recordDrag(source: ActionNode, target?: ActionNode): void;
```

### 포인터 휴리스틱 상태 기계 (source-only)

- `pointerdown`(capture): `suppressNextClick = false`(리셋); `e.isPrimary && e.button === 0` 아니면 return; `isOwnUi` skip; `dragCandidate = { el, x, y, pointerId }`; `dragging = false`.
- `pointermove`(capture): `dragCandidate` 없거나 pointerId 불일치면 return; `!dragging && exceedsDragThreshold(...)` → `dragging = true`.
- `pointerup`(capture): pointerId 일치 시 — `dragging`이면 `endEl = document.elementFromPoint(e.clientX, e.clientY)`; **가드 통과 시에만** `recordDrag(describeNode(dragCandidate.el))`(target 미부착) + `suppressNextClick = true`. 후보 클리어.
  - 가드(전부 충족): `endEl` 존재 && `!isOwnUi(endEl)` && `endEl !== dragCandidate.el`(요소 간 이동 — 팬·스크롤·슬라이더 같은 in-element 제스처 제외) && `getSelection()?.isCollapsed !== false`(텍스트 선택 제외).
  - `endEl`은 가드 판정에만 쓰고 **기록하지 않는다**(고스트 신뢰 불가).
- `pointercancel`(capture): 후보 클리어.

### 네이티브 DnD 상태 기계 (source+target)

- `dragstart`(capture): `isOwnUi` skip; `pendingNativeDrag = describeNode(e.target)`.
- `drop`(capture): `pendingNativeDrag` 있고 `!isOwnUi(e.target)`면 `recordDrag(pendingNativeDrag, describeNode(e.target))`; 클리어.
- `dragend`(capture): `pendingNativeDrag` 남아 있으면(드롭 없음) 폐기 클리어.

## 기존 패턴 준수

- **pre-arm 자가완결 청크 제약**: 새 코드는 `action-recorder.ts`(이미 IIFE)와 `action-recorder-helpers.ts`(로컬 relative import, 인라인 번들됨)에만 추가 — 외부 static import 0 유지(pre-arm 무력화 회귀 주의).
- **`satisfies never` 망라**: `kind` switch의 `default`가 `satisfies never`라 `"drag"` 추가 시 ActionLogContent·markers의 모든 switch에 케이스를 더하지 않으면 typecheck 실패 — 누락 자동 검출.
- **i18n 동시 갱신**: `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`(ko/en 키 대칭·placeholder 토큰 일치) 자동 실행. `{source}`/`{target}` 토큰이 ko·en 양쪽에 일치해야 통과.
- **녹화 모드 전용**: 액션 레코더는 `video-capture.ts`에서 video 모드에만 activate — drag도 그 활성 조건 상속.
- **테스트 우선**: `exceedsDragThreshold`·`resolveActionNode`를 먼저 `__tests__`에 작성 후 구현.

## 대안 검토

1. **포인터 경로도 target 기록(풀 source→target)** — 가장 갖고 싶은 "어디로"지만, dnd-kit·rbd의 드래그 고스트 때문에 `elementFromPoint`가 드롭존이 아닌 클론/portal을 맞혀 **자신 있게 틀린 target**을 기록할 위험. 합성 이벤트 e2e로는 고스트가 재현 안 돼 회귀 가드도 약함. precision 우선 원칙상 포인터 경로는 source-only. → 기각.
2. **drag를 새 kind가 아닌 click의 플래그로** — source·target을 click 단일 target 스키마에 욱여넣어야 하고 필터·아이콘·문구가 섞여 UX 모호. 새 `drag` kind가 `satisfies never` 안전망과도 정합. → 기각.
3. **rrweb식 좌표 스트림 + 리플레이**(Jam 방식) — 좌표 직렬화·리플레이 뷰어가 필요한 대형 작업. BugShot은 이미 30s Replay(video)로 "보여주기" 커버. 의미 단위 step이 비용 대비 효과 큼. → 기각.
4. **네이티브 DnD 제외(포인터만)** — `draggable=true` 드래그는 브라우저가 pointermove를 억제해 놓침. 리스너 3개 추가로 신뢰 가능한 target 경로를 확보하므로 채택. → 기각.

## 위험 요소

- **suppressNextClick 누수**: drag 후 click이 발화되지 않는 라이브러리에서 플래그가 다음 진짜 click을 삼킬 수 있음 → `pointerdown` 진입부에서 무조건 리셋해 1 제스처로 한정. "임계 미달 click은 정상 기록" 회귀 테스트 필수.
- **포인터 경로 false positive(가짜 drag 발생)**: 임계 15px + `endEl !== source` + `isCollapsed` 3중 가드로 스크롤·팬·텍스트선택은 대부분 제외. 잔여 주범은 **경계를 넘는 sloppy click**(버튼 누르고 옆 요소에서 뗌) — 한 자릿수 % 수준, 임계 15px로 완화. source-only라 가짜여도 "X를 드래그"까지만 오염(틀린 target으로 개발자를 오도하지 않음).
- **endEl이 고스트라 가드가 통과**: 라이브러리 드래그의 endEl은 고스트(=source와 다른 노드)라 `endEl !== source` 가드를 통과 → source-only drag 기록(의도대로). target은 애초에 기록 안 하므로 고스트가 결과를 오염시키지 않음.
- **capture phase pointermove 성능**: 고빈도지만 핸들러는 후보 없으면 즉시 return, 있으면 `dragging` true 후 추가 계산 없이 return. throttle 불요.
- **privacy.md 영향**: drag는 기존 click 캡처와 **동일 데이터 범주**(요소 접근성 이름·selector), **동일 sink**(액션 로그) → 새 수집·전송 동작 아님. privacy.md 갱신 불요로 판단, `/push` privacy 게이트에서 재확인.
- **iframe**: 액션 레코더는 `all_frames` 주입이라 iframe 내부 드래그도 잡지만 `elementFromPoint`는 프레임별 document 기준 — 프레임 경계 넘는 드래그는 기존 액션 origin 처리와 동일 한계(신규 회귀 아님).
