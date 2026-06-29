# 콘솔 로그 가독성 개선 — 구현 태스크

## 선행 조건

- 새 의존성·권한·env 없음. 순수 렌더 변경.
- 영향 파일: `src/sidepanel/lib/linkify.ts`(신규), `src/sidepanel/components/LinkifiedText.tsx`(신규), `InlineLink.tsx`, `ConsoleLogContent.tsx`, `ActionLogContent.tsx`.
- `NetworkLogContent.tsx`는 변경 없음(레퍼런스 패턴, URL 평문 유지).
- log-viewer는 `ConsoleLogContent`를 재사용하므로 별도 수정 불필요(자동 반영).

## 태스크

### Task 1: 토크나이저 단위 테스트 작성 (TDD)

- **변경 대상**: `src/sidepanel/lib/__tests__/linkify.test.ts` (신규)
- **작업 내용**: `tokenizeLogText`의 케이스를 먼저 고정.
- **검증**:
  - [x] URL 없는 텍스트 → `[{type:'text'}]` 1개
  - [x] **빈 문자열 `""` → `[]`** (LinkifiedText가 빈 fragment 렌더; map 무항목)
  - [x] `visit https://react.dev/errors/185 for ...` → text/url/text 분리, url value=`https://react.dev/errors/185`
  - [x] **URL이 텍스트 전체**: `"https://h/x"` → url 토큰 1개(앞뒤 text 토큰 없음)
  - [x] **http(비-https)**: `http://h/x` → url 토큰, href 동일
  - [x] 후행 점: `... https://react.dev/errors/185.` → url에 `.` 미포함, 다음 text 토큰에 `.`
  - [x] **후행 `,`/`;`**: `a https://h/x, b` → url=`https://h/x`, 다음 text에 `, b`
  - [x] 괄호 종료: `at F3 (https://h/assets/index.js:55:27752)` → url value=`https://h/assets/index.js:55:27752`, href=`https://h/assets/index.js`
  - [x] **괄호 포함 URL(의도된 절단)**: `https://en.wikipedia.org/wiki/Foo_(bar)` → url value=`https://en.wikipedia.org/wiki/Foo_(bar`(첫 `)`에서 종료, 의도된 동작 명문화)
  - [x] line만: `https://h/a.js:55` → href=`https://h/a.js`
  - [x] 쿼리스트링: `https://h/p?a=b&c=d` → 통째 url, href 동일
  - [x] 멀티 URL 한 줄 → 각각 url 토큰
  - [x] **멀티라인**: `"a https://h/x\nb https://h/y"` → URL이 `\n`을 안 넘고 각 줄 url 분리(`\s`가 `\n` 포함)
  - [x] 경로 없는 `host:port` `https://h:8080` → 포트를 line으로 오인 안 하고 href 보존 / 포트+경로 `http://localhost:3000/app.js:5:2` → 포트 보존 + 끝 `:5:2`만 제거

### Task 2: 토크나이저 구현

- **변경 대상**: `src/sidepanel/lib/linkify.ts` (신규)
- **작업 내용**: `LogTextToken` 타입 + `tokenizeLogText(text)`. URL regex(`/https?:\/\/[^\s)'"<>]+/g`), 후행 `.,;!?` 트림, href에서 끝 `:\d+(:\d+)?` 제거.
- **검증**:
  - [x] Task 1 테스트 전부 통과
  - [x] `pnpm typecheck` green

### Task 3: LinkifiedText 래퍼 + InlineLink onClick prop

- **변경 대상**: `src/sidepanel/components/LinkifiedText.tsx` (신규), `src/sidepanel/components/InlineLink.tsx`
- **작업 내용**:
  - `InlineLink`에 optional `onClick` prop 추가(additive, 기존 호출부 무영향).
  - `LinkifiedText({ text })`: `tokenizeLogText(text)`를 map. url 토큰 → `<InlineLink href={t.href} onClick={(e)=>e.stopPropagation()}>{t.value}</InlineLink>`, text 토큰 → 문자열. key는 인덱스.
- **검증**:
  - [x] `pnpm typecheck` green
  - [x] InlineLink 기존 호출부(action nav, pageUrl 등) 컴파일·동작 무변

### Task 4: ConsoleLogContent 본문색 제거 + linkify 적용

- **변경 대상**: `src/sidepanel/components/ConsoleLogContent.tsx`
- **작업 내용**:
  - 헤더 본문 span에서 `levelColor(entry.level)` 제거(기본색), `{entry.args}` → `<LinkifiedText text={entry.args} />`.
  - 펼친 본문 `<pre>`·스택 `<pre>`의 텍스트를 `<LinkifiedText text=... />`로 교체.
  - **스택 `<pre>`(`:254`)에 `data-testid="console-stack"` 부착** — e2e가 linkify를 *스택 영역에 스코프해* 검증하기 위함(펼친 행엔 항상 `pageUrl` 링크 `:259`가 있어 행 단위 카운트로는 linkify 회귀를 못 잡음). src 변경은 이 testid 추가만.
  - 고아가 된 `levelColor` 함수 제거. `levelBgColor`·`levelCodeBg`·`LevelIcon` 유지(info 배경/아이콘 포함 — 중립화 안 함).
- **검증**:
  - [ ] 에러 행 본문이 기본색, 배경 연분홍 + 빨강 아이콘 유지
  - [ ] 메시지·펼친 본문 `<pre>`·스택 `<pre>` 세 곳 모두 URL이 파란 링크
  - [ ] 헤더 URL 클릭 시 행 펼침 토글 안 됨(`console-stack` 미출현으로 확인)
  - [ ] info 행 본문 기본색(파란 텍스트 제거), 단 파란 배경·Info 아이콘은 유지
  - [x] `pnpm typecheck` green

### Task 5: ActionLogContent navigation 본문색 제거

- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx`
- **작업 내용**: 행 span(`:287`)에서 `kindColor(entry.kind)` 제거 → 기본 foreground. 고아가 된 `kindColor` 함수 제거. `kindBgColor`(파란 배경)·`KindIcon`(파란 MapPin)·nav `InlineLink`(`:121`, `data-testid="action-nav-link"`)는 유지.
- **검증**:
  - [ ] navigation 행 동사부가 기본색, URL만 파란 링크
  - [ ] 파란 배경 틴트 + MapPin 아이콘 유지
  - [x] `data-testid="action-nav-link"` 보존
  - [ ] click/input 행 시각 변화 없음
  - [x] `pnpm typecheck` green

## 테스트 계획

- **단위 테스트**: `tokenizeLogText` — Task 1의 14개 케이스(URL 추출·빈문자열`[]`·http·URL전체·후행 부호 트림·괄호URL 절단·`:line:col` href 정리·쿼리·멀티·멀티라인·포트-only). `pnpm test` 통과.
- **e2e 시나리오** (자동화 가능, `/e2e-write` 입력) — **모두 `[data-testid=console-stack]` 컨테이너로 스코프**(행 단위 `getByRole(link)`는 항상 있는 `pageUrl` 링크 때문에 linkify 회귀를 못 잡음):
  - 콘솔 에러 행을 펼치면 `console-stack` **내부**에 `a[href]` 링크가 1개 이상 있고, 그 href들에 `:\d+:\d+` 꼬리가 없다(line:col 제거 검증).
  - 접힌 콘솔 헤더의 URL 링크를 클릭하면 행이 펼쳐지지 않는다 — **판정: 클릭 후 `console-stack`이 출현하지 않음**(stopPropagation 검증). 클릭 대상은 헤더 span 내부 `a`.
  - 헤더 URL 링크가 Tab 포커스 가능하고 Enter로 동작한다(기존 헤더 토글이 키보드 비접근인 것과 무관하게 native anchor 동작 — 회귀 없음 확인, 1줄).
  - action navigation 행에 `[data-testid=action-nav-link]`가 그대로 존재한다(회귀 가드).
  - (위 시나리오에 필요한 testid는 `console-stack` 1개 — Task 4에서 src에 부착. 그 외 추가 필요 시 e2e-write가 testid만 추가)
- **수동 테스트** (시각 정합):
  - [ ] **(성공 기준 승격) 라이트/다크 모드 양쪽**에서 콘솔 에러·경고·정보 행이 식별 가능한지 — 다크는 배경 틴트가 약하므로 아이콘이 주 신호임을 확인, 아이콘 가림 케이스 폴백 점검
  - [ ] 링크 클릭 시 새 탭에서 소스 파일이 `:line:col` 없이 정상 열리는지
  - [ ] action navigation 행이 콘솔과 같은 시각 모델(중립 본문 + 링크 + 배경/아이콘)인지, ClickTarget 셀렉터 색은 유지되는지
  - [ ] network 행 시각 회귀 없는지(무변경 확인)

## 구현 순서 권장

Task 1 → 2 (TDD 토크나이저, 순서 고정) → 3 (래퍼/InlineLink) → 4·5 (병렬 가능, 둘 다 독립 컴포넌트). Task 5는 `LinkifiedText` 없이도 가능(색 제거만)하므로 Task 3과도 병렬 가능.

## 가이드 영향

없음 (시각 정합·가독성 개선이며 기능·플로우·UI 라벨 불변). 단, `/guide` 시 `guide/ko·en`의 로그/리포트 페이지가 콘솔/action 색을 텍스트로 서술하거나 스크린샷에 의존하면 갱신 여부만 확인.
