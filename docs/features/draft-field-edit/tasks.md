# Draft 텍스트 필드 수정 — 구현 태스크

## 선행 조건

- 신규 권한·env·의존성 없음. 기존 `patchIssue`(issues-store)·`TiptapEditor`·`OrderedListEditor`만 재사용.
- `DraftDetailDialog`는 draft/submitted 이슈 모두에 열림(`IssueListTab`의 `activeDraft`가 status 무관). [수정] 버튼은 `issue.status === "draft"`에서만 노출해야 함.

## 태스크

### Task 1: `applyDraftFieldEdit` 순수 헬퍼 + 테스트 (TDD)

- **변경 대상**: `src/sidepanel/lib/applyDraftFieldEdit.ts` (신규), `src/sidepanel/lib/__tests__/applyDraftFieldEdit.test.ts` (신규)
- **작업 내용**:
  - `DraftEditTarget` 타입과 `applyDraftFieldEdit(issue, target, nextValue): Partial<IssueRecord>` 구현.
  - `kind: "title"` → `{ title: nextValue, draft: { ...issue.draft, title: nextValue }, updatedAt: <now> }`.
  - `kind: "section"` → `{ draft: { ...issue.draft, sections: { ...issue.draft.sections, [target.section.id]: nextValue } }, updatedAt: <now> }`.
  - 원본 `issue` 불변 유지.
- **검증**:
  - [ ] 테스트를 먼저 작성해 red 확인 후 구현으로 green(`/tdd interface` 경로 권장).
  - [ ] 제목 편집: 반환 patch의 `title`과 `draft.title`이 모두 새 값. 나머지 `draft.sections`는 보존.
  - [ ] 섹션 편집: `draft.sections[id]`만 새 값, 다른 섹션·`draft.title`·최상위 `title` 보존.
  - [ ] 두 경로 모두 `updatedAt`이 입력 issue보다 갱신(또는 주입한 now 값과 일치).
  - [ ] 원본 `issue` 객체가 변형되지 않음(불변).
  - [ ] `pnpm test` 통과.

> `updatedAt`은 테스트 결정성을 위해 `Date.now()` 직접 호출보다 인자 주입 또는 호출부에서 세팅을 고려. (예: 헬퍼는 `updatedAt`을 세팅하고 테스트는 `>= before` 검증, 또는 now를 인자로 받는다.)

### Task 2: `OrderedListEditor` 공유 컴포넌트 추출

- **변경 대상**: `src/sidepanel/components/OrderedListEditor.tsx` (신규), `src/sidepanel/tabs/DraftingPanel.tsx` (수정)
- **작업 내용**:
  - `DraftingPanel.tsx`의 로컬 `OrderedListEditor` 함수를 그대로 신규 파일로 이동, `export`.
  - `DraftingPanel.tsx`는 로컬 정의 제거 후 `import { OrderedListEditor } from "@/sidepanel/components/OrderedListEditor"`. 호출부·시그니처 불변.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] `DraftingPanel`의 재현 절차 입력 동작 무변화(수동: 라이브 draft 편집에서 번호목록 추가/삭제/포커스 이동 정상).

### Task 3: `DraftEditDialog` 편집 다이얼로그

- **변경 대상**: `src/sidepanel/tabs/DraftEditDialog.tsx` (신규)
- **작업 내용**:
  - `AiDraftDialog` 다이얼로그 껍데기(80vw·rounded-3xl·p-6, [취소]/[저장] footer)를 따르는 컴포넌트.
  - props: `open`, `target: DraftEditTarget | null`, `onOpenChange`, `onSave(nextValue)`.
  - 내부 `value` 상태를 열릴 때 `target.value`로 seed(`useEffect([target, open])`).
  - 렌더 분기: title→`Input` / orderedList 섹션→`OrderedListEditor` / 문단 섹션→`Suspense` + `LazyTiptapEditor`(`lazy(() => import("../components/TiptapEditor"))`).
  - 다이얼로그 제목: title이면 `t("section.issueTitle")`, 섹션이면 섹션 라벨(`section.labelOverride?.trim() || t(sectionLabelKey(id))`). `t("draftDetail.editField.title", { label })` 사용.
  - [저장]: `onSave(value)` 후 `onOpenChange(false)`.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] 문단 섹션에서 Tiptap 마운트 시 `Suspense` fallback 정상, DND/붙여넣기 이미지 삽입 동작(수동, Chrome).

### Task 4: `DraftDetailDialog` [수정] 버튼 + 편집 연결

- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx` (수정)
- **작업 내용**:
  - `editTarget` 상태 추가, `<DraftEditDialog>` 마운트, `handleSaveEdit`에서 `applyDraftFieldEdit`→`patchIssue`→`setEditTarget(null)`.
  - 제목 `FieldSection` 헤더에 [수정] 버튼(`t("draftDetail.edit")`) — `issue.status === "draft"`일 때만.
  - `DraftDetailSections`에 편집 콜백/편집가능 판정 전달. enabled 본문 섹션 헤더에 [수정] 버튼(draft 한정). 클릭 시 `setEditTarget({ kind: "section", section: sec, value: issue.draft.sections[sec.id] ?? "" })`.
  - 빈 편집 대상 섹션도 렌더(현재 `if (!value.trim()) continue` 완화) → 빈 값은 `DocSectionBody` `common.empty` 표시. 미디어/로그 블록 삽입 로직(`POST_MEDIA_SECTION_IDS`)은 불변.
  - 미디어/로그/스타일/첨부/env 섹션에는 [수정] 버튼 없음.
- **검증**:
  - [ ] draft 상세에서 제목·발생현상·재현절차·기대결과·비고에 [수정] 노출, 나머지엔 없음.
  - [ ] submitted 이슈 상세에는 [수정] 버튼이 안 뜸.
  - [ ] 각 필드 수정→저장 시 상세 즉시 반영.
  - [ ] `pnpm typecheck`·`pnpm test` 통과.

### Task 5: i18n 키 추가

- **변경 대상**: `src/i18n/namespaces/common.ts`, `src/i18n/namespaces/editor.ts`
- **작업 내용**:
  - `common.save`: "저장" / "Save".
  - `draftDetail.edit`: "수정" / "Edit".
  - `draftDetail.editField.title`: "{label} 수정" / "Edit {label}".
- **검증**:
  - [ ] ko/en 양쪽 추가, PostToolUse locales 대칭 훅 통과.
  - [ ] placeholder 토큰(`{label}`) ko/en 일치.

## 테스트 계획

- **단위 테스트**: `applyDraftFieldEdit` — (a) title 편집이 title+draft.title 동시 갱신·타 섹션 보존, (b) section 편집이 해당 섹션만 갱신·title 보존, (c) updatedAt 갱신, (d) 원본 불변. (Task 1)
- **e2e 시나리오** (`/e2e-write` 입력):
  - draft 상세를 열고 "발생 현상" 섹션 [수정]을 누르면 편집 다이얼로그가 열린다.
  - 편집 다이얼로그에서 텍스트를 바꾸고 [저장]하면 상세의 해당 섹션이 새 텍스트를 표시한다.
  - 제목 [수정]으로 제목을 바꿔 저장하면 상세 제목과 리스트 행 제목이 새 제목을 표시한다.
  - submitted 이슈 상세에는 [수정] 버튼이 없다.
  - (data-testid 필요: 각 [수정] 버튼 `edit-field-<id>`/`edit-title`, 편집 다이얼로그 `draft-edit-dialog`, 저장 버튼 `draft-edit-save`.)
- **수동 테스트** (Chrome):
  - Tiptap 문단 섹션 편집 다이얼로그에서 이미지 파일 DND/붙여넣기 삽입 → 저장 → 상세에 이미지 렌더.
  - 인라인 이미지가 이미 있는 섹션 편집 시 기존 이미지 보존.
  - 재현 절차(orderedList) 항목 추가/삭제/저장 정합.

## 구현 순서 권장

1. **Task 1**(헬퍼+테스트, TDD red→green) — 저장 로직 확정, 나머지의 기반.
2. **Task 2**(OrderedListEditor 추출) — Task 3의 의존.
3. **Task 5**(i18n) — Task 3·4에서 키 사용하므로 먼저 또는 병행.
4. **Task 3**(DraftEditDialog) — Task 2·5 이후.
5. **Task 4**(DraftDetailDialog 연결) — 전부 이후, 최종 통합.

- Task 1과 Task 2/5는 상호 독립 → 병렬 가능.

## 가이드 영향

사용자 노출 UX 추가(draft 상세에서 텍스트 필드 수정). 구현 후 `/guide`로 대조·갱신:
- draft 이슈 관리/검토를 다루는 페이지가 있으면 "저장된 draft의 제목·본문 섹션을 [수정] 버튼으로 편집" 흐름 추가(ko·en). 정확한 페이지는 `guide/AUTHORING.md` IA와 기존 draft 관련 문서를 확인해 결정.
- 대상 페이지 후보가 없으면 draft/이슈 관리 가이드 신설 여부를 `/guide`에서 판단.
