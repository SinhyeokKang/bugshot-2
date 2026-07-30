# 재현 환경에 API 호스트 표시 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 추가 없음. 새 의존성 없음(`pnpm-workspace.yaml` 정책 무관).
- 착수 전 `docs/POSTMORTEM.md:39`을 읽는다 — 이 작업이 정확히 그 함정 위에 있다.
  - "프롬프트 지시가 가리키는 대상을 인쇄된 컨텍스트로 검증하지 않으면, 예산 절삭이 기준점을
    지우고 인쇄 순서가 '이후'를 반대로 뒤집는다" (2026-07-30) — **문서가 주장하는 코드 사실을
    실제로 열어 대조하지 않으면 green인 채로 틀린다**는 게 이 항목의 요지다. 이 feature 문서의
    라인 번호·selector 구독 상태도 리뷰에서 6건 틀린 채 발견됐다.
- `design.md`의 **"수정하지 않는 파일 (명시)"** 목록을 확인한다. 본문 빌더·ctx 팩토리를 고치고
  있으면 설계에서 이탈한 것이다.

## 태스크

### Task 1: `apiHostRow.ts` 순수 함수 (`/tdd interface` → 구현)

- **변경 대상**: `src/sidepanel/lib/apiHostRow.ts` (신규),
  `src/sidepanel/lib/__tests__/apiHostRow.test.ts` (신규)
- **작업 내용**: `design.md`의 인터페이스 설계대로 `API_HOSTS_LABEL` · `registrableDomain` ·
  `deriveApiHostsRow` · `apiHostRowFor` · `syncApiHostsRow` 구현. `pageUrl`은 한 번 파싱하고
  `originOf`를 쓰지 않는다(`design.md` 규칙 1의 `file://` 트랩 참조). 게이트 4개와 동기화
  판정(주입·갱신·제거·사용자 수정 보존)은 컴포넌트가 아니라 `apiHostRowFor`·`syncApiHostsRow`
  안에 있어야 한다 — `DraftingPanel`에는 테스트 파일이 없어, 컴포넌트에 남긴 로직은 전부
  그물 밖이다.
- **검증**:
  - [ ] `pnpm test src/sidepanel/lib/__tests__/apiHostRow.test.ts` green
  - [ ] `pnpm typecheck` clean
  - [ ] `grep -n 'session-keys' src/sidepanel/lib/apiHostRow.ts` → 0건 (`originOf` 미사용이
        의도임을 고정)

### Task 2: 자동 행 메타데이터 + 래치 store 승격 + `DraftingPanel` 동기화·표시

- **변경 대상**: `src/types/environment.ts`, `src/store/editor-store.ts`,
  `src/sidepanel/hooks/useEditorSessionSync.ts`, `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  1. `EnvironmentRow`에 선택적 `source: "api-hosts"`를 추가한다. UI에는 별도 자동 감지 표시를
     하지 않는다.
  2. `apiHostsDismissed`·`apiHostsDerived`를 editor-store에 `reproPrefillDone` 동형으로
     추가한다 — 선언·initial·setter·`EditorSnapshot` pick + `useEditorSessionSync.ts:98` 인접
     세션 pick. **Pick 목록과 `snapshotFromState()` 두 곳을 함께** 손댄다(ARCHITECTURE.md 함정).
  3. draft 자동 행 동기화 `useEffect`에서 `apiHostRowFor(...)` 결과를 `syncApiHostsRow`에 넘겨
     반영한다. effect는 배선만: 리듀서 반환 `rows`가 참조 동일하면 write 생략(무한 루프 방지),
     write 시점 `getState().draft` 읽기(AI prefill `setDraft`와 경합 방지 —
     `useReproPrefill.ts:107-115`), deps는 발화 판정용 원시 값만(`:150-153` 선례).
     **추가 selector는 래치 2개뿐** — `captureMode`(`:63`)·`networkLog`(`:79`)·
     `logsAttach`(`:82`)·`target`(`:88`)이 이미 구독 중이고 `supportsConsoleNetworkLog`도
     이미 import돼 있다(`:42`).
  4. 커스텀 행 삭제 버튼 핸들러에서 `source === "api-hosts"` 행이면 `apiHostsDismissed`를
     직접 세운다(추론 감지 금지). 로그 첨부 off 시 자동 행 제거, 다시 on이면 **재주입**(명시
     삭제만 미부활). 지연 도착 로그는 미수정 행만 갱신한다(리듀서 규칙).
  5. 재현 환경 섹션을 controlled `open`/`onOpenChange`로 전환하고 자동 행 주입 시점에
     `setOpen(true)` — `SectionTextarea`(`:679`) 선례. 행 삭제 직후에는 열린 상태 유지.
  6. 값 `Input`에 `min-w-0`을 추가하고 전체 커스텀 행 값 Input에 Radix Tooltip(hover·focus
     전문 표시, 빈 값이면 Content 미렌더, 로컬 Provider, `max-w-*`+`break-all`)을 단다.
- **검증**:
  - [ ] `pnpm typecheck` clean
  - [ ] `pnpm test` 전체 green — 기존 골든 스냅샷 62개 **무변경**(스냅샷이 갱신됐다면 본문
        빌더를 건드린 것이므로 설계 이탈)
  - [ ] 로그 off 제거·재 on 재주입·명시 삭제 후 미부활·지연 로그 주입·사용자 수정 보존 —
        전부 `syncApiHostsRow` 단위 테스트(Task 1)로 고정. 컴포넌트에는 판정 로직을 남기지
        않는다
  - [ ] `grep -c "useEditorStore((s) =>" src/sidepanel/tabs/DraftingPanel.tsx` 가 변경 전
        대비 **+2 이하**(래치 2개 외 중복 selector 미추가)

### Task 3: 실제 Chrome 수동 검증

- **변경 대상**: 없음 (검증 전용)
- **작업 내용**: `pnpm build` 후 언팩 로드해 아래 체크리스트 수행. jsdom·유닛으로는 잡히지
  않는 store 타이밍·실제 로그 수집 경로를 여기서만 확인할 수 있다.
- **검증**: 아래 "수동 테스트" 절 참조

### Task 4: 가이드 갱신 (`/guide`)

- **변경 대상**: `guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md` ·
  `guide/en/screenshot/issue.md` · `guide/en/video/issue.md`
- **작업 내용**: `guide/AUTHORING.md` 규칙을 먼저 읽고, 재현 환경 자동 채움 문단(각 파일 13행
  근처)에 ko/en 동시 추가:
  - API Hosts 행이 네트워크 로그에서 자동으로 채워지며 수정·삭제 가능하다.
  - **안 나오는 경우**: 페이지가 자기 주소로만 요청할 때 / 로그 첨부를 껐을 때 / 요소 스타일
    편집 모드. 부재 조건이 전부 "행 없음"으로 관측이 같아 사용자가 정상/실패를 구분할 수 없다.
  - `guide/*/element/issue.md`는 **건드리지 않는다**(게이트로 제외되는 모드).
- **검증**:
  - [ ] ko/en 본문이 같은 내용 (한쪽만 고치면 즉시 stale)
  - [ ] element 가이드 무변경
  - [ ] "안 나오는 경우"가 ko/en 양쪽에 있다

### Task 5: privacy 대조·갱신

- **변경 대상**: `docs/privacy.ko.md` (원본) · `docs/privacy.en.md` (번역)
- **작업 내용**: 네트워크 로그에서 파생한 API 호스트가 **첨부 파일이 아니라 이슈 본문 평문**에
  실린다는 사실을 반영. 함께 적을 것:
  - "로그 첨부가 켜진 screenshot/video/freeform draft"에 한정된다는 조건. 작성 화면에서 로그
    첨부를 끄면 자동 행도 제거된다.
  - `logs.html`이 업로드 실패(`logsDropped`)로 빠진 리포트에도 본문 줄은 남고, Slack 공유는
    채널 메시지 본문이라 첨부를 열지 않는 멤버에게도 보인다.
  - 위치는 `:82`(로그 첨부 기본 on) · `:84`(로그 1건 본문 삽입) 문단 계열이 자연스럽다.
- **검증**:
  - [ ] ko/en 본문 동시 갱신
  - [ ] 새 수집·새 전송 경로가 없다는 점이 본문과 모순되지 않음(파생만 하므로 수집 항목은 불변)
  - [ ] 상단 시행일 — 오늘이 이미 `2026년 7월 30일`(`docs/privacy.ko.md:3`)이라 같은 날이면
        유지, 날짜가 바뀌었으면 갱신. 억지로 미래 날짜를 넣지 않는다

### Task 6: `docs/DIRECTORY.md` 갱신

- **변경 대상**: `docs/DIRECTORY.md` (`:87` `src/sidepanel/lib/` 열거)
- **작업 내용**: `apiHostRow`를 한 줄 설명과 함께 추가. `/push` 신선도 검사의 "새 파일 추가"
  트리거에 해당하므로 별도 커밋(`docs(DIRECTORY): ...`).
- **검증**:
  - [ ] `apiHostRow` 항목이 `environmentRows` 인접에 있다

## 테스트 계획

### 단위 테스트 — `src/sidepanel/lib/__tests__/apiHostRow.test.ts`

`registrableDomain`:
- `api.acme.com` → `acme.com` / `acme.com` → `acme.com`
- `api.acme.co.kr` → `acme.co.kr` (2단 접미사)
- `co.kr` → `co.kr` (레이블 2개 — 3레이블 규칙의 미정의 분기 방어)
- `o1.ingest.sentry.io` → `sentry.io`
- `localhost` → `localhost` / `127.0.0.1` → `127.0.0.1` / `[::1]` → `[::1]`
- `API.Acme.com.` → `acme.com` (대문자 + 트레일링 닷 정규화)
- 빈 문자열 → 빈 문자열

`deriveApiHostsRow` (page = `https://app.acme.com/orders/42`):
- 동족 hostname 1개 → `{ label: "API Hosts", value: "api.acme.com", source: "api-hosts" }`
- 페이지 origin으로만 요청 → `null`
- Sentry(`o1.ingest.sentry.io`)·GA만 → `null` (비동족)
- 동족 2개(`api.` 3건 + `auth.` 1건) → `"api.acme.com, auth.acme.com"`
- 동족 2개 동률 → 배열에서 먼저 나온 hostname 순서
- status 200만 있는 정상 요청도 후보가 된다(실패 축 무관 — 대안 C 회귀 방지)
- scheme·port·path는 제거하고 hostname만 보존
- **상대 URL**(`/api/orders`)이 섞여도 skip하고 나머지로 판정 — XHR 경로
  (`network-recorder.ts:279`)·`sendBeacon`(`:432`)은 호출자가 준 문자열을 `maskUrl` 경유로
  저장하는데(민감 쿼리 값만 치환, 호스트·경로 원문 보존, 파싱 실패 시 원문 그대로) 상대 URL은
  파싱 실패라 그대로 들어온다. 절대 URL을 쓰는 fetch 경로와 결과가 갈리는 지점
- 파싱 불가 URL(`"not a url"`)이 섞여도 나머지로 판정
- **`wss://api.acme.com` / `ws://api.acme.com`만 → `null`** (http/https만 후보)
- **스킴만 다른 동족**: page `https://app.acme.com`, req `http://api.acme.com` → 후보가 된다
  (origin 상이 + 동족)
- **`localhost` ↔ `127.0.0.1`** → `null` (e2e에서 유일하게 가용한 primitive라 명시적으로 못 박는다)
- `requests: []` → `null` / `pageUrl: ""` → `null` / `pageUrl: undefined` → `null`
- **`pageUrl: "file:///x/y.html"` → `null`**, `"about:blank"` → `null`
  (`new URL(...).origin`이 문자열 `"null"`인 트랩 — 규칙 1)
- `co.kr` 환경: page `https://app.acme.co.kr`, req `https://api.acme.co.kr` → 후보 ✅
  (2단 접미사 미처리 시 `co.kr` vs `co.kr`로 우연히 통과하는 게 아니라, `acme.co.kr` 일치로
  통과하는지 확인 — 반례로 page `https://app.other.co.kr`, req `https://api.acme.co.kr` →
  `null` 을 함께 둔다)
- **derive 레벨 트레일링 닷**: page `https://app.acme.com`, req `https://app.acme.com./x` →
  `null` (`new URL().hostname`은 트레일링 닷을 보존하므로 정규화 없이 raw 비교하면 자기
  페이지 호스트가 `app.acme.com.`으로 재포함된다 — 규칙 3의 정규화-후-비교 고정)
- **포트만 다른 동일 hostname**: page `http://localhost:3000`, req `http://localhost:8080/api`
  → `null` (hostname 단위 비교라 포트 무시 — dev 환경의 흔한 조합을 명시 고정)
- **IDN/punycode**: page `https://한글.example`, req `https://api.한글.example/x` →
  `new URL`이 양쪽을 punycode(`xn--`)로 정규화해 동족 판정이 성립하는지 확인

`syncApiHostsRow` (동기화 판정 — 래치·보존 규칙의 그물):
- 행 없음 + `apiRow` + `!dismissed` → 주입, `lastDerived` = 파생값
- 행 없음 + `apiRow` + `dismissed` → 무변화 (입력 `rows` 참조 그대로 — short-circuit 근거)
- 행 있음(값 == `lastDerived`) + 새 `apiRow` → 값 갱신 (사용자 미수정)
- 행 있음(값 != `lastDerived`) + 새 `apiRow` → 무변화 (**사용자 수정 보존** — 목표 2)
- `apiRow: null` → source 행 제거 + `lastDerived: null` (로그 첨부 off 경로)
- `apiRow: null` + source 행 없음 → 무변화 (참조 동일)
- 제거 후 다시 `apiRow` 도착 + `!dismissed` → 재주입 (off→on 토글 경로)

`apiHostRowFor` (게이트 — 여기가 회귀 그물의 본체다):
- `captureMode: "element"` → `null` (**모드 게이트 회귀 — 지우면 element 이슈에 로그 파생값이 샌다**)
- `captureMode: "screenshot"` + `logsAttach: false` → `null`
- `networkLog: null` → `null`
- `networkLog: { captured: 3, requests: [] }` → `null` (`captured`와 `requests.length`가 갈리는
  캡 트림 상황 — 게이트에 `captured > 0`을 두지 않는 이유)
- `captureMode: "screenshot"|"video"|"freeform"` + `logsAttach: true` + 동족 요청 → 행

### e2e 시나리오 (`/e2e-write` 입력)

**선행 인프라 변경**: `e2e/fixtures/extension.ts` launch args에
`--host-resolver-rules=MAP *.bugshot.test 127.0.0.1` 추가. 공용 픽스처라 CI 4샤드 전체에
영향이 가고, 기존 `127.0.0.1`/`localhost` spec은 이 규칙에 안 걸려 무변경이다. 페이지를
`http://app.bugshot.test:PORT`로 열고 `http://api.bugshot.test:PORT/...`로 fetch를 1건 낸다.
**함정 2개**: ① `fixtureTabId`의 기본 매치 패턴은 `http://127.0.0.1/*`라 `bugshot.test`
페이지는 **명시 패턴을 넘겨야** 탭 식별이 된다 ② 시나리오 1의 "섹션이 펼쳐진다" 단언은
`Section` `testId` 부착이 선행돼야 판정 가능하다(`DraftingPanel.tsx:575`에서 prop 미전달 —
`/e2e-write`가 부착).

**판정은 미리보기 화면 기준**이다 — 작성 화면 재현 환경 UI에는 `data-testid`가 0개인데
`IssuePreviewView.tsx:113-114`에 `data-testid="env-row"` + `data-env-label`이 이미 있다.
`--lang=ko`가 워커별로 비결정적이므로(`e2e/GOTCHAS.md`) placeholder 기반 locator는 쓰지 않는다.

- `app.bugshot.test`에서 `api.bugshot.test` 2건, `auth.bugshot.test` 1건 fetch 후 영역
  스크린샷을 찍으면 작성 화면 재현 환경 섹션이 펼쳐지고, 미리보기의
  `[data-env-label="API Hosts"]` 값이 `api.bugshot.test, auth.bugshot.test`다.
- 작성 화면에서 그 행의 삭제 버튼을 누르면 미리보기 재현 환경 표에
  `[data-env-label="API Hosts"]`가 없다. 로그 첨부를 다시 켜도 되살아나지 않는다(명시 삭제
  래치 — off→on 재주입 규칙보다 우선).
- video 취소로 동족 API 로그를 보존한 뒤 요소 스타일 편집 모드로 픽하면
  `[data-env-label="API Hosts"]`가 나타나지 않는다.

freeform 지연 로그 도착 시나리오는 e2e에서 **제외**한다 — tail sync 레이스를 Playwright에서
결정적으로 재현할 레시피가 없어 flaky spec이 된다. 수동 테스트(Task 3의 freeform·페이지 이동
항목)가 전담한다.

### 수동 테스트 (Chrome, Task 3)

기존 자동 그물과 중복되는 항목은 뺐다 — 값 수정 반영·행 삭제·`logs.html` Report 탭·자기
origin만 요청은 각각 `environmentRows.test.ts`, 골든 62개(`Locale` 행이 전 스냅샷에 등장),
`buildReportData.test.ts`, `apiHostRow` 단위 테스트가 이미 봉인한다.

- [ ] QA/스테이징 성격의 실제 사이트(페이지와 API 호스트가 다른 곳)에서 영역 스크린샷 →
      작성 화면 재현 환경 섹션이 **펼쳐진 채** `API Hosts` 행이 채워져 있다
- [ ] 그 값이 실제 XHR 대상 hostname 목록·요청 수 정렬과 일치한다(DevTools Network와 대조).
      값 칸이 잘려도 hover·focus
      툴팁으로 전문을 읽을 수 있다
- [ ] **실제로 지라(또는 GitHub) 이슈를 등록해 본문 재현 환경 목록에 `API Hosts` 줄이 있는지
      확인** — 이전 시도가 실패한 지점이 정확히 여기다. 화면만 보고 통과시키지 않는다.
      등록된 이슈를 목록에서 열어 상세 화면에도 같은 값이 있는지 함께 확인.
      (전제: `.env.local` OAuth client ID + 연결된 실제 워크스페이스 — 이 저장소 dev 환경은
      충족. 없으면 스킵이 아니라 **미완료**로 처리)
- [ ] **행 삭제 → 미리보기 진입 → 작성으로 복귀** 순서에서 행이 부활하지 않는다
      (`backToDraft`가 `DraftingPanel`을 언마운트하는 경로 — 래치가 store에 없으면 여기서 깨진다)
- [ ] **행 삭제 → 사이드패널 닫고 재오픈** → 행이 부활하지 않는다 (래치 세션 영속 왕복)
- [ ] **영상 녹화 시작 → 녹화 취소 → 요소 스타일 편집 모드로 픽 → element drafting** 순서에서
      행이 생기지 않는다. `cancelRecording`이 `preserveLogs`로 로그를 보존하는 경로다 —
      **행이 안 보이는 이유가 로그 부재가 아님을 확인**하려면 그 상태에서 로그 카드에 네트워크
      건수가 남아 있는지 함께 본다. (기존 문서의 "스크린샷 캡처 → 취소" 순서는 `reset()`을 타
      `networkLog === null`이 되므로 게이트를 지워도 통과한다 — 검증이 공전한다)
- [ ] **freeform 캡처**로 리포트를 만들면 행이 채워진다. `startFreeform`이 `draft=null` +
      `phase:"drafting"`을 한 커밋에 세팅해 draft 생성 useEffect가 즉시 발화하므로 위험 2의
      레이스에 가장 취약하다. 비면 실패로 처리하고 구현을 수정한다
- [ ] **캡처 중 페이지 이동을 1회 포함**한 뒤 캡처 종료 → 행이 채워졌는지. tail sync가
      `drafting`에서 `superseded()` 가드를 통과해 draft 생성 뒤 착지할 수 있다(위험 2).
      비면 실패로 처리하고 구현을 수정한다
- [ ] 30s Replay로 구간을 잘라 API 요청이 없는 구간만 남기면 행이 사라진다
- [ ] 작성 화면에서 사이드패널을 닫고 재오픈 → 행이 유지된다(세션 스냅샷 왕복)

## 구현 순서 권장

Task 1 → Task 2 → Task 3 순서(의존). Task 4·5·6은 Task 2 완료 후 **서로 병렬** 가능하며
Task 3와도 병렬이다. `/ship`으로 돌릴 경우 Task 4는 "가이드 영향" 플래그, Task 5는 privacy
게이트, Task 6은 `/push` 신선도 검사에 해당한다.

## 가이드 영향

- `guide/ko/screenshot/issue.md` · `guide/en/screenshot/issue.md` — 재현 환경 자동 채움 설명에
  API Hosts + "안 나오는 경우" 추가
- `guide/ko/video/issue.md` · `guide/en/video/issue.md` — 동일
- `guide/*/element/issue.md` — **변경 없음**(모드 게이트로 제외)

## e2e 영향

- `e2e/fixtures/extension.ts` — launch args에 `--host-resolver-rules` 추가 (공용 픽스처, CI 4샤드)
- 신규 spec — 위 e2e 시나리오 3개
