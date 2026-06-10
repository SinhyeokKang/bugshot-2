# 스타일 변경사항 확인 다이얼로그 — 기술 설계

## 개요

기존 데이터(현재 선택의 `styleEdits` + `bufferedElements[]`)를 그대로 읽어 요소별 diff 그룹을 만드는 순수 헬퍼를 추가하고, 그 위에 shadcn Dialog 기반 목록 UI를 얹는다. 개별 초기화의 DOM 반영은 현재 선택 요소는 기존 `applyStyles`/`applyClasses`/`applyText` 경로를 재사용하고, 버퍼 요소는 content script에 selector 기반 부분 원복 메시지(`picker.applyEditsBySelector`)와 selector 기반 캡처 준비 메시지(`picker.prepareCaptureBySelector`)를 신설해 처리한다. 전체 초기화는 기존 `resetAllStyleEdits` + `picker.resetAllEdits`를 그대로 쓴다.

## 변경 범위

### `src/sidepanel/lib/styleChangeGroups.ts` (신규)
다이얼로그·badge가 공유하는 순수 로직. UI 없이 테스트 가능.
- `buildChangeGroups(selection, styleEdits, bufferedElements)` — 버퍼 항목(선택 순서)을 앞에, 현재 선택을 마지막에 둔 그룹 배열. 그룹별 rows는 `buildStyleDiff` 결과. rows가 빈 그룹(diff 없는 현재 선택)은 제외.
- `countChangeRows(groups)` — badge N. 모든 그룹 rows 합.
- `removeDiffRow(snapshot, edits, prop)` — diff 행 1개를 제거한 새 `EditorStyleEdits` 계산. `"text"` → text 원복, `"class"` → classList 원복, shorthand 행(`padding`/`margin`/`border-radius`) → 해당 키 + longhand 4종 모두 inlineStyle에서 삭제, 그 외 → 해당 키 삭제.

### `src/sidepanel/lib/__tests__/styleChangeGroups.test.ts` (신규)
위 3개 함수 단위 테스트.

### `src/sidepanel/components/StyleChangesTable.tsx`
- 변경: 모듈 내부 상수 `SHORTHAND_GROUPS`를 `export`로 공개 (removeDiffRow가 collapse 역매핑에 사용). 그 외 변경 없음.

### `src/types/picker.ts`
- `PickerMessage`에 2개 메시지 추가:
  - `{ type: "picker.applyEditsBySelector"; selector: string; classList: string[]; inlineStyle: Record<string, string>; text: string | null }`
  - `{ type: "picker.prepareCaptureBySelector"; selector: string }`

### `src/content/picker.ts`
- `handleApplyEditsBySelector(msg)`: `document.querySelector(selector)` → `editedEls.get(el)`의 원본 상태로 `restoreElState` 후 전달받은 edits 재적용(class는 원본과 다를 때만 `className` 설정, inline은 원본 style 위에 `setProperty`, text는 `text !== null`이고 원본과 다를 때만 `writeEditableText`). 적용 후 `isElementClean`이면 `editedEls`에서 제거. `inspectorCache.delete(el)` + `render()`. 요소 미발견·미편집이면 no-op. 응답 `{ found: boolean }`.
- `handlePrepareCaptureBySelector(selector, sendResponse)`: overlay 숨김 → `querySelector` → rect가 뷰포트를 벗어나면(`top<0 || left<0 || bottom>innerHeight || right>innerWidth`) 현재 스크롤 위치를 모듈 변수에 저장하고 `scrollIntoView({ block: "center", inline: "center", behavior: "instant" })` → double rAF 대기 후 rect 재측정해 비동기 `sendResponse` (리스너에서 `return true`). 요소 미발견이면 `{ rect: null, viewport }`.
- `handleEndCapture()`: 저장된 스크롤 위치가 있으면 `window.scrollTo`로 복원 후 클리어. overlay 복구는 기존 그대로.

### `src/sidepanel/picker-control.ts`
- `applyEditsBySelector(tabId, selector, edits): Promise<boolean>` — 메시지 송신, `found` 반환(실패 시 false).
- `prepareCaptureBySelector(tabId, selector): Promise<PrepareCaptureResponse | null>`.

### `src/sidepanel/capture.ts`
- `captureElementSnapshotBySelector(tabId, selector, options?)` — `captureElementSnapshot`과 동일 파이프라인이되 `prepareCaptureBySelector` 사용. rect null·캡처 실패 시 null (기존과 동일하게 `endCapture`를 finally에서 호출 — 스크롤 복원이 여기서 일어남).

### `src/store/editor-store.ts`
- 액션 2개 추가:
  - `patchBufferedElement(selector, patch: Partial<Pick<BufferedElement, "styleEdits" | "afterImage">>)` — selector 일치 항목 갱신.
  - `removeBufferedElement(selector)` — 항목 제거(이미지 폐기).
- `bufferedElements`는 이미 `EditorSnapshot`에 포함 → `useEditorSessionSync`의 기존 구독 경로로 영속화 자동 처리. 추가 작업 없음.

### `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx` (신규)
트리거 버튼 + Dialog를 묶은 컴포넌트 (AiStylingDialog와 같은 디렉터리, DomTreeTitle처럼 내부 `useState` open 관리).
- 트리거: `<Button variant="outline" disabled={count === 0}>{t("editor.confirmChanges")}{count > 0 && <Badge variant="secondary">{count}</Badge>}</Button>`
- 본문: `buildChangeGroups` 결과를 그룹별로 렌더. 그룹 헤더는 `formatElementName` (`src/lib/element-label.ts`) 라벨 + 현재 선택 그룹엔 구분 표기. 행: `prop` / as-is → to-be / 우측 초기화 IconButton(`RotateCcw`, `h-8 w-8`). 값 표기는 StyleChangesTable의 unset 표기(`styleTable.unset`) 관례를 따른다.
- 푸터: `<DialogFooter className="sm:justify-between">` — 좌측 `<Button variant="destructive">{t("editor.changesDialog.resetAll")}</Button>`(AlertDialog 트리거), 우측 `<Button>{t("common.ok")}</Button>`(닫기).
- 개별 초기화 중복 실행 방지: `useBufferThenSwitch` 패턴의 busy ref.

### `src/sidepanel/tabs/StyleEditorPanel.tsx`
- 기존 AlertDialog 블록(448-476행) 제거 → `<StyleChangesDialog />`로 교체.
- `changeCount`/`totalChangeCount` 인라인 계산 제거 → `countChangeRows(buildChangeGroups(...))`로 대체 (StyleChangesDialog 내부로 이동 가능). `canProceed`(=`hasChange || bufferedElements.length > 0`)는 [다음] 버튼용으로 유지.

### `src/i18n/namespaces/editor.ts`
- ko/en 동시 추가: `editor.confirmChanges`("변경사항 확인"/"Review changes"), `editor.changesDialog.title`, `editor.changesDialog.current`("현재 선택"/"Selected"), `editor.changesDialog.resetRow`("이 변경 초기화"/"Reset this change"), `editor.changesDialog.resetAll`("전체 초기화"/"Reset all").
- 기존 `editor.resetChanges`·`editor.resetChanges.body`는 전체 초기화 AlertDialog에 재사용. `common.ok`("확인"/"OK") 기존 키 사용.

## 데이터 흐름

### 개별 초기화 — 현재 선택 요소
```
행 초기화 클릭
→ next = removeDiffRow(selection, styleEdits, row.prop)
→ setStyleEdits(next)                          # 패널 인풋 자동 갱신 (아래 "기존 패턴 준수")
→ row.prop === "class" ? applyClasses(tabId, next.classList)
  : row.prop === "text" ? applyText(tabId, next.text)
  : applyStyles(tabId, next.inlineStyle)        # DOM 원복 (applyStyles는 원본 style attr 기준 재적용)
```

### 개별 초기화 — 버퍼 요소
```
행 초기화 클릭
→ next = removeDiffRow(b.selectionSnapshot, b.styleEdits, row.prop)
→ applyEditsBySelector(tabId, selector, next)   # DOM: 원본 원복 후 잔여 edits 재적용
→ remaining = buildStyleDiff(snapshot, next)
→ remaining.length === 0
   ? removeBufferedElement(selector)            # 항목 제거 (before/after 이미지 폐기)
   : patchBufferedElement(selector, { styleEdits: next })
     → img = captureElementSnapshotBySelector(tabId, selector)   # 스크롤→캡처→스크롤 복원
     → patchBufferedElement(selector, { afterImage: img })       # 실패 시 null = 폐기
→ selector === selection?.selector (중복 케이스)
   ? selectByPath(tabId, selector)              # 재선택 → picker.selected → onElementSelected
                                                # → selection·styleEdits 재베이스라인, beforeImage 재캡처
                                                # (미버퍼 현재 편집은 폐기됨 — PRD 엣지 케이스)
→ countChangeRows(...) === 0 이면 다이얼로그 닫기
```

### 전체 초기화
```
[전체 초기화] → AlertDialog 재확인 (editor.resetChanges.body, count=N)
→ resetAllStyleEdits()        # styleEdits 원복 + bufferedElements 비움, selection 유지
→ resetAllEdits(tabId)        # content script restoreAll → DOM 전체 원복 + scheduleSelectionUpdate
→ Dialog 닫기 (0건 자동 닫힘)
```

## 인터페이스 설계

```typescript
// src/sidepanel/lib/styleChangeGroups.ts
import type { StyleDiffRow, StyleDiffSelection, StyleDiffEdits } from "@/sidepanel/components/StyleChangesTable";
import type { BufferedElement, EditorSelection, EditorStyleEdits } from "@/store/editor-store";

export interface ChangeGroup {
  source: "current" | "buffered";
  selector: string;
  tagName: string;
  classList: string[];              // 그룹 라벨용 (formatElementName 입력)
  snapshot: StyleDiffSelection;     // 원복 기준
  edits: StyleDiffEdits;
  rows: StyleDiffRow[];             // buildStyleDiff(snapshot, edits)
}

export function buildChangeGroups(
  selection: EditorSelection | null,
  styleEdits: EditorStyleEdits,
  bufferedElements: BufferedElement[],
): ChangeGroup[];

export function countChangeRows(groups: ChangeGroup[]): number;

export function removeDiffRow(
  snapshot: StyleDiffSelection,
  edits: StyleDiffEdits,
  prop: string,
): EditorStyleEdits;
```

```typescript
// src/types/picker.ts (PickerMessage 추가분)
| { type: "picker.applyEditsBySelector"; selector: string; classList: string[]; inlineStyle: Record<string, string>; text: string | null }
| { type: "picker.prepareCaptureBySelector"; selector: string }
```

```typescript
// src/sidepanel/picker-control.ts
export async function applyEditsBySelector(
  tabId: number,
  selector: string,
  edits: { classList: string[]; inlineStyle: Record<string, string>; text: string | null },
): Promise<boolean>;
export async function prepareCaptureBySelector(
  tabId: number,
  selector: string,
): Promise<PrepareCaptureResponse | null>;

// src/sidepanel/capture.ts
export async function captureElementSnapshotBySelector(
  tabId: number,
  selector: string,
  options?: { margin?: number },
): Promise<string | null>;

// src/store/editor-store.ts (EditorState 추가분)
patchBufferedElement: (
  selector: string,
  patch: Partial<Pick<BufferedElement, "styleEdits" | "afterImage">>,
) => void;
removeBufferedElement: (selector: string) => void;
```

## 기존 패턴 준수

- **패널 인풋 갱신**: 모든 인풋이 store 구독 기반이라 `setStyleEdits` 경로면 자동 갱신된다 — `useStyleProp`은 store 직독, `ValueCombobox`는 `prevValue` ref로 외부 변경 시 draft 동기화(`ValueCombobox.tsx:59-63`), `ClassEditor`는 `lastCommittedRef` useEffect(`StyleEditorPanel.tsx:529-535`), `TextEditor`는 store 직독. `SectionRevertButton`이 같은 경로(`setStyleEdits` + `applyStyles`)로 이미 검증된 패턴.
- **테스트 우선**: 신규 순수 헬퍼(`styleChangeGroups.ts`)는 테스트 먼저 작성 (`/tdd interface`). 같은 디렉터리 `__tests__/*.test.ts`, Vitest.
- **i18n 동시 갱신**: ko/en 양쪽 + PostToolUse 훅의 locales 테스트 통과.
- **IconButton 사이즈**: 행 초기화 버튼 `h-8 w-8` (섹션 액션 규격).
- **shadcn 우선**: Dialog·AlertDialog·Badge·Button 모두 기존 `src/components/ui/` 컴포넌트 사용. 신규 설치 불필요.
- **세션 영속화**: `bufferedElements` 변경은 기존 `EditorSnapshot` 구독 경로로 자동 저장 — 새 영속화 코드 금지.
- **메시지 비동기 응답**: `prepareCaptureBySelector`는 scrollIntoView 후 rAF 대기가 필요해 리스너에서 `return true` + 비동기 `sendResponse` (기존 `picker.collectTokens` 패턴).

## 대안 검토

- **버퍼 요소 초기화 시 afterImage를 그대로 두거나 즉시 폐기**: 재캡처보다 단순하지만, 사용자가 "초기화 후에도 after 이미지가 실제 화면과 일치하는 것"을 best로 명시 선택. 재캡처 실패 시 폐기를 fallback으로 둬 단순안의 안전성을 흡수했다.
- **개별 초기화를 요소 단위로만 제공**: content script 메시지가 1개로 줄지만(전체 원복만), 사용자가 스타일 항목 단위 초기화를 명시 요구. 기각.
- **중복 요소(재선택된 버퍼 항목)를 목록에서 제외하거나 행 초기화 비활성화**: 구현이 단순하고 회귀 위험이 작지만 사용자가 "개별 초기화 허용 + 재선택으로 베이스라인 갱신"을 선택. 그 대가로 미버퍼 편집 폐기라는 동작이 생기며 PRD에 명시했다.
- **diff 행을 uncollapsed(longhand 개별)로 노출**: `removeDiffRow`의 shorthand 역매핑이 불필요해지지만, 기존 `buildStyleDiff`/`StyleChangesTable`의 collapse 표기와 어긋나 drafting 단계 표와 불일치. 기각.

## 위험 요소

- **badge 카운트 산식 변화**: 기존 `changeCount`는 inline 키 수(uncollapsed) 기반, 신규 N은 `buildStyleDiff` 행 수(shorthand collapse 반영). padding 4면을 모두 같은 값으로 바꾼 경우 기존 4 → 신규 1. 다이얼로그 행 수와 일치시키기 위한 의도된 변화.
- **scrollIntoView 부작용**: 캡처를 위해 페이지 스크롤이 순간 이동한다. `behavior: "instant"` 강제 + `endCapture`에서 복원하지만, 페이지 자체의 scroll listener가 부수 효과를 낼 수 있다. 스크롤 컨테이너 내부 요소(`window` 스크롤이 아닌 경우)는 `scrollIntoView`가 조상 컨테이너들을 함께 스크롤하므로 window 위치 복원만으로 완전 복원이 안 될 수 있음 — 알려진 한계로 수용(캡처 자체는 정상).
- **captureVisibleTab 호출 빈도**: 연속 개별 초기화 시 캡처가 quota(`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`)에 걸릴 수 있다. 실패 시 afterImage null 폐기로 흡수되고 기능은 깨지지 않는다. busy ref로 연타도 차단.
- **중복 요소 행 초기화 → 미버퍼 편집 폐기**: `selectByPath` 재선택이 `onElementSelected`를 타며 styleEdits를 베이스라인으로 리셋한다. 의도된 동작이나 사용자 입장에서 놀랄 수 있음 — 가이드 문서에 한 줄 언급 권장.
- **selector 불안정성**: `buildSelector` 기반 selector가 페이지 DOM 변형으로 무효해질 수 있다. `applyEditsBySelector`가 `found:false`를 반환해도 store 갱신은 진행해 UI 일관성을 지킨다(원복 불가는 기존 restoreAll도 동일하게 겪는 한계).
- **전체 초기화의 기존 quirk 유지**: 재선택된 버퍼 요소가 있는 상태의 전체 초기화에서 `selection.classList`가 편집된 베이스라인을 가리키는 기존 동작은 건드리지 않는다(외과적 범위).
