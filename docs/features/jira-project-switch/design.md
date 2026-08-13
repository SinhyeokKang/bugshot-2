# Jira 프로젝트 제출 시 전환 — 기술 설계

## 개요

프로젝트를 **계정 설정에서 이슈 필드로 승격**한다. `EditorIssueFields.projectKey`를 추가해 제출 다이얼로그가 그 값으로 제출하고, `accounts.jira.projectKey`는 "기본값"으로 강등된다(연동 탭 컨트롤은 그대로). sticky는 이미 존재하는 `lastSubmitFields.jira.projectKey`를 복원 소스로 승격해 얻는다 — 지금은 "직전 제출이 같은 프로젝트였나" 판정에만 쓰이고 값 자체는 버려진다.

**background는 변경하지 않는다.** `jira.listIssueTypes`·`jira.searchEpics`·`jira.submitIssue`가 이미 `projectKey`를 인자로 받고, 사이트가 고정이라 `loadAuth()`의 단일 auth 슬롯 전제도 유지된다. 변경은 전부 사이드패널이다.

## 변경 범위

### 1. `src/types/platform.ts`

`JiraLastSubmitFields`에 필드 2개 추가. 둘 다 optional이라 **스토어 마이그레이션 불필요**(`SETTINGS_STORE_VERSION`은 11 유지 — v7~v10이 같은 이유로 마커만 bump했던 것과 달리, 여기선 새 플랫폼 추가가 아니므로 bump 자체가 없다).

- `issueTypeId?: string` — 프로젝트가 바뀌면 이슈타입도 바뀌는데, 지금 이슈타입의 유일한 sticky 소스가 `accounts.jira.issueTypeId`(계정 기본값)라 기본 프로젝트가 아닌 곳으로 제출할 때마다 매번 다시 골라야 한다. 목표 2를 실질적으로 충족시키려면 직전 제출 이슈타입이 남아야 한다.
- `siteId?: string` — `jiraSiteId(auth)` 값. 직전 제출값이 **다른 사이트의 것**일 때 복원을 막는 게이트(S5). 지금은 `sameProject` 비교가 이 역할을 우연히 겸하고 있는데, 아래 D3에서 그 비교가 사라지므로 명시 게이트가 필요하다.

### 2. `src/store/editor-store.ts`

- `EditorIssueFields`에 `projectKey?: string` 추가. `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`에 있어 세션 영속 대상이고, optional 추가라 스냅샷 마이그레이션도 불필요하다.
- `confirmDraft`(853행)의 `initialJiraFields(lastSubmitFields.jira, jiraAccount)` 호출에 현재 사이트 id를 3번째 인자로 전달.
- `restorable` 게이트(852행: `!issueFields.assigneeId && !issueFields.priorityId`)는 그대로 둔다 — 세션 중 사용자가 이미 고른 값을 직전 제출값으로 덮지 않기 위한 기존 규율이다.

### 3. `src/sidepanel/lib/initialJiraFields.ts`

의미 재정의. 현재는 `projectKey`를 **반환하지 않고**(주석: "EditorIssueFields에 없는 키가 새어 세션에 영속된다") `sameProject` 판정에만 쓴다. 이제 `projectKey`가 정식 필드이므로 반환한다.

핵심 변화: **`sameProject` 게이트가 사라진다.** 직전 제출값은 한 프로젝트의 스냅샷이므로, `projectKey`까지 함께 복원하면 정합이 저절로 맞는다. 지금 "프로젝트가 갈리면 전체 무효"로 버리던 값들이 이제는 그 프로젝트와 함께 살아난다. 남는 게이트는 사이트 일치 하나다.

### 4. `src/sidepanel/tabs/jiraFields/project-change.ts` (신규)

프로젝트 전환 시 필드 정리 규칙의 단일 출처. 순수 함수라 컴포넌트가 아니라 별도 모듈에 둔다(`resolve-epic-parent.ts`와 같은 위상 — 같은 디렉터리, `__tests__/`에 단위 테스트).

`cc`만 남기고 나머지를 비운다. 근거: `cc`는 사이트 전역 사용자 멘션이고(`jira.searchUsers`는 `projectKey`를 받지 않는다), 나머지는 전부 프로젝트 스코프다. 우선순위는 Jira에서 전역 스킴이라 유지해도 되지만, 프로젝트마다 다른 우선순위 스킴을 쓸 수 있고 기존 `initialJiraFields`가 이미 "프로젝트가 갈리면 우선순위도 무효"로 판정하고 있어 같은 기준을 따른다.

### 5. `src/sidepanel/tabs/jiraFields/ProjectField.tsx` (신규)

제출 다이얼로그용 프로젝트 콤보. 연동 탭의 `src/sidepanel/tabs/ProjectCombobox.tsx`와 **별개 컴포넌트다** — 그쪽은 스토어를 직접 갱신(`updateJiraAccount`)하고 이쪽은 `value`/`onChange` prop을 받는다. 같은 디렉터리의 `EpicField`·`RelatesField`와 동일하게 `FieldCombobox` + `useDebouncedSearch(fetchProjects)` 조합을 쓴다.

서버 검색을 쓰는 이유: `searchProjects`가 `maxResults: 50`이라 클라이언트 필터만으로는 51번째 프로젝트에 도달할 수 없다(S4). `jira.listProjects` 메시지가 이미 `query?`를 받으므로 background 변경은 없다.

### 6. `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`

- 최상단에 프로젝트 `FieldRow` 추가(라벨은 기존 키 `jira.project` 재사용 — **i18n 신규 키 0**, `project.select`/`project.search`/`project.empty`도 재사용).
- 프로젝트 변경 핸들러가 `applyProjectChange`를 통해 patch를 만들어 `onChange`.
- `projectKey`를 하위 필드에 prop으로 내린다(아래 7·8).

### 7. `src/sidepanel/tabs/jiraFields/IssueTypeField.tsx`

두 가지를 바꾼다.

- `jiraAccount.projectKey` 대신 prop `projectKey`로 목록을 조회.
- **`defaultId` 자동 적용에 가드를 건다.** 현재 `useEffect(() => { if (!value && defaultId) onChange(defaultId) })`가 값이 비면 즉시 `accounts.jira.issueTypeId`를 밀어넣는다. 프로젝트를 바꿔 `issueTypeId`를 비운 직후 이게 발동하면 **다른 프로젝트에 존재하지 않는 이슈타입 ID가 자동으로 박혀** 제출이 400으로 죽는다. 현재 프로젝트가 계정 기본 프로젝트와 같을 때만 적용한다. `fallbackLabel`로 쓰는 `defaultName`도 같은 조건.

### 8. `src/sidepanel/tabs/jiraFields/EpicField.tsx` · `RelatesField.tsx`

`useJiraConfig().projectKey` 대신 prop `projectKey`를 쓴다. `useJiraConfig`는 "연동 완료" 게이트로 계속 쓴다(`AssigneeField`·`CcField`는 게이트 용도로만 호출하므로 무변경).

### 9. `src/sidepanel/tabs/IssueCreateModal.tsx`

- 제출 시 `projectKey: jiraAccount.projectKey` → `issueFields.projectKey ?? jiraAccount.projectKey`.
- 가드(163행) `!jiraAccount.projectKey`도 같은 유효 프로젝트 기준으로.
- `setLastSubmitFields("jira", …)`에 유효 `projectKey` + `issueTypeId` + `siteId: jiraSiteId(jiraAccount.auth)`.

### 10. `src/sidepanel/tabs/DraftDetailDialog.tsx`

로컬 `SubmitFields` 타입에 `projectKey?: string` 추가, `initialJiraFields` 호출에 사이트 id 전달, 제출·저장 경로를 9와 동일하게. (`usePlatformFields`는 Jira를 다루지 않는다 — Jira 필드만 editor-store/로컬 state로 갈라져 있는 기존 구조를 그대로 따른다.)

### 11. `e2e/jira-project-switch.spec.ts` (신규)

`slack-issue-promotion.spec.ts`의 패턴 재사용 — settings envelope seed + `chrome.runtime.sendMessage` 스파이로 `jira.listProjects`/`jira.listIssueTypes`/`jira.submitIssue`를 가로채 SW fetch 없이 판정.

## 데이터 흐름

```
[연동 탭]  accounts.jira.projectKey = "WEB"        ← 기본값. 이 기능은 절대 쓰지 않는다(읽기만)
                    │
                    │ (fallback)
                    ▼
[다이얼로그 열림]  initialJiraFields(last, account, currentSiteId)
                    │
                    ├─ last.siteId ≠ currentSiteId → account.projectKey + 빈 하위 필드
                    └─ 일치/미기록      → last.projectKey ?? account.projectKey + last 하위 필드
                    ▼
          issueFields.projectKey = "API"
                    │
                    ├──→ IssueTypeField / EpicField / RelatesField 조회 스코프
                    │
                    ├──→ [프로젝트 변경] applyProjectChange() → cc 제외 전부 undefined
                    │
                    └──→ submitToJira({ projectKey: "API", … })
                              │
                              └─→ setLastSubmitFields("jira", { projectKey: "API",
                                     issueTypeId, siteId, assignee…, priority…, relates, cc })
                                     ※ accounts.jira는 건드리지 않는다
```

## 인터페이스 설계

```ts
// src/types/platform.ts
export interface JiraLastSubmitFields {
  projectKey?: string;        // 기존 — 판정용에서 복원 소스로 승격
  issueTypeId?: string;       // 추가
  siteId?: string;            // 추가 — jiraSiteId(auth)
  assigneeId?: string;
  assigneeName?: string;
  priorityId?: string;
  priorityName?: string;
  parentKey?: string;
  parentLabel?: string;
  relates?: { key: string; label: string }[];
  cc?: { accountId: string; displayName: string }[];
}

// src/store/editor-store.ts
export interface EditorIssueFields {
  projectKey?: string;        // 추가
  issueTypeId?: string;
  // …기존 그대로
}

// src/sidepanel/lib/initialJiraFields.ts
export interface JiraAccountDefaults {
  projectKey?: string;
  issueTypeId?: string;
  assigneeId?: string;
  assigneeName?: string;
}

export type JiraInitialFields = Omit<JiraLastSubmitFields, "siteId">;

/**
 * currentSiteId: jiraSiteId(account.auth). 직전 제출값이 다른 사이트 것이면 통째로 버린다.
 * 미지정이면 사이트 검증을 건너뛴다(테스트·계정 미연결 경로).
 */
export function initialJiraFields(
  last: JiraLastSubmitFields | undefined,
  account: JiraAccountDefaults | undefined,
  currentSiteId?: string,
): JiraInitialFields;

// src/sidepanel/tabs/jiraFields/project-change.ts
/**
 * 프로젝트 전환 시 적용할 patch. cc를 제외한 프로젝트 스코프 필드를 undefined로 만든다.
 * 같은 프로젝트를 다시 고르면 빈 patch(=projectKey만)를 돌려 입력을 보존한다.
 */
export function applyProjectChange(
  current: Pick<EditorIssueFields, "projectKey">,
  nextProjectKey: string,
): Partial<EditorIssueFields>;

// src/sidepanel/tabs/jiraFields/ProjectField.tsx
export function ProjectField({
  value,
  fallbackLabel,
  onChange,
}: {
  value?: string;
  fallbackLabel?: string;
  onChange: (projectKey: string) => void;
}): JSX.Element;
```

`initialJiraFields`의 새 규칙:

```
sameSite   = !last?.siteId || !currentSiteId || last.siteId === currentSiteId
src        = (last && sameSite) ? last : {}
projectKey = src.projectKey ?? account?.projectKey
isDefaultProject = !!projectKey && projectKey === account?.projectKey

issueTypeId = src.issueTypeId ?? (isDefaultProject ? account?.issueTypeId : undefined)
assignee    = src.assigneeId ? (src.assigneeId, src.assigneeName)
                             : (isDefaultProject ? (account?.assigneeId, account?.assigneeName) : (undefined, undefined))
```

담당자 id·표시명을 **소스 단위로 통째로 고르는** 기존 규율은 유지한다(따로 fallback하면 다른 사람 이름이 붙는다 — 기존 주석이 POSTMORTEM 2026-06-27을 참조).

## 기존 패턴 준수

- **store는 `sidepanel/tabs`를 import하지 않는다.** `initialJiraFields`가 `sidepanel/lib/`에 있는 이유가 이것이고(editor-store가 쓴다), 새로 추가하는 `project-change.ts`는 컴포넌트만 쓰므로 `tabs/jiraFields/`에 둔다.
- **i18n**: 신규 키 없음(`jira.project`·`project.select`·`project.search`·`project.empty` 재사용). 따라서 8개 네임스페이스·`public/_locales`·log-viewer 복제 사전 모두 무변경.
- **필드 컴포넌트 컨벤션**: `FieldCombobox` + `useDebouncedSearch` 조합(`EpicField`·`RelatesField` 선례). 콤보 자체 스타일링 금지.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`(node), 콤보 인터랙션이 상태 전이를 좌우하면 `*.test.tsx`(jsdom + user-event) — `AssigneeField.test.tsx` 선례.
- **세션 영속**: `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`에 포함돼 자동으로 따라온다.

## 대안 검토

**A1. 연동 탭 `ProjectCombobox`를 제출 다이얼로그에 그대로 재사용.** 코드 추가가 거의 없다. 기각 — 그 컴포넌트는 `updateJiraAccount`로 계정을 직접 갱신하므로 제출 다이얼로그에서 쓰면 연동 설정이 뒤집힌다(목표 2 위반). prop 기반으로 개조하면 연동 탭 쪽도 같이 바뀌어 외과적 범위를 벗어난다.

**A2. 고른 프로젝트로 `accounts.jira.projectKey`를 갱신(상태 하나로 통일).** 가장 단순하다. 기각 — 다른 7개 플랫폼이 전부 `defaults`(설정)와 `fields`(이번 제출)를 분리하고 있고, 제출 다이얼로그가 설정을 덮어쓰는 부작용은 되돌릴 방법이 다이얼로그 안에 없다.

**A3. sticky 없이 매번 계정 기본 프로젝트로 초기화.** 구현이 가장 얕다. 기각 — 두 프로젝트를 번갈아 쓰는 게 이 기능의 주 용도인데 매번 다시 골라야 한다. GitHub repo·Linear team이 이미 `lastSubmitFields`로 sticky하다.

**A4. 사이트(워크스페이스) 복수화까지 한 번에.** 원 목표를 완전히 달성한다. 기각(이번 스코프) — `JiraAccount` 재구성 + 마이그레이션 + 연동 UI 다중 선택 + `lastSubmitFields` 사이트별 키잉 + 연동 해제 2단 분리가 딸려오고, background `loadAuth()` 단일 슬롯 전제도 깨야 한다. 프로젝트 전환은 그중 어느 것도 필요 없다. PRD "원 목표와의 거리" 참조.

**A5. `useJiraConfig`가 제출 컨텍스트의 프로젝트를 반환하도록 개조(prop drilling 회피).** 훅 하나만 고치면 하위 필드가 전부 따라온다. 기각 — 훅이 값을 얻으려면 React Context가 필요하고, 연동 탭에서도 쓰이는 훅이라 두 소비 맥락이 섞인다. 하위 필드가 3개뿐이라 prop이 더 싸고 명시적이다.

## 위험 요소

**R1. `initialJiraFields` 의미 변경이 조용한 회귀를 만들 수 있다.** 지금 이 함수는 "프로젝트가 갈리면 직전 제출값 전체 무효"로 동작한다. 새 규칙은 프로젝트까지 함께 복원하므로 **기존에는 버려지던 값이 살아난다.** 특히 연동 탭에서 기본 프로젝트를 바꾼 사용자는, 지금은 하위 필드가 리셋되지만 앞으로는 직전 프로젝트가 그대로 복원돼 "설정을 바꿨는데 다이얼로그가 안 따라온다"고 느낄 수 있다. **의도된 동작이다**(설정은 기본값, 직전 제출이 우선) — 기존 테스트 `initialJiraFields.test.ts`가 반드시 red로 잡히므로 갱신하면서 이 의도를 케이스명에 남긴다.

**R2. `IssueTypeField`의 `defaultId` 자동 주입(설계 7).** 가드를 빼먹으면 프로젝트 전환 직후 다른 프로젝트의 이슈타입 ID가 자동으로 박혀 제출이 400으로 죽는다. **이 기능이 유발하는 가장 직접적인 회귀 경로**이므로 단독 검증 대상으로 둔다.

**R3. `markSubmitted`의 `issueTypeName`이 계정 기본값이다.** `IssueCreateModal.tsx:189`·`DraftDetailDialog.tsx:445`가 `jiraAccount.issueTypeName`을 저장한다 — 실제 고른 이슈타입이 아니다. 지금도 부정확하지만(계정 기본과 다른 이슈타입을 고르면 어긋난다), 프로젝트 전환이 생기면 **다른 프로젝트의 이슈타입명이 목록에 표시되는** 형태로 더 자주 노출된다. 고치려면 `IssueTypeField.onChange`가 이름까지 올려야 해 시그니처와 두 호출부가 바뀐다. **이번 비목표** — 노출 빈도만 늘고 기존 부정확성의 성격은 같다.

**R4. 세션 영속된 `issueFields.projectKey`.** 편집 중인 이슈는 프로젝트를 세션에 들고 있으므로, 그 사이 연동 탭에서 기본 프로젝트를 바꿔도 진행 중인 이슈는 원래 프로젝트를 유지한다. 의도된 동작이나, 사용자에게는 "설정을 바꿨는데 반영이 안 된다"로 보일 수 있다(R1과 같은 계열).

**R5. 프로젝트 키 유효성은 제출 시점에만 판정된다.** 복원된 `projectKey`의 프로젝트가 삭제됐거나 권한을 잃었으면 제출이 실패한다. 기존에도 `accounts.jira.projectKey`에 같은 문제가 있어 위험 수준은 동일하다 — 사전 검증(목록 조회 후 대조)은 다이얼로그 열 때마다 네트워크를 태우므로 하지 않는다.

**R6. e2e에서 Jira는 프로젝트 미설정 시 모달이 자동으로 열린다.** `e2e/slack-issue-promotion.spec.ts:31` 주석대로 `JiraConnectForm`의 `SetupDialog`가 항상 마운트돼 있어, seed에 `projectKey`가 없으면 다른 판정이 가려진다. 신규 spec의 seed에도 `projectKey`를 반드시 넣는다.
