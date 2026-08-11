# audit-refactor-2 — 기술 설계

## 개요

🔴2(스코프 리셋이 in-flight 응답을 무효화하지 않음)를 **개별 픽스가 아니라 공용 훅 이행으로** 해소한다. `src/sidepanel/hooks/useLazyListOnOpen.ts:23-26`이 이미 `reqIdRef.current++` + `setItems([])`를 한 곳에서 수행하므로, 손 재구현 컴포넌트를 `src/sidepanel/components/SingleLazyCombobox.tsx`로 갈아끼우면 race가 부수적으로 사라진다. race 대상 6개가 이행 대상 7개에 전부 포함되므로 별도 픽스 경로가 필요 없다.

**공용 컴포넌트·훅에는 코드를 한 줄도 추가하지 않는다.** 현재 props(`disabled`/`load`/`getKey`/`getName`/`getItemValue`/`renderItem`/`selectedKey`/`onSelect`/`triggerLabel`/`searchPlaceholder`/`emptyLabel`/`pinSelected`)만으로 7개를 전부 표현할 수 있음을 아래 표에서 확인했다. 표현할 수 없는 3개(서버 검색형)는 이행하지 않는다 — 공용 컴포넌트를 검색형까지 커버하도록 일반화하는 것은 CLAUDE.md "요청하지 않은 유연성·추상화 추가 금지"에 정면으로 걸린다.

## 이행 대상/제외 판정

감사 42번이 지목한 10개 전수. "리셋 트리거"는 현재 코드의 `useEffect(..., [deps])`에서 실제로 읽은 값이다.

| # | 파일 | 현재 리셋 트리거 | 로드 모델 | 고유 요구 | 🔴2 해당 | 판정 |
|---|---|---|---|---|---|---|
| 1 | `githubFields/LabelCombobox.tsx` | `[owner, repo]` (`:65`) | open 시 1회 + cmdk 기본 필터 | 라벨 색 dot(`ColorSwatch shape="round"` `:127`) | ✅ | **이행** — `renderItem`으로 dot 수용 |
| 2 | `githubFields/AssigneeCombobox.tsx` | `[owner, repo]` (`:64`) | open 시 1회 + cmdk 기본 필터 | 아바타 `<img>` (`:130-136`) | ✅ | **이행** — `renderItem`으로 아바타 수용 |
| 3 | `githubFields/RepoCombobox.tsx` | 없음 — `[open, query]`로 **질의마다 서버 재조회**, 250ms debounce (`:42-63`) | 서버 검색 | 2줄(fullName + description) | ❌ | **제외** — 아래 근거 |
| 4 | `gitlabFields/LabelCombobox.tsx` | `[projectId]` (`:60`) | open 시 1회 + cmdk 기본 필터 | 라벨 색 dot (`:122`) | ✅ | **이행** |
| 5 | `gitlabFields/AssigneeCombobox.tsx` | `[projectId]` (`:67`) | open 시 1회 + cmdk 기본 필터 | 아바타 `<img>` (`:135-141`) | ✅ | **이행** |
| 6 | `gitlabFields/ProjectCombobox.tsx` | 없음 — `[open, query]` 서버 재조회, 250ms (`:42-63`) | 서버 검색 | 2줄(nameWithNamespace + path) | ❌ | **제외** |
| 7 | `asanaFields/WorkspaceCombobox.tsx` | 없음(스코프 없음) — `[open, items.length]` (`:61`) | open 시 1회 + 클라 필터 | 없음 | ❌ | **이행** — 가장 단순, 참조 이행 케이스 |
| 8 | `asanaFields/ProjectCombobox.tsx` | `[workspaceGid]` (`:71`) | open 시 1회 + 클라 필터 | 없음 | ✅ | **이행** |
| 9 | `asanaFields/AssigneeCombobox.tsx` | `[workspaceGid]` (`:71`) | open 시 1회 + 클라 필터 | 이름+이메일 2줄(`:142-149`), `orderSelectedFirst`(`:125`) | ✅ | **이행** — `renderItem` + `pinSelected` |
| 10 | `notionFields/DatabaseCombobox.tsx` | 없음 — `[open, query]` 서버 재조회, 300ms (`:43-64`) | 서버 검색 | 이모지 프리픽스, `onChange(id, title)` 2인자 | ❌ | **제외** |

**이행 7 / 제외 3.** 🔴2 대상 6개는 모두 이행 집합 안에 있다.

### 제외 근거 (3·6·10 — 서버 검색형)

세 파일은 `query` state가 effect 의존성에 들어 있어 **타이핑할 때마다 background로 새 검색 요청을 보낸다**(`sendBg({type:"github.searchRepos", query})` 등). `SingleLazyCombobox`는 `open` 시 `load()`를 1회 호출하고 `query`는 순수 클라이언트 필터로만 쓴다(`SingleLazyCombobox.tsx:58-66`) — `load`가 `query`를 받지 않으므로 구조적으로 표현 불가다.

수용하려면 `load: (query: string) => Promise<T[]>` + debounce + `serverSearch?: boolean` 같은 옵션을 공용 컴포넌트에 넣어야 하는데, 그러면 한 컴포넌트가 두 로드 모델을 분기로 껴안게 된다. 게다가 **저장소에는 이미 검색형 전용 훅이 따로 있다** — `src/sidepanel/tabs/jiraFields/useDebouncedSearch.ts`(`seqRef` 기반 응답 무효화 포함). 검색형을 통합하려면 그쪽 계열로 묶는 게 맞고, 그건 이 배치의 스코프가 아니다. **세 파일은 손대지 않는다.**

(부수 확인: 세 파일 모두 `reqIdRef` 무효화를 이미 올바르게 하고 있고 `items.length > 0` 조기 반환도 없어 🔴2 증상이 없다. 방치해도 버그가 남지 않는다.)

### 구현 후 확인 — linear 3개에 같은 계열의 **약한** race가 있다 (별도 배치 후보)

구현 단계의 CTO 게이트가 이행 밖 콤보박스를 전수 확인하다 찾은 것이라 감사 리포트에는 없다. **이 배치에서 고치지 않는다** — 스코프 밖이고, 증상 등급이 달라 묶으면 이 배치가 "무엇을 고쳤는지"가 흐려진다.

`linearFields/{LabelCombobox,AssigneeCombobox,ProjectCombobox}.tsx`는 `loadedTeamId` 마커로 조기 반환을 `loadedTeamId === teamId && items.length > 0`까지 좁혀 놨다. 그래서 **영구 wedge는 없다** — 팀이 바뀌면 마커가 어긋나 재오픈 시 재조회된다. 🔴2가 "닫힌 채 스코프가 바뀌면 목록이 영영 안 고쳐진다"인 것과 등급이 다르다.

다만 **응답 무효화가 아예 없다.** 팀 A 조회가 in-flight인 채 팀 B로 바꿔 재조회했을 때 A가 B보다 늦게 도착하면 `setItems(listA)` + `setLoadedTeamId("A")`가 B의 목록을 덮는다. 팝오버가 열려 있는 동안은 deps(`[open, teamId]`)가 안 바뀌어 그 상태가 유지되므로, **팀 B 이슈에 팀 A의 라벨·담당자를 고를 수 있다.** 닫았다 열면 복구된다.

이행 대상이 되려면 `loadedTeamId` 마커 패턴을 `load` 식별자 기반으로 바꿔야 하는데, 그건 세 파일의 로드 모델 자체를 갈아끼우는 일이라 별도 배치가 맞다. jira는 확인 결과 깨끗하다 — `IssueTypeField`·`PriorityField`는 `cancelled` 클린업이 `open` 변화에도 걸려 reqId보다 강한 무효화이고, 나머지 4개가 쓰는 `useDebouncedSearch.ts`에는 `seqRef` 무효화가 있다.

## 변경 범위

### 수정 (7)

각 파일 공통으로 아래가 **삭제**된다: `useState`(items/loading/error/open/query), `useEffect` 2개(로드·리셋), `reqIdRef`, `Popover`/`PopoverTrigger`/`PopoverContent`/`Command`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`/`Button`/`Check`/`ChevronsUpDown`/`Loader2`/`cn` import. **추가**되는 건 `useCallback` + `SingleLazyCombobox` import뿐이다. 결과 파일은 `clickupFields/ListCombobox.tsx`(58줄)와 같은 형태가 된다.

| 파일 | 현재 역할 | 변경 내용 |
|---|---|---|
| `src/sidepanel/tabs/githubFields/LabelCombobox.tsx` | 저장소 라벨 단일 선택 | `load = useCallback(() => sendBg({type:"github.getLabels", owner:owner!, repo:repo!}), [owner, repo])`, `getKey=(l)=>l.name`, `getName=(l)=>l.name`, `renderItem`에 `ColorSwatch`+이름 |
| `src/sidepanel/tabs/githubFields/AssigneeCombobox.tsx` | 저장소 담당자 단일 선택 | `load` deps `[owner, repo]`, `getKey/getName=(u)=>u.login`, `renderItem`에 아바타+login |
| `src/sidepanel/tabs/gitlabFields/LabelCombobox.tsx` | 프로젝트 라벨 | `load` deps `[projectId]`, `getKey/getName=(l)=>l.name`, `renderItem`에 `ColorSwatch` |
| `src/sidepanel/tabs/gitlabFields/AssigneeCombobox.tsx` | 프로젝트 담당자 | `load` deps `[projectId]`, `getKey=(u)=>String(u.id)`, `getName=(u)=>u.username`, `renderItem`에 아바타 |
| `src/sidepanel/tabs/asanaFields/WorkspaceCombobox.tsx` | 워크스페이스 | `load = useCallback(..., [])`, `getKey=(w)=>w.gid`, `getName=(w)=>w.name` |
| `src/sidepanel/tabs/asanaFields/ProjectCombobox.tsx` | 워크스페이스 하위 프로젝트 | `load` deps `[workspaceGid]`, `getKey=(p)=>p.gid`, `getName=(p)=>p.name` |
| `src/sidepanel/tabs/asanaFields/AssigneeCombobox.tsx` | 워크스페이스 멤버 | `load` deps `[workspaceGid]`, `getKey=(u)=>u.gid`, `getName=(u)=>u.name`, `getItemValue=(u)=>u.gid`, `pinSelected`, `renderItem`에 이름/이메일 2줄 |

**각 파일의 `export interface *Value`와 `Props` 시그니처는 그대로 유지한다.** 호출부(`*IssueFields.tsx` 4개 + `tabs/connect/*ConnectForm.tsx` 4개, 총 8곳)를 건드리지 않기 위한 제약이다(회귀 감시 R1·R2).

### 신규 (2 — 테스트)

| 파일 | 역할 |
|---|---|
| `src/sidepanel/hooks/__tests__/useLazyListOnOpen.test.tsx` | 공용 훅의 계약 잠금 — open 1회 로드 / `load` 교체 시 in-flight 무효화 / 에러 포맷 |
| `src/sidepanel/tabs/githubFields/__tests__/LabelCombobox.test.tsx` | 🔴2 재현 — 이행 전 red, 이행 후 green |

### 문서 (1)

| 파일 | 변경 |
|---|---|
| `docs/DESIGN.md` §13 `SingleLazyCombobox.tsx` 행 | "현재 clickup·slack 2곳만 쓴다 — 나머지 6개는 … 손으로 조립한 잔재다" → 이행 후 실제(github·gitlab·asana·clickup·slack 사용, 서버 검색형 3개와 linear·jira는 별개 계열)로 갱신 |

### 변경하지 않음

`src/sidepanel/components/SingleLazyCombobox.tsx`, `src/sidepanel/hooks/useLazyListOnOpen.ts`, `src/sidepanel/components/ccOptions.ts`, 제외 3개 파일, linear·jira 필드 전체, 호출부 8곳.

## 데이터 흐름

이행 후 스코프 변경 → 후보 리셋의 흐름 (github 라벨 기준).

```
GithubIssueFields.onChange({owner:B, repo:B', label:undefined, ...})
  → LabelCombobox 리렌더 (owner/repo prop 변경)
    → useCallback deps [owner, repo] 변경 → load 식별자 새로 발급
      → SingleLazyCombobox의 load prop 변경
        → useLazyListOnOpen effect#1 (deps: [load])
             reqIdRef.current++      ← 이전 스코프 in-flight 응답 무효화 (🔴2 해소 지점)
             setItems([])
        → 다음 open 시 effect#2가 items.length === 0 이므로 재조회
           A(이전 스코프) 응답 도착 → myReq !== reqIdRef.current → 폐기
```

현재(이행 전)와의 차이는 `reqIdRef.current++` 한 줄뿐이고, 그 한 줄이 훅 안에 있으므로 컴포넌트 쪽에는 어떤 race 처리 코드도 남지 않는다.

## 인터페이스 설계

**공용 훅·컴포넌트에 추가되는 시그니처는 없다.** 기존 계약을 그대로 사용한다.

```ts
// src/sidepanel/hooks/useLazyListOnOpen.ts (변경 없음)
export function useLazyListOnOpen<T>(
  open: boolean,
  enabled: boolean,
  load: () => Promise<T[]>,
  formatError?: (err: unknown) => string,
): { items: T[]; loading: boolean; error: string | null };

// src/sidepanel/components/SingleLazyCombobox.tsx (변경 없음)
interface Props<T> {
  disabled: boolean;
  load: () => Promise<T[]>;          // 반드시 useCallback([스코프])로 감쌀 것
  getKey: (item: T) => string;
  getName: (item: T) => string;      // 검색 필터 기준
  getItemValue?: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  selectedKey: string | null;
  onSelect: (item: T | null) => void;
  triggerLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  pinSelected?: boolean;
}
```

이행 대상 7개의 **외부 시그니처도 변하지 않는다.** 예시(github Label — 변경 전후 동일):

```ts
interface Props {
  owner: string | undefined;
  repo: string | undefined;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}
```

`SingleLazyCombobox`의 `onSelect: (item: T | null) => void`와 `onChange: (next: string | undefined) => void`의 어댑팅은 각 컴포넌트 안에서 한다:

```tsx
onSelect={(l) => onChange(l ? l.name : undefined)}
selectedKey={value ?? null}
```

(`SingleLazyCombobox`는 이미 선택된 항목을 다시 고르면 `onSelect(null)`을 부른다 — `SingleLazyCombobox.tsx:118`. 현재 손 재구현의 토글 해제 동작과 동일하다.)

## 기존 패턴 준수

- **DESIGN.md §13 "공용 합성 컴포넌트"** — 새 폼/필드는 `SingleLazyCombobox`/`CcMultiCombobox`를 조합한다. 이 배치가 바로 그 규칙의 미이행분을 청산한다.
- **DESIGN.md §13 "Connect 폼 기본값 필드"** — 이슈 모달 콤보박스를 Connect 폼이 그대로 재사용하고, 상위 값 `onChange`가 하위 defaults를 비운다. **이 계약을 유지하려고 Props 시그니처를 동결한다.**
- **CLAUDE.md "store는 `sidepanel/tabs`를 import하지 않는다"** — 이행은 `tabs/*Fields/` → `sidepanel/components/`·`sidepanel/hooks/` 방향 의존만 늘린다. 역방향이 아니라 규칙과 무관하게 안전하다.
- **CLAUDE.md 테스트 2트랙** — `useLazyListOnOpen`은 React 훅이고 대상 콤보박스는 렌더·인터랙션이 상태 전이를 좌우하므로 **`*.test.tsx`(jsdom + @testing-library/react)** 트랙이다. 셋업은 `src/test/setup-dom.ts`가 이미 cleanup + PointerCapture·scrollIntoView 폴리필을 제공한다. 선례: `src/sidepanel/components/__tests__/CcMultiCombobox.test.tsx`(`userEvent`로 Popover 열고 `getAllByRole("option")` 검사), `src/sidepanel/tabs/jiraFields/__tests__/AssigneeField.test.tsx`.
- **CLAUDE.md i18n** — 키를 새로 만들지 않는다. 기존 `github.field.*`/`gitlab.field.*`/`asana.field.*` 키를 그대로 props로 넘긴다.
- **CLAUDE.md 외과적 변경** — 인접 코드(호출부·제외 3개·linear·jira) 개선 금지.

## 대안 검토

### 대안 A — 6곳의 리셋 effect에 `reqIdRef.current++` 한 줄씩만 추가

가장 작은 픽스다. 6줄이면 🔴2가 사라진다. **채택하지 않았다**: 감사 42번이 지적한 대로 이 race는 이행 잔여에서 나온 것이라, 한 줄 픽스는 같은 구조를 그대로 남겨 다음 손 재구현에서 재발한다(`docs/POSTMORTEM.md`가 반복해서 잡는 "복제된 로직의 한쪽만 고침" 계열). 또 이행 자체가 각 파일에서 100줄 이상을 걷어내므로, 픽스만 하면 나중에 같은 파일을 두 번 건드리게 된다.

단, **이행 리스크가 큰 파일이 나오면 그 파일만 대안 A로 처리**하는 폴백은 살려둔다(태스크 단위로 독립이라 가능).

### 대안 B — 서버 검색형 3개까지 포함해 `SingleLazyCombobox`를 검색형으로 확장

`load: (query: string) => Promise<T[]>` + `debounceMs` + `serverSearch` prop 추가. **채택하지 않았다**: 한 컴포넌트가 두 로드 모델을 분기로 껴안게 되고, 검색형 전용 훅(`jiraFields/useDebouncedSearch.ts`)이 이미 따로 존재해 출처가 셋으로 늘어난다. 요청받지 않은 일반화다.

### 대안 C — 손 재구현 컴포넌트에서 `SingleLazyCombobox`가 아니라 `useLazyListOnOpen`만 도입(마크업은 유지)

race는 해소되고 UI는 100% 동결된다. **채택하지 않았다**: 42번이 지목한 Popover/Command 셸 중복이 그대로 남아 이행이 절반만 된다. 다만 R4(검색 필터 의미 변화)를 절대 용인할 수 없다는 판단이 나오면 이 대안이 후퇴선이다.

## 위험 요소

1. **`load`를 `useCallback`으로 감싸지 않으면 무한 재조회.** 인라인 화살표를 넘기면 매 렌더 `load` 식별자가 바뀌어 훅 effect#1이 계속 돌고, `setItems([])` → effect#2 재조회 → 리렌더 루프가 된다. 이행 7건 전부에서 `useCallback` 유무를 리뷰 체크리스트로 둔다.
2. **검색 필터 알고리즘 변경(R4).** github/gitlab의 Label·Assignee 4개는 지금 cmdk 기본 필터(퍼지 스코어링 + 점수순 정렬)를 쓴다. 이행 후엔 `getName` 부분일치 + 원래 순서다. 의도된 수렴이지만 사용자 눈에 보이는 변화이므로 PRD에 명시했고 수동 체크리스트에 넣는다.
3. **`getKey` 선택 실수.** gitlab Assignee의 `value`는 `{id:number, username}`이라 `getKey`는 `String(u.id)`, `selectedKey`는 `value ? String(value.id) : null`이어야 한다. 숫자/문자 혼용은 타입 에러 없이 선택 표시만 조용히 죽을 수 있다(현재 코드는 `value?.id === u.id`로 number 비교). **Task 단위 검증에서 "선택 후 체크 표시가 남는지"를 반드시 본다.**
4. **`getKey`가 이름 기반인 경우의 중복.** github/gitlab Label은 `value`가 라벨 **이름 문자열**이라 `getKey=(l)=>l.name`이 자연스럽다. 같은 이름의 라벨이 둘일 수 없으니 안전하지만, `key` prop이 현재 `l.id`인 것과 달라진다(React key만 바뀌고 동작은 동일).
5. **e2e로 못 잡는다.** 이 콤보박스들은 OAuth 연결 계정 + background SW `fetch`를 전제하고, `e2e/clickup-submit-gating.spec.ts` 주석이 적은 대로 **SW fetch는 모킹 불가**라 콤보박스 조회 경로는 e2e 진입 자체가 안 된다. 그물은 jsdom 테스트 2개 + 수동 체크리스트뿐이다.
6. **Connect 폼 이중 렌더.** 같은 컴포넌트가 이슈 모달과 설정>연동 양쪽에서 렌더된다. Connect 폼에서는 상위 값이 `account.defaults`에서 오므로 스코프 변경 경로가 다르다(`updateGithubAccount`). 이행 후 Connect 폼에서도 스코프 변경 → 후보 갱신을 확인한다.
7. **`renderItem` 누락 시 무음 열화.** `renderItem`을 안 넘기면 `SingleLazyCombobox`가 `<span className="truncate">{getName(it)}</span>` 폴백을 그린다 — 타입 에러도 런타임 에러도 없이 색 dot/아바타/이메일만 사라진다. 파일당 육안 확인이 필요한 이유.
