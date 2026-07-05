# Draft 텍스트 필드 수정 — 기술 설계

## 개요

저장된 draft 이슈의 텍스트 필드를 상세 다이얼로그에서 수정한다. 상세 본체(`DraftDetailDialog`)는 readOnly를 유지하되, 편집 가능한 각 필드(제목 + enabled 본문 섹션) 헤더에 [수정] 버튼을 달아 클릭 시 **단일 필드 편집 다이얼로그(`DraftEditDialog`)**를 연다. 편집 위젯은 라이브 편집기(`DraftingPanel`)의 것을 그대로 재사용한다(제목=`Input`, 문단=`TiptapEditor`, 재현 절차=`OrderedListEditor`). [저장] 시 순수 헬퍼로 계산한 patch를 `useIssuesStore.patchIssue`로 반영한다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/lib/applyDraftFieldEdit.ts`** — 순수 헬퍼. 편집 대상과 새 값을 받아 `patchIssue`에 넘길 `Partial<IssueRecord>`를 계산한다. 제목/섹션 분기, 제목 편집 시 최상위 `title`+`draft.title` 동시 갱신, `updatedAt` 갱신을 단일 출처로 캡슐화(테스트 대상).
- **`src/sidepanel/tabs/DraftEditDialog.tsx`** — 단일 필드 편집 다이얼로그. `AiDraftDialog`의 다이얼로그 껍데기(80vw·rounded-3xl·p-6, [취소]/[저장] footer)를 따르고, 대상 종류에 따라 편집 위젯을 렌더한다.
- **`src/sidepanel/components/OrderedListEditor.tsx`** — 현재 `DraftingPanel.tsx` 안의 로컬 `OrderedListEditor`를 공유 컴포넌트로 추출. `DraftingPanel`과 `DraftEditDialog` 둘 다 import.
- **`src/sidepanel/lib/__tests__/applyDraftFieldEdit.test.ts`** — 헬퍼 단위 테스트.

### 변경 파일

- **`src/sidepanel/tabs/DraftingPanel.tsx`**
  - 현재 역할: 라이브 draft 편집 패널. 로컬 `OrderedListEditor` 정의·사용, `LazyTiptapEditor` lazy import.
  - 변경: 로컬 `OrderedListEditor` 정의 제거 → 신규 `@/sidepanel/components/OrderedListEditor`에서 import(호출부 시그니처 동일, 무동작 변화). `LazyTiptapEditor`는 그대로 둠.

- **`src/sidepanel/tabs/DraftDetailDialog.tsx`**
  - 현재 역할: draft 상세를 읽기 전용으로 렌더 + 제출 흐름. `patchIssue`는 이미 import되어 있음(현재 platform 갱신용).
  - 변경:
    - `editTarget` 상태(`DraftEditTarget | null`) 추가. 값이 있으면 `DraftEditDialog`를 open.
    - 제목 `FieldSection`(현재 line 863~871)에 헤더 [수정] 버튼 추가 → `setEditTarget({ kind: "title", value: issue.draft.title })`.
    - `DraftDetailSections`에 `editableSectionIds`(또는 `onEditSection` 콜백) prop 추가. 본문 섹션 렌더 시 편집 대상 섹션 헤더에 [수정] 버튼을 달고 클릭 시 `onEditSection(sec)` 호출.
    - **빈 섹션 처리**: `DraftDetailSections`의 본문 루프에서 `if (!value.trim()) continue;`(현재 line 1129)를 편집 가능 섹션에 한해 완화 — 빈 편집 대상 섹션도 [수정] 버튼과 함께 렌더(빈 값은 `DocSectionBody`의 `common.empty` 표시).
    - `handleSaveEdit(nextValue)`: `applyDraftFieldEdit(issue, editTarget, nextValue)` → `patchIssue(issue.id, patch)` → `setEditTarget(null)`.

- **`src/i18n/namespaces/common.ts`** — `common.save` 키 추가(ko/en).
- **`src/i18n/namespaces/editor.ts`** — `draftDetail.edit`(버튼 라벨 "수정"/"Edit"), `draftDetail.editField.title`(편집 다이얼로그 제목, 예: "{label} 수정") 키 추가(ko/en).

> i18n 파일 편집 시 PostToolUse 훅이 ko/en 대칭 검사를 자동 실행 — 양쪽 동시 갱신 필수.

## 데이터 흐름

```
[DraftDetailDialog]
  editTarget: null → 사용자가 섹션/제목의 [수정] 클릭
    → setEditTarget({ kind, value, section? })
    → <DraftEditDialog open target=editTarget onSave=handleSaveEdit />
        (열릴 때 내부 value 상태를 target.value로 seed)
        사용자 편집 → [저장] → onSave(nextValue)
  handleSaveEdit(nextValue):
    patch = applyDraftFieldEdit(issue, editTarget, nextValue)
    useIssuesStore.patchIssue(issue.id, patch)   // 영속(chrome.storage)
    setEditTarget(null)
  → issues-store 갱신 → DraftDetailDialog 리렌더(새 issue prop) → 상세 즉시 반영
                     → IssueRow/검색(issue.title) 반영(제목 수정 시)
```

- 인라인 이미지: `TiptapEditor`가 DND/붙여넣기 파일을 `saveInlineImage(refId, blob)`로 blob-db에 저장하고 본문에 `inline:refId` ref를 삽입(기존 동작). 편집 값은 개행/마크다운 문자열로 `onChange`를 통해 나온다. 별도 저장 로직 불필요.
- 고아 인라인 이미지: 편집으로 제거된 이미지 blob은 제출 시 기존 `pruneOrphanInlineImages`(handleSubmit 말미)가 정리. 이번 기능은 별도 정리 없음(기존 정책 유지).

## 인터페이스 설계

```ts
// src/sidepanel/lib/applyDraftFieldEdit.ts
import type { IssueRecord } from "@/store/issues-store";
import type { IssueSection } from "@/store/settings-ui-store";

export type DraftEditTarget =
  | { kind: "title"; value: string }
  | { kind: "section"; section: IssueSection; value: string };

/**
 * 편집 결과를 patchIssue용 부분 패치로 계산.
 * - title: 최상위 title + draft.title 동시 갱신(리스트/검색 정합).
 * - section: draft.sections[id] 갱신.
 * - 항상 updatedAt 갱신.
 * 원본 issue는 변경하지 않음(불변).
 */
export function applyDraftFieldEdit(
  issue: IssueRecord,
  target: DraftEditTarget,
  nextValue: string,
): Partial<IssueRecord>;
```

```ts
// src/sidepanel/tabs/DraftEditDialog.tsx
export function DraftEditDialog({
  open,
  target,          // DraftEditTarget | null — null이면 닫힌 상태
  onOpenChange,
  onSave,          // (nextValue: string) => void
}: {
  open: boolean;
  target: DraftEditTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (nextValue: string) => void;
}): JSX.Element;
```

- 내부: `const [value, setValue] = useState("")`. `useEffect([target, open])`로 열릴 때 `target.value`로 seed.
- 렌더 분기:
  - `kind: "title"` → `<Input value onChange />`, 다이얼로그 제목 `t("section.issueTitle")` 기준.
  - `kind: "section"` & `section.renderAs === "orderedList"` → `<OrderedListEditor value onChange placeholder />`.
  - `kind: "section"` & 문단 → `<Suspense fallback={<Textarea disabled/>}><LazyTiptapEditor value onChange placeholder ariaLabel /></Suspense>`.
- footer: `[취소](common.cancel)` `[저장](common.save)`. 저장은 `onSave(value)` 후 `onOpenChange(false)`.

```ts
// src/sidepanel/components/OrderedListEditor.tsx (추출, 시그니처 불변)
export function OrderedListEditor({
  value, onChange, placeholder,
}: { value: string; onChange: (next: string) => void; placeholder: string }): JSX.Element;
```

편집 가능 섹션 판정: 상세에서 [수정] 버튼을 다는 대상은 **enabled인 본문 섹션 전체**(`description`/`stepsToReproduce`/`expectedResult`/`notes` 중 `sectionConfig`에서 enabled). 미디어/로그/스타일/첨부/env 블록은 대상 아님.

## 기존 패턴 준수

- **순수 헬퍼 + 단위 테스트 우선**(CLAUDE.md 테스트 원칙): 저장 patch 계산을 `applyDraftFieldEdit`로 분리해 테스트로 검증한 뒤 UI에 연결.
- **세션 영속화**: `patchIssue`는 이미 `persist`(chrome.storage) 대상 스토어의 액션 → 별도 저장 코드 불필요.
- **편집 위젯 재사용**: 새 에디터를 만들지 않고 `TiptapEditor`/`OrderedListEditor`/`Input`을 그대로 사용 — 마크다운/인라인 이미지/orderedList 정합을 라이브 편집기와 동일 보장.
- **i18n 동시 갱신**: ko/en 양쪽 키 추가, PostToolUse 훅 통과.
- **UI 컨벤션**: 새 스타일링 대신 shadcn `Dialog`/`Button`/`Input`/`Textarea` 재사용. [수정] 버튼은 `Button size="sm" variant="ghost"`(헤더 액션) 등 기존 Section action 패턴 참고.

## 대안 검토

- **대안 A: `DraftDetailDialog` 본체를 인라인 편집으로 전환(readOnly 해제).** 사용자가 명시적으로 "본체는 지금처럼 readOnly, 별도 다이얼로그"를 요구 → 기각. 상세/편집 관심사 분리가 유지되고, 라이브 편집 위젯을 상세 레이아웃에 직접 심을 때 생기는 스크롤·미디어 혼재 복잡도도 피함.
- **대안 B: 편집 다이얼로그를 plain `Textarea`(AiDraftDialog와 문자 그대로 동일)로.** 구현은 더 단순하나 인라인 이미지가 `![](inline:xxx)` 원문으로 노출되고 번호목록 편집 정합이 깨짐 → 사용자가 "라이브 편집기와 동일" 선택으로 기각.
- **대안 C: [수정] 버튼 1개로 제목+전체 섹션 통합 편집.** 사용자가 "섹션별 개별 편집" 선택 → 기각. 개별 편집이 요청 문구("수정 가능한 섹션에 [수정] 버튼")와 일치하고 다이얼로그 상태도 단순.

## 위험 요소

- **제목 이중 필드 동기화**: `issue.title`(리스트/검색)과 `issue.draft.title`(상세/제출)을 반드시 함께 갱신. 한쪽만 바꾸면 리스트·검색이 stale. `applyDraftFieldEdit`에 단일 출처로 고정하고 테스트로 못박는다.
- **빈 섹션 렌더 완화 회귀**: `DraftDetailSections`의 `if (!value.trim()) continue`를 편집 대상 섹션에 한해 완화할 때, 비-편집 컨텍스트(예: 향후 재사용) 렌더가 바뀌지 않도록 편집 가능 여부 조건을 명확히. 미디어/로그 블록 삽입 순서(`POST_MEDIA_SECTION_IDS` 기준)는 건드리지 않는다.
- **Tiptap lazy + Dialog 마운트**: 편집 다이얼로그가 열릴 때만 `LazyTiptapEditor` 마운트 → `Suspense` fallback 필수(라이브 편집기와 동일 처리). 닫으면 언마운트되어 인라인 blob URL revoke가 정상 동작하는지 확인(TiptapEditor 자체 cleanup 의존).
- **OrderedListEditor 추출 회귀**: 로컬→공유 컴포넌트 이동은 무동작 변화여야 함. `DraftingPanel`의 재현 절차 입력이 이동 후에도 동일 동작하는지 확인(import 경로만 변경).
- **submitted 이슈 배제**: `DraftDetailDialog`는 draft/submitted 상세 모두 열릴 수 있으므로(승격 경로), [수정] 버튼은 `issue.status === "draft"`일 때만 노출.
