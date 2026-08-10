# audit-refactor-2 — 콤보박스 race 수정 + lazy-load 단일 출처 이행

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다.

**사용자 노출 변화: 있다.** 이 배치의 🔴2는 실제 증상이 있는 버그다 — GitHub/GitLab/Asana 이슈 필드에서 **상위 스코프(저장소·프로젝트·워크스페이스)를 바꾼 뒤 라벨·담당자 콤보박스를 열면 이전 스코프의 후보가 그대로 보이고, 다시 열어도 갱신되지 않는다.** 그 상태에서 고른 값은 새 스코프에 존재하지 않는 라벨/담당자라 제출 시 플랫폼 API가 거부하거나 조용히 무시한다. 나머지(🟡42)는 내부 구조 정리라 노출 변화가 없다.

## 배치 지도

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| audit-refactor-1 | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| **audit-refactor-2** | **콤보박스 race·lazy-load 단일 출처 이행** | **🔴2 · 🟡42** | **중** |
| audit-refactor-3 | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| audit-refactor-4 | 세션·데이터 정합 | 🟡12~14,17,18 · ⚪71,73~76 | 중 |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

### 🔴2 — 스코프 리셋이 in-flight 응답을 무효화하지 않는다

`src/sidepanel/tabs/githubFields/LabelCombobox.tsx:65-67`의 리셋 effect는 이렇게 생겼다.

```tsx
useEffect(() => {
  setItems([]);
}, [owner, repo]);
```

`setItems([])`만 하고 `reqIdRef`를 올리지 않는다. 그래서 다음 순서가 성립한다.

1. 저장소 A에서 라벨 콤보박스를 연다 → `github.getLabels(A)` 발사 (`myReq = 1`).
2. 응답 전에 콤보박스를 닫고 저장소를 B로 바꾼다 → 리셋 effect가 `items`를 비운다. **`reqIdRef.current`는 그대로 1.**
3. A의 응답이 도착한다 → `myReq(1) === reqIdRef.current(1)` 통과 → `setItems(A의 라벨)`.
4. 라벨 콤보박스를 다시 연다 → 로드 effect의 `if (items.length > 0) return;`(같은 파일 `:42`)에 막혀 **B를 조회하지 않는다.**

결과적으로 사용자는 저장소 B의 폼에서 저장소 A의 라벨 목록을 보고, 목록은 재열기·재렌더로도 복구되지 않는다(스코프를 한 번 더 바꿔야 풀린다).

공용 훅 `src/sidepanel/hooks/useLazyListOnOpen.ts:23-26`은 정확히 이걸 막는다.

```ts
useEffect(() => {
  reqIdRef.current++;
  setItems([]);
}, [load]);
```

즉 **버그가 아니라 미이행의 부산물**이다. 훅에는 이미 고쳐져 있고, 훅을 안 쓰는 6곳에만 남아 있다.

동일 패턴 6곳 (전부 `setItems([])`만 하고 `reqIdRef` 미증가):

| 파일 | 리셋 effect | 로드 가드 |
|---|---|---|
| `src/sidepanel/tabs/githubFields/LabelCombobox.tsx:65` | `[owner, repo]` | `:42` |
| `src/sidepanel/tabs/githubFields/AssigneeCombobox.tsx:64` | `[owner, repo]` | `:41` |
| `src/sidepanel/tabs/gitlabFields/LabelCombobox.tsx:60` | `[projectId]` | `:41` |
| `src/sidepanel/tabs/gitlabFields/AssigneeCombobox.tsx:67` | `[projectId]` | `:41` |
| `src/sidepanel/tabs/asanaFields/ProjectCombobox.tsx:71` | `[workspaceGid]` | `:47` |
| `src/sidepanel/tabs/asanaFields/AssigneeCombobox.tsx:71` | `[workspaceGid]` | `:48` |

### 🟡42 — 공용 셸이 있는데 8곳이 손으로 재조립돼 있다

`src/sidepanel/components/SingleLazyCombobox.tsx`(Popover + Command + lazy load + 로딩/에러/빈 상태 + 선택 상단 고정)와 그 내부의 `useLazyListOnOpen`이 단일 출처인데, 실제 사용은 **clickup·slack 2개 플랫폼 5개 파일**뿐이다.

현재 사용처(참조 구현):

| 파일 | 스코프(리셋 트리거) | 특이 사용 |
|---|---|---|
| `src/sidepanel/tabs/clickupFields/WorkspaceCombobox.tsx:26` | 없음 (`useCallback(..., [])`) | 기본형 |
| `src/sidepanel/tabs/clickupFields/SpaceCombobox.tsx:27` | `workspaceId` | `disabled={!ready}` + 안내 트리거 라벨 |
| `src/sidepanel/tabs/clickupFields/ListCombobox.tsx:27` | `spaceId` | `getItemValue` + `renderItem`(폴더명 보조 표시) |
| `src/sidepanel/tabs/clickupFields/AssigneeCombobox.tsx:27` | `workspaceId` | `pinSelected` + `renderItem`(이름/이메일 2줄) |
| `src/sidepanel/tabs/slackFields/ChannelCombobox.tsx:27` | 없음 | `renderItem`(`ChannelIcon`) |

핵심은 `load`를 `useCallback([스코프])`로 감싸 넘기는 것이다. 스코프가 바뀌면 `load` 식별자가 바뀌고, 훅의 리셋 effect가 `reqIdRef.current++` + `setItems([])`를 동시에 수행한다. 손 재구현 6곳이 놓친 절반이 바로 이 `reqIdRef.current++`다.

`docs/DESIGN.md` §13도 이미 같은 사실을 적어두었다 — *"`SingleLazyCombobox`는 현재 clickup·slack 2곳만 쓴다 — 나머지 6개는 Popover+Command를 손으로 조립한 잔재다."*

## 목표

1. **🔴2의 race 6곳이 사라진다.** 스코프를 바꾼 뒤 콤보박스를 열면 항상 새 스코프의 후보가 조회된다. 이전 스코프의 늦은 응답은 폐기된다.
2. **race를 자동 테스트로 고정한다.** 이행 전에 실패하고 이행 후에 통과하는 재현 테스트가 저장소에 남는다(`*.test.tsx` 트랙).
3. **이행 대상 7개 콤보박스가 `SingleLazyCombobox` 한 벌로 수렴한다.** 각 파일에서 `useState`/`useEffect`/`reqIdRef`/Popover·Command 마크업이 사라지고 `useCallback` + props 매핑만 남는다(clickup 참조 구현과 동일한 형태).
4. **공용 컴포넌트·훅에 새 prop이나 옵션을 추가하지 않고 이행이 끝난다.** 추가가 필요하다는 결론이 나오면 그 콤보박스는 이행 대상에서 뺀다(CLAUDE.md "요청하지 않은 유연성·추상화 추가 금지").
5. **`docs/DESIGN.md` §13의 "clickup·slack 2곳만" 문장이 이행 후 상태와 맞게 갱신된다.**

## 비목표 (Non-goals)

- **서버 검색형 콤보박스 3개의 이행.** `githubFields/RepoCombobox.tsx`·`gitlabFields/ProjectCombobox.tsx`·`notionFields/DatabaseCombobox.tsx`는 입력마다 서버에 재질의하는 debounce 검색이라 "열 때 1회 로드 + 클라이언트 필터"인 `SingleLazyCombobox`와 모델이 다르다. 근거·판정은 `design.md` 표 참조. **이 3개는 🔴2 대상도 아니다**(스코프 리셋 effect 자체가 없다).
- **linear 콤보박스 4개**(`TeamCombobox`·`LabelCombobox`·`AssigneeCombobox`·`ProjectCombobox`). 감사 42번 열거 밖이고, 이들은 `reqIdRef`가 아니라 `loadedTeamId` state 마커로 다른 패턴을 쓴다(`src/sidepanel/tabs/linearFields/LabelCombobox.tsx:36,39`). 별도 판단이 필요하므로 이 배치에서 건드리지 않는다.
- **jira 필드 콤보박스.** `tabs/jiraFields/FieldCombobox.tsx`라는 자체 표현 셸 + `useDebouncedSearch.ts`를 이미 갖고 있다. 다른 계열이다.
- **`CcMultiCombobox` 계열**(다중 선택 CC). 8개 플랫폼 전부 이미 공용 컴포넌트 + `useLazyListOnOpen`을 쓴다.
- **`SingleLazyCombobox`/`useLazyListOnOpen`의 기능 확장.** 서버 검색·페이지네이션·무한 스크롤 추가 금지.
- **UI 시각 변경.** 트리거·팝오버·항목의 겉모습은 그대로다.
- **콤보박스 외 감사 항목.** 다른 배치 소관.

## 회귀 감시 지점

이행하다 깨질 수 있는 기존 동작과 확인법. (`/feature` 템플릿의 "사용자 시나리오" 대체)

| # | 감시 대상 | 왜 깨질 수 있나 | 확인법 |
|---|---|---|---|
| R1 | **Connect 폼 재사용** — 대상 7개 중 5개가 `tabs/connect/*ConnectForm.tsx`에서도 렌더된다 (`GithubConnectForm.tsx:25,26`, `GitlabConnectForm.tsx:26,27`, `AsanaConnectForm.tsx:21,22,23`) | props 시그니처를 바꾸면 이슈 폼만 고치고 Connect 폼을 놓친다 | `pnpm typecheck` + 설정>연동에서 각 플랫폼 기본값 필드가 렌더·선택되는지 육안 |
| R2 | **상위 값 변경 시 하위 defaults 비우기** — `GithubConnectForm.tsx:142-152`의 주석 있는 로직, `GithubIssueFields.tsx:52-58`의 `label/assignee/cc` 동시 비우기 | 이행이 `onChange` 콜백 시그니처를 건드리면 이 로직이 조용히 어긋난다 | 저장소를 바꾼 뒤 라벨·담당자 트리거 라벨이 placeholder로 돌아오는지 |
| R3 | **`ready` 게이트 안내 라벨** — `!ready`일 때 트리거에 `github.field.requireRepo` / `gitlab.field.requireProject` / `asana.field.requireWorkspace`를 노출하고 버튼이 비활성 (DESIGN.md §13 Connect 폼 규칙) | `triggerLabel`/`disabled` 매핑을 빠뜨리기 쉽다 | 상위 값 미선택 상태에서 트리거 문구와 비활성 확인 |
| R4 | **검색 필터 의미** — github/gitlab의 Label·Assignee 4개는 현재 `<Command>` 기본 필터(cmdk 스코어링·정렬)를 쓰고, `SingleLazyCombobox`는 `shouldFilter={false}` + `getName` 부분일치다 | 이행 시 필터 알고리즘이 바뀐다(퍼지 매칭·점수순 정렬 상실). **의도된 수렴이지만 눈에 보이는 변화**다 | 라벨 검색창에 중간 문자열을 넣어 부분일치로 걸리는지 |
| R5 | **항목 부가 렌더** — 라벨 색 dot(`ColorSwatch shape="round"`, github/gitlab Label), 아바타 `<img>`(github/gitlab Assignee), 이름+이메일 2줄(asana Assignee) | `renderItem`으로 옮기면서 누락되기 쉽다 | 각 콤보박스를 열어 dot/아바타/이메일이 그대로 보이는지 |
| R6 | **선택 항목 상단 고정** — `asanaFields/AssigneeCombobox.tsx:125`가 `orderSelectedFirst`를 직접 호출 | `pinSelected` prop 매핑을 빠뜨리면 조용히 사라진다 | 담당자를 고른 뒤 다시 열었을 때 맨 위에 있는지 |
| R7 | **무한 재조회** — `load`를 `useCallback`으로 감싸지 않으면 매 렌더마다 식별자가 바뀌어 훅의 리셋 effect가 계속 돌고 재조회 루프에 빠진다 | 이행 시 가장 쉬운 실수 | 콤보박스를 열어둔 채 네트워크 요청이 1회인지 (background 로그) |
| R8 | **에러·로딩·빈 상태 문구** — 각 콤보박스마다 `*.empty` / `*.search` i18n 키가 다르다 | props 매핑 시 다른 플랫폼 키를 복사해오기 쉽다 | ko/en 양쪽에서 문구 확인, `src/i18n/` 키 존재 여부 |

## 성공 기준

1. `src/sidepanel/hooks/__tests__/useLazyListOnOpen.test.tsx`와 `src/sidepanel/tabs/githubFields/__tests__/LabelCombobox.test.tsx`가 추가되고 `pnpm test` 통과.
2. 위 재현 테스트가 **이행 전 코드에서는 실패**하는 것을 확인한 기록이 남는다(TDD red → green).
3. 이행 대상 7개 파일에 `useEffect`·`reqIdRef`·`Popover`·`Command` import가 남아 있지 않다(`grep`으로 확인 가능).
4. `pnpm typecheck` 통과, `pnpm test` 통과.
5. R1~R8 전 항목을 Chrome 실물에서 확인(콤보박스가 OAuth 연결 계정을 전제로 하므로 자동화 불가 — `tasks.md` 수동 체크리스트).
6. `docs/DESIGN.md` §13의 `SingleLazyCombobox` 행이 갱신된다.
