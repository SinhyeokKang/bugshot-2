# 이슈 CC 멘션 — 기술 설계

## 개요

CC는 **플랫폼별 제출 필드**다. 본문 에디터(플랫폼 공용 마크다운)에는 손대지 않고, 제출 직전 각 플랫폼의 본문 빌더가 네이티브 멘션을 푸터 직전에 삽입한다. 사용자 목록은 기존 assignee 검색 메시지를 재사용하고(Notion만 신규 `notion.listUsers`), 멘션 포맷 빌더는 순수 함수(`ccMention.ts`)로 분리해 단위 테스트한다. 알림이 마크다운으로 보장되지 않는 Linear는 `issueCreate.subscriberIds`로 알림을 보장한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/ccMention.ts` | 멘션 포맷 순수 함수 모음: `ccMarkdownLine`, `ccAdfParagraph`, `ccAsanaHtml`, `injectAsanaCc`, `CC_SENTINEL` |
| `src/sidepanel/lib/__tests__/ccMention.test.ts` | 위 헬퍼 테스트 |
| `src/sidepanel/components/MultiUserCombobox.tsx` | 공용 멀티셀렉트 콤보박스 (Popover+Command, 토글 선택·전체 클리어·아바타) |
| `src/sidepanel/tabs/jiraFields/CcField.tsx` | Jira CC (jira.searchUsers + useDebouncedSearch) |
| `src/sidepanel/tabs/githubFields/CcCombobox.tsx` | GitHub CC (github.searchAssignees) |
| `src/sidepanel/tabs/linearFields/CcCombobox.tsx` | Linear CC (linear.getMembers) |
| `src/sidepanel/tabs/notionFields/CcCombobox.tsx` | Notion CC (신규 notion.listUsers) |
| `src/sidepanel/tabs/gitlabFields/CcCombobox.tsx` | GitLab CC (gitlab.searchAssignees) |
| `src/sidepanel/tabs/asanaFields/CcCombobox.tsx` | Asana CC (asana.searchAssignees) |

### 기존 파일 변경

| 파일 | 변경 |
|---|---|
| `src/store/editor-store.ts` | `EditorIssueFields`에 `cc?: { accountId: string; displayName: string }[]` 추가 (Jira 필드는 여기 산다) |
| `src/types/platform.ts` | `JiraLastSubmitFields`·`GithubLastSubmitFields`·`LinearLastSubmitFields`·`NotionLastSubmitFields`·`GitlabLastSubmitFields`·`AsanaLastSubmitFields`에 각 플랫폼 cc 필드 추가 (아래 인터페이스 설계) |
| `src/types/linear.ts` | `LinearCreateIssuePayload.subscriberIds?: string[]` |
| `src/types/notion.ts` | `NotionBlock` union에 `{ type: "mention_paragraph"; userIds: string[] }` 추가, `NotionUser { id; name; avatarUrl? }` 추가 |
| `src/types/messages.ts` | `{ type: "notion.listUsers" }` 메시지 + 핸들러 케이스 추가 |
| `src/background/notion-api.ts` | `listUsers(auth)` (GET `/users` 페이지네이션, `type === "person"` 필터) + `expandBlock`에 `mention_paragraph` 케이스 (`{ type: "mention", mention: { user: { id } } }` rich text, 앞에 `"cc "` 텍스트) |
| `src/background/linear-api.ts` | `createIssue`: `payload.subscriberIds?.length`면 `input.subscriberIds` 전달 |
| `src/sidepanel/lib/buildIssueAdf.ts` | `buildIssueAdf(ctx, inlineImageRefIds?, cc?)` — cc 있으면 `ccAdfParagraph(cc)`를 `rule`/푸터 직전에 push |
| `src/sidepanel/lib/buildGithubIssueBody.ts` | input에 `cc?: string[]`(login) — `ccMarkdownLine(cc)`를 `footerMarkdown()` 직전에 push |
| `src/sidepanel/lib/buildGitlabIssueBody.ts` | 동일 (`cc?: string[]`, username) |
| `src/sidepanel/lib/buildLinearIssueBody.ts` | 동일 (`cc?: string[]`, 표시 이름 — 시각 표시용) |
| `src/sidepanel/lib/buildNotionIssueBody.ts` | input에 `cc?: string[]`(userId) — blocks 마지막에 `{ type: "mention_paragraph", userIds }` push (background가 첨부 섹션·푸터를 그 뒤에 붙임) |
| `src/sidepanel/lib/buildAsanaIssueBody.ts` | input에 `hasCc?: boolean` — true면 푸터 직전에 `CC_SENTINEL` 텍스트 줄 push |
| `src/sidepanel/lib/submitToGithub.ts` | input `cc?: string[]` → buildGithubIssueBody로 전달 |
| `src/sidepanel/lib/submitToLinear.ts` | input `cc?: { id: string; name: string }[]` → body에 이름 줄 + payload `subscriberIds: cc.map(u => u.id)` |
| `src/sidepanel/lib/submitToNotion.ts` | input `cc?: string[]` → buildNotionIssueBody로 전달 |
| `src/sidepanel/lib/submitToGitlab.ts` | input `cc?: string[]` → buildGitlabIssueBody로 전달 |
| `src/sidepanel/lib/submitToAsana.ts` | input `cc?: { gid: string }[]` → `hasCc` 전달 + htmlNotes 생성 2곳(create·updateTaskNotes)에서 `injectAsanaCc(html, cc)` 적용 |
| `src/sidepanel/tabs/githubFields/GithubIssueFields.tsx` 외 5개 `*IssueFields.tsx` | `XIssueFieldsValue.cc` 추가, `initialXFields`에 last.cc 복원, CC FieldRow 추가 (assignee 아래) |
| `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx` | AssigneeField 아래 CcField 추가 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | 6개 핸들러: submitTo*/buildIssueAdf에 cc 전달 + `setLastSubmitFields`에 cc 저장 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 동일 배선 (제출 파이프라인이 중복돼 있음 — 양쪽 모두 필수) |
| `src/sidepanel/tabs/SubmitFieldsDialog.tsx` | ① DialogContent에 `max-h-[80vh]` + `overflow-y-auto` 추가 (CC로 필드 수 증가 — DraftDetailDialog 전례 패턴) ② `handleSubmit` catch에서 현재 플랫폼 cc가 비어 있지 않으면 에러 토스트에 `t("field.cc.submitErrorHint")` 덧붙임 (stale CC 원인 식별) |
| `src/sidepanel/hooks/usePlatformFields.ts` | 직접 변경 없음 가능성 높음 — `XIssueFieldsValue` 타입 전파로 cc가 자동 통과. 제출 핸들러가 cc를 읽는 경유지이므로 구현 시 통과 확인만 |
| `src/i18n/namespaces/settings.ts` | `field.cc.label` / `field.cc.select` / `field.cc.search` / `field.cc.empty` / `field.cc.clear`(전체 해제) / `field.cc.notionCapabilityError`(403 안내 — actionable 문구) / `field.cc.submitErrorHint`(제출 실패 시 CC 원인 힌트) ko·en 동시 추가 (기존 `field.assignee.*` 옆) |

## 데이터 흐름

```
[SubmitFieldsDialog]
  플랫폼별 XIssueFields → CcCombobox
    open 시 lazy fetch (기존 assignee 메시지 재사용, Notion만 notion.listUsers)
    선택값 → XIssueFieldsValue.cc (usePlatformFields state / Jira는 editor-store issueFields)
        ↓ 제출
[IssueCreateModal | DraftDetailDialog] handleXSubmit
    cc → submitToX(input.cc) / buildIssueAdf(ctx, refs, cc)
        ↓ 본문 삽입 (푸터 직전)
    Jira    : ccAdfParagraph → ADF mention 노드
    GH/GL   : ccMarkdownLine → "cc @login1, @login2"
    Linear  : ccMarkdownLine(이름, 특수문자 이스케이프) + payload.subscriberIds
    Notion  : mention_paragraph 블록 → background expandBlock이 mention rich text로 전개
    Asana   : CC_SENTINEL(markdown) → markdownToAsanaHtml 통과 → injectAsanaCc가 <a data-asana-gid>로 치환
        ↓ 제출 성공
    setLastSubmitFields("x", { ...기존, cc })  → 다음 제출 prefill
```

## 인터페이스 설계

```typescript
// src/sidepanel/lib/ccMention.ts
export const CC_SENTINEL = "[[bugshot:cc]]";

/** "cc @a, @b" — 쉼표 구분(이름 경계 명확화, 전 플랫폼 공통). handles 비어 있으면 "".
 *  이름 내 마크다운 특수문자(`_*[]~` 백틱 등)는 백슬래시 이스케이프 (Linear 표시 이름용). */
export function ccMarkdownLine(handles: string[]): string;

/** ADF: { type:"paragraph", content:[ {text:"cc "}, {type:"mention", attrs:{id, text:"@Name"}}, {text:", "} ... ] } */
export function ccAdfParagraph(
  users: { accountId: string; displayName: string }[],
): AdfNode | null;

/** `cc <a data-asana-gid="GID1"/>, <a data-asana-gid="GID2"/>` */
export function ccAsanaHtml(users: { gid: string }[]): string;

/** html 내 CC_SENTINEL을 ccAsanaHtml로 치환. users 비면 sentinel만 제거 */
export function injectAsanaCc(html: string, users: { gid: string }[]): string;
```

```typescript
// 플랫폼별 cc 필드 (XIssueFieldsValue + XLastSubmitFields 동일 형태)
jira   : cc?: { accountId: string; displayName: string }[]   // EditorIssueFields + JiraLastSubmitFields
github : cc?: string[]                                       // login = 멘션 핸들 = 표시명
linear : cc?: { id: string; name: string }[]                 // id → subscriberIds, name → 본문 표시
notion : cc?: { id: string; name: string }[]                 // id → mention, name → UI 표시
gitlab : cc?: { username: string; name: string }[]           // username → @멘션, name → UI 표시
asana  : cc?: { gid: string; name: string }[]                // gid → 앵커, name → UI 표시
```

```typescript
// src/sidepanel/components/MultiUserCombobox.tsx
export interface MultiUserOption {
  key: string;        // 플랫폼 멘션 키 (accountId/login/userId/username/gid)
  label: string;      // 표시명
  avatarUrl?: string;
}
interface Props {
  options: MultiUserOption[];
  selectedKeys: string[];
  onToggle: (option: MultiUserOption) => void;  // 선택/해제 (팝오버 닫지 않음)
  onClear: () => void;                          // 전체 해제 — 팝오버 내 맨 위 액션 항목 (Jira FieldCombobox "선택 해제" 패턴, 선택 1개 이상일 때만 노출)
  loading: boolean;
  error: string | null;
  disabled?: boolean;          // 선행 필드 미선택
  disabledLabel?: string;      // 예: t("github.field.requireRepo")
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  onOpenChange?: (open: boolean) => void;  // open 시 lazy fetch 트리거
  onSearch?: (q: string) => void;          // Jira 서버 검색 (지정 시 Command shouldFilter=false)
}
// 트리거 라벨: 1-2명은 이름 나열, 3명 이상은 "이름1, 이름2 외 N" 축약 (다이얼로그 ~320px 가독성).
// 아바타는 shadcn Avatar 설치 없이 기존 콤보박스의 raw <img class="h-4 w-4 rounded-full"> 패턴.
```

```typescript
// src/background/notion-api.ts
export async function listUsers(auth: NotionAuth): Promise<NotionUser[]>;
// GET /users?page_size=100 (+ start_cursor 페이지네이션, has_more 동안 전량 로드 — 상한 없음, 검토 후 결정).
// start_cursor/has_more 루프는 notion-api 내 신규 패턴 (기존 searchDatabases는 단발 page_size:20).
// results에서 type === "person"만 매핑. 403(capability 부재)은 NotionError로 전파하되,
// CcCombobox가 status 403이면 t("field.cc.notionCapabilityError")로 치환 표시.

// src/types/messages.ts
| { type: "notion.listUsers" }   // → NotionUser[]
```

```typescript
// Linear issueCreate input 추가분
if (payload.subscriberIds?.length) input.subscriberIds = payload.subscriberIds;
```

## 본문 내 위치 규칙

cc 줄은 **저작 본문의 마지막, 브랜딩 푸터(`Reported via BugShot`) 직전**. 플랫폼별 실현:

- GitHub/GitLab/Linear: 각 `buildXIssueBody`가 `footerMarkdown()` push 직전에 `ccMarkdownLine` push.
- Jira: `buildIssueAdf`가 `{ type: "rule" }` push 직전에 `ccAdfParagraph` push.
- Notion: 클라이언트 blocks의 마지막 요소 → background `createPage`가 그 뒤에 첨부 섹션·푸터를 붙이므로 자연히 저작 본문 끝.
- Asana: html_notes는 markdown 경유라 네이티브 앵커를 직접 못 박음 → `buildAsanaIssueBody`가 푸터 직전에 `CC_SENTINEL` 텍스트 줄을 emit하고, `submitToAsana`가 변환된 HTML에서 `injectAsanaCc`로 치환 (create·updateTaskNotes 2곳 모두). sentinel은 markdown 특수문자가 없어 `markdownToAsanaHtml`을 텍스트로 통과한다.

## 기존 패턴 준수

- **콤보박스 lazy fetch**: open 시 1회 로드 + 선행 필드 변경 시 캐시 무효화 (`githubFields/AssigneeCombobox.tsx`의 reqIdRef 패턴). Jira만 `useDebouncedSearch` 서버 검색.
- **lastSubmitFields prefill**: `initialXFields(last, defaults)`에 cc 복원 추가. defaults에는 cc 없음 (계정 기본값 아님).
- **i18n ko/en 동시 갱신**: settings.ts 네임스페이스, PostToolUse 훅이 대칭 검사.
- **메시지 비동기 응답**: `notion.listUsers`는 기존 notion.* 케이스와 동일하게 `loadNotionAuth()` 후 API 호출.
- **본문 회귀 0**: cc 미선택 시 모든 빌더가 기존과 동일 출력 (옵션 파라미터, 빈 배열/undefined면 no-op).
- **IconButton/버튼 사이즈·shadcn**: MultiUserCombobox는 Popover+Command+Button(outline) — 기존 AssigneeCombobox와 동일 구성.

## 대안 검토

1. **본문 에디터 인라인 `@` 멘션 (Tiptap Mention extension)** — 기각. 에디터 마크다운은 플랫폼 공용·드래프트 영속 대상이라 플랫폼별 사용자 ID를 품으면 플랫폼 전환·복사(마크다운 복사)·드래프트 재개 전부에 변환 규칙이 필요해진다. CC 필드는 이 문제를 구조적으로 제거.
2. **Linear 본문 마크다운 멘션 (`@이름`)에 알림 의존** — 기각. Linear API로 생성한 description의 plain `@이름`은 멘션으로 파싱·알림된다는 공식 보장이 없다. `subscriberIds`는 문서화된 입력 필드로 알림(구독)이 보장됨. 본문 `@이름`은 시각 표시로만 유지.
3. **공용 컴포넌트 없이 플랫폼별 멀티콤보박스 6벌 복제** — 기각. 기존 AssigneeCombobox가 플랫폼별 복제인 건 단일 선택 UI가 제각각 단순해서였고, 멀티셀렉트(토글·클리어·라벨 조합)는 동작 면적이 커서 한 벌(`MultiUserCombobox`)로 모으고 fetch만 플랫폼별 thin wrapper에 둔다.
4. **Notion CC를 페이지 property(people)로 설정** — 기각. people property는 데이터베이스 스키마에 따라 존재하지 않을 수 있고, 본문 멘션이 "누가 관련인지"를 이슈 내용과 함께 보여주는 요구에 더 부합.

## 위험 요소

- **Linear `IssueCreateInput.subscriberIds` 존재 검증**: 구현 시 GraphQL introspection 또는 실호출로 확인. 없으면 cc 줄(시각)만 남기고 구독 생략 — 알림 미보장 상태로 출시 OK(PRD 목표 계층화), 결과를 가이드에 명시.
- **Notion `/v1/users` capability**: 통합(integration)에 "사용자 정보 읽기" capability가 없으면 403. BugShot Notion 앱 설정 확인 필요. capability 변경 시 기존 연결 사용자의 재인증 마찰은 수용하기로 결정 → 403이면 콤보박스에 `field.cc.notionCapabilityError` 안내 표시로 graceful 처리(제출 비차단).
- **Notion API 멘션 알림 여부**: API로 생성한 본문 mention이 알림을 발송하는지 실워크스페이스 검증 필요 (페이지 접근 권한이 있는 사용자만 알림됨). 안 가면 시각 멘션만으로 출시.
- **Notion 100블록 truncate에서 cc 손실 가능**: `createPage`는 본문+첨부+푸터를 합쳐 `expanded.slice(0, 100)`으로 자르므로, blocks 마지막에 위치한 cc 블록이 가장 먼저 잘린다. 100블록 초과는 극히 드물다고 판단해 **수용** (보존 로직 추가 안 함 — 기존 경고 로그로 충분).
- **stale CC prefill 위험 수용**: prefill된 cc 멤버가 무효(탈퇴 등)면 제출이 실패할 수 있다(특히 Asana 400). 사전 교차 검증 없이 SubmitFieldsDialog의 에러 토스트에 cc 힌트를 덧붙이는 것으로 대응 (변경 범위 표 참고).
- **Asana 앵커 검증**: `html_notes`의 `<a data-asana-gid="USER_GID"/>`가 유효하지 않으면 Asana가 본문 전체를 거부(400)할 수 있다. 실계정 테스트 필수. updateTaskNotes 경로(이미지 인라인 갱신)에서도 동일 치환을 잊으면 2차 write가 cc를 sentinel 문자열로 덮어쓴다.
- **GitHub/GitLab 멘션 범위**: 후보 목록이 assignee API(레포 collaborator / 프로젝트 멤버) 기준이라 org 전체 멘션은 불가 — 의도된 제약.
- **editor-store 영속 호환**: `EditorIssueFields.cc`는 optional 추가라 기존 세션 데이터와 호환 (마이그레이션 불필요).
- **privacy.md 신선도**: Notion `/users` 신규 엔드포인트 호출(워크스페이스 멤버 목록 조회)이 추가되므로 manifest diff가 없어도 `/push` 전 privacy.md 대조 대상.
