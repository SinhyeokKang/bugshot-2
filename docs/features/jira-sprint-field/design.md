# Jira 제출 시 Sprint 선택 — 기술 설계

## 개요

**필드의 존재 여부를 서버에 묻고, 답이 "있다"일 때만 그린다.** Sprint는 사이트마다 ID가 다른 커스텀 필드라 클라이언트가 알 수 있는 게 없다 — createmeta 상세 엔드포인트(`/rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}`)가 그 프로젝트+이슈타입의 **create 화면에 실제로 올라간 필드 목록**을 주고, 거기서 `schema.custom === "com.pyxis.greenhopper.jira:gh-sprint"`를 찾으면 존재 판정·필드 ID·값 형식이 한 번에 나온다. 칸반·보드 미연결·team-managed·에픽 타입 같은 케이스를 **열거하지 않고** 흡수하는 게 이 선택의 핵심이다(열거하면 다음 케이스에서 구멍 난다 — CSS 캐스케이드 화이트리스트와 같은 이유).

값 목록만은 createmeta가 못 준다(`allowedValues` 없이 `autoCompleteUrl`만 온다). 그래서 목록은 **agile API**로 간다: `board?projectKeyOrId=` → 보드별 `board/{id}/sprint?state=active,future`. 이건 BugShot이 처음 호출하는 API 계열이라 **OAuth scope 커버리지가 미검증**이고, Task 0 spike가 선행한다.

배치는 두 층으로 나뉜다:
- **존재 판정(createmeta)** — 선제. 프로젝트·이슈타입이 확정될 때마다 1회. 결과가 있어야 행을 그린다.
- **값 목록(agile)** — lazy. 콤보를 열 때. `IssueTypeField`·`EpicField`와 같은 패턴.

**필드 ID 해석은 background에서 두 번 일어난다** — 판정용 1회(패널 요청)와 제출용 1회(`createIssue` 내부). 패널이 `fieldId`를 payload에 실어 나르지 않는 이유는 아래 §createIssue에 있다.

**이 문서는 `jira-project-switch` 구현 이후 상태를 전제한다**(PRD §선행 기획 의존). `EditorIssueFields.projectKey`, `applyProjectChange`, 하위 필드의 `projectKey` prop이 이미 있다고 본다.

## 변경 범위

### 1. `src/background/jira-api.ts`

함수 4개 + 순수 파서 2개 추가. 기존 함수는 `createIssue` 하나만 수정한다.

```
SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint"
```

- **`pickSprintField(res)`** (순수, export) — createmeta 필드 응답에서 sprint 필드를 골라 `JiraSprintFieldMeta | null`. `parseTransitions`(`jira-api.ts:446`)가 이미 "네트워크 함수 옆에 순수 파서를 export해 단위 테스트한다"는 선례를 만들어 뒀고 같은 위상이다.
  - 후보가 2개 이상이면(마이그레이션 잔재로 gh-sprint 스키마 필드가 복수인 사이트가 있다) **첫 번째를 쓴다.** 우선순위 규칙을 발명하지 않는다 — 어느 쪽이 맞는지 판정할 근거가 클라이언트에 없다.
- **`getSprintFieldMeta(auth, projectKey, issueTypeId)`** — 위 엔드포인트를 `maxResults=200`으로 호출해 `pickSprintField`. 페이지네이션은 **하지 않는다**(1페이지 200필드를 넘는 create 화면은 실재하지 않는다 — R5).
- **`mergeBoardSprints(perBoard)`** (순수, export) — 보드별 결과를 합쳐 `id` 기준 dedup(같은 스프린트가 두 보드에 걸릴 수 있다), `active` → `future` 순, 같은 상태 안에서는 `id` 오름차순. 보드가 1개면 `boardName`을 비워 반환한다(UI가 보드명을 안 그리는 신호 — §6).
- **`listSprints(auth, projectKey)`** — `GET /rest/agile/1.0/board?projectKeyOrId={key}&type=scrum&maxResults=50` → 보드별 `GET /rest/agile/1.0/board/{id}/sprint?state=active,future&maxResults=50`. **보드 단위 실패는 삼킨다**(칸반 오분류·권한 없음 → 400/403이 그 보드에서만 난다). 전 보드가 실패하면 빈 배열이지 throw가 아니다 — 목록이 비는 것과 오류는 UI에서 같은 처리다.
- **`getSprint(auth, sprintId)`** — `GET /rest/agile/1.0/sprint/{id}`. 404/403이면 `null`. sticky 검증 전용(§7).

`createIssue`(`jira-api.ts:267`) 수정:

```ts
if (payload.sprintId != null) {
  const meta = await getSprintFieldMeta(auth, payload.projectKey, payload.issueTypeId);
  if (meta) fields[meta.fieldId] = meta.isArray ? [payload.sprintId] : payload.sprintId;
}
```

`sprintId`가 없으면 **분기 자체를 안 탄다** — 스프린트를 안 고른 제출의 payload는 도입 전과 동일하다(PRD 목표 5). meta를 여기서 다시 해석하는 이유는 §대안 A1.

### 2. `src/types/jira.ts`

```ts
export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  boardId: number;
  boardName: string;   // 보드가 1개면 "" — UI가 보조 라벨을 생략하는 신호
}

export interface JiraSprintFieldMeta {
  fieldId: string;     // "customfield_10020" — 사이트마다 다르다
  isArray: boolean;    // schema.type === "array"
}
```

`JiraCreateIssuePayload`에 `sprintId?: number` 추가. **`fieldId`·`isArray`는 payload에 넣지 않는다**(§대안 A1).

### 3. `src/types/messages.ts` — bg 메시지 3개

```ts
| { type: "jira.sprintFieldMeta"; projectKey: string; issueTypeId: string }   // → JiraSprintFieldMeta | null
| { type: "jira.listSprints"; projectKey: string }                            // → JiraSprint[]
| { type: "jira.getSprint"; sprintId: number }                                // → JiraSprint | null
```

`src/background/messages.ts`의 switch에 case 3개(`jira.listIssueTypes`(246행) 옆, 전부 `await loadAuth()` 1행 위임).

### 4. `src/types/platform.ts` · `src/store/editor-store.ts`

- `JiraLastSubmitFields`에 `sprintId?: number; sprintName?: string;`
- `EditorIssueFields`(`editor-store.ts:127`)에 동일 2개.

둘 다 optional이라 **스토어 마이그레이션 불필요**(`SETTINGS_STORE_VERSION` 11 유지). `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`라 세션 영속은 자동으로 따라온다.

`sprintName`을 함께 저장하는 이유는 `parentKey`/`parentLabel`, `assigneeId`/`assigneeName`과 같다 — 콤보를 열기 전에 트리거에 표시할 `fallbackLabel`이 필요하다.

### 5. `src/sidepanel/lib/initialJiraFields.ts`

`JiraInitialFields`에 `sprintId`·`sprintName`이 `JiraLastSubmitFields` 경유로 자동 포함된다(`Omit<…, "siteId">` 형태라 별도 작업 없음). **여기서는 유효성을 검증하지 않는다** — 검증은 네트워크가 필요하고 이 함수는 순수 함수여야 한다. 검증은 §7.

### 6. `src/sidepanel/tabs/jiraFields/SprintField.tsx` (신규)

`EpicField`와 같은 골격(`FieldCombobox` + `useDebouncedSearch`)이되 **검색이 서버가 아니라 클라이언트다** — agile API에 스프린트 이름 검색이 없다. 목록을 한 번 받아 `FieldCombobox`의 기본 필터(`shouldFilter={!onSearch}`)에 맡긴다. 즉 `onSearch`를 넘기지 않는다.

```tsx
<SprintField
  projectKey={projectKey}
  value={fields.sprintId}
  fallbackLabel={fields.sprintName}
  onChange={(id, name) => onChange({ sprintId: id, sprintName: name })}
/>
```

**보드명 표시**: 사용자 결정은 "전 보드 합집합 + 보드명 그룹"이었으나, `FieldCombobox`는 children을 단일 `CommandGroup heading={groupLabel}`로 감싼다(`FieldCombobox.tsx` 하단). 보드별 그룹 헤딩을 만들려면 그 컴포넌트를 개조해야 하고, 이는 나머지 6개 필드에 영향을 준다(외과적 범위 위반). **대신 각 항목 우측에 보드명을 `text-muted-foreground`로 붙인다** — `EpicField`가 `{epic.key}`를 muted로, summary를 본문으로 두는 것과 같은 2단 표기다. 보드가 1개면(`boardName === ""`) 생략한다. 구분 가능성이라는 원 의도는 유지되고 공용 컴포넌트는 안 건드린다.

### 7. `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`

세 가지가 붙는다.

- **존재 판정**: `useSprintFieldMeta(projectKey, issueTypeId)`(§8) 결과가 있을 때만 `<FieldRow label={t("create.sprint")}>`를 렌더. `!isEpicType &&`로 감싸지 **않는다** — 에픽 제외는 createmeta가 이미 답을 준다(조건을 두 곳에 두면 드리프트한다).
- **meta 소멸 시 값 비우기**: meta가 `null`로 바뀌었는데 `fields.sprintId`가 남아 있으면 `onChange({ sprintId: undefined, sprintName: undefined })`. 이슈타입 전환(S4) 경로다.
- **sticky 검증**: `fields.sprintId`가 있고 아직 검증 전이면 `jira.getSprint` 1회 → `resolveStickySprint`(§9)가 준 patch를 적용. 스프린트를 고른 적 없는 제출에서는 **요청이 0회**다.

### 8. `src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts` (신규)

`(projectKey, issueTypeId)`가 둘 다 있을 때 `jira.sprintFieldMeta`를 호출해 `{ meta, loading }`을 반환하는 훅. 키가 바뀌면 재조회하고 이전 응답은 버린다(`useDebouncedSearch`의 `seqRef` 패턴과 동일한 stale 방어). **오류는 삼킨다** — 판정 실패는 "필드 없음"과 UI가 같다(PRD S5).

캐시는 두지 않는다. 이슈타입을 왕복하면 재조회한다 — 요청하지 않은 최적화다.

### 9. `src/sidepanel/tabs/jiraFields/sprint-sticky.ts` (신규)

```ts
export function resolveStickySprint(
  current: Pick<EditorIssueFields, "sprintId" | "sprintName">,
  fetched: JiraSprint | null,
): Partial<EditorIssueFields> | null;
```

- `current.sprintId`가 없으면 `null`(할 일 없음)
- `fetched`가 `null`이거나 **`state`가 `active`·`future` 중 하나가 아니면** `{ sprintId: undefined, sprintName: undefined }`. `closed`를 거르는 게 아니라 **유효 상태를 화이트리스트로 통과**시킨다 — 미지 상태 문자열이 유효로 새지 않게(R9).
- 유효하면 이름이 바뀌었을 때만 `{ sprintName: fetched.name }`, 아니면 `null`

순수 함수라 `project-change.ts`와 같은 위상으로 `tabs/jiraFields/`에 둔다(컴포넌트만 쓴다 — store는 `sidepanel/tabs`를 import하지 않는다는 규칙의 반대 방향이라 문제없다).

### 10. `src/sidepanel/tabs/jiraFields/project-change.ts` (선행 기획 파일 수정)

`applyProjectChange`가 비우는 목록에 `sprintId`·`sprintName` 추가. 스프린트는 보드에, 보드는 프로젝트에 묶이므로 프로젝트 스코프다(`cc`처럼 사이트 전역이 아니다). **선행 기획의 파일을 고치는 유일한 지점**이고, 그쪽 단위 테스트도 함께 갱신한다.

### 11. `src/sidepanel/lib/submitToJira.ts`

`JiraSubmitInput`에 `sprintId?: number`, `jira.submitIssue` payload에 그대로 전달. 그 외 무변경.

### 12. `src/sidepanel/tabs/IssueCreateModal.tsx` · `DraftDetailDialog.tsx`

- `submitToJira({ …, sprintId: issueFields.sprintId })` (`IssueCreateModal.tsx:167` / `DraftDetailDialog.tsx:419`)
- `setLastSubmitFields("jira", { …, sprintId, sprintName })` (`:194` / `:451`)
- `DraftDetailDialog`의 로컬 `SubmitFields` 타입에 2개 추가.

`markSubmitted`는 건드리지 않는다 — 이슈 목록 카드에 스프린트를 표시하지 않는다(비목표).

### 13. i18n — 신규 키 5개

| 키 | 파일 | ko | en |
|---|---|---|---|
| `create.sprint` | `namespaces/editor.ts` (147행 인근) | 스프린트 | Sprint |
| `field.sprint.select` | `namespaces/settings.ts` (66행 인근) | 스프린트 선택 (선택사항) | Select sprint (optional) |
| `field.sprint.search` | 〃 | 스프린트 검색... | Search sprints... |
| `field.sprint.empty` | 〃 | 사용 가능한 스프린트가 없습니다. | No sprints available. |
| `field.sprint.label` | 〃 | 스프린트 | Sprints |

`public/_locales`·log-viewer 복제 사전은 **무관**(manifest 문자열도, log-viewer가 쓰는 컴포넌트도 아니다). `src/i18n/` PostToolUse 훅이 ko/en 대칭을 자동 검사한다.

### 14. `e2e/jira-sprint-field.spec.ts` (신규)

`slack-issue-promotion.spec.ts`의 seed + `chrome.runtime.sendMessage` 스파이 패턴. `jira.sprintFieldMeta`/`jira.listSprints`/`jira.submitIssue`를 가로채 SW fetch 없이 판정한다. seed에 `projectKey`는 반드시 넣는다(없으면 `JiraConnectForm`의 `SetupDialog`가 모달로 자동 오픈돼 다른 판정을 가린다 — `slack-issue-promotion.spec.ts:31`).

## 데이터 흐름

```
[다이얼로그 Jira 탭]  projectKey="WEB", issueTypeId="10004"
        │
        ├─(선제)─→ jira.sprintFieldMeta ─→ createmeta/{proj}/issuetypes/{type}
        │              │                        └→ pickSprintField(values)
        │              ├─ null  → 행을 그리지 않는다. 남은 sprintId는 비운다.  [S2·S4]
        │              └─ meta  → <FieldRow> 삽입                              [S1]
        │
        ├─(sprintId 있을 때만)─→ jira.getSprint ─→ resolveStickySprint()
        │                              └─ closed/404 → 값 비움                  [S3]
        │
        ├─(콤보 열 때)─→ jira.listSprints ─→ board?projectKeyOrId=WEB&type=scrum
        │                                        └→ 보드별 sprint?state=active,future
        │                                             └→ mergeBoardSprints() (dedup·정렬)
        │
        └─(제출)─→ submitToJira({ …, sprintId: 42 })
                        └→ jira.submitIssue ─→ createIssue()
                                                 └─ sprintId 있으면 getSprintFieldMeta 재해석
                                                      fields["customfield_10020"] = 42 | [42]
                                                 └─ sprintId 없으면 분기 진입 안 함 (payload 불변)
```

## 인터페이스 설계

```ts
// src/types/jira.ts
export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  boardId: number;
  boardName: string;
}

export interface JiraSprintFieldMeta {
  fieldId: string;
  isArray: boolean;
}

export interface JiraCreateIssuePayload {
  // …기존 그대로
  sprintId?: number;   // 추가. fieldId·isArray는 background가 재해석한다(대안 A1)
}

// src/types/platform.ts — JiraLastSubmitFields
  sprintId?: number;
  sprintName?: string;

// src/store/editor-store.ts — EditorIssueFields
  sprintId?: number;
  sprintName?: string;

// src/background/jira-api.ts
interface CreateMetaFieldsResponse {
  // ⚠ 봉투 키(values vs fields)는 Task 0 spike가 실측으로 확정한다.
  values: {
    fieldId: string;
    name: string;
    schema?: { type?: string; custom?: string };
  }[];
  total?: number;
}

export function pickSprintField(res: CreateMetaFieldsResponse): JiraSprintFieldMeta | null;
export function mergeBoardSprints(
  perBoard: { boardName: string; sprints: JiraSprint[] }[],
): JiraSprint[];

export function getSprintFieldMeta(
  auth: JiraAuth, projectKey: string, issueTypeId: string,
): Promise<JiraSprintFieldMeta | null>;
export function listSprints(auth: JiraAuth, projectKey: string): Promise<JiraSprint[]>;
export function getSprint(auth: JiraAuth, sprintId: number): Promise<JiraSprint | null>;

// src/sidepanel/tabs/jiraFields/sprint-sticky.ts
export function resolveStickySprint(
  current: Pick<EditorIssueFields, "sprintId" | "sprintName">,
  fetched: JiraSprint | null,
): Partial<EditorIssueFields> | null;

// src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts
export function useSprintFieldMeta(
  projectKey: string | undefined,
  issueTypeId: string | undefined,
): { meta: JiraSprintFieldMeta | null; loading: boolean };

// src/sidepanel/tabs/jiraFields/SprintField.tsx
export function SprintField(props: {
  projectKey: string;
  value?: number;
  fallbackLabel?: string;
  onChange: (id: number | undefined, name?: string) => void;
}): JSX.Element;
```

## 기존 패턴 준수

- **필드 컴포넌트 컨벤션**: `FieldCombobox` + 조회 훅(`EpicField`·`RelatesField` 선례). 콤보 자체 스타일링 금지, shadcn `CommandItem` 사용.
- **background 순수 파서 분리**: `parseTransitions`(`jira-api.ts:446`)와 같은 형태로 `pickSprintField`·`mergeBoardSprints`를 export해 네트워크 없이 단위 테스트한다.
- **store는 `sidepanel/tabs`를 import하지 않는다**: 새 파일 2개(`sprint-sticky.ts`·`useSprintFieldMeta.ts`)는 컴포넌트만 쓰므로 `tabs/jiraFields/`에 둔다. `initialJiraFields`가 `lib/`에 있는 이유(editor-store가 쓴다)와 대비된다.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`(node), 콤보 인터랙션이 상태 전이를 좌우하면 `*.test.tsx`(jsdom + user-event) — `AssigneeField.test.tsx` 선례.
- **i18n 동시 갱신**: ko/en 두 로케일 모두. `src/i18n/` PostToolUse 훅이 red면 차단하므로 TDD red 단계에서 빨갛게 뜨는 건 정상이다.
- **세션 영속**: `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`라 별도 작업 없음.
- **privacy 문서**: 대조 대상이나 갱신은 불필요할 가능성이 높다 — 새 수집·저장·캡처가 없고, 기존 `<all_urls>`/Jira 자격증명으로 **같은 목적**(사용자 Jira 사이트에 이슈 등록)의 엔드포인트를 하나 더 부르는 것뿐이다. 다만 privacy 문서는 권한 문자열이 아니라 *실제 동작*에 묶이므로 `/push` 트라이아지에서 판단한다(Task 8).

## 대안 검토

**A1. `fieldId`·`isArray`를 패널이 payload에 실어 보낸다(제출 시 createmeta 재호출 제거).** 패널이 이미 판정하며 알고 있는 값이고 요청 1회를 아낀다. **기각** — ① 세션 영속(`EditorIssueFields`)에 캐시성 메타가 섞이거나, 아니면 판정 결과를 컴포넌트에서 제출 핸들러(`IssueCreateModal`·`DraftDetailDialog`)까지 prop/전역으로 끌어내려야 한다. Jira 필드는 `usePlatformFields`를 안 타고 editor-store·로컬 state로 갈라져 있어 이 경로가 두 벌이 된다. ② 다이얼로그를 연 뒤 이슈타입이 바뀌면 stale `fieldId`로 제출된다. background 재해석은 **제출 시점의 진실**을 쓴다. 대가는 스프린트를 고른 제출에서만 발생하는 요청 1회다.

**A2. `/rest/api/3/field` 전역 목록에서 gh-sprint 필드를 찾는다.** 사이트당 1회면 되고 캐시하기 좋다. **기각** — 존재 판정을 못 한다. 전역에 필드가 있어도 그 프로젝트+이슈타입의 create 화면에 올라갔는지는 별개이고, 그게 400의 원인이다. createmeta는 필드 ID·존재·값 형식을 한 번에 답한다.

**A3. createmeta 없이 필드를 항상 그리고, 400이 나면 스프린트를 떼고 재시도.** 요청이 가장 적다. **기각** — 스프린트 없는 프로젝트에서 매번 빈 콤보가 뜨고(목표 2 위반), 첨부 업로드까지 끝난 제출을 재시도하면 부분 생성 위험이 있다(`submitIssue`는 업로드+생성이 단일 호출이다 — `DraftDetailDialog.tsx:435` 주석). 사용자가 고른 값을 조용히 버리는 것도 PRD S6에 어긋난다.

**A4. 스프린트 목록도 선제 조회해 active 자동 선택.** 첫 제출이 편해진다. **기각(사용자 결정)** — board + 보드별 sprint로 N+1회가 다이얼로그를 열 때마다, 스프린트를 안 쓰는 사용자에게도 나간다. sticky가 반복 제출을 커버한다.

**A5. `FieldCombobox`에 다중 그룹(보드별 heading)을 추가.** 원 요청에 더 가깝다. **기각** — 공용 컴포넌트를 고치면 나머지 6개 필드가 영향권에 들어온다(외과적 범위). 항목 내 보조 라벨로 구분 가능성은 유지된다(§6).

**A6. 스프린트 이름 검색을 서버로 보낸다.** 목록이 길어도 대응된다. **기각** — agile API에 스프린트 이름 검색 파라미터가 없다. JQL로 우회하면 이슈 검색이지 스프린트 검색이 아니다. 한 프로젝트의 active+future 스프린트는 보통 한 자릿수라 클라이언트 필터로 충분하다.

## 위험 요소

**R1. OAuth scope — 이 기획 최대 변수.** agile API(`/rest/agile/1.0/…`)를 BugShot이 호출한 적이 없다. 현재 SCOPES는 classic 3종(`read:jira-user`·`read:jira-work`·`write:jira-work` — `oauth.ts:25`)이고, classic `read:jira-work`가 agile GET을 덮는다는 게 문서상 통설이나 **실측되지 않았다.** 안 되면 사용자 결정에 따라 granular scope(`read:board-scope:jira-software`·`read:sprint:jira-software`)를 추가하고 기존 OAuth 사용자 재동의를 감수한다. 여기 숨은 두 번째 함정: **Atlassian 앱은 classic과 granular scope를 섞지 못할 수 있다** — 섞을 수 없다면 3종 전부를 granular로 마이그레이션해야 하고, 그건 이 기획의 크기를 넘는다. Task 0이 개발자 콘솔 앱 설정까지 확인해야 하는 이유다. API 키(Basic) 경로는 scope 개념이 없어 무관하다.

**R2. 값 형식(스칼라 vs 배열)이 미검증이다.** company-managed에서 `"customfield_10020": 25`(스칼라)로 통하는 사례가 흔하지만, createmeta의 `schema.type`은 `array`로 오는 경우가 있다. 즉 **선언된 타입과 create가 받는 형식이 다를 수 있다.** 설계는 `isArray = schema.type === "array"`를 신호로 쓰되, Task 0이 실계정에서 어느 쪽이 통하는지 확정한다. 스칼라 실패 시 배열로 자동 재시도하는 폴백은 **두지 않는다**(A3와 같은 이유 — 제출 재시도는 첨부까지 얽힌다).

**R3. createmeta 응답 봉투 키.** 이슈타입 목록 엔드포인트는 `issueTypes`를 반환하는데(`IssueTypesResponse`), 필드 목록 엔드포인트는 `values`일 가능성이 높다. 문서에 `values`로 썼으나 **실측 전이다.** 틀리면 `pickSprintField`가 항상 `null`을 돌려 **필드가 조용히 안 보인다** — 오류가 아니라 "스프린트 없는 프로젝트"와 구분이 안 되는 실패 모드다. Task 0의 첫 확인 항목.

**R4. 선제 판정이 다이얼로그당 요청을 1회 늘린다.** Jira 탭을 여는 모든 사용자가, 스프린트를 안 쓰더라도 낸다. 이슈타입을 바꾸면 또 낸다(캐시 없음 — §8). 목표 2(없으면 미노출)의 값이다.

**R5. `getSprintFieldMeta`는 페이지네이션하지 않는다.** `maxResults=200` 1페이지만 본다. create 화면 필드가 200개를 넘으면 스프린트를 놓쳐 조용히 미노출된다. 실재 가능성이 낮아 감수하되, R3와 **증상이 같다**(무음 미노출)는 점이 진단을 어렵게 한다 — 둘 다 "필드가 안 보인다"로 신고된다.

**R6. 보드 단위 실패를 삼킨다(§1).** 권한 없는 보드가 섞이면 그 보드 스프린트만 조용히 빠진다. 사용자에겐 "있어야 할 스프린트가 목록에 없다"로 보인다. 전 보드 실패만 빈 목록으로 수렴하고 오류는 표시하지 않는다.

**R7. 제출 시점 재해석이 판정과 어긋날 수 있다.** 패널이 meta를 본 뒤 제출까지 사이에 Jira 화면 구성이 바뀌면 `createIssue`의 재해석이 `null`을 받고 **사용자가 고른 스프린트가 조용히 빠진 채 이슈가 생성된다.** 창이 좁아 감수하지만, 무음 누락이라는 성격은 기록해 둔다.

**R8. `applyProjectChange` 수정이 선행 기획 파일을 건드린다(§10).** 두 기획이 시간상 겹치면 충돌한다. `jira-project-switch`가 머지된 뒤 착수한다는 전제가 지켜져야 한다.

**R9. `state` 문자열 신뢰.** `JiraSprint.state`를 union으로 좁혔지만 실제로는 서버 문자열이다. 예상 밖 값이 오면 `resolveStickySprint`의 `state === "closed"` 검사를 통과해 **닫힌 스프린트가 유효로 판정될 수 있다.** 반대로 좁히면(active/future만 유효) 미지 값에서 값이 사라진다 — 후자가 안전하므로 **화이트리스트로 판정한다**(`state === "active" || state === "future"`가 아니면 무효).
