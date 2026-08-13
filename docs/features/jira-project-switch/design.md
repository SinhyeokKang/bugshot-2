# Jira 프로젝트 제출 시 전환 — 기술 설계

## 개요

프로젝트를 **계정 설정에서 이슈 필드로 승격**한다. `EditorIssueFields.projectKey`를 추가해 제출 다이얼로그가 그 값으로 제출하고, `accounts.jira.projectKey`는 "기본값"으로 강등된다(연동 탭 컨트롤은 그대로). sticky는 이미 존재하는 `lastSubmitFields.jira.projectKey`를 복원 소스로 승격해 얻는다 — 지금은 "직전 제출이 같은 프로젝트였나" 판정에만 쓰이고 값 자체는 버려진다.

**background는 변경하지 않는다.** `jira.listIssueTypes`·`jira.searchEpics`·`jira.submitIssue`가 이미 `projectKey`를 인자로 받고, 사이트가 고정이라 `loadAuth()`의 단일 auth 슬롯 전제도 유지된다. 변경은 전부 사이드패널이다.

## 변경 범위

### 1. `src/types/platform.ts`

`JiraLastSubmitFields`에 필드 2개 추가. 둘 다 optional이라 **스토어 마이그레이션 불필요**(`SETTINGS_STORE_VERSION`은 11 유지 — v7~v10이 같은 이유로 마커만 bump했던 것과 달리, 여기선 새 플랫폼 추가가 아니므로 bump 자체가 없다).

- `issueTypeId?: string` — 프로젝트가 바뀌면 이슈타입도 바뀌는데, 지금 이슈타입의 유일한 sticky 소스가 `accounts.jira.issueTypeId`(계정 기본값)라 기본 프로젝트가 아닌 곳으로 제출할 때마다 매번 다시 골라야 한다. 목표 2를 실질적으로 충족시키려면 직전 제출 이슈타입이 남아야 한다.
- `siteId?: string` — `jiraSiteId(auth)` 값. 직전 제출값이 **다른 사이트의 것**일 때 복원을 막는 판별자.

  근거는 둘이다. **① 기존 비대칭 해소**: `markSubmitted`가 이미 `jiraSiteId(auth)`를 이슈 레코드에 남기고 있는데(`IssueCreateModal.tsx:188`·`DraftDetailDialog.tsx:441`) `lastSubmitFields`에만 없다. **② latent 방어**: PRD S5 대로 현재 UI에서 사이트 교체는 반드시 `removeAccount`(→ `lastSubmitFields.jira` 삭제)를 거치므로 이 게이트가 막는 상태는 **도달 불가능**하다. 그럼에도 `finalize()`가 `setAccount("jira", next)`로 계정을 통째 교체하는 경로가 실재하므로, 값싼 판별자로 닫아둔다. *(아래 D3에서 `sameProject` 비교가 사라지는 것은 사실이지만, 그 비교가 사이트 게이트 역할을 "겸하고 있었다"는 서술은 부정확했다 — 같은 사이트 안에서 프로젝트가 갈릴 때도 발동했으므로 사이트 판정이 아니었다.)*

  **한계**: 이 게이트는 `initialJiraFields`에만 걸리므로 세션 `issueFields`를 통한 우회를 막지 못한다. R7 참조.

### 2. `src/store/editor-store.ts`

- `EditorIssueFields`에 `projectKey?: string` 추가. `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`에 있어 세션 영속 대상이고, optional 추가라 스냅샷 마이그레이션도 불필요하다.
- `confirmDraft`(853행)의 `initialJiraFields(lastSubmitFields.jira, jiraAccount)` 호출에 현재 사이트 id를 3번째 인자로 전달. **`initialJiraFields`의 실제 호출부는 여기와 `DraftDetailDialog.tsx:217` 둘뿐이다** — `IssueCreateModal`은 호출하지 않고 스토어의 `issueFields`를 읽기만 한다.
- **`restorable` 게이트에 `projectKey` 예외를 둔다.** 현재 `merged = { ...(restorable ? init : {}), ...s.issueFields }`(855행)는 `restorable`(852행: `!issueFields.assigneeId && !issueFields.priorityId`)이 false면 `init`을 통째로 버린다. 게이트 자체는 "세션 중 사용자가 이미 고른 값을 직전 제출값으로 덮지 않는다"는 기존 규율이라 유지하되, **게이트 조건이 담당자·우선순위이지 프로젝트가 아니므로** `projectKey`는 게이트와 무관하게 항상 `init` 값을 복원한다. 이 예외가 없으면 담당자를 한 번이라도 고른 세션에서 목표 2(sticky)가 성립하지 않는다. 담당자가 이미 856-862행에서 게이트 밖 특례를 받고 있어 선례도 있다.
- **`confirmDraft:858-861`의 담당자 백필에 프로젝트 정합 조건을 건다.** 이 블록은 게이트 밖에서 `if (!merged.assigneeId && init.assigneeId)`로 담당자를 채우는데, `merged.projectKey`(세션 값)와 `init`이 서로 다른 프로젝트일 수 있다. 그러면 다른 프로젝트의 담당자가 주입된다 — R2의 담당자판이다. `merged.projectKey === init.projectKey`일 때만 백필한다.

### 3. `src/sidepanel/lib/initialJiraFields.ts`

의미 재정의. 현재는 `projectKey`를 **반환하지 않고**(주석: "EditorIssueFields에 없는 키가 새어 세션에 영속된다") `sameProject` 판정에만 쓴다. 이제 `projectKey`가 정식 필드이므로 반환한다.

핵심 변화: **`sameProject` 게이트가 사라진다.** 직전 제출값은 한 프로젝트의 스냅샷이므로, `projectKey`까지 함께 복원하면 정합이 저절로 맞는다. 지금 "프로젝트가 갈리면 전체 무효"로 버리던 값들이 이제는 그 프로젝트와 함께 살아난다. 남는 게이트는 사이트 일치 하나다.

### 4. `src/sidepanel/tabs/jiraFields/project-change.ts` (신규)

프로젝트 전환 시 필드 정리 규칙의 단일 출처. 순수 함수라 컴포넌트가 아니라 별도 모듈에 둔다(`resolve-epic-parent.ts`와 같은 위상 — 같은 디렉터리, `__tests__/`에 단위 테스트). 이름도 그 선례를 따라 **`resolveProjectChange`** 로 둔다(patch를 *반환*하는 함수라 적용 동사가 아니다).

**비우는 것**: `issueTypeId`·`assigneeId`·`assigneeName`·`parentKey`·`parentLabel`·`relates`.
**남기는 것**: `priorityId`·`priorityName`·`cc`.

근거는 API 스코프가 아니라 **의미론**이다. 셋 다 프로젝트 인자를 받지 않는 사이트 전역 API를 쓴다 — `AssigneeField`·`CcField` 둘 다 `jira.searchUsers`(`GET /rest/api/3/user/search`, `assignable/search`가 아님)이고 `jira.listPriorities`는 인자가 아예 없다(`GET /rest/api/3/priority`). 갈리는 지점은 **그 값이 대상 프로젝트에서 유효한가**다:

- **담당자는 비운다** — 유저 검색은 전역이지만 배정 가능 여부는 프로젝트 권한에 묶인다. 이 논거는 이미 코드 주석에 있다(`JiraConnectForm.tsx:53-54`: *"유저 검색은 사이트 전역이라 project 없이도 고를 수 있다 … 다만 담당자 자체는 프로젝트 스코프라(assignable user = 프로젝트 권한) 프로젝트가 바뀌면 비운다"*).
- **참조(cc)는 남긴다** — 본문 멘션일 뿐 프로젝트 권한 판정을 받지 않는다.
- **우선순위는 남긴다** — 우선순위 스킴은 사이트 전역이고 대부분 조직이 공유한다. 프로젝트별 스킴을 쓰는 조직에서는 어긋날 수 있으나, 그 경우 제출 시 서버가 거부할 뿐이고 **유효한 값을 매번 버리는 UX 비용**이 더 크다. 기존 `initialJiraFields`가 "프로젝트가 갈리면 전량 무효"로 판정하던 것과 갈라지는 유일한 지점이다.

### 5. `src/sidepanel/tabs/jiraFields/ProjectField.tsx` (신규)

제출 다이얼로그용 프로젝트 콤보. 연동 탭의 `src/sidepanel/tabs/ProjectCombobox.tsx`와 **별개 컴포넌트다** — 그쪽은 스토어를 직접 갱신(`updateJiraAccount`)하고 이쪽은 `value`/`onChange` prop을 받는다. 같은 디렉터리의 `EpicField`·`RelatesField`와 동일하게 `FieldCombobox` + `useDebouncedSearch(fetchProjects)` 조합을 쓴다.

표시 형태는 **트리거 1행 / 리스트 항목 2행**이다. `FieldCombobox` 트리거는 단일 span truncate 고정이라(2행 prop이 없다) `` `${name} (${KEY})` `` 로 합성하고, 리스트 항목은 `children`에 `flex-col`로 이름 + 키 2행을 그린다(`AssigneeField.tsx:129-136` 선례). 필수 필드라 `clearable` 없음.

**`aria-label={t("jira.project")}` 를 트리거에 붙인다.** `FieldRow`의 `<label>`은 `htmlFor`/`id` 연결이 없고 컨트롤을 감싸지도 않아, 행이 6→7개가 되면 접근 이름 없는 combobox가 7개 나열된다. 이 라벨 하나가 **접근성과 e2e 판정 수단을 동시에 해결한다**(§11 참조). 기존 6개 필드의 같은 문제는 외과적 범위 밖이라 건드리지 않는다.

서버 검색을 쓰는 이유: `searchProjects`가 `maxResults: 50`이라 클라이언트 필터만으로는 51번째 프로젝트에 도달할 수 없다(S4). `jira.listProjects` 메시지가 이미 `query?`를 받으므로 background 변경은 없다.

### 6. `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`

- 최상단에 프로젝트 `FieldRow` 추가(라벨은 기존 키 `jira.project` 재사용 — **i18n 신규 키 0**, `project.select`/`project.search`/`project.empty`도 재사용).
- 프로젝트 변경 핸들러가 `resolveProjectChange` patch를 `onChange`로 넘긴다.
- **같은 핸들러에서 `setIsEpicType(false)`.** `isEpicType`은 `handleIssueTypeChange`(`:23-35`) 안에서만 갱신되는 로컬 상태라, patch를 `onChange`로 넘기는 것만으로는 **절대 리셋되지 않는다**. 에픽 프로젝트에서 일반 프로젝트로 옮길 때 상위 에픽 행이 숨은 채 남는다.
- **프로젝트 변경 직후 `IssueTypeField` 콤보를 자동으로 연다.** 이유는 §12(제출 게이트) 참조 — 제출 버튼이 즉시 잠기는 것에 대한 유일한 단서다.
- `projectKey`를 하위 필드에 prop으로 내린다(아래 7·8).

> 참고(기존 결함, 이번에 안 고침): `IssueTypeField:57`의 자동 주입 `onChange(defaultId)`가 `hierarchyLevel`을 넘기지 않아, 계정 기본 이슈타입이 에픽 타입이어도 `isEpicType`이 false로 남는다.

### 7. `src/sidepanel/tabs/jiraFields/IssueTypeField.tsx`

두 가지를 바꾼다.

- `jiraAccount.projectKey` 대신 prop `projectKey`로 목록을 조회.
- **`defaultId` 자동 적용에 가드를 건다 — 경로가 둘이라 둘 다 막아야 한다.**
  1. `useEffect(() => { if (!value && defaultId) onChange(defaultId) })`(`:56-58`) — 값이 비면 즉시 `accounts.jira.issueTypeId`를 밀어넣는다.
  2. **`effectiveValue = value ?? defaultId`(`:53`)** — 이 파생값이 라벨(`:69`)과 체크마크(`:83`)를 직접 먹인다. `fallbackLabel` prop을 쓰는 게 아니라 `label={selected?.name ?? (effectiveValue ? defaultName : undefined)}` 3항 안에 접혀 있다.

  effect만 가드하면 실패 모드가 **바뀐다**: 화면엔 계정 기본 이슈타입("Bug")이 선택된 것처럼 보이는데 실제 `issueFields.issueTypeId`는 비어 있으므로, 제출은 400이 아니라 `create.requiredMissing`으로 죽는다. 사용자에게는 "골라놨는데 안 골랐다고 한다"가 된다. 둘 다 **현재 프로젝트가 계정 기본 프로젝트와 같을 때만** 적용한다.

### 8. `src/sidepanel/tabs/jiraFields/EpicField.tsx` · `RelatesField.tsx`

`useJiraConfig().projectKey` 대신 prop `projectKey`를 쓴다. `useJiraConfig`는 "연동 완료" 게이트로 계속 쓴다(`AssigneeField`·`CcField`는 게이트 용도로만 호출하므로 무변경).

**목록 잔존을 함께 처리한다.** 캐시를 비우는 `useEffect`는 `IssueTypeField.tsx:26-29` 하나뿐이고, 이 두 컴포넌트의 목록은 `useDebouncedSearch` 내부 `items`에 있는데 훅이 `{items, loading, error, search}`만 노출해 **reset 수단이 없다.** 그대로 두면 프로젝트를 바꾼 뒤 다음 fetch가 resolve될 때까지 이전 프로젝트의 에픽·연결 이슈가 목록에 남는다. `useDebouncedSearch`에 reset을 노출하거나 `key={projectKey}`로 remount시킨다 — 후자가 변경 면적이 작다.

### 9. `src/sidepanel/tabs/IssueCreateModal.tsx`

- 제출 시 `projectKey: jiraAccount.projectKey` → `issueFields.projectKey ?? jiraAccount.projectKey`.
- 가드(163행) `!jiraAccount.projectKey`도 같은 유효 프로젝트 기준으로.
- `setLastSubmitFields("jira", …)`에 유효 `projectKey` + `issueTypeId` + `siteId: jiraSiteId(jiraAccount.auth)`.
- 분석 이벤트에 `project_overridden`(boolean — 유효 프로젝트 ≠ `jiraAccount.projectKey`) 추가. `src/background/analytics.ts:26`의 `issue_submitted` 허용 프로퍼티 화이트리스트에도 등록해야 값이 통과한다. 프로젝트 키 자체는 보내지 않는다.

**`setLastSubmitFields("jira", …)` 호출부는 `IssueCreateModal.tsx:194`·`DraftDetailDialog.tsx:451` 둘이고 반드시 함께 고친다.** `sameSite`는 `!last?.siteId`면 통과하므로, 한 곳만 `siteId`를 쓰면 그쪽으로 제출하는 순간 siteId 없는 레코드가 덮어써져 게이트가 무음으로 사라진다.

### 10. `src/sidepanel/tabs/DraftDetailDialog.tsx`

로컬 `SubmitFields` 타입에 `projectKey?: string` 추가, `initialJiraFields` 호출(`:217`)에 사이트 id 전달, 제출·저장 경로를 9와 동일하게. (`usePlatformFields`는 Jira를 다루지 않는다 — Jira 필드만 editor-store/로컬 state로 갈라져 있는 기존 구조를 그대로 따른다.)

> 이 로컬 `SubmitFields`는 `EditorIssueFields`와 구조가 동일한 복제본이고 이미 `<JiraIssueFields fields={fields}>`(`:1023`)로 넘어간다. 타입을 지우고 `EditorIssueFields`로 통일하는 편이 단순하지만, **이 기능과 무관한 리팩터이고 `audit-refactor-6` 소관과 겹치므로 이번엔 필드만 추가한다**(비목표).

### 11. `e2e/jira-project-switch.spec.ts` (신규)

`slack-issue-promotion.spec.ts`의 패턴 재사용 — settings envelope seed + `chrome.runtime.sendMessage` 스파이로 `jira.listProjects`/`jira.listIssueTypes`/`jira.submitIssue`를 가로채 SW fetch 없이 판정.

판정 수단 3가지를 미리 못박는다:

- **콤보 특정**: `ProjectField`에 `data-testid="jira-project-combobox"`. `jiraFields/`의 testid는 현재 0개이고 `FieldRow`의 `<label>`에 `htmlFor`가 없어 `getByLabel`이 실패한다. 남는 `role=combobox` nth 인덱싱은 불안정하다 — Jira 탭 콤보가 6개인데 `EpicField`가 `isEpicType`일 때 조건부 언마운트되고(`JiraIssueFields.tsx:59`), 팝오버가 열리면 cmdk `CommandInput`이 `role=combobox`를 하나 더 추가한다. (`FieldCombobox`에 `testId?`를 얹는 방식도 가능 — `CcMultiCombobox`에 선례가 있다.)
- **기본값 불변 판정**: 연동 탭 UI를 열지 말고 `chrome.storage.local`의 `bugshot-settings`에서 `accounts.jira.projectKey`를 직접 단언한다. 연동 탭을 열면 `SetupDialog` 자동 오픈 등 부작용이 낀다(R6과 같은 계열).
- **seed**: `projectKey: "WEB"` 필수(R6)에 더해 **`auth.cloudId` 필수**. 기존 spec의 auth는 `{kind:"oauth", accessToken, grantedAt}`뿐이라 `jiraSiteId(auth)`가 `undefined`를 반환하고 `sameSite` 게이트가 공허하게 통과한다. envelope은 최신 `version: 11` + 최신 shape로 seed한다(기존 spec들은 v9/v10으로 seed해 migration 체인을 태운다).

### 12. `src/sidepanel/tabs/SubmitFieldsDialog.tsx`

제출 버튼 활성 조건 `fieldsReady`(`:197-213`)의 jira 분기가 지금 `!!jiraFields.issueTypeId` 하나다. 다른 7개는 전부 최상위 스코프를 조건에 넣으므로(`owner/repo`·`teamId`·`projectId`·`workspaceGid`·`listId`·`channelId`) **`!!jiraFields.projectKey && !!jiraFields.issueTypeId`로 맞춘다.**

같이 알아둘 것: 지금까지 이 조건은 `defaultId` 자동 주입 때문에 사실상 항상 true였다. R2 가드를 넣으면 **비-기본 프로젝트에서 처음으로 false가 된다** — 즉 프로젝트를 고른 직후 제출 버튼이 즉시 잠기고, 이 기능의 주 동선(S1)에서 매번 밟는다. `required` 별표는 상시 표시라 상태 변화 신호가 못 되므로, §6의 **이슈타입 콤보 자동 오픈**이 유일한 단서다(추가 클릭 0).

(세 번째 게이트로 `jiraConfigured = isJiraAccountComplete(jiraAccount)`(`:171`)가 여전히 `account.projectKey`를 요구한다. PRD 비목표대로 계정 기본값은 계속 필수이므로 그대로 둔다. 또 이 게이트가 false면 `:290-293`이 Jira 필드를 통째로 렌더하지 않는다 — 그래서 `jiraFields/`에 필드 단위 disabled 표현이 존재하지 않는다.)

## 데이터 흐름

```
[연동 탭]  accounts.jira.projectKey = "WEB"        ← 기본값. 이 기능은 절대 쓰지 않는다(읽기만)
                    │
                    │ (fallback)
                    ▼
initialJiraFields(last, account, currentSiteId)
  호출부는 둘뿐 ─ editor-store.confirmDraft:853 (캡처 확정 시 1회, 주경로)
                └ DraftDetailDialog:217        (다이얼로그 open effect)
  ※ IssueCreateModal은 호출하지 않는다 — 스토어의 issueFields를 읽기만 한다.
    다른 7개 플랫폼이 usePlatformFields로 open마다 재계산하는 것과 다르다.
    (R4가 말한 "설정 변경이 반영 안 됨"의 실제 원인이 이 시점 차이다)
                    │
                    ├─ last.siteId ≠ currentSiteId → account.projectKey + 빈 하위 필드
                    └─ 일치/미기록      → last.projectKey ?? account.projectKey + last 하위 필드
                    ▼
          issueFields.projectKey = "API"      ← restorable 게이트와 무관하게 항상 복원
                    │
                    ├──→ IssueTypeField / EpicField / RelatesField 조회 스코프
                    │
                    ├──→ [프로젝트 변경] resolveProjectChange()
                    │       비움: issueType·assignee·parent·relates
                    │       유지: priority·cc  (사이트 전역)
                    │
                    └──→ submitToJira({ projectKey: "API", … })
                              │
                              └─→ setLastSubmitFields("jira", { projectKey: "API",
                                     issueTypeId, siteId, assignee…, priority…, relates, cc })
                                     ※ accounts.jira.projectKey는 건드리지 않는다
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
 * 프로젝트 전환 시 적용할 patch.
 * 비움: issueTypeId·assigneeId·assigneeName·parentKey·parentLabel·relates
 * 유지(patch에 넣지 않음): priorityId·priorityName·cc — 사이트 전역 스코프
 * 같은 프로젝트를 다시 고르면 빈 patch(=projectKey만)를 돌려 입력을 보존한다.
 */
export function resolveProjectChange(
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
// 트리거에 aria-label={t("jira.project")} + data-testid="jira-project-combobox"
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

담당자 id·표시명을 **소스 단위로 통째로 고르는** 기존 규율은 유지한다 — 따로 fallback하면 다른 사람 이름이 붙는다(`editor-store.ts:858` 주석).

**직결 선례는 `POSTMORTEM 2026-06-30 — Slack 채널·멘션 직전값 미기억 (prefill 우선순위 역전)`** 이다: *"제출 목적지 필드는 last 우선, defaults는 fallback. Asana/ClickUp의 defaults 우선은 workspace(거친 스코프) 한정 예외."* 이번 변경은 Jira project를 workspace 위상에서 제출 목적지로 재분류하는 것이므로 이 회고가 정한 규칙과 정확히 일치한다.

> `editor-store.ts:858` 주석이 가리키는 "POSTMORTEM 2026-06-27"은 **실재하지 않는다** — 그 날짜의 유일한 항목은 cross-origin stylesheet 관련이고 담당자와 무관하다. 이 stale 주석 자체도 정리 대상이다(tasks Task 2).

## 기존 패턴 준수

- **store는 `sidepanel/tabs`를 import하지 않는다.** `initialJiraFields`가 `sidepanel/lib/`에 있는 이유가 이것이고(editor-store가 쓴다), 새로 추가하는 `project-change.ts`는 컴포넌트만 쓰므로 `tabs/jiraFields/`에 둔다. 금지 방향은 store→tabs이고 여기는 tabs→store(타입 import)라 충돌하지 않는다 — `resolve-epic-parent.ts`가 같은 위상의 선례다.
- **i18n**: 신규 키 없음(`jira.project`·`project.select`·`project.search`·`project.empty` 재사용). 따라서 8개 네임스페이스·`public/_locales`·log-viewer 복제 사전 모두 무변경. 다만 이 4개는 **`integrations` 네임스페이스**이고 현재 유일 사용처가 연동 탭(`JiraConnectForm.tsx:40`)이다 — 제출 다이얼로그의 다른 필드 라벨은 `create.*`/`field.*` 계열이라 네임스페이스가 갈린다. 사전이 평면 병합이라 동작 문제는 없다.
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

**R1-b. 마이그레이션 경계의 일회성 회귀.** 마이그레이션이 없으므로 기존 사용자의 `lastSubmitFields.jira`는 `siteId: undefined`이고, `sameSite`가 미기록을 통과로 처리한다. 즉 **업데이트 직후 첫 다이얼로그에서 모든 기존 사용자가 이 경로를 탄다** — `sameProject` 게이트가 사라진 새 규칙으로 옛 프로젝트가 복원된다. 연동 탭에서 기본 프로젝트를 바꿔둔 사용자에게는 한 번 눈에 띄는 사건이다. **수용한다** — R1과 같은 성격이고, 마이그레이션으로 기존 레코드를 드롭하면 잘 쓰던 sticky까지 날린다.

**R2. `IssueTypeField`의 `defaultId` 자동 주입(설계 7). 가드 지점이 둘이다.** effect(`:56-58`)와 파생값 `effectiveValue = value ?? defaultId`(`:53`). effect만 막으면 실패 모드가 400에서 `create.requiredMissing`으로 바뀔 뿐 여전히 깨진다(§7 참조). **이 기능이 유발하는 가장 직접적인 회귀 경로**이므로 단독 검증 대상으로 둔다.

**R3. `markSubmitted`의 `issueTypeName`이 계정 기본값이다.** `IssueCreateModal.tsx:189`·`DraftDetailDialog.tsx:442`가 `jiraAccount.issueTypeName`을 저장한다 — 실제 고른 이슈타입이 아니다. 지금도 부정확하지만(계정 기본과 다른 이슈타입을 고르면 어긋난다), 프로젝트 전환이 생기면 **다른 프로젝트의 이슈타입명이 목록에 표시되는** 형태로 더 자주 노출된다. 고치려면 `IssueTypeField.onChange`가 이름까지 올려야 해 시그니처와 두 호출부가 바뀐다. **이번 비목표** — 노출 빈도만 늘고 기존 부정확성의 성격은 같다.

**R4. 세션 영속된 `issueFields.projectKey`.** 편집 중인 이슈는 프로젝트를 세션에 들고 있으므로, 그 사이 연동 탭에서 기본 프로젝트를 바꿔도 진행 중인 이슈는 원래 프로젝트를 유지한다. 의도된 동작이나, 사용자에게는 "설정을 바꿨는데 반영이 안 된다"로 보일 수 있다(R1과 같은 계열).

R1·R4 공통으로 **완화책을 넣지 않기로 했다.** 연동 탭 프로젝트 라벨에 *"기본값 — 제출할 때 바꿀 수 있습니다"* 보조 1줄이면 해소되지만 i18n 신규 키 1개가 들고, 이번 스코프는 신규 키 0을 유지한다. Jira가 다른 플랫폼과 달리 `defaults` 객체가 아니라 평면 계정 필드라 "설정 = 진실"로 읽히는 구조라는 점이 이 위험의 근원이다(`types/platform.ts:94-104`). PRD S7로 사용자 흐름을 문서화해 두었다.

**R5. 프로젝트 키 유효성은 제출 시점에만 판정된다.** 복원된 `projectKey`의 프로젝트가 삭제됐거나 권한을 잃었으면 제출이 실패한다. 기존에도 `accounts.jira.projectKey`에 같은 문제가 있어 위험 수준은 동일하다 — 사전 검증(목록 조회 후 대조)은 다이얼로그 열 때마다 네트워크를 태우므로 하지 않는다.

같은 계열로 **담당자는 프로젝트가 바뀌어도 목록이 좁혀지지 않는다.** `jira.searchUsers`가 site-wide(`/user/search`)라 전환한 프로젝트에 배정 불가한 사용자를 고를 수 있고, 이건 400의 독립 경로다 — `resolveProjectChange`가 값을 비우는 건 *초기 상태*만 보호한다. 사용자가 직접 고른 뒤의 유효성은 서버가 판정한다.

**R6. e2e에서 Jira는 프로젝트 미설정 시 모달이 자동으로 열린다.** `e2e/slack-issue-promotion.spec.ts:31` 주석대로 `JiraConnectForm`의 `SetupDialog`가 항상 마운트돼 있어, seed에 `projectKey`가 없으면 다른 판정이 가려진다. 신규 spec의 seed에도 `projectKey`를 반드시 넣는다.

**R7. 연동 해제가 세션 `issueFields`를 지우지 않는다.** `removeAccount`는 스토어만 정리하고 `chrome.storage.session`의 `editor:${tabId}` 스냅샷과 `useEditorStore.issueFields`는 남긴다. 편집 세션이 살아 있는 채로 해제 → 다른 사이트 재연결하면 `restorable`이 false(assigneeId 잔존)라 옛 사이트 값이 그대로 제출된다. **`siteId` 게이트는 `initialJiraFields`에만 걸려 이 경로를 못 막는다.** 프로젝트를 필드로 승격하면 여기에 "새 사이트에 없는 projectKey"까지 얹힌다. 기존에도 담당자·에픽에 같은 문제가 있었고 사이트 교체 자체가 현재 UI에서 도달 불가(S5)이므로 **이번 비목표** — 세션 정리는 사이트 복수화와 함께 다룰 주제다.

**R8. 프로젝트 오선택이 비가역이다.** `issues-store.ts:364-376`의 `markSubmitted`가 제출 성공 즉시 video/image/network blob을 삭제한다. 잘못된 프로젝트로 **성공** 제출하면 캡처 원본이 사라져 올바른 프로젝트로 다시 올릴 수 없다(실패 제출은 blob이 남으므로 무관하다). 이 기능은 프로젝트를 전역 기본값에서 매 제출 선택 가능으로 바꾸므로 **오선택 확률을 구조적으로 올린다.** 이번 스코프에서는 방어 UI를 넣지 않고 위험으로만 기록한다 — 프로젝트 행이 다이얼로그 최상단에 있어 제출 전 눈에 들어오고, 실수했더라도 Jira에서 이슈 이동(Move)으로 복구 가능하다(캡처 원본이 필요한 재제출과 달리 이슈는 이미 올라가 있다).
