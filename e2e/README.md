# e2e 스위트 (Playwright)

Chrome 확장을 실제 브라우저에서 구동해 사용자 플로우를 검증하는 e2e 스위트. **무엇을 커버하는지·무엇이 빠졌는지·어떤 함정이 있는지의 단일 출처**다. 시나리오가 늘면 해당 문서를 함께 갱신해 "어디에 뭐가 있나"를 재조사하지 않게 한다.

## 문서 구성

- **[COVERAGE.md](./COVERAGE.md)** — 커버리지 맵(spec별 시나리오) · 수동 잔여(자동화 못 한 것 + 이유).
- **[GOTCHAS.md](./GOTCHAS.md)** — 함정(실전에서 밟은 것 누적). **새 spec 쓰기 전 필독.**
- 이 문서(README) — 개요 · 실행법 · project 구성 · 헬퍼/fixture 빠른 참조.
- 작성 절차·금지·실행-수정 루프는 `/e2e-write` 스킬(`.claude/commands/e2e-write.md`)이 단일 출처 — 여기서 중복하지 않는다.

## 실행

- 빌드/실행: `pnpm build:e2e` → `pnpm test:e2e` (단일 spec: `pnpm test:e2e -- <이름 일부>`). dist-e2e는 **테스트 전용**(`<all_urls>` 포함, 수동 로드·스토어 업로드 금지).
- **두 project**(`playwright.config.ts`):
  - `sidepanel` — 확장 구동 메인 게이트(`retries:0`, 결정적).
  - `logview` — 확장 없이 `dist-log-viewer/index.html`을 합성 데이터로 직접 여는 standalone(`e2e/logview/*.spec.ts`, viewport 1280×800).
  - `logview`는 `dependencies:["sidepanel"]`(사이드패널 green 후 실행). 단독: `pnpm test:e2e --project=logview --no-deps`(dist-log-viewer는 `build:log-viewer`/`build:e2e`가 생성).
  - **30s Replay 캡처 spec(replay-action-log·replay-trim·replay-trim-logs·action-log-coverage·drag-action)은 제거됨** — `captureVisibleTab` cold-start/extension-global quota로 환경 flaky가 심해 게이트를 신뢰 불가하게 만들어 의도적으로 뺐다(트림/액션/드래그 로직은 단위 테스트로 커버, 캡처 경로는 수동 잔여). GOTCHAS 참조.
- **창 깜빡임**: 확장 SW가 headless에선 안 깨어나 headed로만 돈다. 대신 브라우저 창을 화면 밖으로 보내 기본적으로 안 보인다. 디버깅으로 창을 직접 보려면 `E2E_SHOW=1 pnpm test:e2e`.

## 헬퍼 · fixture 빠른 참조

전부 `fixtures/extension.ts`. 새 헬퍼를 추가하면 여기와 `docs/DIRECTORY.md`에 반영한다.

- `ext` worker fixture — `fixtureUrl(page)` / `fixtureTabId(urlPattern?)` / `openPanel(tabId)` / `context`.
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
- `second.html` — cross-page 세션 폐기 검증용(pageKey 상이).
- `console-error.html` — `window.__bugshotThrow()`가 정적 인라인 스크립트의 `bugshotBoom`을 `setTimeout`으로 비동기 throw → uncaught error로 콘솔 로그에 잡힌다. **정적** 인라인 스크립트라야 stack 프레임·`ErrorEvent.filename`이 page URL로 찍혀 args/stack 양쪽에 linkify 대상 URL이 생긴다(`console-linkify.spec`).
- **서버 엔드포인트** `/e2e-json*` (정적 파일 아님 — `fixtures/extension.ts` 서버 분기): `application/json` 본문 `{"note":"zqxbodyneedle"}`을 준다. 마커가 URL엔 없고 본문에만 있어 네트워크 로그 **본문 검색**(`network-body-search.spec`)을 판정. allowlist content-type이라 레코더가 string variant로 캡처. 코드블럭으로 직렬화하면 헤더 포함 **5줄**이라 접기 임계값(15) 아래 — `code-block-collapse.spec`의 음성 케이스도 겸한다.
- **서버 엔드포인트** `/e2e-bigjson*`: 문자열 30개 배열(`{"items":[...]}`) — 코드블럭 직렬화 시 **36줄**로 접기 임계값을 넘는 양성 케이스(`code-block-collapse.spec`). 본문 설계 제약(SENSITIVE 키 회피·중첩 대신 배열)은 GOTCHAS 참조.
- `scroll-capture.html` — 스크롤 캡처용. `#bar`(`position: fixed` 헤더 — 첫 타일 이후 숨김 대상) + `#tall`(150vh — 뷰포트 1.5배라 타일 2장 고정, captureVisibleTab quota 최소화).
- `iframe.html` — top frame + `#frame` iframe(src=basic.html, picker iframe 내부 선택·iframe 로그 캡처용).
- `iframe-nested.html` — `#outer`(src=iframe-child.html, 1-depth 등록 대상) + `#inert`(srcdoc — 미주입·거부 대상). `iframe-child.html`은 그 안에 `#inner`(2-depth, 거부 대상) 보유. picker 거부 게이트용.
- `cross-origin.html` — `http://localhost:<port>/basic.html` iframe을 JS로 주입(동적 포트). 서버는 전 인터페이스 바인딩이라 localhost로도 접속돼 127.0.0.1 top과 origin이 갈라진다 — origin 필터용.
- `websocket.html` — `__openWs(tag)`(arm 후 spec이 호출 — `ws://location.host/` 연결 + open 시 `{ping:tag}` 송신, echo를 promise로 resolve, `__lastWs` 저장) / `__closeWs()`(마지막 연결 close) / `__wsCheck()`(무간섭 — `WebSocket.OPEN===1` + 새 인스턴스 `instanceof WebSocket`). ws echo 서버는 `extension.ts`의 http `upgrade` 핸들(raw, `ws` devDep 없음).

DOM 트리 다이얼로그: 요소 이름 헤더(`dom-tree-trigger`)로 열고, 트리 노드(`dom-tree-node` + `data-selector`)를 클릭해 이동.
