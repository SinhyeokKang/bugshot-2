# 재현 환경 섹션 + drafting 패널 어코디언 — 구현 태스크

## 선행 조건

- 새 권한·의존성·env 불필요.
- `Section` 컴포넌트(`src/sidepanel/components/Section.tsx`)에 `collapsible`/`defaultOpen` prop이 이미 존재함을 확인 (StyleEditorPanel 사용 중).
- 이슈 본문 빌드 함수 5종(`buildIssueMarkdown`/`buildIssueAdf`/`buildGithubIssueBody`/`buildLinearIssueBody`/`buildNotionIssueBody`)에 각각 테스트 파일이 `src/sidepanel/lib/__tests__/`에 존재함을 확인.

## 태스크

### Task 1: 공용 타입 + 순수 헬퍼 2종 + 단위 테스트
- **변경 대상**: `src/types/environment.ts` (신규), `src/sidepanel/lib/environmentRows.ts` (신규), `src/sidepanel/lib/__tests__/environmentRows.test.ts` (신규)
- **작업 내용**:
  - `EnvironmentRow { label: string; value: string }` export. `environmentRows.ts`는 `EnvironmentRow`를 `export type`으로 re-export (import 경로 분산 방지).
  - `filterEnvironmentRows(rows)`: `label.trim()`·`value.trim()` 둘 다 비어있지 않은 row만 반환. value의 개행은 공백으로 치환 (마크다운 본문 깨짐 방지).
  - `deriveReadonlyEnvRows(input)`: `{ url, selector?, viewport?, capturedAt? }`에서 Page→DOM→Viewport→Captured 순 `EnvironmentRow[]` 파생. selector 없으면 DOM 생략, viewport null이면 Viewport 생략.
  - 테스트:
    - `filterEnvironmentRows` — 정상 row 유지 / label 공백-only 제외 / value 공백-only 제외 / 둘 다 공백 제외 / 빈 배열 → 빈 배열 / value 개행 → 공백 치환.
    - `deriveReadonlyEnvRows` — element 입력 4행(Page/DOM/Viewport/Captured) / 비element 3행 / viewport null 시 Viewport 생략 / selector 없으면 DOM 생략.
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

### Task 3: MarkdownContext + 빌드 함수 + 테스트
- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`buildIssueMarkdown` + `buildIssueHtml` 둘 다), `buildGithubIssueBody.ts`, `buildLinearIssueBody.ts`, `buildIssueAdf.ts`, `buildNotionIssueBody.ts` + 각 `__tests__` 파일(5개)
- **작업 내용**:
  - `MarkdownContext`에 `environment: EnvironmentRow[]` (required) 추가.
  - 각 빌드 함수의 Environment 섹션 말미에 `filterEnvironmentRows(ctx.environment)` 결과 추가:
    - `buildIssueMarkdown`/`buildGithubIssueBody`/`buildLinearIssueBody`: `- **${label}**: ${value}`
    - `buildIssueHtml`: `<li><strong>${label}</strong>: ${value}</li>` (마크다운 복사 `text/html` 경로 — 빠뜨리면 Notion/Confluence 붙여넣기에서 custom row 누락)
    - `buildIssueAdf`: `keyValueItem(label, value)`를 **`envItems`·`elemItems` 두 배열 모두**에 push
    - `buildNotionIssueBody`: `{ type: "bulleted_list_item", text: `${label}: ${value}` }`
  - 각 테스트에 케이스 추가: custom row가 Environment 섹션에 나타남 / 빈 row 제외 / value 개행·`**`·백틱 등 메타문자 입력 시 의도한 출력. `makeCtx()` 헬퍼는 공유 헬퍼가 아니라 **5개 테스트 파일에 각각 독립 정의**돼 있으므로 5곳 모두 `environment: []` 기본값 추가 (required 필드라 컴파일 위해).
- **검증**:
  - [ ] `pnpm test` — 5개 빌드 함수 테스트 통과 (`buildIssueMarkdown.test.ts`는 `buildIssueHtml` 케이스 포함)
  - [ ] `pnpm typecheck` 클린

### Task 4: ctx 조립 호출부 갱신 + screenshot 모드 미리보기
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/PreviewPanel.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - `IssueCreateModal.buildCtx()`의 모든 return 분기(4개: freeform/video/screenshot/element)에 `environment: draft.environment ?? []` 추가.
  - `PreviewPanel`: ① **screenshot 분기 추가** — 현재 ctx 조립은 freeform/video/element 3개 분기뿐이라 screenshot 모드는 `else { return }`으로 빠져 미리보기·copy 버튼이 동작하지 않는다. screenshot 분기를 추가하고 copy 버튼 노출 조건도 screenshot 포함하도록 확장. ② 4개 분기 전부에 `environment: draft.environment ?? []` 추가.
  - `DraftDetailDialog.buildCtxForSubmit()`(저장 초안 재제출 — `MarkdownContext` 네 번째 호출부)에 `environment: issue.draft.environment ?? []` 추가. 편집 UI는 추가하지 않음.
- **검증**:
  - [ ] `pnpm typecheck` 클린 (required 필드 누락 시 컴파일 에러로 검출 — 세 파일 모두 갱신돼야 클린)
  - [ ] 수동: screenshot 모드에서 미리보기·마크다운 복사 동작

### Task 5: ReproEnvironmentSection 컴포넌트 + drafting 패널 배선
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`, `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  - i18n 키 3개 추가 (ko·en): `draft.envLabelPlaceholder`, `draft.envValuePlaceholder`, `draft.envAddRow`.
  - 인라인 컴포넌트 `ReproEnvironmentSection` 추가:
    - `<Section title={t("section.env")} collapsible defaultOpen={false}>` 렌더 (항상 기본 접힘).
    - editor-store에서 모드별 값(url, selector, viewport, capturedAt)을 골라 `deriveReadonlyEnvRows(...)`로 readonly 메타 파생. Captured는 `formatTimestamp` 적용.
    - readonly row: `EnvParagraph` 패턴(label span `w-20 text-muted-foreground` + 텍스트 `break-all`). `<Input>` 아님 — 포커스 불가, Tab 순회 제외. 라벨은 영문 리터럴 "Page"/"DOM"/"Viewport"/"Captured". `EnvParagraph`를 `PreviewPanel.tsx`에서 export해 재사용할지는 구현 시 판단.
    - custom row: `draft.environment ?? []` 순회. Label `<Input className="w-28 shrink-0">` + Value `<Input className="flex-1">` + `Trash2` 삭제 버튼(`h-9 w-9`, `OrderedListEditor` 삭제 버튼 스타일). Label 240px 고정 금지 — ~400px 패널에서 Value 폭이 부족해짐.
    - "행 추가" `<Button variant="outline">` (lucide `Plus` 아이콘) — `setDraft`로 `{label:"",value:""}` append.
    - 삭제/수정: `setDraft({ ...draft, environment: next })`.
  - 렌더 트리: 제목 `<Section>` 다음, `{sectionNodes}` 앞에 `<ReproEnvironmentSection />` 삽입.
  - `mediaBlock`(3분기), `SectionTextarea`의 `<Section>`, `logCardsBlock`에 `collapsible` prop 추가. 제목 `<Section>`은 그대로.
  - 초기 `setDraft`(`{ title, sections: {} }`)에 `environment: []` 추가.
  - AI 초안 보존 — `environment`가 누락되지 않도록 draft 교체 경로 전부 점검: element 모드 `handleAIDraft`의 `setDraft({ ...parsed, title: aiTitle })`에 `environment: draft.environment ?? []` 추가, 비-element 모드 `AiDraftDialog`(멀티턴 세션)의 draft 갱신 지점도 동일 보존.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: drafting 패널 제목 아래 "재현 환경" 섹션, 기본 접힘
  - [ ] 수동: 펼치면 모드별 readonly 메타 표시 (element=Page/DOM/Viewport/Captured, screenshot/video=Page/Viewport/Captured, freeform=Page (+viewport/Captured 수집 시))
  - [ ] 수동: "행 추가"로 custom row 추가, label/value 입력, 휴지통으로 삭제
  - [ ] 수동: ~400px 패널에서 Value 입력이 "Chrome 140 / macOS 15" 류 값을 충분히 보여줌
  - [ ] 수동: readonly row가 Tab 순회에서 빠지고 custom row와 시각적으로 구분됨
  - [ ] 수동: 재현 과정·미디어·로그 섹션 접기 토글 동작, 재현 환경만 기본 접힘·나머지 펼침, 제목은 토글 없음
  - [ ] 수동: i18n — en 로케일에서 placeholder 3개("Label"/"Value"/"Add row") 정상 표시

### Task 6: PreviewPanel 환경 표시 갱신
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: PreviewPanel의 환경 표시는 element 모드용 `EnvParagraph`와 그 외 모드용 `NonElementEnvSection` **두 로컬 컴포넌트**다 (시그니처 다름 — 전자는 props, 후자는 store 직접 구독). **두 컴포넌트 모두** `filterEnvironmentRows(draft.environment ?? [])`를 함께 렌더하도록 확장. 빈 row는 `filterEnvironmentRows`가 걸러내므로 자동 미표시 — 미리보기를 거치면 사용자가 빈 row 누락을 인지할 수 있다.
- **검증**:
  - [ ] `pnpm typecheck` 클린
  - [ ] 수동: element·비element 모드 양쪽 미리보기 Environment 섹션에 custom row 표시, 빈 row 미표시

## 테스트 계획

### 단위 테스트
- `environmentRows.test.ts` — `filterEnvironmentRows`: 정상/label 공백-only/value 공백-only/둘 다 공백/빈 배열/value 개행 치환. `deriveReadonlyEnvRows`: element 4행/비element 3행/viewport null 생략/selector 없으면 DOM 생략.
- 빌드 함수 5종 테스트 — Environment 섹션에 custom row 포함, 빈 row 제외, 메타문자(`**`/백틱/개행) 입력 시 의도한 출력. `makeCtx()` 헬퍼는 5개 파일에 각각 독립 정의 → 5곳 모두 `environment` 기본값 추가.

### 수동 테스트 (Chrome)
- [ ] 4개 캡처 모드 각각에서 drafting 진입 → 재현 환경 섹션의 readonly 메타가 모드별로 맞게 표시 (freeform은 Page만 남을 수 있음)
- [ ] custom row 추가/수정/삭제 후 다른 탭 갔다 와도 입력 유지 (세션 영속화)
- [ ] custom row 입력 후 미리보기 → Environment 섹션에 반영 (screenshot 모드 포함 4개 모드 전부)
- [ ] Jira·GitHub·Linear·Notion 각각 제출 → 이슈 본문 Environment 섹션에 custom row bullet 포함
- [ ] 마크다운 복사(`text/html`) 결과를 Notion 등에 붙여넣어 custom row 포함 확인 (`buildIssueHtml` 경로)
- [ ] Label만/Value만 채운 row → 제출 본문·미리보기에서 제외
- [ ] value에 개행 입력 → 본문에서 공백으로 치환돼 불릿 안 깨짐
- [ ] AI 초안 생성 후 custom row(값 든 row 2개) 보존 확인 — element 모드 `handleAIDraft`, 비-element 모드 `AiDraftDialog` 양쪽
- [ ] 저장된 초안 재오픈 → drafting 패널에 custom row 복원, `environment` 없는 구 초안도 에러 없이 로드. DraftDetailDialog 재제출 본문에도 반영
- [ ] 모든 섹션 접기/펼치기 동작, 기본 상태(재현 환경만 접힘) 확인
- [ ] 섹션 접고 탭 이동 후 복귀 → 접힘 상태 기본값으로 리셋 (비영속 확인)
- [ ] i18n — ko/en 양쪽에서 placeholder 3개 정상 표시

## 구현 순서 권장

1. **Task 1** (타입·헬퍼 2종·테스트) — 모든 태스크의 타입 의존성. `/tdd interface`로 테스트 먼저 권장.
2. **Task 2** (스토어 타입) — Task 1의 `EnvironmentRow` 의존.
3. **Task 3** (MarkdownContext + 빌드 함수) — Task 1 의존. `MarkdownContext.environment`를 required로 추가하면 Task 4 전까지 타입 에러가 남음 (의도된 신호).
4. **Task 4** (ctx 호출부 3파일 + screenshot 분기) — Task 3 직후. `IssueCreateModal`·`PreviewPanel`·`DraftDetailDialog` 세 파일을 모두 갱신해야 `pnpm typecheck` 클린 복귀.
5. **Task 6** (PreviewPanel 환경 표시) — Task 4에서 `PreviewPanel.tsx`를 이미 건드렸으니 같은 파일을 이어서 처리. (Task 4와 Task 6이 `PreviewPanel.tsx`를 나눠 건드린다.)
6. **Task 5** (컴포넌트 + 배선) — Task 1·2 의존, `DraftingPanel.tsx`만 건드림. 마지막에.

> 문서 신선도: 신규 파일(`src/types/environment.ts`, `src/sidepanel/lib/environmentRows.ts`)이 생기므로 구현 후 `/push` 단계에서 CLAUDE.md 디렉터리 구조의 `lib/`·`types/` 항목 갱신 필요.
