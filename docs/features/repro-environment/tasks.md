# 재현 환경 섹션 + drafting 패널 어코디언 — 구현 태스크

## 선행 조건

- 새 권한·의존성·env 불필요.
- `Section` 컴포넌트(`src/sidepanel/components/Section.tsx`)에 `collapsible`/`defaultOpen` prop이 이미 존재함을 확인 (StyleEditorPanel 사용 중).
- 이슈 본문 빌드 함수 5종(`buildIssueMarkdown`/`buildIssueAdf`/`buildGithubIssueBody`/`buildLinearIssueBody`/`buildNotionIssueBody`)에 각각 테스트 파일이 `src/sidepanel/lib/__tests__/`에 존재함을 확인.

## 태스크

### Task 1: 공용 타입 + 정제 헬퍼 + 단위 테스트
- **변경 대상**: `src/types/environment.ts` (신규), `src/sidepanel/lib/environmentRows.ts` (신규), `src/sidepanel/lib/__tests__/environmentRows.test.ts` (신규)
- **작업 내용**:
  - `EnvironmentRow { label: string; value: string }` export.
  - `filterEnvironmentRows(rows)`: `label.trim()`·`value.trim()` 둘 다 비어있지 않은 row만 반환.
  - 테스트: 정상 row 유지 / label만 빈 row 제외 / value만 빈 row 제외 / 공백-only 제외 / 빈 배열 → 빈 배열.
- **검증**:
  - [ ] `pnpm test` — `environmentRows.test.ts` 통과
  - [ ] `pnpm typecheck` 클린

### Task 2: 스토어 타입 확장
- **변경 대상**: `src/store/editor-store.ts`, `src/store/issues-store.ts`
- **작업 내용**:
  - `EditorDraft`에 `environment?: EnvironmentRow[]` 추가.
  - `IssueDraftContent`에 `environment?: EnvironmentRow[]` 추가, `defaultDraft`(L36)에 `environment: []` 추가.
  - 버전 bump 없음 — optional 필드.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] `saveDraft` 호출부(`editor-store.ts`의 `draft: { ...state.draft }`)가 자동으로 `environment`를 전달함을 코드로 확인

### Task 3: MarkdownContext + 빌드 함수 5종 + 테스트
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`, `buildGithubIssueBody.ts`, `buildLinearIssueBody.ts`, `buildIssueAdf.ts`, `buildNotionIssueBody.ts` + 각 `__tests__` 파일
- **작업 내용**:
  - `MarkdownContext`에 `environment: EnvironmentRow[]` (required) 추가.
  - 각 빌드 함수의 Environment 섹션 말미에 `filterEnvironmentRows(ctx.environment)` 결과 추가:
    - markdown 계열: `- **${label}**: ${value}`
    - ADF: `keyValueItem(label, value)`를 env 배열에 push
    - Notion: `{ type: "bulleted_list_item", text: `${label}: ${value}` }`
  - 각 테스트에 케이스 추가: custom row가 Environment 섹션에 나타남 / 빈 row는 제외됨. 기존 테스트의 `makeCtx()` 헬퍼에 `environment: []` 기본값 추가 (required 필드라 컴파일 위해).
- **검증**:
  - [ ] `pnpm test` — 5개 빌드 함수 테스트 통과
  - [ ] `pnpm typecheck` 클린

### Task 4: ctx 조립 호출부 갱신
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**:
  - `IssueCreateModal.buildCtx()`의 모든 return 분기(약 4개)에 `environment: draft.environment ?? []` 추가.
  - `PreviewPanel`의 `ctx` 조립 3개 분기(L102-168)에 `environment: draft.environment ?? []` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 클린 (required 필드 누락 시 컴파일 에러로 검출)

### Task 5: ReproEnvironmentSection 컴포넌트 + drafting 패널 배선
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - i18n 키 3개 추가 (ko·en): `draft.envLabelPlaceholder`, `draft.envValuePlaceholder`, `draft.envAddRow`.
  - 인라인 컴포넌트 `ReproEnvironmentSection` 추가:
    - `<Section title={t("section.env")} collapsible defaultOpen={false}>` 렌더.
    - editor-store에서 모드별 readonly 메타 파생 (Page=`target.url`, DOM=`selection.selector` element 한정, Viewport=모드별 viewport `${w}×${h}` null이면 생략, Captured=모드별 capturedAt→`formatTimestamp`).
    - readonly row: Label `w-60 shrink-0` + Value `flex-1`, 둘 다 `readOnly`, 삭제 버튼 없음. 라벨은 영문 리터럴 "Page"/"DOM"/"Viewport"/"Captured".
    - custom row: `draft.environment ?? []` 순회. Label `<Input className="w-60 shrink-0">` + Value `<Input className="flex-1">` + `Trash2` 삭제 버튼(`h-9 w-9`, `OrderedListEditor` 삭제 버튼 스타일).
    - "행 추가" `<Button variant="outline">` (lucide `Plus` 아이콘) — `setDraft`로 `{label:"",value:""}` append.
    - 삭제/수정: `setDraft({ ...draft, environment: next })`.
  - 렌더 트리: 제목 `<Section>` 다음, `{sectionNodes}` 앞에 `<ReproEnvironmentSection />` 삽입.
  - `mediaBlock`(3분기), `SectionTextarea`의 `<Section>`, `logCardsBlock`에 `collapsible` prop 추가. 제목 `<Section>`은 그대로.
  - 초기 `setDraft`(L97-100)에 `environment: []` 추가.
  - `handleAIDraft`의 `setDraft({ ...parsed, title: aiTitle })` → `environment: draft.environment ?? []` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: drafting 패널 제목 아래 "재현 환경" 섹션, 기본 접힘
  - [ ] 수동: 펼치면 모드별 readonly 메타 표시 (element=Page/DOM/Viewport/Captured, 그 외=Page/Viewport/Captured)
  - [ ] 수동: "행 추가"로 custom row 추가, label/value 입력, 휴지통으로 삭제
  - [ ] 수동: Label 입력 고정 너비(240px), Value 입력 가득
  - [ ] 수동: 재현 과정·미디어·로그 섹션 접기 토글 동작, 재현 환경만 기본 접힘·나머지 펼침, 제목은 토글 없음

### Task 6: PreviewPanel 환경 표시 갱신
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: L208 `<Section title={t("section.env")}>`의 환경 표시 컴포넌트가 `filterEnvironmentRows(draft.environment ?? [])`도 함께 렌더하도록 확장. (구현 시 해당 컴포넌트 시그니처 확인 후 custom row prop 추가.)
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: 미리보기 Environment 섹션에 custom row 표시, 빈 row 미표시

## 테스트 계획

### 단위 테스트
- `environmentRows.test.ts` — `filterEnvironmentRows`: 정상/label-빈/value-빈/공백-only/빈 배열.
- 빌드 함수 5종 테스트 — Environment 섹션에 custom row 포함, 빈 row 제외. `makeCtx()` 헬퍼에 `environment` 기본값 추가.

### 수동 테스트 (Chrome)
- [ ] 4개 캡처 모드 각각에서 drafting 진입 → 재현 환경 섹션의 readonly 메타가 모드별로 맞게 표시
- [ ] custom row 추가/수정/삭제 후 다른 탭 갔다 와도 입력 유지 (세션 영속화)
- [ ] custom row 입력 후 미리보기 → Environment 섹션에 반영
- [ ] Jira·GitHub·Linear·Notion 각각 제출 → 이슈 본문 Environment 섹션에 custom row bullet 포함
- [ ] Label만/Value만 채운 row → 제출 본문에서 제외
- [ ] AI 초안 생성 후 custom row 보존 확인
- [ ] 저장된 초안 재오픈 → custom row 복원, `environment` 없는 구 초안도 에러 없이 로드
- [ ] 모든 섹션 접기/펼치기 동작, 기본 상태(재현 환경만 접힘) 확인

## 구현 순서 권장

1. **Task 1** (타입·헬퍼·테스트) — 모든 태스크의 타입 의존성. `/tdd interface`로 테스트 먼저 권장.
2. **Task 2** (스토어 타입) — Task 1의 `EnvironmentRow` 의존.
3. **Task 3** (MarkdownContext + 빌드 함수) — Task 1 의존. `MarkdownContext.environment`를 required로 추가하면 Task 4 전까지 타입 에러가 남음 (의도된 신호).
4. **Task 4** (ctx 호출부) — Task 3 직후. 여기까지 끝나야 `pnpm typecheck` 클린 복귀.
5. **Task 5** (컴포넌트 + 배선) — Task 1·2 의존. Task 6과 `PreviewPanel.tsx`를 나눠 건드리므로 Task 6 직전에.
6. **Task 6** (PreviewPanel 표시) — Task 4에서 PreviewPanel ctx를 이미 건드렸으니 이어서.

> 문서 신선도: 신규 파일(`src/types/environment.ts`, `src/sidepanel/lib/environmentRows.ts`)이 생기므로 구현 후 `/push` 단계에서 CLAUDE.md 디렉터리 구조의 `lib/`·`types/` 항목 갱신 필요.
