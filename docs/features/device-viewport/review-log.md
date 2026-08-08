# 디바이스 뷰포트 — 리뷰·리팩터 루프 기록 (라운드 1~10)

기능 구현이 끝난 뒤 `/code-review` → `/refactor` → 푸시 → 병합을 **10라운드** 돌린 기록이다.
`prd.md`·`design.md`·`tasks.md`가 "무엇을 왜 만들었나"라면 이 문서는 **"만든 뒤 무엇이
틀렸었나"** 다. 다음 사람이 같은 자리를 다시 밟지 않게 하는 것이 목적이라, 고친 것보다
**왜 그게 거기 있었는지**에 지면을 쓴다.

- 리뷰 base: `9409c38`(첫 기능 커밋 `17f2a59`의 부모). 기능 diff는 79파일 규모.
- 종료 조건: **연속 2회 심각(🔴) 0건.** 라운드 10 종료 시점 카운터는 **0**이다(미달).
- 라운드 10 종료 시점: 테스트 5152개 green, `pnpm typecheck` 통과, CI(`verify`+`e2e-gate`) green.

---

## 1. 이 기록의 핵심 — 라운드 3~10의 심각 발견은 **전부** 직전 라운드의 픽스가 원인이었다

예외가 한 번도 없었다. 라운드가 진행될수록 "새로 발견된 결함"이 아니라 **"직전 픽스가 만든
결함"** 만 남았다.

| 라운드 | 🔴 | 그 심각을 만든 것 |
|---|---|---|
| 1 | 5 | 원 구현 |
| 2 | 2 | 원 구현 |
| 3 | 0 | — |
| 4 | 1 | 라운드 3의 전이 통합 |
| 5 | 1 | 라운드 4의 루프 가드 |
| 6 | 2 | 라운드 5의 소유권 토큰 |
| 7 | 1 | 라운드 6의 재수립 전제 |
| 8 | 2 | 라운드 7의 busy 래치 재배치 |
| 9 | 2 | 라운드 8의 `target.url` 의미 변경 |
| 10 | 3 | 라운드 9의 send-cap |

### 왜 이런 일이 반복됐나 — 세 가지 형태

**(a) 계약이 주석에만 있었다.** 라운드 6의 전담 감사가 근본을 짚었다: `reestablish`는
전제("래퍼가 이미 사라졌다")를 **주석으로만** 문서화해서, 새 호출부가 생길 때마다 그 전제를
조용히 깼다. 라운드 7이 그 확인을 코드로 옮겼다(`runTransition`의 busy 래치 안에서
`deviceState`로 실제 확인).

**(b) 값의 *의미*를 절반만 바꿨다.** 라운드 8이 `target.url`을 "top 주소"에서 "래퍼 주소"로
바꿨는데, **생산자 7곳 중 4곳만** 전환하고 소비자는 전부 top 주소와 비교하는 채로 뒀다.
라운드 9의 심각 2건이 여기서 나왔다. 잠금 테스트도 `picker-control.ts` 한 파일만 훑어
누출이 green으로 통과했다 — CLAUDE.md가 `apiHostRow` 사례로 이미 경고한 형태다.

**(c) 모르는 것을 아는 것처럼 답하게 만들었다.** 라운드 9가 `chrome.tabs.sendMessage`에
500ms 상한을 걸었는데, 상한이 만든 `undefined`를 컨트롤러가 **"차단"**(→ 롤백 + 오탐 토스트
+ 페이지 새로고침)과 **"래퍼 없음"**(→ 페이지 전체 캡처 잠금 해제, 재수립 전제 확인 무력화)
으로 읽었다. 게다가 `ensureContentScript`의 첫 문장이 상한 없는 ping이라 **정작 정지 페이지는
그 상한에 닿지도 못했다** — 막으려던 케이스는 못 막고 오탐 창만 새로 만든 것이다.

### 그래서 다음 사람이 지킬 것

1. **전제는 주석이 아니라 코드로 확인한다.** 확인이 불가능하면 그 전제를 없앨 방법을 먼저 찾는다.
2. **값의 의미를 바꾸면 생산자·소비자를 같은 커밋에서 전수 조사한다.** 잠금 테스트의 분모는
   한 파일이 아니라 **생산자 파일 전부**여야 한다.
3. **타임아웃으로 답을 지어내지 않는다.** 상한이 필요하면 *답*이 아니라 *소유권*을 내려놓는다.
   라운드 10의 워치독이 그 형태다 — 늦게 깨어난 왕복은 토큰 검사에 걸려 아무것도 안 건드린다.
4. **뮤테이션 확인은 생략하지 않는다.** 픽스를 되돌려 해당 테스트가 red로 가는지 매번 확인했고,
   그물이 공허했던 경우(라운드 4에서 잘못된 기대값을 박은 테스트)를 실제로 그렇게 잡았다.

---

## 2. 라운드별 요약

### 라운드 1 (🔴 5)
원 구현의 결함. SW 재시작 후 `topUrl` 유실로 모든 same-origin 이동이 handoff로 오판되던
것(`DeviceFrameRecord`에 `topUrl` 동거), `syncFromPage`의 pending 복구 누락,
`runOffToOn`/`reestablish` 중복 본체 통합(`runTransition`), 루프 가드 술어의 죽은 항 제거,
`deviceSet` 주입 보장.

사용자 요청으로 뷰포트 세그먼트 행이 디버그 서브탭과 컨테이너를 공유하던 것을 분리해
자기 행 컨테이너를 갖게 했다(`DeviceViewportBar` 루트가 `shrink-0 border-b px-4 py-4`).

### 라운드 2 (🔴 2)
`.ts`/`.tsx` **basename 충돌**로 tsc 프로그램에서 조용히 제외되던 테스트 파일 3쌍을 발견해
개명(`device-frame.test.tsx` → `device-frame-dom.test.tsx` 등). TS 확장자 우선순위 때문에
같은 이름이면 `.tsx`가 통째로 빠지는데 에러가 안 난다.

커밋 메시지가 사실과 달랐던 것도 여기서 나왔다(`56760eb`가 "both privacy files"라고 했지만
`privacy.ko.md`만 바뀜) — 라운드 7에서 `privacy.en.md`를 맞췄다.

### 라운드 3 (🔴 0)
유일하게 심각 0건이었던 라운드. 이때 카운터가 1이 됐다가 라운드 4에서 리셋됐다.

### 라운드 4~7 (🔴 1·1·2·1)
전이 동시성 영역의 연쇄. `finally`의 소유권 계산(`owned`), `dropDeferredReestablish` vs
`drainDeferredReestablish` 분리, `onHandoff`의 `attemptingWidth ?? snap().width`,
`DIALOG_PHASES` + `trimmingOverlay` 축, 재수립 전제 확인을 busy 래치 안으로 이동.

라운드 7에서 Radix `Tabs`의 `activationMode` 기본값이 `automatic`이라 **화살표 키 포커스
이동만으로 페이지가 재로드**되던 것도 잡았다(`activationMode="manual"`).

### 라운드 8 (🔴 2)
PRD 75줄이 "래퍼 내부 same-origin 네비게이션을 top 네비게이션과 동등 취급(로그·**세션**
수명주기 동일화)"을 스코프에 넣었는데 **로그 절반만 구현**돼 있었다.

- 캡처 4곳이 `chrome.tabs.get().url`을 기록 → 리포트 `Page` 행·`logs.html` pageUrl·세션
  pageKey가 전부 *모드 진입 시점* 주소를 가리킴. `device.state`가 `pageUrl`을 싣고
  `resolvePageUrl()`이 라우팅.
- `clearIfPageChanged`가 `tabs.onUpdated`에서만 호출 → 래퍼는 그 이벤트를 안 쏨. 죽은 문서의
  selector가 세션에 남아 after 캡처가 새 문서의 같은 selector를 찍었다. onCommitted가
  래퍼 프레임에 같은 판정을 걸도록 추가.

부수: `isDeviceFrame`이 element id만 봐서 페이지가 심은 프레임이 래퍼를 자칭 가능
(top 직속 자식 축 추가) / 감시창 밖 non-ABORTED 오류를 전부 handoff로 읽어 DNS 실패가
탭을 못 여는 URL로 이동시킴(`isTransientNetworkError`) / tablist 접근명 추가.

### 라운드 9 (🔴 2)
라운드 8이 만든 생산자·소비자 불일치. `rebindStylingSession`이 래퍼 주소 ↔ top 주소를
비교해 **패널 재오픈마다 멀쩡한 styling 세션이 만료**됐고, `deviceFrameUrl()`이 커밋 전
`about:blank`를 반환해(truthy라 폴백 미작동) 전이 중 캡처가 그 주소로 기록된 뒤
스스로 지워졌다. 생산자 3곳 추가 전환 + 잠금 테스트 분모를 생산자 파일 전부로 확대.

사용자 결정 2건이 이 라운드에서 확정됐다:
- **동시성 구조 개편은 다음 변경으로 미룸** (탭별 직렬 큐 + 통합 generation 객체, 순 −28줄)
- **루프 가드가 draft를 파기하던 동작 → 모드만 풀고 draft 보존** (i18n ko/en 문구 동반 수정)

### 라운드 10 (🔴 3)
라운드 9의 send-cap을 **되돌렸다**(위 1-(c)). `busy` 래치는 소유권 기제가 이미 있는 자리에서
처리 — `TRANSITION_WATCHDOG_MS`(15s) 워치독이 `attemptToken`을 놓고 `busy`를 푼다.

`survivesTopNavigation`도 되돌렸다. 전제("`tabs.onUpdated`에 url이 실리면 top 문서가
교체됐다")가 fragment·pushState에서 거짓이라, **앵커 클릭만으로 iframe 요소의 styling 세션이
만료돼 사용자 편집이 날아갔다.** 닫으려던 구멍(죽은 frameId)보다 피해가 크고, 그 구멍은
`rebindStylingSession`이 여전히 잡는다.

두 번째 감사(fail-closed 전수 검증 + 산출물 정합성)는 🔴 0이었다 — **주장한 fail-closed
게이트 6개가 전부 실제로 fail-closed였다.** 대신 산출물이 조용히 틀리는 4건을 잡았다:

- 래퍼 좌우 여백 클릭이 숨겨진 top `body`를 선택(body가 `height:100vh; display:flex`라
  뷰포트를 덮는다) → 편집이 화면에 무효과, 리포트 `Viewport`는 브라우저 실폭.
  `isHiddenTopElement`가 hover·클릭 양쪽에서 거부.
- `getTopViewport`가 요소 content box라 **안쪽 문서 스크롤바 미차감** → 리포트는 390인데
  페이지 자신은 375. 안쪽 문서의 `innerWidth`를 우선하도록 변경.
- 페이지 전체 캡처 잠금이 UI 한 겹 + 패널 인메모리 `width` 의존 → 패널 재오픈 직후 창에서
  **조용히 1타일**. `beginScrollCapture`가 `null`을 돌려주는 2차 방어 추가.
- stop ACK 소진이 통째로 버려져 숨은 top 레코더가 무장된 채 잔류 → 로그 2벌, 경고 0건.
  래퍼 서브트리 **밖** 문서의 소진은 `notReached`로 올린다(그 문구만 자동 복구를 약속하지 않는다).

---

## 3. 지금 열려 있는 것

### 사용자 결정 대기 없음. 아래는 판단이 끝났거나 의도적으로 남긴 것이다.

**미룬 것 — 동시성 구조 개편.** `device-viewport-controller.ts`에서 게이트(`busy` 읽기)·
래치(`set busy:true`)·소유권(`attemptToken`)이 서로 다른 변수에 서로 다른 지점에 흩어져 있어,
`await`를 하나 추가할 때마다 수동 증명이 새로 필요하다. 같은 파일 안의 반례
둘(`latchedVerdict`/`verdictWaiter` 랑데부, `watchChain` 직렬 체인)은 도입 이후 결함 0건이다.

권고안: **탭별 직렬 큐(기계 발단 전이만 — handoff는 3초 `waitForVerdict`를 푸는 주체라 큐에
못 넣는다) + 통합 generation 객체**, 순 −28줄. 사용자 결정으로 **다음에 이 파일을 건드릴 때
별도 변경**으로 뺀다. 이유: 라운드 10 종료 시점에 알려진 미해결 결함이 0이고 CI가 green이라,
지금 손대면 위 1번의 패턴을 한 번 더 돌릴 위험이 크다.

### 미수정으로 남긴 ⚪

- `navUrlPromise`(`background/index.ts`)가 취소된 top 네비게이션에서 엔트리를 남기고 탭 종료
  시 정리되지 않는다. 탭당 최대 1개이고 다음 네비게이션이 덮는다. **`9409c38` base에도 있는
  기존 문제**라 외과적 원칙상 손대지 않았다(이 기능은 키를 `tabId` → `tabId:frameId`로 넓혔을 뿐).
- `forgetTab` 정리와 탭 종료에 겹친 늦은 네비게이션 이벤트의 레이스 — `ensureRestored`가
  엔트리 3개를 재생성한 뒤 `finally`가 옛 엔트리를 지운다. SW가 주기적으로 죽어 실피해 미미.
- `beforeNavigate`의 `canGuess`가 위조 방어에서 유일하게 URL 일치에 기댄다. arm 3초 창 안에
  top과 같은 URL로 동적 iframe을 띄우면 잠정 등록을 선점할 수 있다. 도달 조건이 좁다.
- 모드 인디케이터(실시간)와 바로 아래 `Viewport` 행(캡처 시점)이 서로 다른 시점을 가리킬 수
  있다. 제출 본문에는 안 실리는 표시 문제.
- 열거 실패 fail-closed가 **모드 OFF에도** 걸려 그 순간 커밋된 iframe의 로그 커버리지를 깎는다.
  모드 OFF에선 오발행 위험이 없으니 프레임 지정 발행으로 폴백해도 안전하다는 지적이 있다.

---

## 4. 라운드 11을 이어받는 사람에게

### 이미 쓴 리뷰 각도 (중복하면 소득이 없다)

1. 4관점 분업(ui·security·dataflow·codehealth) — 라운드 1~5
2. 상태머신 전수 매트릭스 — 라운드 6
3. 동시성 설계 리뷰 — 라운드 8
4. 실사용 여정 워크스루 — 라운드 8
5. **직전 라운드 픽스 적대 감사** — 라운드 9·10 (심각이 가장 많이 나온 각도. 계속 쓸 것)
6. 리소스 누수 · 예외 경로 · 다중 탭 간섭 — 라운드 9
7. fail-closed 주장 전수 검증 + 제출 산출물 값 정합성 — 라운드 10

### 안 써본 각도 (제안)

- **브라우저 실동작에만 걸린 축**: 포인터 드래그·캔버스·스크롤바·확대/축소·`prefers-reduced-motion`.
  유닛으로 못 잡는 영역이라 e2e·수동이 유일한 그물이다(POSTMORTEM 참조).
- **권한·프라이버시 역방향 대조**: `docs/privacy.{ko,en}.md`가 서술한 동작과 실제 코드를
  양방향으로 맞춰본다. 라운드 8·9에서 갱신했지만 전수 대조는 안 했다.
- **접근성 실사용**: 스크린리더로 세그먼트 → 캡처 → 작성 흐름을 끝까지. `aria-label`·
  `role="status"`·`aria-busy`는 손봤지만 실제 낭독 순서는 검증 안 됐다.
- **성능**: 모드 ON에서 문서가 2벌 살아 있는 상태의 메모리·CPU. 원본 문서가 `display:none`일
  뿐 계속 실행된다는 건 privacy 문서에 공개돼 있는데 그 비용을 측정한 적은 없다.

### 절차

착수 전 `docs/POSTMORTEM.md`를 변경 영역 키워드로 grep한다(`device`·`picker`·`capture`·
`세션`·`user gesture`). 라운드 10에서 실제로 그 grep이 회귀 하나를 잡았다
(POSTMORTEM 2026-07-28 "가드 뒤에 await을 넣으면 경계가 사라진다"의 재발).

검증은 매 라운드 `pnpm typecheck` + `pnpm test --run` 전체 + **심각 픽스마다 뮤테이션 확인**
(픽스를 되돌려 해당 테스트가 red인지). 되돌릴 때 `git checkout --`을 쓰지 말 것 — untracked
파일이 섞이면 명령 전체가 실패하는데 `|| true`가 그걸 삼켜 미커밋 변경이 뮤테이트된 채
남는다(라운드 9에서 실제로 겪었다). 백업 파일 복사만 쓴다.

`CLAUDE.md`·`.claude/commands/*.md`를 **Edit/Write 이외의 방법으로** 고치면 PostToolUse 훅이
안 돌아 Codex 미러가 드리프트하고 CI `verify`가 떨어진다(라운드 10에서 실제로 떨어졌다).
그 경우 `pnpm sync:agents`를 손으로 돌린다.
