# Jira 제출 시 Sprint 선택 — 구현 태스크

## 선행 조건

1. **`jira-project-switch`가 머지돼 있어야 한다.** `EditorIssueFields.projectKey`, `applyProjectChange`(`tabs/jiraFields/project-change.ts`), 하위 필드의 `projectKey` prop이 전제다. 없으면 Task 5·6·7이 존재하지 않는 파일을 가리킨다.
2. **Jira 실계정 2개 이상의 프로젝트**: 스크럼 보드가 있는 프로젝트 1개(company-managed), 칸반 전용 또는 보드 없는 프로젝트 1개. 가능하면 team-managed 스크럼 프로젝트도.
3. **OAuth 연동과 API 토큰 연동 양쪽**: R1(scope)이 인증 방식에 따라 갈리므로 둘 다 필요하다.
4. Task 0을 통과하지 못하면 **Task 1 이후는 착수하지 않는다**(설계가 뒤집힌다).

---

## Task 0: 선행 spike — API 실측 (차단 게이트)

코드를 커밋하지 않는다. 실계정에 직접 요청을 날려 설계 전제 4개를 확정하고 결과를 이 파일 하단 "spike 결과"에 기록한다.

- **변경 대상**: 없음(임시 스크립트·`curl`. 커밋하지 않는다)
- **작업 내용**:
  1. **createmeta 봉투 키**(R3) — `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}?maxResults=200`의 최상위 배열 키가 `values`인지 `fields`인지, 각 원소가 `fieldId`·`schema.custom`·`schema.type`을 그대로 갖는지.
  2. **sprint 필드 스키마**(R2) — 위 응답에서 `schema.custom === "com.pyxis.greenhopper.jira:gh-sprint"`인 항목의 `schema.type`. company-managed / team-managed 각각.
  3. **create 수용 형식**(R2) — 실제 이슈 생성으로 `fields[customfield_XXXXX]`에 스칼라(`42`)와 배열(`[42]`) 중 무엇이 통하는지. **둘 다 통하면 그 사실을 기록**한다(설계가 단순해진다).
  4. **OAuth scope**(R1) — 현재 OAuth 토큰으로 `GET /rest/agile/1.0/board?projectKeyOrId=…`와 `GET /rest/agile/1.0/board/{id}/sprint?state=active,future`가 200인지. 401/403이면 Atlassian 개발자 콘솔에서 **이 앱이 classic scope와 granular scope를 함께 가질 수 있는지**까지 확인한다(섞을 수 없으면 3종 전부 마이그레이션이 필요하고, 그건 이 기획 범위를 넘어 재기획 대상이다).
  5. **칸반/보드 없음 거동** — 칸반 보드에 `board/{id}/sprint`를 호출했을 때의 status·body. 보드가 없는 프로젝트의 `board?projectKeyOrId=` 응답(빈 `values`인지 404인지).
- **검증**:
  - [ ] 1~5 답이 전부 기록됐다
  - [ ] 4가 실패면 **작업 중단** — 사용자에게 보고하고 scope 추가(재동의) 여부를 확정한 뒤 재개
  - [ ] 3의 결과가 `isArray` 분기를 유지할지(양쪽 다르면 유지, 한쪽으로 통일되면 상수로 고정) 판정됐다

---

## Task 1: 순수 파서 2개 (TDD red → green)

- **변경 대상**: `src/background/jira-api.ts`, `src/background/__tests__/sprint-parse.test.ts`(신규)
- **작업 내용**: `pickSprintField(res)`·`mergeBoardSprints(perBoard)`를 테스트 먼저 작성하고 구현. `SPRINT_SCHEMA` 상수, `JiraSprint`·`JiraSprintFieldMeta` 타입(`src/types/jira.ts`)도 여기서 추가. 네트워크 함수는 아직 만들지 않는다.
- **검증**:
  - [ ] `pickSprintField`: gh-sprint 있음 → `{fieldId, isArray}` / 없음 → `null` / 후보 2개 → 첫 번째 / `schema` 누락 원소 섞여도 크래시 없음
  - [ ] `mergeBoardSprints`: 보드 2개 중복 id → 1건 / `active`가 `future`보다 앞 / 같은 상태 안 id 오름차순 / 보드 1개면 `boardName === ""` / 빈 입력 → `[]`
  - [ ] `pnpm test src/background/__tests__/sprint-parse.test.ts` green

## Task 2: agile·createmeta 네트워크 함수 3개

- **변경 대상**: `src/background/jira-api.ts`
- **작업 내용**: `getSprintFieldMeta`·`listSprints`·`getSprint` 추가. `listSprints`는 보드 단위 실패를 삼키고(400/403 → 그 보드만 빈 배열), `getSprint`는 404/403 → `null`. Task 0의 실측값(봉투 키·경로)을 반영한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `fetch` 모킹 테스트: 보드 2개 중 1개가 400 → 나머지 보드 스프린트만 반환, throw 없음
  - [ ] `getSprint` 404 → `null`(throw 아님)
  - [ ] 실계정 수동 1회: 스크럼 프로젝트에서 스프린트 목록이 실제로 온다

## Task 3: bg 메시지 3개 배선

- **변경 대상**: `src/types/messages.ts`, `src/background/messages.ts`
- **작업 내용**: `jira.sprintFieldMeta`·`jira.listSprints`·`jira.getSprint`를 `BgRequest` union에 추가하고 switch에 case 3개(`jira.listIssueTypes`(246행) 인근, `await loadAuth()` 위임).
- **검증**:
  - [ ] `pnpm typecheck` 통과 (union 누락 시 switch가 exhaustive 실패로 잡힌다)
  - [ ] `src/types/__tests__/messages.test.ts`가 메시지 목록을 검사한다면 함께 갱신

## Task 4: 제출 경로 — `createIssue` + payload (TDD red → green)

- **변경 대상**: `src/background/jira-api.ts`, `src/types/jira.ts`, `src/sidepanel/lib/submitToJira.ts`, `src/background/__tests__/jira-api.test.ts`
- **작업 내용**: `JiraCreateIssuePayload.sprintId?: number` 추가, `createIssue`에 재해석 분기 삽입, `submitToJira`가 `sprintId`를 전달. **`sprintId`가 없으면 createmeta를 호출하지 않는다.**
- **검증**:
  - [ ] `sprintId` 없는 payload → `fetch` 호출 목록이 도입 전과 동일(createmeta 호출 0회), body 동일 (PRD 목표 5)
  - [ ] `sprintId` 있고 meta `isArray: false` → `fields.customfield_10020 === 42`
  - [ ] `sprintId` 있고 meta `isArray: true` → `fields.customfield_10020` 가 `[42]`
  - [ ] `sprintId` 있는데 meta `null` → sprint 키 없이 생성되고 throw 없음 (R7)

## Task 5: sticky 순수 함수 + 타입 확장 (TDD red → green)

- **변경 대상**: `src/types/platform.ts`, `src/store/editor-store.ts`, `src/sidepanel/tabs/jiraFields/sprint-sticky.ts`(신규), `src/sidepanel/tabs/jiraFields/__tests__/sprint-sticky.test.ts`(신규), `src/sidepanel/tabs/jiraFields/project-change.ts`(선행 기획 파일) + 그 테스트
- **작업 내용**: `sprintId`·`sprintName`을 `JiraLastSubmitFields`·`EditorIssueFields`에 추가. `resolveStickySprint` 구현(유효 상태 **화이트리스트** — `active`·`future`만 통과). `applyProjectChange`가 비우는 목록에 스프린트 2개 추가.
- **검증**:
  - [ ] `current.sprintId` 없음 → `null`
  - [ ] `fetched === null` → 값 비움 patch
  - [ ] `state: "closed"` → 값 비움 / `state: "unknown-future-value"` → **값 비움**(화이트리스트, R9)
  - [ ] 유효 + 이름 동일 → `null` / 유효 + 이름 변경 → `{ sprintName }`만
  - [ ] `project-change.test.ts`: 프로젝트 전환 patch에 `sprintId: undefined`·`sprintName: undefined` 포함
  - [ ] `SETTINGS_STORE_VERSION` 11 유지(optional 추가라 마이그레이션 불필요) — `settings-store.test.ts` green

## Task 6: i18n 키 5개

- **변경 대상**: `src/i18n/namespaces/editor.ts`, `src/i18n/namespaces/settings.ts`
- **작업 내용**: design §13 표대로 ko/en 동시 추가.
- **검증**:
  - [ ] PostToolUse 훅(`locales.test.ts`)이 저장 시점에 green
  - [ ] `public/_locales`·log-viewer 복제 사전은 **무변경**임을 확인(대상 아님)

## Task 7: UI — 판정 훅 + 필드 + 배선

- **변경 대상**: `src/sidepanel/tabs/jiraFields/useSprintFieldMeta.ts`(신규), `SprintField.tsx`(신규), `JiraIssueFields.tsx`, `__tests__/SprintField.test.tsx`(신규)
- **작업 내용**: 선제 판정 훅(`seqRef` stale 방어, 오류는 삼킴), `FieldCombobox` 기반 필드(클라이언트 필터 — `onSearch` 미전달, 보드명은 항목 우측 muted), `JiraIssueFields`에 조건부 `FieldRow` + meta 소멸 시 값 비우기 + sticky 검증 1회. **`!isEpicType` 게이트를 추가하지 않는다**(createmeta가 답한다).
- **검증**:
  - [ ] `SprintField.test.tsx`(jsdom + user-event): 목록 렌더 → 항목 선택 → `onChange(id, name)` 호출 / `clearable`로 해제 시 `onChange(undefined)`
  - [ ] 보드 1개(`boardName: ""`)면 보드명이 렌더되지 않는다
  - [ ] meta `null` → `FieldRow`가 DOM에 없다
  - [ ] `sprintId` 없는 상태로 다이얼로그를 열면 `jira.getSprint`가 호출되지 않는다
  - [ ] `pnpm typecheck` 통과

## Task 8: 제출 진입점 2곳 + 가이드 트라이아지

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`(167·194행), `src/sidepanel/tabs/DraftDetailDialog.tsx`(419·451행)
- **작업 내용**: `submitToJira`에 `sprintId` 전달, `setLastSubmitFields("jira", …)`에 `sprintId`·`sprintName` 저장. `DraftDetailDialog`의 로컬 `SubmitFields` 타입 확장. **두 곳을 같은 커밋에서** 바꾼다(한쪽만 하면 재제출 경로가 무음으로 스프린트를 잃는다).
- **검증**:
  - [ ] 신규 제출 → 다음 다이얼로그가 같은 스프린트로 열린다(수동)
  - [ ] 저장 이슈 재제출 경로도 동일(수동)
  - [ ] `pnpm test` 전체 green

## Task 9: e2e

- **변경 대상**: `e2e/jira-sprint-field.spec.ts`(신규)
- **작업 내용**: settings envelope seed(`projectKey` 필수) + `chrome.runtime.sendMessage` 스파이로 `jira.sprintFieldMeta`·`jira.listSprints`·`jira.submitIssue` 응답 주입.
- **검증**:
  - [ ] meta 있음 → 스프린트 행이 보이고 선택 후 제출 payload에 `sprintId`가 실린다
  - [ ] meta `null` → 행이 없고 제출 payload에 `sprintId` 키가 **없다**
  - [ ] `pnpm build:e2e && pnpm test:e2e e2e/jira-sprint-field.spec.ts` green

---

## 테스트 계획

**단위 테스트**
- `pickSprintField` — 후보 있음/없음/복수, `schema` 누락 방어
- `mergeBoardSprints` — dedup, 정렬(active→future, id 오름차순), 보드 1개 시 `boardName` 공백, 빈 입력
- `resolveStickySprint` — 유효 상태 화이트리스트, `null` fetched, 이름 변경 감지, no-op 케이스
- `applyProjectChange` — 스프린트 2개 포함(기존 테스트 확장)
- `createIssue` — sprint 없는 payload 불변성 / 스칼라·배열 분기 / meta null 무음 생략

**e2e 시나리오** (`/e2e-write` 입력)
- 스프린트 필드 meta가 있으면 Jira 탭에 스프린트 행이 보인다
- 스프린트를 고르고 제출하면 `jira.submitIssue` payload에 그 `sprintId`가 실린다
- 스프린트 필드 meta가 없으면 스프린트 행이 보이지 않고 payload에 `sprintId` 키가 없다
- 이슈타입을 스프린트 없는 타입으로 바꾸면 행이 사라지고 이미 고른 값이 payload에서 빠진다

**수동 테스트** (실계정 — 자동화 불가)
- [ ] company-managed 스크럼 프로젝트: 스프린트 선택 → 제출 → Jira 이슈의 Sprint 필드에 반영
- [ ] team-managed 스크럼 프로젝트: 동일(값 형식이 갈리는 지점 — Task 0 결과 재확인)
- [ ] 칸반 전용 프로젝트: 스프린트 행 미노출
- [ ] 보드 없는 프로젝트: 스프린트 행 미노출
- [ ] 보드 2개 프로젝트: 목록 합쳐짐 + 보드명 표시 + 중복 없음
- [ ] OAuth 연동과 API 토큰 연동 양쪽에서 목록 조회 성공(R1)
- [ ] sticky: 제출 후 다음 다이얼로그에 유지 / 스프린트를 Jira에서 종료시킨 뒤 다시 열면 빈 값

## 구현 순서 권장

```
Task 0 (차단 게이트)
  └→ Task 1 → Task 2 → Task 3 → Task 4        (background 레인)
  └→ Task 5 → Task 6                          (타입·i18n 레인 — Task 1의 타입 추가 이후 병렬 가능)
        └→ Task 7 → Task 8 → Task 9
```

- Task 1의 타입 추가가 끝나면 **background 레인(2→3→4)과 타입·i18n 레인(5→6)은 병렬**이다.
- Task 7은 3·5·6이 모두 끝나야 시작한다(메시지·필드·문구가 다 필요하다).
- Task 9는 8 이후. e2e가 실제 제출 payload를 판정하기 때문이다.

## 가이드 영향

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — Jira 제출 시 고를 수 있는 값 목록에 스프린트가 추가된다. `jira-project-switch`가 이미 같은 섹션(52–60행)을 건드리므로 **그 갱신 뒤에 얹는다.**
- `guide/{ko,en}/element/issue.md` · `screenshot/issue.md` · `video/issue.md` — *"연결한 플랫폼의 필드(…)를 채우고"* 문장은 그대로 유효하다. 문구 수정은 불필요할 가능성이 높으나 `/guide` 시 확인 대상.
- **스크린샷**: 제출 다이얼로그 Jira 탭에 행이 하나 더 늘어난다 → 해당 컷이 있으면 `/guide-shots` 대상.
- **주의**: 스프린트 행은 **스크럼 프로젝트에서만** 보인다. 가이드에 "항상 있는 필드"로 쓰면 칸반 사용자에게 거짓이 된다 — 조건을 함께 적는다.

---

## spike 결과 (Task 0에서 채운다)

| 항목 | 결과 | 확인일 |
|---|---|---|
| createmeta 봉투 키 (`values` vs `fields`) | | |
| sprint `schema.type` (company-managed) | | |
| sprint `schema.type` (team-managed) | | |
| create 수용 형식 (스칼라 / 배열 / 양쪽) | | |
| OAuth classic scope로 agile GET 가능 여부 | | |
| (실패 시) classic ↔ granular 혼용 가능 여부 | | |
| 칸반 보드 `board/{id}/sprint` 응답 | | |
| 보드 없는 프로젝트 `board?projectKeyOrId=` 응답 | | |
