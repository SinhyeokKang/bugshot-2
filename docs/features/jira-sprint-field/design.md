# Jira 제출 시 Sprint 선택 — 기술 설계

## 개요

**필드의 존재 여부를 서버에 묻고, 답이 "있다"일 때만 그린다.** Sprint는 사이트마다 ID가 다른 커스텀 필드라 클라이언트가 알 수 있는 게 없다 — createmeta 상세 엔드포인트(`/rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}`)가 그 프로젝트+이슈타입의 **create 화면에 실제로 올라간 필드 목록**을 주고, 거기서 `schema.custom === "com.pyxis.greenhopper.jira:gh-sprint"`를 찾으면 존재 판정·필드 ID·값 형식이 한 번에 나온다. 칸반·보드 미연결·team-managed·에픽 타입 같은 케이스를 **열거하지 않고** 흡수하는 게 이 선택의 핵심이다(열거하면 다음 케이스에서 구멍 난다 — CSS 캐스케이드 화이트리스트와 같은 이유).

값 목록만은 createmeta가 못 준다 — sprint 필드 항목에 `allowedValues`도 **`autoCompleteUrl`도 없다**(2026-08-13 실측). 그래서 목록은 **agile API**로 간다: `board?projectKeyOrId=` → (kanban 제외) 보드별 `board/{id}/sprint?state=active,future`. 이건 BugShot이 처음 호출하는 API 계열이고, **현재 classic scope로는 401 `scope does not match`가 확정됐다**(R1) — 우회로였던 A7이 닫혔으므로 이 기획은 **granular scope 추가 없이는 성립하지 않는다.**

배치는 세 층으로 나뉜다:
- **존재 판정(createmeta)** — 선제. `(siteId, projectKey, issueTypeId)`가 확정될 때마다 1회, **세션 캐시 히트면 0회**.
- **sticky 검증(`sprint/{id}`)** — 조건부. 저장된 `sprintId`가 있고 meta가 확정된 뒤에만 1회.
- **값 목록(agile board→sprint)** — lazy. 콤보를 열 때. `IssueTypeField`·`EpicField`와 같은 패턴.

**필드 ID 해석은 background에서 두 번 일어난다** — 판정용 1회(패널 요청)와 제출용 1회(`createIssue` 내부). 패널이 `fieldId`를 payload에 실어 나르지 않는 이유는 A1에 있다.

**이 문서는 `jira-project-switch` 구현 이후 상태를 전제한다**(PRD §선행 기획 의존). `EditorIssueFields.projectKey`, `resolveProjectChange`, 하위 필드의 `projectKey` prop, `FieldCombobox`의 `ariaLabel?`/`testId?` prop이 이미 있다고 본다.

## 변경 범위

### 1. `src/background/jira-api.ts`

함수 4개 + 순수 파서 3개 추가. 기존 함수는 `createIssue` 하나만 수정한다.

```
SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint"
MAX_SPRINT_BOARDS = 5
```

- **`pickSprintField(res)`** (순수, export) — createmeta 필드 응답에서 sprint 필드를 골라 `JiraSprintFieldMeta | null`. `parseTransitions`(`jira-api.ts:446`)가 이미 "네트워크 함수 옆에 순수 파서를 export해 단위 테스트한다"는 선례를 만들어 뒀고 같은 위상이다.
  - 후보가 2개 이상이면(마이그레이션 잔재로 gh-sprint 스키마 필드가 복수인 사이트가 있다) **첫 번째를 쓴다.** 우선순위 규칙을 발명하지 않는다 — 어느 쪽이 맞는지 판정할 근거가 클라이언트에 없다.
- **`isActiveSprint(state)`** (순수, export) — `state === "active" || state === "future"`. `JiraSprint.state`는 **서버 문자열이라 `string`으로 두고**(union으로 좁히면 미지 값이 타입 위에서만 사라진다) 판정을 이 함수 하나로 모은다. R9와 §9가 같은 출처를 쓴다.
- **`mergeBoardSprints(perBoard)`** (순수, export) — 보드별 결과를 합쳐 `id` 기준 dedup(같은 스프린트가 두 보드에 걸릴 수 있다 — **먼저 온 보드의 `boardName`을 남긴다**), `active` → `future` 순, 같은 상태 안에서는 `id` 오름차순. 반환은 `{ sprints, multiBoard }` — 보드명을 그릴지 말지는 UI 신호라 `boardName: ""` 같은 센티널로 인코딩하지 않는다.
- **`getSprintFieldMeta(auth, projectKey, issueTypeId)`** — 위 엔드포인트를 호출해 `pickSprintField`. 페이지네이션은 **하지 않는다**(R5).
- **`listSprints(auth, projectKey)`** — `GET /rest/agile/1.0/board?projectKeyOrId={key}&maxResults=50` → **`type !== "kanban"`인 보드만** 남겨 상위 `MAX_SPRINT_BOARDS`개에 `Promise.allSettled`로 `GET /rest/agile/1.0/board/{id}/sprint?state=active,future&maxResults=50`. 선례는 `src/background/messages.ts:719-745`(`MAX_SHEETS` 상한 + `allSettled` — 주석이 *"SW 메모리·동시 fetch 폭증 차단"*).

  **`type=scrum`으로 서버 필터하지 않는다.** 2026-08-13 실측에서 **team-managed 프로젝트의 보드는 `type: "simple"`로 오고 그중 일부가 스프린트를 정상 반환했다**(SRE·BMD·SBDATA 보드 → 200 + 스프린트). `type=scrum`으로 좁혔으면 team-managed 스크럼 팀이 통째로, 그것도 **무음으로** 빠졌을 것이다. 반대로 칸반은 400이 확정이라(`보드는 스프린트를 지원하지 않습니다.`) 호출 자체가 낭비여서 클라이언트에서 제외한다. 이 필터가 팬아웃을 실제로 눌러준다 — 실측 사이트의 한 프로젝트는 보드가 15개인데 kanban 13개를 빼면 2개다.

  **보드 단위 실패도, 보드 목록 조회 실패도 삼킨다** — 전자는 스프린트 미지원 보드·권한 없음, 후자는 재연동 전 OAuth 사용자(PRD §OAuth scope 정책)라 둘 다 "고를 게 없다"로 수렴시킨다. 오류를 노출하면 재연동 전 사용자 전원이 매번 오류 문구를 보게 되고, 그들이 당장 할 수 있는 일은 없다. 대가는 진단 불가이며 그 자리를 분석 축이 메운다(R6). **판정은 status로만 한다** — 400의 `errorMessages`가 사용자 로케일로 번역돼 오므로(위 한국어 문구) 문자열 매칭은 성립하지 않는다.
- **`getSprint(auth, sprintId)`** — `GET /rest/agile/1.0/sprint/{id}`. 404/403이면 `null`이고 **그 외 오류는 던진다** — 429·5xx까지 `null`로 뭉개면 일시 실패가 sticky 검증에서 "스프린트가 사라졌다"가 돼 사용자가 고른 값을 지운다. sticky 검증 전용(§9).

**agile 3경로는 401 재시도를 끈다**(`jiraFetch(auth, path, init, /* retryOn401 */ false)`). `authedFetch`는 401을 만료로만 해석해 refresh 후 재시도하는데, scope 미비 401은 **영구** 조건이라 그 왕복이 전부 낭비이고 회전형 refresh token을 콤보 열 때마다 소모한다. 게다가 그 결과 `OAuthError`는 `sendBg`가 전역 "세션 만료" 안내를 발화시키는 레인을 타서, 사용자가 누른 적 없는 sticky 검증이 재로그인 모달을 띄운다. `getSprintFieldMeta`는 classic `/rest/api/3/` 경로라 401이 진짜 만료를 뜻하므로 재시도를 유지한다.

`createIssue`(`jira-api.ts:267`) 수정:

```ts
if (payload.sprintId != null) {
  const meta = await getSprintFieldMeta(auth, payload.projectKey, payload.issueTypeId)
    .catch(() => null);
  if (meta) fields[meta.fieldId] = meta.isArray ? [payload.sprintId] : payload.sprintId;
}
```

`sprintId`가 없으면 **분기 자체를 안 탄다** — 스프린트를 안 고른 제출의 create body는 도입 전과 동일하고 createmeta 요청도 나가지 않는다(PRD 목표 5). `.catch(() => null)`이 필요한 이유: `getSprintFieldMeta`는 `jiraFetch` 경유라 429/5xx/403에서 `JiraError`를 던지는데, 그대로 두면 **`POST /rest/api/3/issue`가 아예 안 나가고 스프린트를 고른 제출만 통째로 실패한다.** 스프린트가 빠진 채 생성되는 쪽(R7과 같은 무음 누락)이 제출 전체 실패보다 낫다.

### 2. `src/types/jira.ts`

```ts
export interface JiraSprint {
  id: number;
  name: string;
  state: string;          // 서버 문자열. 판정은 isActiveSprint() 단일 출처
  boardName?: string;     // getSprint 경로는 보드를 모른다 — optional이어야 거짓 값을 안 만든다
}

export interface JiraSprintFieldMeta {
  fieldId: string;        // "customfield_10020" — 사이트마다 다르다
  isArray: boolean;       // schema.type === "array"
}
```

`JiraCreateIssuePayload`에 `sprintId?: number` 추가. **`fieldId`·`isArray`는 payload에 넣지 않는다**(A1).

### 3. `src/types/messages.ts` · `src/background/messages.ts` · `src/background/bgRequestTypes.ts`

```ts
| { type: "jira.sprintFieldMeta"; projectKey: string; issueTypeId: string }   // → JiraSprintFieldMeta | null
| { type: "jira.listSprints"; projectKey: string }                            // → { sprints: JiraSprint[]; multiBoard: boolean }
| { type: "jira.getSprint"; sprintId: number }                                // → JiraSprint | null
```

`background/messages.ts`의 switch에 case 3개(`jira.listIssueTypes`(246행) 옆, 전부 `await loadAuth()` 1행 위임 — 읽기 메시지에 `ensureFreshAuth`는 붙이지 않는다. `authedFetch`가 호출마다 갱신하고, 핸들러 레벨 갱신은 auth를 값으로 들고 다니는 `jira.submitIssue` 전용이다).

**`bgRequestTypes.ts`의 `BG_REQUEST_TYPE_MAP`에도 3개를 등록한다.** `index.ts`의 onMessage 디스패치 화이트리스트이고, 주석이 *"과거 asana 연동이 이 등록 누락으로 런타임에서 전량 차단된 회귀"*를 기록하고 있다. `Record<BgRequest["type"], true>`라 누락 시 typecheck가 잡지만, 태스크에 명시하지 않으면 "왜 typecheck가 빨간가"를 다시 추적하게 된다.

### 4. `src/types/platform.ts` · `src/store/editor-store.ts`

- `JiraLastSubmitFields`에 `sprintId?: number; sprintName?: string;`
- `EditorIssueFields`에 동일 2개.

둘 다 optional이라 **스토어 마이그레이션 불필요**(`SETTINGS_STORE_VERSION` 11 유지). `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`라 세션 영속은 자동으로 따라온다.

`sprintName`을 함께 저장하는 이유는 `parentKey`/`parentLabel`, `assigneeId`/`assigneeName`과 같다 — 콤보를 열기 전에 트리거에 표시할 이름이 필요하다. 다만 **검증 전에는 표시하지 않는다**(§9).

### 5. `src/sidepanel/lib/initialJiraFields.ts`

`sprintId`·`sprintName`이 `JiraLastSubmitFields` 경유로 자동 포함된다(반환 타입이 `Omit<…>` 기반이고 구현이 `...src` 스프레드라 **코드 변경 0**). **여기서는 유효성을 검증하지 않는다** — 검증은 네트워크가 필요하고 이 함수는 순수 함수여야 한다. 검증은 §9.

### 6. `src/sidepanel/tabs/jiraFields/SprintField.tsx` (신규)

`EpicField`와 같은 골격(`FieldCombobox`)이되 **검색이 서버가 아니라 클라이언트다** — agile API에 스프린트 이름 검색이 없다. 목록을 한 번 받아 `FieldCombobox`의 기본 필터(`shouldFilter={!onSearch}`)에 맡긴다. 즉 `onSearch`를 넘기지 않는다.

```tsx
<SprintField
  projectKey={projectKey}
  value={fields.sprintId}
  fallbackLabel={sprintVerified ? fields.sprintName : undefined}
  onChange={(id, name) => onChange({ sprintId: id, sprintName: name })}
/>
```

- **접근성·e2e 판정 수단**: 트리거에 `ariaLabel={t("create.sprint")}` + `testId="jira-sprint-combobox"`를 붙인다. `FieldRow`의 `<label>`엔 `htmlFor`가 없어 접근 이름이 안 붙고, 스프린트 행이 생기면 Jira 탭 combobox가 8개가 된다(팝오버가 열리면 cmdk `CommandInput`이 하나 더). 두 prop은 선행 기획이 `FieldCombobox`에 이미 추가했으므로 **전달만 한다** — `ProjectField`가 `testId="jira-project-combobox"`로 쓰는 것과 같은 형태다.
- **해제**: `clearable={value != null}` + `onClear={() => onChange(undefined)}`. 스프린트는 선택 필드이고 `EpicField`·`AssigneeField`·`PriorityField`가 모두 해제 경로를 갖는다. `FieldCombobox`가 해제 항목을 별도 `CommandGroup heading={t("common.actions")}`로 그리므로 추가 i18n 키는 없다.
- **보드명 표시**: `mergeBoardSprints`가 `multiBoard: true`를 준 경우에만, `AssigneeField`의 **2줄 스택**을 복제한다 — `<span className="flex min-w-0 flex-1 flex-col">` + 스프린트명 `truncate` + 보드명 `truncate text-xs text-muted-foreground`. 한 줄 접미사는 폭이 안 나온다: 400px 패널에서 `CommandItem` 텍스트 예산이 약 232px(≈33자)이고 `"Sprint 24 - Q3 Platform Hardening"` 한 줄이 그걸 다 쓴다(320px 패널이면 23자). `EpicField`의 muted 접두(`{epic.key}`, `shrink-0`)는 **Jira key가 ~10자로 유계**라 성립하는 형태이고 보드명은 무계 문자열이라 이식되지 않는다.

### 7. `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`

- **행 위치**: 이슈타입 `FieldRow` **바로 아래**(프로젝트→이슈타입→스프린트로 "이 이슈가 어디로 가는가"가 묶인다).
- **로딩 자리 예약**: 판정 중에는 그 자리에 로딩 표시를 그린다(`NotionIssueFields`의 `loadingSchema` 인라인 스피너와 같은 형태 — `<Loader2 className="h-3 w-3 animate-spin" /> + t("common.loading")`). 판정이 끝나면 콤보로 교체되거나 사라진다. 자리를 잡아두므로 아래 5개 행이 밀리지 않고, "판정이 돌긴 했는가"가 눈에 보인다(R3·R5의 무음 실패와 로딩 실패가 구분된다).
- **존재 판정**: `useSprintFieldMeta(projectKey, issueTypeId)`(§8)가 `{ meta, loading }`을 준다. `!isEpicType &&`로 감싸지 **않는다** — 에픽 제외는 createmeta가 이미 답을 주고, `isEpicType`은 `JiraIssueFields`의 로컬 `useState`라 다이얼로그 재오픈 시 리셋되는 신뢰할 수 없는 신호다(조건을 두 곳에 두면 드리프트한다).
- **meta 소멸 시 값 비우기**: meta가 `null`로 확정됐는데 `fields.sprintId`가 남아 있으면 `onChange({ sprintId: undefined, sprintName: undefined })`. 이슈타입 전환(S4)·프로젝트 전환(S7) 경로다. 콤보가 열려 있었다면 `onOpenChange(false)`를 먼저 태운다 — Radix Popover가 통째로 언마운트되면 포커스가 `<body>`로 떨어진다.
- **sticky 검증**: §9. **meta가 확정된 뒤에만** 돈다(meta `null`이면 요청 0회 — 비우기와 경합하지 않는다).

### 8. `src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts` (신규)

`(projectKey, issueTypeId)`가 둘 다 있을 때 `jira.sprintFieldMeta`를 호출해 `{ meta, loading }`을 반환하는 훅. 키가 바뀌면 재조회하고 이전 응답은 버린다(`useDebouncedSearch`의 `seqRef` 패턴과 동일한 stale 방어 — A→B→A로 빠르게 바꿔도 늦게 온 응답이 오염시키지 않는다). **오류는 삼킨다** — 판정 실패는 "필드 없음"과 UI가 같다(PRD S5).

**세션 캐시**: 모듈 스코프 `Map<string, JiraSprintFieldMeta | null>`, 키는 `${siteId}|${projectKey}|${issueTypeId}`. 캐시 히트면 요청이 0회이고 `loading`도 뜨지 않는다. 근거는 두 가지 — ① Jira의 create 화면 구성은 세션 중 거의 바뀌지 않는다 ② stale이 400으로 이어지지 않는다(제출 시 background가 어차피 재해석한다 — §1). `siteId`를 키에 넣는 건 연동을 갈아끼운 뒤 이전 사이트의 판정이 남지 않게 하기 위함이다.

### 9. `src/sidepanel/tabs/jiraFields/sprint-sticky.ts` (신규)

```ts
export function resolveStickySprint(
  current: Pick<EditorIssueFields, "sprintId" | "sprintName">,
  fetched: JiraSprint | null,
): Partial<EditorIssueFields> | null;
```

- `current.sprintId`가 없으면 `null`(할 일 없음)
- `fetched`가 `null`이거나 `isActiveSprint(fetched.state)`가 false면 `{ sprintId: undefined, sprintName: undefined }`. `closed`를 거르는 게 아니라 **유효 상태를 화이트리스트로 통과**시킨다 — 미지 상태 문자열이 유효로 새지 않게(R9).
- 유효하면 이름이 바뀌었을 때만 `{ sprintName: fetched.name }`, 아니면 `null`

**표시 게이트**: 검증이 끝나기 전에는 `SprintField`에 `fallbackLabel`을 넘기지 않는다(§6). 저장된 이름을 먼저 보여주면 무효 판정 시 "Sprint 24"가 보였다가 placeholder로 되돌아가 *골라놨던 게 사라졌다*로 읽힌다. placeholder → 값 방향으로만 움직이게 한다.

**재검증 래치**는 boolean이 아니라 **검증한 `sprintId` 값 기준**이다. boolean이면 프로젝트를 바꿔 새 sticky 값이 들어와도 재검증이 안 돈다.

순수 함수라 `resolve-epic-parent.ts`·`project-change.ts`와 같은 위상으로 `tabs/jiraFields/`에 둔다.

### 10. `src/sidepanel/tabs/jiraFields/project-change.ts` (선행 기획 파일 수정)

`resolveProjectChange`가 비우는 목록에 `sprintId`·`sprintName`을 더해 **6키 → 8키**가 된다. 보존 집합(`priorityId`·`priorityName`·`cc`)은 그대로다 — 우선순위·참조는 사이트 전역이고, 스프린트는 보드에, 보드는 프로젝트에 묶이므로 프로젝트 스코프다. **선행 기획의 파일과 테스트를 고치는 유일한 지점**이다.

### 11. `src/sidepanel/lib/submitToJira.ts`

`JiraSubmitInput`에 `sprintId?: number`, `jira.submitIssue` payload에 그대로 전달. 그 외 무변경.

### 12. `src/sidepanel/tabs/IssueCreateModal.tsx` · `DraftDetailDialog.tsx`

라인 번호는 선행 기획 구현이 같은 자리를 다시 쓰는 중이라 **심볼로 지목한다**(착수 전 grep으로 재확인):

- `handleJiraSubmit`의 `submitToJira({ … })` 호출에 `sprintId: <fields>.sprintId` 추가
- `setLastSubmitFields("jira", { … })`에 `sprintId`·`sprintName` 추가
- `DraftDetailDialog`의 로컬 `SubmitFields` 타입에 2개 추가
- 분석 축 2개(`sprint_field_shown`·`sprint_selected`)를 `submitEventProperties`로 전달

`markSubmitted`는 건드리지 않는다 — 이슈 목록 카드에 스프린트를 표시하지 않는다(비목표). `SubmitFieldsDialog`의 `fieldsReady` 게이트도 **무변경**이다(스프린트는 optional).

### 13. `src/background/analytics.ts` · `src/sidepanel/lib/track-submit.ts`

- `ALLOWED_EVENTS.issue_submitted` 화이트리스트에 `sprint_field_shown`·`sprint_selected` 등록. 누락하면 `filterProperties`가 무음 폐기한다.
- `submitEventProperties`에 인자 2개 추가, boolean은 `String()`으로(`replay_trimmed`·`project_overridden` 선례). Jira 외 플랫폼은 `null`을 넘겨 축 자체를 안 싣는다 — `project_overridden`과 같은 형태.

### 14. i18n — 신규 키 5개

| 키 | 파일 | ko | en |
|---|---|---|---|
| `create.sprint` | `namespaces/editor.ts` | 스프린트 | Sprint |
| `field.sprint.select` | `namespaces/settings.ts` | 스프린트 선택 (선택사항) | Select sprint (optional) |
| `field.sprint.search` | 〃 | 스프린트 검색... | Search sprints... |
| `field.sprint.empty` | 〃 | 일치하는 스프린트가 없습니다. | No matching sprints. |
| `field.sprint.label` | 〃 | 스프린트 | Sprints |

각 파일에 ko/en 블록이 따로 있으므로 **양쪽 모두** 넣는다. `empty` 문구가 "사용 가능한"이 아니라 "일치하는"인 이유: `shouldFilter`가 켜져 있어 `CommandEmpty`는 **목록이 빌 때와 검색어가 안 맞을 때 둘 다** 뜬다 — 기존 5개 키가 전부 "일치하는 X이 없습니다" 형태인 것과 같은 이유다.

`public/_locales`·log-viewer 복제 사전은 **무관**(manifest 문자열도, log-viewer가 쓰는 컴포넌트도 아니다). 스프린트는 **이슈 본문에 나가지 않으므로 `bodyLocale` 축과도 무관**하다.

### 15. `e2e/jira-sprint-field.spec.ts` (신규)

`slack-issue-promotion.spec.ts`의 seed + `chrome.runtime.sendMessage` 스파이 패턴. seed 요구 3개:

- **`projectKey`** — 없으면 `JiraConnectForm`의 `SetupDialog`가 모달로 자동 오픈돼 다른 판정을 가린다.
- **`auth.cloudId`** — `jiraSiteId(auth)`가 이걸 그대로 반환한다. 없으면 `undefined`가 돼 선행 기획의 `sameSite` 게이트가 공허하게 통과하고 sticky 시나리오가 무의미하게 green이 된다. `e2e/`에 선례가 없는 새 요구다.
- **envelope `version: 11`** — 기존 spec들은 `version: 10`이라 마이그레이션 체인을 탄다.

콤보 특정은 **`getByTestId("jira-sprint-combobox")`만** 쓴다. `role=combobox` nth 인덱싱은 금지 — 콤보가 8개인 데다 `EpicField`가 조건부 언마운트되고 팝오버가 열리면 `CommandInput`이 하나 더 생긴다.

## 데이터 흐름

```
[다이얼로그 Jira 탭]  projectKey="WEB", issueTypeId="10004"
        │
        ├─(선제, 캐시 미스일 때만)─→ jira.sprintFieldMeta ─→ createmeta/{proj}/issuetypes/{type}
        │      │  캐시 키: siteId|projectKey|issueTypeId        └→ pickSprintField(values)
        │      ├─ 판정 중 → 이슈타입 행 아래 로딩(자리 예약)
        │      ├─ null  → 행 없음. 남은 sprintId는 비운다. 검증 요청 0회.   [S2·S4·S7]
        │      └─ meta  → <FieldRow> 삽입                                   [S1]
        │
        ├─(meta 확정 + sprintId 있을 때만)─→ jira.getSprint ─→ resolveStickySprint()
        │            └─ 검증 전엔 이름 미표시 → 유효할 때만 채운다           [S3]
        │
        ├─(콤보 열 때)─→ jira.listSprints ─→ board?projectKeyOrId=WEB
        │                                       └→ kanban 제외 → 상위 5개 allSettled
        │                                            sprint?state=active,future
        │                                            └→ mergeBoardSprints() → {sprints, multiBoard}
        │
        └─(제출)─→ submitToJira({ …, sprintId: 42 })
                        └→ jira.submitIssue ─→ createIssue()
                                                 └─ sprintId 있으면 getSprintFieldMeta 재해석
                                                      fields["customfield_10020"] = 42 | [42]
                                                      (meta 조회 실패 → catch → sprint 생략)
                                                 └─ sprintId 없으면 분기 진입 안 함 (body 불변)
                        └→ trackSubmit(… sprint_field_shown, sprint_selected)
```

## 인터페이스 설계

```ts
// src/types/jira.ts
export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  // boardId는 두지 않는다 — 쓰기만 하고 읽는 곳이 없어 getSprint 경로에서 센티널을 지어내게 된다.
  boardName?: string;
}

export interface JiraSprintFieldMeta {
  fieldId: string;
  isArray: boolean;
}

export interface JiraCreateIssuePayload {
  // …기존 그대로
  sprintId?: number;   // 추가. fieldId·isArray는 background가 재해석한다(A1)
}

// src/types/platform.ts — JiraLastSubmitFields
  sprintId?: number;
  sprintName?: string;

// src/store/editor-store.ts — EditorIssueFields
  sprintId?: number;
  sprintName?: string;

// src/background/jira-api.ts
interface CreateMetaFieldsResponse {
  // 봉투 키는 `fields`다(2026-08-13 실측 — 이슈타입 목록 엔드포인트의 `issueTypes`와 다르고
  // 페이지네이션 관용구인 `values`도 아니다). maxResults=200은 서버가 그대로 존중했다.
  fields: {
    fieldId: string;
    name: string;
    schema?: { type?: string; custom?: string };
  }[];
  total?: number;
}

export function pickSprintField(res: CreateMetaFieldsResponse): JiraSprintFieldMeta | null;
export function isActiveSprint(state: string): boolean;
export function mergeBoardSprints(
  perBoard: { boardName: string; sprints: JiraSprint[] }[],
): { sprints: JiraSprint[]; multiBoard: boolean };

export function getSprintFieldMeta(
  auth: JiraAuth, projectKey: string, issueTypeId: string,
): Promise<JiraSprintFieldMeta | null>;
export function listSprints(
  auth: JiraAuth, projectKey: string,
): Promise<{ sprints: JiraSprint[]; multiBoard: boolean }>;
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
): {
  meta: JiraSprintFieldMeta | null;
  loading: boolean;
  failed: boolean;    // 조회 실패. "없음 확정"과 갈라야 값 삭제가 안 새어나간다
  answered: boolean;  // 이 키에 답을 받았나. 상위가 키 입력을 다시 세지 않게 한다
};

// src/sidepanel/tabs/jiraFields/SprintField.tsx
export function SprintField(props: {
  projectKey: string;
  value?: number;
  fallbackLabel?: string;      // 검증 완료 전에는 넘기지 않는다(§9)
  onChange: (id: number | undefined, name?: string) => void;
}): JSX.Element;

// src/sidepanel/lib/track-submit.ts — submitEventProperties 인자 추가
  sprintFieldShown: boolean | null = null,
  sprintSelected: boolean | null = null,
```

## 기존 패턴 준수

- **필드 컴포넌트 컨벤션**: `FieldCombobox` 기반(`EpicField`·`IssueTypeField`·`PriorityField`·`AssigneeField`·`ProjectField` 5개가 선례. `RelatesField`·`CcField`는 `CcMultiCombobox`라 다른 계열이다). 콤보 자체 스타일링 금지, shadcn `CommandItem` 사용.
- **background 순수 파서 분리**: `parseTransitions`(`jira-api.ts:446`)와 같은 형태로 `pickSprintField`·`isActiveSprint`·`mergeBoardSprints`를 export해 네트워크 없이 단위 테스트한다.
- **store는 `sidepanel/tabs`를 import하지 않는다**: 새 파일 3개(`SprintField.tsx`·`sprint-sticky.ts`·`useSprintFieldMeta.ts`)는 컴포넌트만 쓰므로 `tabs/jiraFields/`에 둔다. `initialJiraFields`가 `lib/`에 있는 이유(editor-store가 쓴다)와 대비된다.
- **테스트 2트랙**: 순수 함수는 `*.test.ts`(node), 콤보 인터랙션이 상태 전이를 좌우하면 `*.test.tsx`(jsdom + user-event) — `AssigneeField.test.tsx`·`ProjectField.test.tsx` 선례.
- **i18n 동시 갱신**: ko/en 두 로케일 모두. `src/i18n/` PostToolUse 훅이 red면 차단하므로 TDD red 단계에서 빨갛게 뜨는 건 정상이다.
- **분석 화이트리스트**: `ALLOWED_EVENTS`에 등록하지 않으면 무음 폐기. boolean은 문자열화.
- **세션 영속**: `issueFields`는 이미 `EDITOR_SNAPSHOT_KEYS`라 별도 작업 없음.
- **pre-arm 청크 격리**: 무관하다(`src/content/` 파일을 건드리지 않는다).
- **privacy**: 대조 대상이나 갱신은 불필요할 가능성이 높다 — 새 수집·저장·캡처가 없고, 기존 자격증명으로 **같은 목적**(사용자 Jira 사이트에 이슈 등록)의 엔드포인트를 추가하며, 기존 §3 표가 `api.atlassian.com`을 이미 덮는다. 스프린트 검색은 클라이언트 필터라 "입력한 검색어가 전송"에도 해당하지 않는다. 다만 privacy는 권한 문자열이 아니라 *실제 동작*에 묶이고 심사 탈락 전례가 있으므로 **판단 자체를 태스크로 기록**한다(Task 10).

## 대안 검토

**A1. `fieldId`·`isArray`를 패널이 payload에 실어 보낸다(제출 시 createmeta 재호출 제거).** 요청 1회를 아낀다. **기각** — 다이얼로그를 연 뒤 이슈타입이 바뀌면 stale `fieldId`로 제출된다. background 재해석은 **제출 시점의 진실**을 쓴다. (초안에 있던 "세션 영속에 캐시성 메타가 섞인다"는 근거는 폐기했다 — §4가 `sprintName`을 표시용으로 이미 `EditorIssueFields`에 넣으므로 자기모순이다.)

**A2. `/rest/api/3/field` 전역 목록에서 gh-sprint 필드를 찾는다.** 사이트당 1회면 되고 캐시하기 좋다. **기각** — 존재 판정을 못 한다. 전역에 필드가 있어도 그 프로젝트+이슈타입의 create 화면에 올라갔는지는 별개이고, 그게 400의 원인이다.

**A3. createmeta 없이 필드를 항상 그리고, 400이 나면 스프린트를 떼고 재시도.** 요청이 가장 적다. **기각** — 스프린트 없는 프로젝트에서 매번 빈 콤보가 뜨고(목표 2 위반), 사용자가 고른 값을 조용히 버리고 성공한 척하게 된다(PRD S6). (초안의 "부분 생성 위험" 근거는 폐기 — `createIssue`가 첨부 업로드보다 먼저 돌아 create 400이면 업로드는 한 건도 안 났다.)

**A4. 스프린트 목록도 선제 조회해 active 자동 선택.** 첫 제출이 편해진다. **기각(사용자 결정)** — board + 보드별 sprint 팬아웃이 다이얼로그를 열 때마다, 스프린트를 안 쓰는 사용자에게도 나간다. sticky가 반복 제출을 커버한다.

**A5. `FieldCombobox`에 다중 그룹(보드별 heading)을 추가.** 원 요청에 더 가깝다. **기각** — 단일 `CommandGroup` 안에 `CommandGroup`을 중첩하면 `[cmdk-group]` 안에 `[cmdk-group]`이 들어가 heading 스타일 셀렉터와 cmdk의 그룹 필터 semantics가 설계 밖으로 나간다. 이번 스코프 밖이고, 보드 구분은 2줄 항목으로 충족된다. (선행 기획이 `ariaLabel`/`testId`를 가산적 opt-in prop으로 얹은 것처럼 "공용 컴포넌트는 절대 못 건드린다"는 뜻은 아니다 — 렌더 구조 변경이라 등급이 다르다.)

**A6. 스프린트 이름 검색을 서버로 보낸다.** 목록이 길어도 대응된다. **기각** — agile API에 스프린트 이름 검색 파라미터가 없다. 한 프로젝트의 active+future 스프린트는 보통 한 자릿수라 클라이언트 필터로 충분하다.

**A7. createmeta가 주는 `autoCompleteUrl`로 목록을 받는다.** 채택되면 팬아웃(R6)도 agile scope 리스크(R1)도 한 번에 소멸하는 경로였다. **기각 — 그런 URL이 없다.** 2026-08-13 실측에서 sprint 필드 항목은 `fieldId`·`name`·`schema`만 갖고 `autoCompleteUrl`이 `undefined`였다(`allowedValues`도 없다). 즉 createmeta는 **존재·ID·타입만 답하고 값은 어느 형태로도 주지 않는다.** agile API가 유일 경로이며, 이 기각으로 R1이 우회 불가능한 선행 조건이 됐다.

**A8. `jira.getSprint`를 `jira.sprintFieldMeta`에 병합**(`{ …, validateSprintId? }` → `{ meta, sprint }`). 메시지·라운드트립이 하나씩 줄고 두 동작의 경합이 구조적으로 사라진다. **기각** — §8의 세션 캐시와 충돌한다. meta가 캐시 히트하면 병합된 요청 자체가 안 나가 sticky 검증이 통째로 스킵된다. 캐시 히트 시에만 별도 요청을 다시 만드는 건 병합의 이점을 지운다. 경합은 §7의 "meta 확정 후에만 검증"으로 이미 닫힌다.

## 위험 요소

**R1. OAuth scope — 발동 확정(2026-08-13), 이 기획의 선행 조건.** 현재 `SCOPES`는 `read:jira-user`·`read:jira-work`·`write:jira-work` + `offline_access` 4개(`oauth.ts:25`)인데, 이 토큰으로 `GET /rest/agile/1.0/board?projectKeyOrId=…`가 **401 `{"code":401,"message":"Unauthorized; scope does not match"}`** 를 돌려준다. classic `read:jira-work`는 agile API를 덮지 않는다. A7(autoCompleteUrl 우회)도 같은 실측에서 닫혔으므로 **granular scope 추가가 우회 불가능한 선행 조건**이다.

필요한 scope는 `read:board-scope:jira-software`(보드 목록)·`read:sprint:jira-software`(스프린트 목록·단건). 콘솔이 의존으로 `read:project:jira`를 함께 요구할 수 있다.

추가하되 **기존 사용자를 깨지 않는다** — `refreshOAuthToken`이 갱신 요청에 `scope`를 안 싣고 access token의 scope는 동의 시점에 고정되므로, 기존 토큰은 새 scope를 얻지 못한다. 그 사용자는 **재연동 전까지 목록이 빈 채로** 보인다(PRD §OAuth scope 정책 — 강제 재동의·유도 UI 없음).

**혼용 가능 확정(2026-08-13).** 한 앱이 classic 3종과 granular 3종을 함께 보유할 수 있고, 동의 화면에도 나란히 뜬다(*"Boards and backlogs, Sprints, jira-user, jira-work"*). 재기획 갈림길은 닫혔다.

**함정 — `read:project:jira`가 빠지면 board·sprint 둘 다 안 된다.** `read:board-scope:jira-software`·`read:sprint:jira-software`만 넣고 호출했을 때 **여전히 401 `scope does not match`** 였다. 문서상 `GET /board`는 `read:board-scope:jira-software` + `read:project:jira`를 **둘 다** 요구하고, 하나라도 없으면 같은 401로 떨어져 "scope를 추가했는데도 안 된다"로 보인다. 최종 `SCOPES`는 6개다:

```
read:jira-user  read:jira-work  write:jira-work        (classic — 기존)
read:board-scope:jira-software  read:project:jira  read:sprint:jira-software   (granular — 추가)
offline_access
```

**R2. 값 형식(스칼라 vs 배열) — 절반 해소(2026-08-13).** company-managed 사이트에서 sprint 필드는 `fieldId: "customfield_10020"`, **`schema.type: "array"`** 로 확인됐다. 남은 건 **create가 실제로 무엇을 받는가**다 — `"customfield_10020": 25`(스칼라)로 통하는 사례가 흔해 **선언된 타입과 수용 형식이 어긋날 수 있고**, 그러면 `isArray` 분기 키 자체를 못 믿는다. 이슈 생성이 필요해 아직 미검증이며, 어긋나는 것으로 판명되면 **스칼라 고정 + 실패를 사용자에게 노출**(무음 폴백 금지)이 기본값이다. 스칼라 실패 시 배열로 자동 재시도하는 폴백은 두지 않는다.

**R3. createmeta 응답 봉투 키 — 해소(2026-08-13).** 키는 **`fields`**다. 이슈타입 목록 엔드포인트의 `issueTypes`와도, 페이지네이션 관용구 `values`와도 다르다 — 초안이 `values`로 단언했었고 그대로 갔으면 `pickSprintField`가 항상 `null`을 돌려 **필드가 조용히 안 보였을 것**이다("스프린트 없는 프로젝트"와 구분되지 않는 실패 모드). Task 0 픽스처를 단위 테스트에 박아 이 키를 고정한다.

**R4. 선제 판정이 다이얼로그당 요청을 1회 늘린다.** 스프린트를 안 쓰는 사용자도 낸다. 세션 캐시(§8)가 반복분을 지우지만 세션 첫 회는 남는다. 목표 2(없으면 미노출)의 값이다.

**R5. `getSprintFieldMeta`는 페이지네이션하지 않는다 — 크기 확정(2026-08-13).** 실측 사이트의 create 화면은 `total: 21`이었고 서버가 `maxResults=200`을 그대로 존중했다(자체 캡 없음). 1페이지 200필드를 넘는 create 화면은 실재하지 않는다고 보고 감수한다. 다만 넘으면 증상이 무음 미노출이라 진단이 어렵다는 성격은 그대로다.

**R6. 목록 조회 실패를 전부 삼킨다(§1).** 네 원인이 하나의 증상으로 수렴한다 — ① 보드 목록 조회 실패(재연동 전 OAuth 사용자·만료 토큰) ② 보드 단위 400(스프린트 미지원 보드) ③ kanban 제외 후에도 보드가 5개를 넘을 때의 상한 밖 보드 ④ 보드 목록 1페이지(50) 초과. ④는 실재한다 — 실측 사이트의 **전체** 보드가 `total: 71`·`isLast: false`였다(단, `projectKeyOrId`로 좁히면 한 프로젝트 최대치는 15개였다). 사용자에겐 전부 "고를 스프린트가 없다"로 보이고 오류 문구는 뜨지 않는다. **의도된 선택이다**(PRD S2b) — 대가는 진단 불가이며, `sprint_field_shown` × `sprint_selected` 축이 사후 관측을 맡는다.

**R7. 제출 시점 재해석이 판정과 어긋날 수 있다.** 패널이 meta를 본 뒤 제출까지 사이에 Jira 화면 구성이 바뀌거나 createmeta 조회가 실패하면(§1의 `.catch`) **사용자가 고른 스프린트가 조용히 빠진 채 이슈가 생성된다.** 창이 좁고 제출 전체 실패보다 낫다고 판단해 감수하지만, 무음 누락이라는 성격은 기록해 둔다.

**R8. `resolveProjectChange` 수정이 선행 기획 파일과 테스트를 건드린다(§10).** 두 기획이 시간상 겹치면 충돌한다. `jira-project-switch`가 머지된 뒤 착수한다는 전제가 지켜져야 한다. 같은 이유로 `initialJiraFields.test.ts`·`editor-store.test.ts`도 선행 기획이 최근 재작성한 파일이다.

**R9. `state` 문자열 신뢰.** `JiraSprint.state`를 `string`으로 두고 `isActiveSprint`가 **화이트리스트로** 판정한다(`active`·`future`만 통과). union으로 좁히면 미지 값이 타입 위에서만 사라지고 런타임에서는 그대로 흘러 닫힌 스프린트가 유효로 샌다.
