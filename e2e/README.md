# e2e 스위트 (Playwright)

Chrome 확장을 실제 브라우저에서 구동해 사용자 플로우를 검증하는 e2e 스위트. **무엇을 커버하는지·무엇이 빠졌는지·어떤 함정이 있는지의 단일 출처**다. 시나리오가 늘면 해당 문서를 함께 갱신해 "어디에 뭐가 있나"를 재조사하지 않게 한다.

## 문서 구성

- **[COVERAGE.md](./COVERAGE.md)** — 커버리지 맵(spec별 시나리오) · 수동 잔여(자동화 못 한 것 + 이유).
- **[GOTCHAS.md](./GOTCHAS.md)** — 함정(실전에서 밟은 것 누적). **새 spec 쓰기 전 필독.**
- **[MANUAL-SMOKE.md](./MANUAL-SMOKE.md)** — Aside 실사이트 스모크 S1~S6(시나리오·전제 단언·판정 문장·대상 사이트·실행 이력). **Playwright 스위트가 아니다** — 수동 잔여 중 환경 제약분을 실제 브라우저로 훑는 리포트 전용 도구고 절차는 `/manual-smoke` 스킬이 갖는다.
- 이 문서(README) — 개요 · 실행법 · project 구성 · 헬퍼/fixture 빠른 참조.
- 작성 절차·금지·실행-수정 루프는 `/e2e-write` 스킬(`.claude/commands/e2e-write.md`)이 단일 출처 — 여기서 중복하지 않는다.

## 실행

- **CI에서 자동으로 돈다** — `.github/workflows/ci.yml`의 `e2e` job이 dev push · main PR · nightly에서 전 스위트를 `--shard=N/4` 매트릭스(러너 4대)로 돌린다. headed 강제라 `xvfb-run`(가상 스크린 1920×1080×**24**) 경유고, 더미 `.env.ci`만 쓰므로 secret 없이 fork PR에서도 동작한다. 아래 로컬 실행은 CI를 기다리지 않고 미리 확인할 때 쓴다.
- 빌드/실행: `pnpm build:e2e` → `pnpm test:e2e` (단일 spec: `pnpm test:e2e -- <이름 일부>`, 샤드 재현: `pnpm test:e2e --shard=1/4`). dist-e2e는 **테스트 전용**(`<all_urls>` 포함, 수동 로드·스토어 업로드 금지).
  - **`--`는 이름 필터에만 붙인다.** pnpm이 `--`를 리터럴로 넘기고 playwright는 그 뒤를 전부 **positional 파일 필터**로 읽으므로, `pnpm test:e2e -- --shard=1/4`처럼 플래그에 붙이면 플래그로 인식되지 않고 `No tests found`로 죽는다. 플래그(`--shard`·`--project`·`--list` 등)는 `--` 없이 그대로 준다.
- **두 project**(`playwright.config.ts`):
  - `sidepanel` — 확장 구동 메인 게이트.
  - `logview` — 확장 없이 `dist-log-viewer/index.html`을 합성 데이터로 직접 여는 standalone(`e2e/logview/*.spec.ts`, viewport 1280×800). 단독 실행: `pnpm test:e2e --project=logview`(dist-log-viewer는 `build:log-viewer`/`build:e2e`가 생성). **`dependencies:["sidepanel"]`는 없다** — 실제 의존이 아니었고, `--shard` 사용 시 의존 project가 샤드마다 전량 실행돼 샤딩 효과를 지운다.
  - **30s Replay 캡처 spec(replay-action-log·replay-trim·replay-trim-logs·action-log-coverage·drag-action)은 제거됨** — `captureVisibleTab` cold-start/extension-global quota로 환경 flaky가 심해 게이트를 신뢰 불가하게 만들어 의도적으로 뺐다(트림/액션/드래그 로직은 단위 테스트로 커버, 캡처 경로는 수동 잔여). GOTCHAS 참조.
- **`retries`는 로컬 0 / CI 1** (`process.env.CI` 분기). 로컬은 flaky를 숨기지 않고, CI는 xvfb·SW 기동 환경 flaky에 복구 기회를 한 번만 준다. `forbidOnly`도 CI 한정 — `.only`가 남으면 샤드가 조용히 green이 된다.
- **창 깜빡임**: 확장 SW가 headless에선 안 깨어나 headed로만 돈다. 대신 브라우저 창을 화면 밖으로 보내 기본적으로 안 보인다. 디버깅으로 창을 직접 보려면 `E2E_SHOW=1 pnpm test:e2e`. **CI에선 이 이동을 생략한다** — xvfb엔 가릴 화면이 없고, 가상 스크린 밖으로 밀면 렌더가 클립될 수 있다.

## 헬퍼 · fixture 빠른 참조

전부 `fixtures/extension.ts`. 새 헬퍼를 추가하면 여기와 `docs/DIRECTORY.md`에 반영한다.

- `ext` worker fixture — `fixtureUrl(page)` / `fixtureHostUrl(host, page)` / `fixtureTabId(urlPattern?)` / `openPanel(tabId)` / `context`.
  - `fixtureHostUrl(host, page)` — 같은 fixture 서버를 임의 호스트명으로 연다. launch args의 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1` 덕에 `app`/`api`/`auth.bugshot.test`가 하나의 registrable domain으로 묶인다(동족 hostname이 필요한 `api-hosts-env-row` 전용 — GOTCHAS 참조). **`fixtureTabId`엔 패턴을 명시**해야 한다.
- `enterDebug(panel)` — 디버그 탭 진입(active 폴링).
- `enterDebugAndPick(fixture, panel, selector)` — 디버그 → element 모드 → 요소 선택 → `repick` 확인까지.
- `pickElement(fixture, panel, selector, opts?)` — bbox 중심 클릭(double rAF hover). 기본(`expectSelection:true`)은 **repick 노출까지 클릭 재시도**(재arm 레이스로 인한 유실 클릭 방어). repick이 안 뜨는 픽(element-shot 캡처·iframe 미지원)은 `{ expectSelection: false }`로 1회만. `{ frame: "#sel" }`로 **iframe 내부 요소 선택**(frameLocator bbox — 메인 프레임 뷰포트 기준 좌표).
- `ensureSectionOpen(panel, toggleTestId, probeLabel)` — 접힌 collapsible Section 펼침(probeLabel prop이 DOM에 없으면 토글 클릭). 접힌 섹션은 자식이 DOM에서 제거됨. 예: Position 섹션(`section-position-toggle`, probe `"position"`/`"z-index"`).
- `typeStyleValue(panel, label, value)` — ValueCombobox 팝오버 입력.
- `setQuadLinkedValue(panel, label, value)` — QuadProp(margin/padding) LinkToggle 4면 동일값.
- `setQuadSideValue(panel, label, sideIndex, value)` — QuadProp 개별 면(top/right/bottom/left) 입력.
- `selectStyleValue(panel, label, option)` — SelectProp(display/overflow 등) 옵션 텍스트 선택.
- `setQuadStyleLinkedValue(panel, label, option)` — QuadStyleProp(border-style) LinkToggle 켜고 네 변 동일 옵션 선택.
- `setQuadStyleSideValue(panel, label, sideIndex, option)` — QuadStyleProp 개별 면 옵션 선택(unlink).
- `setAlignment(panel, label, idx)` — AlignmentProp(text-align) 탭 선택 (left0 center1 right2 justify3).
- `closeAllPopovers(panel)` — Escape + outside-click 폴백.

logview project 전용(`logview/fixtures.ts` — 확장 fixture와 별개, 일반 Playwright `test`):

- `openViewer(page, data)` — `dist-log-viewer/index.html`에 `Partial<LogViewerData>`를 평문 JSON으로 주입해 `setContent`로 연다(미지정 필드는 null/기본 meta).
- `makeActionLog()` / `makeConsoleLog()` / `makeNetworkLog()` / `makeReport()` — 합성 로그·리포트 빌더(전 kind/level/contentType + 2 origin + 본문 검색 마커, Report는 env 2행+paragraph/orderedList). `ORIGIN_A`/`ORIGIN_B`(필터용 2 origin), `NET_BODY_NEEDLE`(URL엔 없고 응답 본문에만 있는 마커), `REPORT_COPY_MARKDOWN`(copy payload 검증값).
- `generateTinyVideoDataUrl(page)` — canvas를 ~1.2s MediaRecorder 녹화해 finite-duration 영상 data URL을 즉석 생성(마커·seek 검증용, 커밋 미디어·ffmpeg 불요). **`openViewer` 전** 호출. `T0`(export) = 영상 `startedAt` 기준 시각(`T0+ms` 로그 → `ms/1000`초). GOTCHAS "logview 마커·seek" 참조.
- `stubClipboard(page)` — **openViewer 후** 호출. `navigator.clipboard.write`(rich)를 reject시켜 copy가 `writeText` 폴백을 타게 하고 그 텍스트를 `window.__copiedText`로 노출. addInitScript는 setContent에 안 먹어 evaluate로 주입한다.

fixture 페이지(`fixtures/pages/`):

- `basic.html` — `#title`(color·padding 명시), `#tbl`(2×2 `<table>` — 테이블 속성 전부 기본값, Table 섹션 접힘·`table-layout` 라이브 적용 검증용), `#card.card.box`, `#el1`–`#el3`(`.swatch` — 다요소 버퍼·재선택용), `#quad`(inline `padding:4px 8px 12px 16px` — 4면 상이, linked auto-derive 검증용), `#multi`(inline `width:calc(var(--space-sm)*2)` — multiplier hint 검증용), `#filler`(2000px). `:root` 토큰: `--space-sm:8px`/`--space-lg:32px`(hint 갱신 — `style-token-hint`), `--brand:tomato`(named-color 분류)/`--space-0:0`(unitless 0 분류 — `style-bugfix-regression`).
- `shorthand-var.html` — var()가 낀 shorthand의 specified 복원용. `*{border:0}` 리셋이 **컴포넌트 규칙보다 먼저** 온다(순서가 뒤집히면 리셋이 이겨 spec이 무의미해진다). `#tokened`(`border: .1rem solid var(--divider)`)·`#logical`(`padding-inline: 4px 8px` — 논리 속성은 var 없이도 물리 longhand로 explode 안 됨)·`#trans`(`transition: color var(--dur)`)·`#calcgap`(`gap: calc(var(--space-lg) / 2)` — 괄호 안 나눗셈)·`#important`(`border-color: red !important` 규칙 뒤에 일반 `border` 규칙). 토큰은 `:root`의 `--divider`/`--dur`/`--space-lg`.
- `specificity.html` — 캐스케이드 승자 판정용. 값 축은 전부 `rem`(색 리터럴은 CSSOM이 rgb()로 정규화하는 데다 computed가 곧 승자 값이라 판정이 죽어도 같은 문자열이 나온다 — `rem`이라야 승자 원문과 computed 폴백이 갈린다). `#btn`(`.btn{width:12rem}`이 문서상 **앞**, `button{width:100px}`이 뒤 — specificity가 문서순을 이겨야 함) · `#accent`(class `2xl:accent accent-late` — Chrome이 `.\32 xl\:accent`로 직렬화, 이스케이프 종결 공백을 놓치면 `[0,1,1]`로 부풀어 동률 문서순 승자를 뒤집는다) · `#cq`(`#cq-wrap`이 `container-type:inline-size; width:120px`라 `@container (min-width:400px)` 규칙이 **비적용** — 인덱서가 조건을 평가하지 않아 규칙은 인덱스에 남는다). 요소마다 다른 `min-height`(11/12/13px)는 CSS 뷰 doc 전환 게이트 전용 marker(단언 대상과 분리).
- `stable-locator.html` — selector 생성 우선순위용. 세 쌍 전부 **형제를 둔다** — 얕은 경로가 이미 유일하면 finder가 가장 싼 후보(`span`)로 끝내 앵커가 나올 자리 자체가 없다. `article[data-e2e="enrollment-card"] > p > span.chip`(형제 카드는 `data-e2e` 없음) · `section[data-testid="checkout-panel"] button#deadbeef.Button_ab12cd34`(id가 전부 글자라 finder 기본 `wordLike`는 통과하고 우리 hex 휴리스틱만 거부 — 두 단계 결과가 실제로 갈려 단언이 공허해지지 않는다) · `div[data-testid="user-jane@acme.com"] span.note`(PII 값 거부 판정용). doc 전환 게이트는 `[data-marker="a|b|c"]` → `min-height` 11/12/13px — **값이 1자라 finder의 wordLike를 못 넘어 양 단계 모두 selector 후보로 안 쓴다. 값을 단어로 바꾸면 compat 단계가 집어가 게이트가 곧 단언이 된다.**
- `second.html` — cross-page 세션 폐기 검증용(pageKey 상이).
- `console-error.html` — `window.__bugshotThrow()`가 정적 인라인 스크립트의 `bugshotBoom`을 `setTimeout`으로 비동기 throw → uncaught error로 콘솔 로그에 잡힌다. **정적** 인라인 스크립트라야 stack 프레임·`ErrorEvent.filename`이 page URL로 찍혀 args/stack 양쪽에 linkify 대상 URL이 생긴다(`console-linkify.spec`).
- **서버 엔드포인트** `/e2e-json*` (정적 파일 아님 — `fixtures/extension.ts` 서버 분기): `application/json` 본문 `{"note":"zqxbodyneedle"}`을 준다. 마커가 URL엔 없고 본문에만 있어 네트워크 로그 **본문 검색**(`network-body-search.spec`)을 판정. allowlist content-type이라 레코더가 string variant로 캡처. 코드블럭으로 직렬화하면 헤더 포함 **5줄**이라 접기 임계값(15) 아래 — `code-block-collapse.spec`의 음성 케이스도 겸한다.
- **서버 엔드포인트** `/e2e-bigjson*`: 문자열 30개 배열(`{"items":[...]}`) — 코드블럭 직렬화 시 **36줄**로 접기 임계값을 넘는 양성 케이스(`code-block-collapse.spec`). 각 원소는 마커(`e2e-bigjson-NNN`) 뒤에 `x` 120자를 달아 **한 줄이 패널 폭을 넘는다** — 행 번호 열이 가로 스크롤에서 빠지는지 판정하려면 실제 오버플로가 나야 한다(짧으면 그 축이 조용히 공허해진다). 본문 설계 제약(SENSITIVE 키 회피·중첩 대신 배열)은 GOTCHAS 참조.
- `scroll-capture.html` — 스크롤 캡처용. `#bar`(`position: fixed`) + `#sticky`(`position: sticky`, 자홍 픽셀 판정) 헤더는 첫 타일 이후 숨김 대상. `#tall`은 150vh라 타일 2장 고정(captureVisibleTab quota 최소화).
- `capture-context.html` — element 캡처 컨텍스트 확장용. `#modal`(`role=dialog` + `aria-modal`, `position:fixed` 60vw×80px — 확장 게이트 G1/G2/G3를 전부 만족하도록 크기를 잡았다) 안의 `#modal-btn`(40×40 정사각 — 크롭 종횡비가 모달과 확실히 갈린다), 그리고 시맨틱 조상이 없는 `.plain-wrap > div > #plain-btn`(폴백 확인용). **`inset:0` 백드롭을 두지 않는다** — 전면 오버레이는 picker 클릭을 가로챈다. 모달 높이를 `vh`/`vw`로 잡으면 창 비율에 따라 크롭이 정사각형이 되거나 버튼이 박스 밖으로 밀려 게이트가 깨진다(GOTCHAS 참조).
- `api-hosts.html` — 재현 환경 `API Hosts` 자동 행용. `#box`(320×200, element 픽 대상)와 `__fetchApis(port)`(spec이 arm 확인 후 호출 — `api.bugshot.test` 2건 + `auth.bugshot.test` 1건을 `/e2e-json-*` 경로로 요청해 요청 수 내림차순 정렬까지 판정 가능하게 둔다). 로드 시 자동 발사하지 않는 이유는 레코더 fetch 후크의 `capturing` 게이트(websocket.html과 같은 계열).
- `iframe.html` — top frame + `#frame` iframe(src=basic.html, picker iframe 내부 선택·iframe 로그 캡처용).
- `iframe-narrow.html` — top + `#narrow` iframe(**150×400**, src=narrow-child.html). **오버레이 프레임 소유 축 전용**(배너 top 단독 / 좁은 프레임 라벨 폭 접기). `iframe.html`을 넓히거나 iframe을 얹지 않고 페이지를 따로 둔 이유는 그쪽을 **4개 spec이 공유**하기 때문이다(프레임 수·origin 버킷이 로그 계열 판정에 걸린다). `narrow-child.html`의 `#chip`은 클래스 문자열이 길어 badge 모드로 떨어져도 라벨 자연 폭이 프레임 폭을 넘는다 — **넓히면 폭 접기가 발동하지 않아 spec이 조용히 green이 된다**(전제 단언이 그때 red를 낸다).
- `iframe-nested.html` — `#outer`(src=iframe-child.html, 1-depth 등록 대상) + `#inert`(srcdoc — 미주입·거부 대상). `iframe-child.html`은 그 안에 `#inner`(2-depth, 거부 대상) 보유. picker 거부 게이트용.
- `cross-origin.html` — `http://localhost:<port>/basic.html` iframe을 JS로 주입(동적 포트). 서버는 전 인터페이스 바인딩이라 localhost로도 접속돼 127.0.0.1 top과 origin이 갈라진다 — origin 필터용.
- `websocket.html` — `__openWs(tag)`(arm 후 spec이 호출 — `ws://location.host/` 연결 + open 시 `{ping:tag}` 송신, echo를 promise로 resolve, `__lastWs` 저장) / `__closeWs()`(마지막 연결 close) / `__wsCheck()`(무간섭 — `WebSocket.OPEN===1` + 새 인스턴스 `instanceof WebSocket`). ws echo 서버는 `extension.ts`의 http `upgrade` 핸들(raw, `ws` devDep 없음).

DOM 트리 다이얼로그: 요소 이름 헤더(`dom-tree-trigger`)로 열고, 트리 노드(`dom-tree-node` + `data-selector`)를 클릭해 이동.
