# 이슈 CC 멘션 — 구현 태스크

## 선행 조건

- **Linear**: `IssueCreateInput.subscriberIds` 필드 존재 확인 (GraphQL introspection 또는 Linear API 문서). 없으면 Task 3의 Linear 항목을 "cc 줄만"으로 축소하고 보고에 명시.
- **Notion**: BugShot Notion 통합 설정에서 "사용자 정보 읽기(Read user information)" capability 활성 여부 확인. 비활성이면 활성화 + 기존 토큰으로 `/v1/users` 403 여부 실확인.
- 권한·env 추가 없음 (모든 API가 기존 host_permissions 범위).

## 태스크

### Task 1: ccMention 순수 헬퍼 (+ 테스트 우선)
- **변경 대상**: `src/sidepanel/lib/ccMention.ts`(신규), `src/sidepanel/lib/__tests__/ccMention.test.ts`(신규)
- **작업 내용**: `CC_SENTINEL`, `ccMarkdownLine`, `ccAdfParagraph`, `ccAsanaHtml`, `injectAsanaCc` 구현. design.md 시그니처 준수. `/tdd interface`로 테스트 먼저.
- **검증**: `pnpm test ccMention`
  - [ ] `ccMarkdownLine(["a","b"]) === "cc @a @b"`, 빈 배열 → `""`
  - [ ] `ccAdfParagraph`: "cc " 텍스트 + 사용자별 mention 노드(`attrs.id`, `attrs.text="@Name"`), 빈 배열 → null
  - [ ] `injectAsanaCc`: sentinel → 앵커 치환, users 비면 sentinel 제거, sentinel 없는 html은 그대로

### Task 2: 타입·메시지·background API
- **변경 대상**: `src/types/platform.ts`, `src/types/linear.ts`, `src/types/notion.ts`, `src/types/messages.ts`, `src/store/editor-store.ts`, `src/background/notion-api.ts`, `src/background/linear-api.ts`
- **작업 내용**:
  - 각 `XLastSubmitFields` + `EditorIssueFields`에 cc 필드 (design.md 형태표)
  - `LinearCreateIssuePayload.subscriberIds?: string[]` + `createIssue` input 매핑
  - `NotionUser` 타입, `NotionBlock`에 `mention_paragraph`, `notion.listUsers` 메시지 + 핸들러
  - `listUsers(auth)`: `/users?page_size=100` + `start_cursor` 페이지네이션, `type==="person"` 필터
  - `expandBlock`에 `mention_paragraph` → paragraph(`"cc "` text + user mention rich text)
- **검증**: `pnpm typecheck` + `pnpm test`
  - [ ] `notion-api.test.ts`: listUsers 페이지네이션(2페이지 mock)·bot 필터, expandBlock mention_paragraph 전개
  - [ ] `linear-api.test.ts`: subscriberIds 있으면 input 포함, 없으면 미포함

### Task 3: 본문 빌더 cc 삽입
- **변경 대상**: `buildIssueAdf.ts`, `buildGithubIssueBody.ts`, `buildGitlabIssueBody.ts`, `buildLinearIssueBody.ts`, `buildNotionIssueBody.ts`, `buildAsanaIssueBody.ts` (모두 `src/sidepanel/lib/`)
- **작업 내용**: design.md "본문 내 위치 규칙"대로 — 마크다운 3종은 `footerMarkdown()` 직전 `ccMarkdownLine` push, Jira는 `rule` 직전 `ccAdfParagraph` push, Notion은 blocks 마지막에 `mention_paragraph`, Asana는 푸터 직전 `CC_SENTINEL` 줄.
- **검증**: 각 기존 테스트 파일에 케이스 추가 (`buildIssueAdf.test.ts` 등 6개)
  - [ ] cc 있을 때: cc 요소가 푸터(또는 rule) 직전에 위치
  - [ ] cc 없을 때(undefined·빈 배열): 출력이 기존 스냅샷과 동일 (회귀 0)
  - [ ] `markdownToAsanaHtml(CC_SENTINEL 포함 본문)` 출력에 sentinel이 원형 보존

### Task 4: submitTo* 배선
- **변경 대상**: `submitToGithub.ts`, `submitToLinear.ts`, `submitToNotion.ts`, `submitToGitlab.ts`, `submitToAsana.ts` (모두 `src/sidepanel/lib/`)
- **작업 내용**: 각 input에 cc 추가 → 빌더로 전달. Linear는 `payload.subscriberIds = cc.map(u => u.id)`. Asana는 `hasCc` 전달 + htmlNotes 2곳(create의 `markdownToAsanaHtml(body)`·updateTaskNotes의 `markdownToAsanaHtml(body, imageRefs)`)에 `injectAsanaCc` 적용.
- **검증**: `pnpm typecheck`
  - [ ] Asana: create·update 양쪽 모두 치환 적용 확인 (update 누락 시 이미지 인라인 갱신이 cc를 sentinel 문자열로 되돌림)

### Task 5: UI — MultiUserCombobox + 플랫폼별 CC 필드 + i18n
- **변경 대상**: `src/sidepanel/components/MultiUserCombobox.tsx`(신규), 플랫폼별 `CcCombobox.tsx`/`CcField.tsx` 6개(신규), `*IssueFields.tsx` 6개, `src/i18n/namespaces/settings.ts`
- **작업 내용**:
  - MultiUserCombobox: design.md props. 토글 선택(팝오버 유지), 트리거에 선택 이름 `, ` 나열(truncate), clearable. 기존 AssigneeCombobox(`githubFields/AssigneeCombobox.tsx`)의 Popover+Command 패턴·로딩/에러 표시를 그대로 따른다 (새 레이아웃 발명 금지).
  - 플랫폼 wrapper: 각자 기존 assignee fetch 패턴 복제 (lazy load, reqIdRef, 선행 필드 미선택 시 disabled). Jira만 `useDebouncedSearch` + `onSearch`.
  - 각 `XIssueFieldsValue.cc` + `initialXFields` last.cc 복원 + assignee 아래 `FieldRow label={t("field.cc.label")}` 추가.
  - i18n: `field.cc.label`("CC"), `field.cc.select`, `field.cc.search`, `field.cc.empty` ko·en 동시 (PostToolUse 훅 통과).
  - 콤보박스에 `data-testid="cc-combobox"` 부여 (플랫폼 prefix 불필요 — 탭당 1개).
- **검증**:
  - [ ] `pnpm typecheck` + i18n 훅 green
  - [ ] (수동) 6개 탭 모두 CC 필드 노출·다중 선택·해제·클리어 동작

### Task 6: 제출 핸들러 배선 (두 다이얼로그)
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**: 6개 `handleXSubmit` 각각 — cc를 submitTo*/`buildIssueAdf`에 전달 + `setLastSubmitFields("x", { ..., cc })`. **두 파일 모두** (제출 파이프라인 중복 구조).
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] (수동) 제출 → 재오픈 시 cc prefill, 드래프트 상세에서 제출해도 동일

## 테스트 계획

- **단위 테스트**: Task 1~3의 체크리스트 (ccMention 신규, 본문 빌더 6종 케이스 추가, notion/linear-api 케이스 추가). 전부 `pnpm test` green이 완료 조건.
- **e2e 시나리오**: 없음 — 이슈 제출 플로우는 플랫폼 OAuth가 필요해 기존에도 e2e 미커버 (CC 필드는 제출 다이얼로그 안에만 존재).
- **수동 테스트** (Chrome + 실계정):
  - [ ] Jira: cc 멘션이 본문에 렌더 + 멘션 알림 수신
  - [ ] GitHub: `cc @login` 멘션 하이라이트 + 알림
  - [ ] GitLab: 동일
  - [ ] Linear: cc 사용자가 구독자로 등록 + 알림 (subscriberIds 동작 확인)
  - [ ] Notion: 본문 멘션 렌더 + 알림 (API 생성 멘션의 알림 여부가 미검증 — 안 가면 보고에 명시)
  - [ ] Asana: 앵커 멘션 렌더 + 팔로워 추가, 이미지 포함 이슈에서 updateTaskNotes 후에도 멘션 유지
  - [ ] 전 플랫폼: cc 미선택 제출 시 본문이 기존과 동일 (회귀)
  - [ ] Notion capability 부재 토큰: 콤보박스 에러 표시 + 제출 비차단

## 구현 순서 권장

1. Task 1 (`/tdd interface` → 구현) — 다른 태스크의 기반
2. Task 2 → Task 3 → Task 4 (직렬: 타입 → 빌더 → 배선)
3. Task 5 (UI)는 Task 2 완료 후 Task 3·4와 **병렬 가능**
4. Task 6 (최종 배선) — Task 4·5 완료 후
5. 수동 테스트 → 선행 조건의 Linear/Notion 검증 결과 반영

## 가이드 영향

- `integrations/issue-tracking.md` (ko·en) — 이슈 제출 필드 설명에 CC(멘션) 추가, 플랫폼별 알림 동작 차이(Linear=구독자) 명시
- `guide/AUTHORING.md` — 본문 섹션 구성(cc 줄)·플랫폼 표 사실 스냅샷 대조 (트리거: 본문 섹션 변경)
- `docs/privacy.md` — Notion `/v1/users` 신규 호출(워크스페이스 멤버 목록 조회) 대조·갱신 (manifest diff 0이지만 신규 외부 엔드포인트 트리거)
