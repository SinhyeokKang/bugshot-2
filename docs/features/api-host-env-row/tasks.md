# 재현 환경에 API 호스트 표시 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 추가 없음. 새 의존성 없음(`pnpm-workspace.yaml` 정책 무관).
- 착수 전 `docs/POSTMORTEM.md`에서 아래 두 항목을 읽는다 — 이 작업이 정확히 그 함정 위에 있다.
  - "프롬프트 지시가 가리키는 대상을 인쇄된 컨텍스트로 검증하지 않으면…"
  - "본문이 로그 상세를 인쇄한다고 전제하고 '미상세 건수'를 파생했다…"
- `design.md`의 **"수정하지 않는 파일 (명시)"** 목록을 확인한다. emitter·ctx 팩토리를 고치고
  있으면 설계에서 이탈한 것이다.

## 태스크

### Task 1: `apiHostRow.ts` 순수 함수 (`/tdd interface` → 구현)

- **변경 대상**: `src/sidepanel/lib/apiHostRow.ts` (신규),
  `src/sidepanel/lib/__tests__/apiHostRow.test.ts` (신규)
- **작업 내용**: `design.md`의 인터페이스 설계대로 `API_HOST_LABEL` · `registrableDomain` ·
  `deriveApiHostRow` 구현. `originOf`는 `@/lib/session-keys.ts`에서 import(새로 만들지 않는다).
- **검증**:
  - [ ] `pnpm test src/sidepanel/lib/__tests__/apiHostRow.test.ts` green
  - [ ] `pnpm typecheck` clean
  - [ ] `grep -rn "safeOrigin" src/sidepanel/lib/apiHostRow.ts` → 0건 (중복 헬퍼 미생성)

### Task 2: `DraftingPanel` draft 생성 시 주입

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx` (`:124-135` useEffect)
- **작업 내용**: store에서 `networkLog`·`logsAttach` selector 추가, 게이트
  `supportsConsoleNetworkLog(captureMode) && logsAttach && networkLog && networkLog.captured > 0`
  통과 시 `deriveApiHostRow(networkLog.requests, target?.url ?? "")` 결과를 `environment` 초기값에
  넣는다. `useEffect` deps에 추가한 값들을 반영한다.
- **검증**:
  - [ ] `pnpm typecheck` clean
  - [ ] `pnpm test` 전체 green — 기존 골든 스냅샷 62개 **무변경**(스냅샷이 갱신됐다면 emitter를
        건드린 것이므로 설계 이탈)
  - [ ] `git diff --stat` 결과가 `apiHostRow.ts` · `apiHostRow.test.ts` · `DraftingPanel.tsx`
        3개 파일뿐 (문서 제외)

### Task 3: 실제 Chrome 수동 검증

- **변경 대상**: 없음 (검증 전용)
- **작업 내용**: `pnpm build` 후 언팩 로드해 아래 체크리스트 수행. jsdom·유닛으로는 잡히지
  않는 store 타이밍·실제 로그 수집 경로를 여기서만 확인할 수 있다.
- **검증**: 아래 "수동 테스트" 절 참조

### Task 4: 가이드 갱신 (`/guide`)

- **변경 대상**: `guide/ko/screenshot/issue.md` · `guide/ko/video/issue.md` ·
  `guide/en/screenshot/issue.md` · `guide/en/video/issue.md`
- **작업 내용**: `guide/AUTHORING.md` 규칙을 먼저 읽고, 재현 환경 자동 채움 문단(각 파일 13행
  근처)에 API Host 행이 자동으로 들어오며 수정·삭제 가능하다는 설명을 ko/en 동시 추가.
  `guide/*/element/issue.md`는 **건드리지 않는다**(게이트로 제외되는 모드).
- **검증**:
  - [ ] ko/en 본문이 같은 내용 (한쪽만 고치면 즉시 stale)
  - [ ] element 가이드 무변경

### Task 5: privacy 대조·갱신

- **변경 대상**: `docs/privacy.ko.md` (원본) · `docs/privacy.en.md` (번역)
- **작업 내용**: 네트워크 로그에서 파생한 API 호스트가 이슈 본문에 실린다는 사실을 반영.
  "로그 첨부가 켜진 screenshot/video/freeform 캡처에 한정"이라는 조건을 함께 적는다.
  상단 시행일 bump.
- **검증**:
  - [ ] ko/en 본문·시행일 동시 갱신
  - [ ] 새 수집·새 전송 경로가 없다는 점이 본문과 모순되지 않음(파생만 하므로 수집 항목은 불변)

## 테스트 계획

### 단위 테스트 — `src/sidepanel/lib/__tests__/apiHostRow.test.ts`

`registrableDomain`:
- `api.acme.com` → `acme.com` / `acme.com` → `acme.com`
- `api.acme.co.kr` → `acme.co.kr` (2단 접미사)
- `o1.ingest.sentry.io` → `sentry.io`
- `localhost` → `localhost` / `127.0.0.1` → `127.0.0.1`
- 빈 문자열 → 빈 문자열

`deriveApiHostRow` (page = `https://app.acme.com/orders/42`):
- 동족 API origin 1개 → `{ label: "API Host", value: "https://api.acme.com" }`
- 페이지 origin으로만 요청 → `null`
- Sentry(`o1.ingest.sentry.io`)·GA만 → `null` (비동족)
- 동족 2개(`api.` 3건 + `auth.` 1건) → 요청 수 최다인 `https://api.acme.com`
- 동족 2개 동률 → 배열에서 먼저 나온 origin
- status 200만 있는 정상 요청도 후보가 된다(실패 축 무관 — 대안 C 회귀 방지)
- 포트 포함 origin(`https://api.acme.com:8443`) 보존
- 파싱 불가 URL(`"not a url"`)이 섞여도 나머지로 판정
- `requests: []` → `null` / `pageUrl: ""` → `null`
- `co.kr` 환경: page `https://app.acme.co.kr`, req `https://api.acme.co.kr` → 후보 ✅
  (2단 접미사 미처리 시 `co.kr` vs `co.kr`로 우연히 통과하는 게 아니라, `acme.co.kr` 일치로
  통과하는지 확인 — 반례로 page `https://app.other.co.kr`, req `https://api.acme.co.kr` →
  `null` 을 함께 둔다)

### e2e 시나리오 (`/e2e-write` 입력)

- 테스트 페이지에서 다른 서브도메인으로 fetch를 1건 발생시킨 뒤 영역 스크린샷을 찍으면,
  작성 화면 재현 환경 섹션에 `API Host` 라벨을 가진 편집 가능한 행이 나타난다.
- 그 행의 삭제 버튼을 누르면 행이 사라지고, 미리보기 화면 재현 환경 표에도 나타나지 않는다.
- 요소 스타일 편집 모드로 캡처하면 `API Host` 행이 나타나지 않는다.

> e2e 환경에서 cross-subdomain 요청을 만들 수 있는지가 관건이다. 불가하면 이 시나리오는
> 수동으로 내리고 단위 테스트 + 수동 체크리스트로 커버한다.

### 수동 테스트 (Chrome, Task 3)

- [ ] QA/스테이징 성격의 실제 사이트(페이지와 API 호스트가 다른 곳)에서 영역 스크린샷 →
      작성 화면에 `API Host` 행이 자동으로 채워진다
- [ ] 그 값이 실제 XHR 대상 origin과 일치한다(DevTools Network와 대조)
- [ ] 값을 수정 → 미리보기 · 마크다운 복사 결과에 수정값이 반영된다
- [ ] 행 삭제 → 본문 어디에도 안 나온다
- [ ] **실제로 지라(또는 GitHub) 이슈를 등록해 본문 재현 환경 목록에 `API Host` 줄이 있는지
      확인** — 이전 시도가 실패한 지점이 정확히 여기다. 화면만 보고 통과시키지 않는다
- [ ] 등록된 이슈를 이슈 목록에서 열어 상세 화면 재현 환경에도 같은 값이 있다
- [ ] `logs.html`을 열어 Report 탭 env 표에 같은 값이 있다
- [ ] 로그 첨부 토글을 끈 상태로 캡처 → 행 없음
- [ ] **스크린샷 캡처 → 취소 → 요소 스타일 편집 모드로 픽** 순서에서 행이 생기지 않는다
      (`preserveLogs` 경로 — 모드 게이트 회귀 검증)
- [ ] 30s Replay로 구간을 잘라 API 요청이 없는 구간만 남기면 행이 사라진다
- [ ] 페이지가 자기 origin으로만 요청하는 사이트에서는 행이 안 생긴다

## 구현 순서 권장

Task 1 → Task 2 → Task 3 순서(의존). Task 4·5는 Task 2 완료 후 **서로 병렬** 가능하며
Task 3와도 병렬이다. `/ship`으로 돌릴 경우 Task 4는 "가이드 영향" 플래그, Task 5는 privacy
게이트에 해당한다.

## 가이드 영향

- `guide/ko/screenshot/issue.md` · `guide/en/screenshot/issue.md` — 재현 환경 자동 채움 설명에
  API Host 추가
- `guide/ko/video/issue.md` · `guide/en/video/issue.md` — 동일
- `guide/*/element/issue.md` — **변경 없음**(모드 게이트로 제외)
