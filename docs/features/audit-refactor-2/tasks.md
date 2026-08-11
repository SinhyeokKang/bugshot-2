# audit-refactor-2 — 구현 태스크

## 선행 조건

- 권한·env·의존성 변경 없음. 새 패키지 없음(`@testing-library/react`·`user-event`·jsdom 셋업은 이미 구비 — `vitest.config.ts`의 `environmentMatchGlobs` + `src/test/setup-dom.ts`).
- 착수 전 `docs/POSTMORTEM.md`를 `콤보박스`·`race`·`useEffect`·`Popover` 키워드로 grep해 과거 함정을 소환한다(CLAUDE.md 소환 회로).
- 참조 구현 3개를 먼저 읽는다: `src/sidepanel/tabs/clickupFields/ListCombobox.tsx`(스코프 + `renderItem`), `src/sidepanel/tabs/clickupFields/AssigneeCombobox.tsx`(`pinSelected` + 2줄 렌더), `src/sidepanel/tabs/slackFields/ChannelCombobox.tsx`(스코프 없음).
- **공용 파일 2개는 읽기만 하고 수정하지 않는다** — `src/sidepanel/components/SingleLazyCombobox.tsx`, `src/sidepanel/hooks/useLazyListOnOpen.ts`.

## 태스크

### Task 1: 공용 훅 계약 잠금 테스트

- **변경 대상**: `src/sidepanel/hooks/__tests__/useLazyListOnOpen.test.tsx` (신규)
- **작업 내용**: `renderHook`(@testing-library/react)으로 `useLazyListOnOpen`의 3가지 계약을 고정한다. `load`는 수동 resolve 가능한 deferred(`let resolveA!: (v: T[]) => void; const pA = new Promise(...)`)로 만든다.
  1. `open=false`면 `load` 미호출 → `open=true`로 rerender하면 1회 호출, resolve 후 `items` 반영. 같은 `load`로 open/close를 반복해도 재호출 없음(`items.length > 0` 조기 반환).
  2. **in-flight 무효화**: `open=true`로 `loadA` 호출 → resolve 전에 `loadB`로 rerender → `loadA` resolve(`["old"]`) → `items`에 `"old"`가 **없어야** 한다. 이어서 `loadB` resolve(`["new"]`) → `items === ["new"]`.
  3. `load` reject 시 `error`가 `formatError` 결과로 채워지고, `formatError`가 렌더마다 새 함수여도 effect가 재실행되지 않는다(호출 횟수로 검증 — latest-ref 분리 `useLazyListOnOpen.ts:20-21`).
- **검증**:
  - [x] `pnpm test src/sidepanel/hooks/__tests__/useLazyListOnOpen.test.tsx` 통과 (현재 코드 기준 **처음부터 green** — 훅은 이미 올바르다. 회귀 잠금용)
  - [x] 케이스 2에서 `useLazyListOnOpen.ts:24`의 `reqIdRef.current++`를 일시적으로 지우면 실패하는 것을 확인(테스트가 실제로 그 줄을 지키는지 검증)

### Task 2: 🔴2 재현 테스트 (red)

- **변경 대상**: `src/sidepanel/tabs/githubFields/__tests__/LabelCombobox.test.tsx` (신규)
- **작업 내용**: 이행 전 `LabelCombobox`에서 **실패하는** 테스트를 먼저 박는다.
  - mock: `vi.mock("@/i18n", () => ({ useT: () => (k: string) => k }))`, `vi.mock("@/types/messages", ...)`로 `sendBg`를 deferred 반환 스텁으로 대체(`CcMultiCombobox.test.tsx`의 i18n mock 패턴 + `vi.fn()`).
  - 시나리오(감사 원문 그대로):
    1. `owner="o" repo="A"`로 렌더 → 트리거 클릭(open) → `sendBg` 1회 호출(repo A), 응답은 아직 미해결.
    2. Escape로 닫는다.
    3. `repo="B"`로 rerender (스코프 변경).
    4. **이제** repo A 요청을 `[{id:1,name:"a-only",color:"f00"}]`로 resolve.
    5. 트리거를 다시 클릭(open).
    6. **기대**: `sendBg`가 repo B로 호출되고, 목록에 `"a-only"`가 없다.
  - 이행 전 결과: 4단계 응답이 `reqIdRef` 검사를 통과해 `items`를 채우고, 5단계에서 `items.length > 0`(`LabelCombobox.tsx:42`)이 재조회를 막아 `"a-only"`가 보인다 → **실패**.
- **검증**:
  - [x] 이행 전 `pnpm test src/sidepanel/tabs/githubFields/__tests__/LabelCombobox.test.tsx` **실패**(red) — 실패 메시지를 기록에 남긴다
  - [x] 실패 원인이 "재조회 없음 + 이전 스코프 항목 노출"인지 확인(단순 셀렉터 오류가 아님)

### Task 3: `githubFields/LabelCombobox` 이행 (green)

- **변경 대상**: `src/sidepanel/tabs/githubFields/LabelCombobox.tsx`
- **작업 내용**: `Props` 시그니처 동결. 본문을 `SingleLazyCombobox` 호출로 교체.
  - `const ready = !!owner && !!repo;`
  - `const load = useCallback(() => sendBg<GithubLabel[]>({ type: "github.getLabels", owner: owner!, repo: repo! }), [owner, repo]);`
  - `disabled={!ready}` / `getKey={(l) => l.name}` / `getName={(l) => l.name}` / `selectedKey={value ?? null}` / `onSelect={(l) => onChange(l ? l.name : undefined)}`
  - `renderItem={(l) => (<><ColorSwatch shape="round" color={l.color} className="mr-2" /><span className="truncate">{l.name}</span></>)}`
  - `triggerLabel = !ready ? t("github.field.requireRepo") : value ?? t("github.field.labels.placeholder")`, `searchPlaceholder={t("github.field.labels.search")}`, `emptyLabel={t("github.field.labels.empty")}`
  - `useState`/`useEffect`/`reqIdRef`/Popover·Command·Button·아이콘 import 전부 삭제.
- **검증**:
  - [x] Task 2 테스트 green
  - [x] `pnpm typecheck` 통과
  - [x] `grep -n "useEffect\|reqIdRef\|Popover\|CommandItem" src/sidepanel/tabs/githubFields/LabelCombobox.tsx` 결과 0줄
  - [x] `load`가 `useCallback`으로 감싸져 있다 (위험요소 1)
  - [ ] 수동: 저장소 선택 → 라벨 콤보박스에 **색 dot이 보인다**(R5) / 미선택 시 트리거가 `requireRepo` 문구 + 비활성(R3)

### Task 4: `githubFields/AssigneeCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/githubFields/AssigneeCombobox.tsx`
- **작업 내용**: Task 3과 동형. `load` deps `[owner, repo]`, `type: "github.searchAssignees"`, `getKey/getName = (u) => u.login`, `selectedKey={value ?? null}`, `onSelect={(u) => onChange(u ? u.login : undefined)}`, `renderItem`에 `u.avatarUrl` 있을 때만 `<img className="mr-2 h-4 w-4 rounded-full">` + login. `triggerLabel`은 기존 IIFE와 동일한 3분기.
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [x] `grep`으로 `useEffect`/`reqIdRef`/`Popover` 잔여 0
  - [ ] 수동: 아바타 이미지가 항목마다 보인다(R5), 아바타 없는 유저는 이미지 없이 정상 렌더

### Task 5: `gitlabFields/LabelCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/gitlabFields/LabelCombobox.tsx`
- **작업 내용**: `ready = !!projectId`, `load` deps `[projectId]`, `type: "gitlab.getLabels"`, `getKey/getName = (l) => l.name`, `renderItem`에 `ColorSwatch`, `triggerLabel`의 미선택 문구는 `gitlab.field.requireProject`.
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [x] `grep` 잔여 0
  - [ ] 수동: 프로젝트 변경 후 라벨 목록이 새 프로젝트 것으로 갱신(🔴2), 색 dot 유지

### Task 6: `gitlabFields/AssigneeCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/gitlabFields/AssigneeCombobox.tsx`
- **작업 내용**: `AssigneeValue`(`{id:number, username:string}`) 유지. **`getKey={(u) => String(u.id)}`, `selectedKey={value ? String(value.id) : null}`** — number/string 혼용 주의(위험요소 3). `getName={(u) => u.username}`, `onSelect={(u) => onChange(u ? { id: u.id, username: u.username } : null)}`, `renderItem`에 아바타 + username.
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [ ] 수동: **담당자를 고른 뒤 다시 열면 체크 표시가 그 항목에 남는다**(getKey 문자열화 검증 — 여기가 조용히 죽는 지점)
  - [ ] 수동: 같은 담당자를 다시 클릭하면 선택 해제된다

### Task 7: `asanaFields/WorkspaceCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/asanaFields/WorkspaceCombobox.tsx`
- **작업 내용**: 스코프 없음 — `const load = useCallback(() => sendBg<AsanaWorkspace[]>({ type: "asana.getWorkspaces" }), []);`. `disabled={!!disabled}`(Props의 optional `disabled` 유지), `getKey=(w)=>w.gid`, `getName=(w)=>w.name`, `selectedKey={value?.workspaceGid ?? null}`, `onSelect={(w) => onChange(w ? { workspaceGid: w.gid, workspaceName: w.name } : null)}`, `renderItem` 불필요.
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [x] `grep` 잔여 0 — 이행 후 파일이 50줄 이하
  - [ ] 수동: 워크스페이스 목록이 열리고 검색·선택이 동작

### Task 8: `asanaFields/ProjectCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/asanaFields/ProjectCombobox.tsx`
- **작업 내용**: `ready = !!workspaceGid`, `load` deps `[workspaceGid]`, `type: "asana.searchProjects"`(`query: ""` 유지 — 서버 검색 없음), `getKey=(p)=>p.gid`, `getName=(p)=>p.name`, `selectedKey={value?.projectGid ?? null}`. 기존 파일 `:44`의 "서버 검색이 없어 1회 받아 클라이언트 필터" 주석은 `load` 위로 옮겨 보존한다(WHY 주석).
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [ ] 수동: 워크스페이스를 바꾸면 프로젝트 후보가 새 워크스페이스 것으로 갱신(🔴2)
  - [ ] 수동: 검색어 입력 시 클라이언트 필터가 동작(서버 재요청 없음)

### Task 9: `asanaFields/AssigneeCombobox` 이행

- **변경 대상**: `src/sidepanel/tabs/asanaFields/AssigneeCombobox.tsx`
- **작업 내용**: `load` deps `[workspaceGid]`, `type: "asana.searchAssignees"`. `getKey=(u)=>u.gid`, `getName=(u)=>u.name`, **`getItemValue={(u) => u.gid}`**(현재 `CommandItem value={u.gid}`와 동일 유지), **`pinSelected`**(현재 `:125`의 `orderSelectedFirst` 대체 — R6), `renderItem`에 이름 + 이메일 2줄. `orderSelectedFirst` 직접 import는 제거한다(내 변경이 만든 고아).
- **검증**:
  - [x] `pnpm typecheck` 통과, `pnpm test` 통과
  - [x] `grep -n "orderSelectedFirst" src/sidepanel/tabs/asanaFields/AssigneeCombobox.tsx` 결과 0줄
  - [ ] 수동: 담당자를 고른 뒤 다시 열면 **맨 위에 온다**(R6)
  - [ ] 수동: 이메일 보조 줄이 그대로 보인다(R5)

### Task 10: DESIGN.md §13 갱신

- **변경 대상**: `docs/DESIGN.md` (§13 공용 합성 컴포넌트 표의 `SingleLazyCombobox.tsx` 행)
- **작업 내용**: "현재 clickup·slack 2곳만 쓴다 — 나머지 6개는 Popover+Command를 손으로 조립한 잔재다" 문장을 이행 결과로 교체. 남는 예외를 명시한다: **서버 검색형 3개**(`githubFields/RepoCombobox`·`gitlabFields/ProjectCombobox`·`notionFields/DatabaseCombobox` — 질의마다 서버 재조회라 모델이 다름), **linear 4개**(`loadedTeamId` 마커 패턴), **jira**(`FieldCombobox` + `useDebouncedSearch` 자체 계열).
- **검증**:
  - [x] 문장이 `grep -rn "SingleLazyCombobox" src/`의 실제 사용처 목록과 일치
  - [x] 별도 커밋(`docs(DESIGN): ...`)으로 분리

## 테스트 계획

### 단위 테스트 (`*.test.tsx` — jsdom + @testing-library/react)

CLAUDE.md 2트랙 규정상 둘 다 **`.tsx` 트랙**이다. `useLazyListOnOpen`은 순수 함수가 아닌 React 훅이고, 대상 콤보박스는 렌더·인터랙션(Popover 열기, Escape)이 상태 전이를 좌우한다. `.test.ts`(node) 트랙으로는 잡히지 않는다.

| 파일 | 케이스 | 상태 |
|---|---|---|
| `src/sidepanel/hooks/__tests__/useLazyListOnOpen.test.tsx` | ① open 시 1회 로드, 재open 시 재조회 없음 ② **`load` 교체 → 이전 응답 폐기 → 새 `load`로 재조회**(🔴2 근본 계약) ③ reject 시 `error` 세팅 + `formatError` 재생성이 effect를 재실행시키지 않음 | 처음부터 green (회귀 잠금) |
| `src/sidepanel/tabs/githubFields/__tests__/LabelCombobox.test.tsx` | **🔴2 재현**: repo A로 open → 응답 전 close → repo B로 rerender → A 응답 늦게 도착 → 재open 시 `"a-only"`가 목록에 없고 repo B로 `sendBg` 재호출 | Task 2에서 **red** → Task 3에서 green |

재현 테스트의 핵심 구성: `sendBg`를 `vi.fn()`으로 mock하고 호출마다 **수동 resolve 가능한 deferred**를 돌려준다. 늦은 응답을 "실제로 늦게" 만들어야 race가 재현된다 — 즉시 resolve하면 스코프 변경 전에 반영돼 시나리오가 성립하지 않는다.

나머지 6개 콤보박스에 대해서는 개별 테스트를 추가하지 않는다. 이행 후 race 방어는 전적으로 `useLazyListOnOpen` 한 곳에 있고 그 계약은 Task 1이 잠근다 — 같은 시나리오를 6번 복제하면 그물이 아니라 유지비만 는다.

### e2e 시나리오

**없음.** 대상 콤보박스는 OAuth 연결 계정 + background service worker `fetch`를 전제한다. `e2e/clickup-submit-gating.spec.ts:4-7` 주석이 적은 대로 **SW fetch는 모킹이 불가**해 account를 storage에 seed해도 콤보박스 조회 경로에는 진입할 수 없고, 그래서 기존 플랫폼 필드 spec들도 prefill로 콤보박스를 우회한다. 이 배치는 정확히 그 조회 경로를 다루므로 e2e 그물이 원리적으로 닿지 않는다.

### 수동 테스트 (Chrome)

**선행**: `pnpm build` 후 확장 재로드(`dist` stale이면 헛테스트).

각 플랫폼에 실제 연결된 계정이 필요하다. 플랫폼별로 **이슈 제출 다이얼로그**와 **설정>연동 폼** 두 화면 모두에서 확인한다(R1).

- [ ] **GitHub / 🔴2 본증상**: 저장소 A 선택 → 라벨 콤보박스 열었다 **즉시 닫고** 저장소 B로 변경 → 라벨 콤보박스 재오픈 → **B의 라벨이 보인다**(A의 라벨이 남아 있지 않다)
- [ ] **GitHub / 담당자**: 위와 동일 절차를 담당자 콤보박스로
- [ ] **GitLab**: 프로젝트 A→B 변경 후 라벨·담당자 각각 동일 확인
- [ ] **Asana**: 워크스페이스 A→B 변경 후 프로젝트·담당자 각각 동일 확인
- [ ] R2: 상위 값을 바꾸면 하위 라벨·담당자 트리거가 placeholder로 리셋된다(이슈 폼·Connect 폼 양쪽)
- [ ] R3: 상위 값 미선택 시 트리거가 안내 문구 + 비활성
- [ ] R4: github/gitlab 라벨·담당자 검색이 부분일치로 동작(퍼지 매칭이 사라진 것을 인지·수용)
- [ ] R4-b: 같은 4개에서 cmdk의 **관련도 정렬도 사라져** 결과가 API 응답 순서로 고정된다(`shouldFilter={false}`가 필터와 정렬을 함께 끈다). 인지·수용.
- [ ] R4-c: 같은 4개에서 **팝오버를 닫아도 검색어가 남는다**. 이행 전엔 `CommandInput`이 비제어라 `PopoverContent` 언마운트와 함께 리셋됐지만, 공용 컴포넌트는 `query`를 Popover 바깥 state로 들고 있다. 저장소 A에서 "bug"를 친 뒤 저장소 B로 바꿔 열면 **B의 라벨이 그 검색어로 걸러진 채**(최악의 경우 `empty` 문구) 보인다 — 입력창에 텍스트가 남아 무음은 아니고 지우면 복구된다. asana 3개·clickup 4개·slack 1개는 원래 이 동작이라, 이행 후 12곳이 같은 규칙으로 수렴한다. **공용 컴포넌트의 기존 성질이므로 고치려면 `SingleLazyCombobox`를 손대야 하고 그건 이 배치의 수정 금지 대상이다** — 수용하고, 바꾸려면 별도 배치로 12곳을 함께 다룬다.
- [ ] R5: 라벨 색 dot / 아바타 / asana 담당자 이메일 2줄이 모두 보인다
- [ ] R6: asana 담당자를 고른 뒤 재오픈하면 맨 위에 온다
- [ ] R7: 콤보박스를 열어둔 채 background 네트워크 요청이 1회인지(DevTools > SW) — 무한 재조회 없음
- [ ] R8: ko/en 전환 후 각 콤보박스의 placeholder·empty 문구가 정상
- [ ] 다크모드에서 7개 콤보박스 시각 이상 없음

## 구현 순서 권장

```
Task 1 (훅 계약 잠금, 독립)
   ↓
Task 2 (red 재현) → Task 3 (github Label 이행 → green)   ← 이행 패턴 확정
   ↓
Task 4 · 5 · 6 · 7 · 8 · 9  ← Task 3 이후 서로 독립, 병렬 가능
   ↓
Task 10 (DESIGN.md — 전 이행 완료 후)
```

- **Task 3을 반드시 먼저 완주한다.** 첫 이행에서 props 매핑·`useCallback`·`renderItem` 패턴이 확정되고, 나머지 6개는 그 복제다. 한 번에 7개를 갈아엎으면 회귀가 어느 파일에서 났는지 추적할 수 없다.
- Task 4~9는 파일이 서로 겹치지 않아 병렬 가능하지만, **파일당 커밋을 분리**한다(회귀 시 되돌릴 단위).
- Task 10은 마지막. 이행 중간에 갱신하면 문서가 코드보다 앞서 stale이 된다.

## 가이드 영향

**없음.** 콤보박스의 겉모습·조작 방식·라벨 문구가 그대로다. 🔴2 수정은 "원래 그렇게 동작했어야 하는 것"의 복구라 가이드에 새로 설명할 UX가 없다.
