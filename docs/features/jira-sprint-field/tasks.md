# Jira 제출 시 Sprint 선택 — 구현 태스크

## 선행 조건

1. **`jira-project-switch` 구현이 main에 있어야 한다.** 문서가 아니라 **코드** 기준이다 — `tabs/jiraFields/project-change.ts`(`resolveProjectChange`)·`ProjectField.tsx`·`FieldCombobox`의 `ariaLabel`/`testId` prop·`EditorIssueFields.projectKey`가 실재해야 Task 5·7·8이 성립한다. (착수 시점에 그 기획이 아직 작업 트리에만 있으면 대기한다 — 같은 파일·같은 테스트를 고치므로 충돌한다.)
2. **Jira 실계정 2개 이상의 프로젝트**: 스크럼 보드가 있는 프로젝트 1개(company-managed), 칸반 전용 또는 보드 없는 프로젝트 1개. 가능하면 team-managed 스크럼 프로젝트도. 보드가 2개 이상인 프로젝트가 있으면 `multiBoard` 경로까지 덮인다.
3. **OAuth 연동과 API 토큰 연동 양쪽**: R1(scope)이 인증 방식에 따라 갈리므로 둘 다 필요하다.
   - **Atlassian 콘솔 작업은 이미 끝났다**(2026-08-13): granular 3종을 앱에 추가해 뒀다. 코드 쪽 `SCOPES` 3줄 추가는 **Task 2와 함께 커밋**한다 — 기능 없이 먼저 넣으면 신규 사용자가 쓰지도 않는 권한에 동의하게 된다.
4. **권한·manifest 변경 없음**을 전제로 시작한다. 새 host_permissions·optional permission이 필요 없고(`<all_urls>`가 이미 덮는다), manifest diff는 0이다. privacy 대조는 Task 10에서 판정한다(무변경 결론이어도 판단을 기록한다 — 심사 탈락 전례).
5. Task 0을 통과하지 못하면 **Task 1 이후는 착수하지 않는다**(설계가 뒤집힌다).

---

## Task 0: 선행 spike — API 실측 (차단 게이트)

코드를 커밋하지 않는다. 실계정에 직접 요청을 날려 설계 전제를 확정하고 결과를 이 파일 하단 "spike 결과"에 기록한다. **실계정·실제 이슈 생성·개발자 콘솔 확인이 필요해 에이전트가 대신 돌 수 없다 — 사용자가 먼저 수행하고 표를 채운 뒤 구현을 시작한다.**

- **변경 대상**: 없음(임시 스크립트·`curl`. 커밋하지 않는다)
- **작업 내용**:
  1. ~~**createmeta 봉투 키**(R3)~~ — **완료(2026-08-13).** 키는 `fields`. `total: 21`이고 서버가 `maxResults=200`을 자체 캡 없이 존중했다 → R3 해소, R5 크기 확정.
  2. **sprint 필드 스키마**(R2) — company-managed는 **완료**: `fieldId: "customfield_10020"`, `schema.type: "array"`. **team-managed 프로젝트에서 같은지 남았다.**
  3. **create 수용 형식**(R2) — 실제 이슈 생성으로 `fields.customfield_10020`에 스칼라(`42`)와 배열(`[42]`) 중 무엇이 통하는지. **둘 다 통하면 그 사실을 기록**한다(설계가 단순해진다). **미검증 — 이슈를 실제로 만들어야 하고, 스프린트 id는 5가 풀려야 얻는다.**
     - *둘 다 거부되면*(객체 `{id:42}` 요구 등): `isArray` 분기가 무의미해지므로 design §1·R2를 다시 쓴다.
     - *`schema.type`이 `array`인데 스칼라만 통하면*: 분기 키를 신뢰할 수 없다는 뜻이므로 **스칼라 고정 + 실패 노출**로 간다(R2).
  4. ~~**`autoCompleteUrl` 실측**(A7)~~ — **기각 확정(2026-08-13).** sprint 필드 항목에 `autoCompleteUrl`이 아예 없다(`allowedValues`도 없음). createmeta는 존재·ID·타입만 답하고 값은 주지 않는다 → **agile API 우회로 없음**, 5의 갈림길을 건너뛸 수단이 사라졌다.
  5. ~~**OAuth scope**(R1)~~ — **해소(2026-08-13).** classic만으로는 401 `scope does not match`가 확정됐고, **classic 3종 + granular 3종 혼용이 가능**했다(동의 화면에 나란히 표시). 함정: `read:board-scope:jira-software`·`read:sprint:jira-software`만 넣으면 **여전히 401**이고 `read:project:jira`까지 넣어야 200이다(`GET /board`가 둘을 동시에 요구). `SCOPES`(`oauth.ts:25`)에 3종 추가 → 재빌드 → 연동 해제·재연결로 200 확인 완료.
     - ⚠️ **확장을 `chrome://extensions`에서 새로고침하지 않으면 옛 SW 번들이 남아 동의 화면에 새 scope가 안 뜬다** — 실제로 한 번 헛다리를 짚었다.
  6. ~~**칸반/보드 없음 거동**~~ — **완료(2026-08-13).** 칸반 보드 → **400** + `errorMessages: ["보드는 스프린트를 지원하지 않습니다."]`(**사용자 로케일로 번역돼 오므로 문자열 매칭 불가 — status로만 판정**). 보드가 없는(또는 스크럼 보드가 없는) 프로젝트 → **404가 아니라 200 + 빈 `values`**.
  7. **team-managed 보드 — 설계 변경을 유발한 발견(2026-08-13).** team-managed 프로젝트 보드는 `type: "simple"`로 오고 **그중 일부가 스프린트를 정상 반환한다**(SRE·BMD·SBDATA → 200). 초안의 `?type=scrum` 서버 필터는 이들을 **무음 누락**시켰을 것이다 → design §1을 "필터 없이 받고 클라이언트에서 `type !== "kanban"` 제외"로 고쳤다. 실측: 한 프로젝트 보드 15개 중 kanban 13개 → 필터 후 2개. 사이트 전체는 `total: 71`·`isLast: false`(페이지 상한 실재).
- **검증**:
  - [x] 1·4·5·6·7 완료 — 표 참조. **차단 게이트는 해제됐다**(R1 해소)
  - [x] 2 company-managed 완료 / **team-managed `schema.type`은 미측정**(보드는 확인됐으나 createmeta는 안 봤다)
  - [ ] 3(create 수용 형식)이 표에 기록됐다 — **미검증으로 남길지 결정 필요**(§spike 잔여 참조)
  - [ ] 3의 결과로 `isArray` 분기를 유지할지(양쪽 다르면 유지, 한쪽으로 통일되면 상수 고정, 어긋나면 스칼라 고정) 판정됐다
  - [ ] **실측한 응답 body를 픽스처로 저장**해 Task 1·2의 단위 테스트에 그대로 넣는다 — spike 결과가 문서가 아니라 코드로 남아야 회귀 시 red가 된다
  - [ ] 확정값을 `jira-api.ts` 해당 함수 주석 + design R1·R2·R3에 반영한다

---

## Task 1: 순수 파서 3개 (TDD red → green)

- **변경 대상**: `src/types/jira.ts`, `src/background/jira-api.ts`, `src/background/__tests__/sprint-parse.test.ts`(신규)
- **작업 내용**: `pickSprintField(res)`·`isActiveSprint(state)`·`mergeBoardSprints(perBoard)`를 테스트 먼저 작성하고 구현. `SPRINT_SCHEMA`·`MAX_SPRINT_BOARDS` 상수, `JiraSprint`(`state: string`·`boardName?`)·`JiraSprintFieldMeta` 타입도 여기서. 네트워크 함수는 아직 만들지 않는다. Task 0 픽스처를 입력으로 쓴다.
- **검증**:
  - [ ] `pickSprintField`: gh-sprint 있음 → `{fieldId, isArray}` / 없음 → `null` / 후보 2개 → 첫 번째 / `schema` 누락 원소가 섞여도 크래시 없음 / 빈 배열 → `null`
  - [ ] `isActiveSprint`: `"active"`·`"future"` → true / `"closed"` → false / `"unknown-future-value"` → **false**(화이트리스트, R9) / 빈 문자열 → false
  - [ ] `mergeBoardSprints`: 보드 2개 중복 id → 1건이고 **먼저 온 보드의 `boardName`이 남는다** / `active`가 `future`보다 앞 / 같은 상태 안 id 오름차순 / 보드 1개 → `multiBoard: false` / 보드 2개 → `multiBoard: true` / 빈 입력 → `{sprints: [], multiBoard: false}`
  - [ ] `pnpm test src/background/__tests__/sprint-parse.test.ts` green

## Task 2: agile·createmeta 네트워크 함수 3개

- **변경 대상**: `src/background/jira-api.ts`, `src/background/__tests__/jira-api.test.ts`
- **작업 내용**: `getSprintFieldMeta`·`listSprints`·`getSprint` 추가. `listSprints`는 보드 목록에서 `type !== "kanban"`만 남긴 뒤 상위 `MAX_SPRINT_BOARDS`(5)개를 골라 `Promise.allSettled`로 팬아웃하고, **보드 단위 실패도 보드 목록 실패도 삼킨다**(`{sprints: [], multiBoard: false}`). `getSprint`는 404/403 → `null`. Task 0의 실측값(봉투 키·경로·필터)을 반영한다.
  - **먼저 목 헬퍼를 만든다**: 기존 헬퍼(`jira-api.test.ts`)는 `vi.fn().mockResolvedValue(...)` **단일 응답**이라 URL별 분기가 없다. 이 태스크와 Task 4가 둘 다 URL 라우팅을 요구하므로 `mockFetchByUrl(routes)` 형태의 헬퍼를 추가하고 기존 `vi.unstubAllGlobals()` afterEach를 재사용한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 보드 2개 중 1개가 400 → 나머지 보드 스프린트만 반환, throw 없음 (실측: 칸반·미지원 보드가 400을 준다)
  - [ ] 보드 목록 자체가 403 → `{sprints: [], multiBoard: false}`, throw 없음 (재연동 전 OAuth 사용자 경로)
  - [ ] `type: "kanban"` 보드는 **fetch 자체를 안 한다**; `"scrum"`·`"simple"`은 호출한다 (team-managed 누락 방지 — Task 0 항목 7)
  - [ ] kanban 제외 후 보드 7개 → **fetch가 board 1회 + sprint 5회, 총 6회**(상한 적용)
  - [ ] `getSprint` 404 → `null`(throw 아님)
  - [ ] Task 0 픽스처로 `getSprintFieldMeta`가 실제 응답에서 `fieldId`를 뽑아낸다

## Task 3: bg 메시지 3개 배선

- **변경 대상**: `src/types/messages.ts`, `src/background/messages.ts`, **`src/background/bgRequestTypes.ts`**
- **작업 내용**: `jira.sprintFieldMeta`·`jira.listSprints`·`jira.getSprint`를 `BgRequest` union에 추가하고, switch에 case 3개(`jira.listIssueTypes` 인근, `await loadAuth()` 위임 — `ensureFreshAuth`는 붙이지 않는다), **`BG_REQUEST_TYPE_MAP`에 3개 등록**(누락하면 `index.ts`의 onMessage 화이트리스트에서 전량 차단된다 — 과거 asana 회귀).
- **검증**:
  - [ ] `pnpm typecheck` 통과 — `BG_REQUEST_TYPE_MAP`이 `Record<BgRequest["type"], true>`라 등록 누락은 여기서 red가 된다
  - [ ] `background/messages.ts`의 switch에 `default`가 있어 union 추가 누락을 typecheck가 못 잡는지 확인한다. 못 잡으면 그게 이 태스크의 유일한 자동 그물이 `BG_REQUEST_TYPE_MAP`뿐이라는 뜻이다
  - [ ] (`src/types/__tests__/messages.test.ts`는 메시지 목록을 검사하지 않는다 — `BgError`·OAuth 헬퍼 전용이라 갱신 대상이 아니다)

## Task 4: 제출 경로 — `createIssue` + payload (TDD red → green)

⚠️ **(a)를 먼저 green으로 만든 뒤 (b)를 넣는다.** 기준선 없이 "도입 전과 동일"은 판정할 수 없다.

- **변경 대상**: `src/background/jira-api.ts`, `src/types/jira.ts`, `src/sidepanel/lib/submitToJira.ts`, `src/background/__tests__/jira-api.test.ts`
- **작업 내용**:
  - **(a) 기준선 고정**: 현행 `createIssue`의 요청을 고정하는 테스트를 **변경 전에** 추가해 green. 단언은 "fetch 정확히 1회 + body가 `{fields:{project,summary,description,issuetype}}`이고 `Object.keys(fields)`가 정확히 그 4개". 현재 `createIssue` 테스트는 **0건**이다(기존 파일은 `parseTransitions`·`messageForJiraStatus`·`extractJiraDetail`·`resolveUrl`만 덮는다).
  - **(b)** `JiraCreateIssuePayload.sprintId?: number` 추가, `createIssue`에 재해석 분기(`.catch(() => null)` 포함) 삽입, `submitToJira`가 `sprintId`를 전달.
- **검증**:
  - [ ] (a)가 (b) 이후에도 green — `sprintId` 없는 호출에서 fetch 1회, `fields` 키 집합 불변, **createmeta URL이 `mock.calls`에 없다**
  - [ ] `sprintId` 있고 meta `isArray: false` → `fields.customfield_10020 === 42`
  - [ ] `sprintId` 있고 meta `isArray: true` → `fields.customfield_10020`이 `[42]`
  - [ ] `sprintId` 있는데 meta `null` → sprint 키 없이 생성되고 throw 없음 (R7)
  - [ ] **`sprintId` 있는데 createmeta가 429/500을 던짐 → sprint 키 없이 생성되고 create 요청은 정상 발사**(`.catch` 경로 — 이게 없으면 제출 전체가 죽는다)

## Task 5: sticky 순수 함수 + 타입 확장 (TDD red → green)

⚠️ **`resolveProjectChange` 수정은 선행 기획 파일과 그 테스트를 건드린다.** 그쪽 구현이 green이 된 뒤에만 착수한다.

- **변경 대상**: `src/types/platform.ts`, `src/store/editor-store.ts`, `src/sidepanel/tabs/jiraFields/sprint-sticky.ts`(신규) + `__tests__/sprint-sticky.test.ts`(신규), `src/sidepanel/tabs/jiraFields/project-change.ts` + `__tests__/project-change.test.ts`(선행 기획 파일)
- **작업 내용**: `sprintId`·`sprintName`을 `JiraLastSubmitFields`·`EditorIssueFields`에 추가. `resolveStickySprint` 구현(`isActiveSprint` 화이트리스트 사용). `resolveProjectChange`의 비움 목록을 **6키 → 8키**로(테스트의 `CLEARED` 배열도 함께). 보존 집합(`priorityId`·`priorityName`·`cc`)은 무변경이고 "같은 프로젝트를 다시 고르면 `projectKey`만" 케이스도 무변경이다.
- **검증**:
  - [ ] `current.sprintId` 없음 → `null`
  - [ ] `fetched === null` → 값 비움 patch
  - [ ] `state: "closed"` → 값 비움 / `state: "unknown-future-value"` → **값 비움**(R9)
  - [ ] 유효 + 이름 동일 → `null` / 유효 + 이름 변경 → `{ sprintName }`만
  - [ ] `project-change.test.ts`: 비움 8키에 `sprintId`·`sprintName` 포함, `priorityId`·`priorityName`·`cc`는 여전히 patch에 **없다**
  - [ ] `SETTINGS_STORE_VERSION` 11 유지(optional 추가라 마이그레이션 불필요) — `settings-store.test.ts` green
  - [ ] red가 되는 기존 테스트: `project-change.test.ts`(6→8키). `initialJiraFields.test.ts`·`editor-store.test.ts`는 **코드 변경이 없어 green으로 남아야 한다** — red면 `...src` 스프레드 전제가 깨진 것이므로 조사한다

## Task 6: i18n 키 5개

- **변경 대상**: `src/i18n/namespaces/editor.ts`, `src/i18n/namespaces/settings.ts`
- **작업 내용**: design §14 표대로 ko/en 동시 추가(각 파일에 ko/en 블록이 따로 있다).
- **검증**:
  - [ ] PostToolUse 훅(`locales.test.ts`)이 저장 시점에 green
  - [ ] `field.sprint.empty`가 "일치하는 …" 형태(검색 불일치 상황을 겸하므로) — 기존 5개 키와 같은 어법
  - [ ] `public/_locales`·log-viewer 복제 사전은 **무변경**임을 확인(대상 아님)

## Task 7: UI — 판정 훅 + 필드 + 배선

⚠️ **쪼개지 말 것.** "meta 소멸 시 값 비우기"와 "sticky 검증"이 같은 `sprintId`에 쓰기를 하므로 한쪽만 들어가면 다른 쪽이 값을 되박는다(`IssueTypeField`의 기본값 자동 주입과 같은 형태). 우선순위는 **meta 확정 후에만 검증, meta `null`이면 요청 0회**다.

- **변경 대상**: `src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts`(신규), `SprintField.tsx`(신규), `JiraIssueFields.tsx`, `__tests__/SprintField.test.tsx`(신규), `__tests__/useSprintFieldMeta.test.tsx`(신규)
- **작업 내용**:
  - 판정 훅: `seqRef` stale 방어, 오류 삼킴, 모듈 스코프 세션 캐시(키 `siteId|projectKey|issueTypeId`).
  - `SprintField`: `FieldCombobox` 기반, `onSearch` 미전달(클라이언트 필터), **`ariaLabel={t("create.sprint")}` + `testId="jira-sprint-combobox"`**, `clearable={value != null}` + `onClear`, `multiBoard`일 때만 `AssigneeField` 2줄 스택으로 보드명.
  - `JiraIssueFields`: 이슈타입 행 **바로 아래**에 배치, 판정 중 로딩 자리 예약(`Loader2` + `common.loading`), meta 있을 때만 `FieldRow`, meta 소멸 시 값 비우기(열려 있으면 `onOpenChange(false)` 먼저), 검증 완료 전 `fallbackLabel` 미전달.
- **검증**:
  - [ ] `SprintField.test.tsx`: 목록 렌더 → 항목 선택 → `onChange(id, name)` / 해제 → `onChange(undefined)`
  - [ ] `multiBoard: false`면 보드명이 렌더되지 않는다 / `true`면 2줄로 렌더된다
  - [ ] meta `null` → `queryByTestId("jira-sprint-combobox")`가 `null`
  - [ ] 판정 중 → 로딩 표시가 있고, 아래 행들의 순서가 판정 전후로 동일하다
  - [ ] `sprintId` 없는 상태로 열면 `jira.getSprint`가 호출되지 않는다
  - [ ] meta `null`이면 `sprintId`가 있어도 `jira.getSprint`가 호출되지 않는다(경합 방지)
  - [ ] 검증 응답 전에는 저장된 이름이 트리거에 보이지 않는다(placeholder → 값 방향)
  - [ ] `useSprintFieldMeta`: 이슈타입을 A→B→A로 빠르게 바꿔도 늦게 온 A 응답이 B를 오염시키지 않는다 / **같은 키 재조회 시 요청이 0회**(캐시) / `siteId`가 다르면 캐시가 갈린다
  - [ ] 이슈타입 `Bug`→`Epic`→`Bug` 왕복 후 값이 되살아나지 않는다(S4)
  - [ ] `pnpm typecheck` 통과

## Task 8: 제출 진입점 2곳 + 분석 축

⚠️ **두 진입점을 같은 커밋에서** 바꾼다. 한쪽만 하면 재제출 경로가 무음으로 스프린트를 잃는다.

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`, `src/background/analytics.ts`, `src/sidepanel/lib/track-submit.ts` + `src/background/__tests__/analytics.test.ts`
- **작업 내용**: 라인 번호가 아니라 **심볼로 지목**한다(선행 기획 구현이 같은 자리를 다시 쓰는 중 — 착수 전 grep으로 재확인). `handleJiraSubmit`의 `submitToJira({…})`에 `sprintId`, `setLastSubmitFields("jira", {…})`에 `sprintId`·`sprintName`, `DraftDetailDialog`의 로컬 `SubmitFields` 타입 확장. `submitEventProperties`에 `sprintFieldShown`·`sprintSelected` 인자 추가(`String()` 문자열화, Jira 외에는 `null`), `ALLOWED_EVENTS.issue_submitted`에 두 키 등록.
- **검증**:
  - [ ] 두 키가 화이트리스트를 통과한다(`analytics.test.ts` — 등록 누락 시 `filterProperties`가 무음 폐기)
  - [ ] Jira 외 플랫폼 제출에는 두 키가 실리지 않는다
  - [ ] `sprint_field_shown`과 `sprint_selected`가 **독립**이다(행은 보였는데 안 고른 조합이 표현된다)
  - [ ] 신규 제출 → 다음 다이얼로그가 같은 스프린트로 열린다(수동)
  - [ ] 저장 이슈 재제출 경로의 payload·`lastSubmitFields`에도 실린다(수동 + Task 9 e2e)
  - [ ] `SubmitFieldsDialog`의 `fieldsReady`는 **무변경**(스프린트는 optional)
  - [ ] `pnpm test` 전체 green

## Task 9: e2e

- **변경 대상**: `e2e/jira-sprint-field.spec.ts`(신규), **`e2e/COVERAGE.md`**
- **작업 내용**: settings envelope seed + `chrome.runtime.sendMessage` 스파이로 `jira.sprintFieldMeta`·`jira.listSprints`·`jira.submitIssue` 응답 주입. **seed 필수 3개**: `projectKey`(없으면 `SetupDialog`가 자동으로 열려 다른 판정을 가린다), **`auth.cloudId`**(없으면 `jiraSiteId`가 `undefined`가 돼 선행 기획의 `sameSite` 게이트가 공허 통과 — `e2e/`에 선례 0건인 새 요구), **envelope `version: 11`**(기존 spec은 `version: 10`이라 마이그레이션 체인을 탄다). 콤보 특정은 `getByTestId`만 쓴다(`role=combobox` nth 금지 — 콤보 8개 + 팝오버 오픈 시 `CommandInput`이 추가된다). `e2e/COVERAGE.md`에 시나리오 추가(`e2e/README.md` 규정).
- **검증**:
  - [ ] meta 있음 → 스프린트 행이 보이고, 선택 후 제출 payload에 `sprintId`가 실린다
  - [ ] meta `null` → 행이 없고 제출 payload에 `sprintId` 키가 **없다**
  - [ ] 이슈타입을 스프린트 없는 타입으로 바꾸면 행이 사라지고 이미 고른 값이 payload에서 빠진다
  - [ ] 재제출 경로(`DraftDetailDialog`)에서도 payload에 `sprintId`가 실린다
  - [ ] `pnpm build:e2e && pnpm test:e2e e2e/jira-sprint-field.spec.ts` green

## Task 10: 문서 (구현 후)

- **변경 대상**: `docs/DIRECTORY.md`, `docs/privacy.{ko,en}.md`(대조), `guide/{ko,en}/integrations/platforms.md`
- **작업 내용**:
  - **`docs/DIRECTORY.md`** — `/guide`가 안 건드리므로 여기서 처리한다. 세 군데: `jiraFields/` 파일 목록(+`SprintField.tsx`·`useSprintFieldMeta.ts`·`sprint-sticky.ts`), `jira-api.ts` 기술(agile API 계열 신규 호출 + 순수 파서 3개), `submitToJira` 기술(`sprintId` 전달).
  - **privacy 대조** — 신규 외부 엔드포인트가 트리거다(`.claude/commands/push.md`). 결론이 "무변경"이어도 **판단을 기록**한다: 새 수집·저장이 없고 기존 자격증명으로 같은 목적의 호출이며 §3 표가 `api.atlassian.com`을 이미 덮는다. 갱신하게 되면 ko/en 본문 + 상단 시행일을 함께 bump.
  - **가이드** — 아래 §가이드 영향.
- **검증**:
  - [ ] `docs/DIRECTORY.md`에서 신규 파일 3개와 순수 파서가 검색된다
  - [ ] privacy 판정이 문서 또는 커밋 메시지에 남았다
  - [ ] `pnpm sync:agents:check` 통과(문서 변경이 미러에 영향 없음 확인)

---

## 회귀 리스크 (착수 전 grep으로 재확인 — 문서 작성 시점 기준이라 드리프트한다)

- **`createIssue` 호출부** — `background/messages.ts`의 `jira.submitIssue` 핸들러 1곳. 첨부 업로드 루프보다 **먼저** 돌므로 create 실패 시 부분 업로드는 없다.
- **`JiraSubmitInput` 소비처** — `IssueCreateModal`·`DraftDetailDialog` 2곳.
- **`lastSubmitFields.jira` 읽기/쓰기** — `editor-store.confirmDraft`(`initialJiraFields` 경유)·`DraftDetailDialog`·`setLastSubmitFields` 2곳 + `removeAccount("jira")`의 삭제 경로.
- **`resolveProjectChange` 소비처** — `JiraIssueFields.handleProjectChange` 1곳(선행 기획).
- **무변경 단언**: `SubmitFieldsDialog`의 `fieldsReady`(스프린트는 optional), `markSubmitted`, `initialJiraFields` 구현, `public/_locales`, log-viewer 사전, manifest.

## 테스트 계획

**단위 테스트**
- `pickSprintField` — 후보 있음/없음/복수, `schema` 누락 방어, 빈 배열
- `isActiveSprint` — 화이트리스트 4케이스
- `mergeBoardSprints` — dedup(+`boardName` 승자), 정렬, `multiBoard` 판정, 빈 입력
- `listSprints` — 보드 단위 실패 격리, 보드 목록 실패, 5개 상한
- `resolveStickySprint` — 화이트리스트, `null` fetched, 이름 변경, no-op
- `resolveProjectChange` — 비움 8키 + 보존 3키(기존 테스트 확장)
- `createIssue` — 기준선(키 집합 4개·createmeta 미호출) / 스칼라·배열 분기 / meta null / meta 조회 throw
- `submitEventProperties` + `filterProperties` — 두 축의 화이트리스트 통과·문자열화·플랫폼 게이트
- `useSprintFieldMeta` — stale 방어, 캐시 히트, `siteId` 분리

**e2e 시나리오** (`/e2e-write` 입력)
- 스프린트 필드 meta가 있으면 Jira 탭에 스프린트 행이 보인다
- 스프린트를 고르고 제출하면 `jira.submitIssue` payload에 그 `sprintId`가 실린다
- 스프린트 필드 meta가 없으면 스프린트 행이 보이지 않고 payload에 `sprintId` 키가 없다
- 이슈타입을 스프린트 없는 타입으로 바꾸면 행이 사라지고 이미 고른 값이 payload에서 빠진다
- 저장 이슈 재제출에서도 payload에 `sprintId`가 실린다

**수동 테스트** (실계정 — 자동화 불가)
- [ ] company-managed 스크럼 프로젝트: 스프린트 선택 → 제출 → Jira 이슈의 Sprint 필드에 반영
- [ ] team-managed 스크럼 프로젝트: 동일(값 형식이 갈리는 지점 — Task 0 결과 재확인)
- [ ] 칸반 전용 프로젝트 / 보드 없는 프로젝트: 스프린트 행 미노출
- [ ] 보드 2개 프로젝트: 목록 합쳐짐 + 보드명 2줄 표시 + 중복 없음
- [ ] 보드는 있으나 active/future 스프린트 0개: 행은 뜨고 "일치하는 스프린트가 없습니다"(S2b)
- [ ] OAuth 연동과 API 토큰 연동 양쪽에서 목록 조회(R1 — OAuth가 재연동 전이면 빈 목록이 정상)
- [ ] sticky: 제출 후 다음 다이얼로그에 유지 / 스프린트를 Jira에서 종료시킨 뒤 다시 열면 빈 값
- [ ] 세션 영속: 스프린트를 고르고 패널을 닫았다 열면 유지된다(`EDITOR_SNAPSHOT_KEYS` 자동 포함이지만 확인은 필요)
- [ ] 400px·320px 폭에서 긴 스프린트명 + 보드명이 잘리지 않고 2줄로 보인다

## 구현 순서 권장

```
Task 0 (차단 게이트 — 사용자가 직접 수행)
  └→ Task 1 (타입·순수 파서)
        ├→ Task 2 → Task 3 → Task 4        (background 레인)
        └→ Task 5 → Task 6                 (타입·i18n 레인, 위와 병렬)
              └→ Task 7 → Task 8 → Task 9 → Task 10
```

- Task 5는 `resolveStickySprint`가 `JiraSprint`를 받으므로 **Task 1에 의존**한다. Task 1 이후에 두 레인이 갈린다.
- Task 7은 3·5·6이 모두 끝나야 시작한다(메시지·필드·문구가 다 필요하다).
- Task 9는 8 이후. e2e가 실제 제출 payload를 판정하기 때문이다.

## 가이드 영향

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — Jira 제출 시 고를 수 있는 값 목록에 스프린트가 추가된다. `jira-project-switch`가 이미 같은 섹션(52–60행)을 건드리므로 **그 갱신 뒤에 얹는다.**
- `guide/{ko,en}/element/issue.md` · `screenshot/issue.md` · `video/issue.md` — *"연결한 플랫폼의 필드(…)를 채우고"* 문장은 그대로 유효하다. 문구 수정은 불필요할 가능성이 높으나 `/guide` 시 확인 대상.
- **스크린샷**: 제출 다이얼로그 Jira 탭에 행이 하나 더 늘어난다 → 해당 컷이 있으면 `/guide-shots` 대상.
- **주의 2개**: ① 스프린트 행은 **스크럼 프로젝트에서만** 보인다 — "항상 있는 필드"로 쓰면 칸반 사용자에게 거짓이다. ② OAuth 연동 사용자는 **재연동 전까지 목록이 빌 수 있다**(R1 결과에 따라) — 가이드에 단정적으로 쓰기 전에 Task 0 결과를 확인한다.

---

## spike 결과 (Task 0에서 채운다)

| 항목 | 결과 | 확인일 |
|---|---|---|
| createmeta 봉투 키 (`values` vs `fields`) | **`fields`** (`values` 아님 — 초안이 틀렸었다) | 2026-08-13 |
| createmeta 응답 `total` / 서버 적용 `maxResults` | `total: 21` / `maxResults: 200` 존중(자체 캡 없음) | 2026-08-13 |
| sprint `schema.type` (company-managed) | `fieldId: "customfield_10020"`, `type: "array"` | 2026-08-13 |
| sprint `schema.type` (team-managed) | 미측정 | |
| create 수용 형식 (스칼라 / 배열 / 양쪽) | **미측정** — 실제 이슈 생성이 필요하고, 스프린트가 있는 프로젝트가 회사 실 프로젝트뿐 | |
| `autoCompleteUrl` 값·응답 모양·필터 파라미터 (A7) | **없음**(`undefined`) → A7 기각, 우회로 소멸 | 2026-08-13 |
| OAuth classic scope로 agile GET 가능 여부 | **불가** — 401 `Unauthorized; scope does not match` | 2026-08-13 |
| classic ↔ granular 혼용 가능 여부 | **가능** — 동의 화면에 6종 동시 표시 | 2026-08-13 |
| agile GET에 필요한 granular 조합 | `read:board-scope:jira-software` + **`read:project:jira`** + `read:sprint:jira-software`. 가운데 것이 빠지면 **여전히 401** | 2026-08-13 |
| 칸반 보드 `board/{id}/sprint` 응답 | **400** + 로케일 번역된 `errorMessages` → status로만 판정 | 2026-08-13 |
| 보드 없는 프로젝트 `board?projectKeyOrId=` 응답 | **200 + 빈 `values`**(404 아님) | 2026-08-13 |
| team-managed 보드 type / 스프린트 반환 | `type: "simple"`, **일부가 스프린트를 정상 반환** → `type=scrum` 서버 필터 폐기 | 2026-08-13 |
| 보드 페이지네이션 | 사이트 전체 `total: 71`·`isLast: false`(1페이지 50). 한 프로젝트 최대 15개 관측 | 2026-08-13 |

측정 환경: cloudId `5c399437-…`, createmeta는 프로젝트 `FCLXP`·이슈타입 `버그`, 보드/스프린트는 사이트 전역, OAuth 연동.

### spike 잔여 (구현 착수를 막지는 않는다)

**create 수용 형식(항목 3)만 열려 있다.** 측정하려면 스프린트가 실재하는 프로젝트에 테스트 이슈를 만들었다 지워야 하는데, 그런 프로젝트가 전부 회사 실 프로젝트다. 두 선택지:

- **측정 후 확정** — 스프린트가 있는 프로젝트(예: 연습용 스프린트가 있는 보드)에 이슈를 만들어 스칼라·배열을 각각 시도하고 즉시 삭제.
- **`schema.type: "array"`를 신뢰하고 배열로 구현**(권장) — 틀려도 제출이 400으로 **즉시 드러나고** 무음으로 잘못 저장되지 않는다. 첫 실사용이 곧 검증이며, Task 4의 `isArray` 분기는 그대로 둔다(team-managed에서 값이 다를 수 있으므로 분기 자체는 필요하다).
