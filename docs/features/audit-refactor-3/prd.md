# 레코더 게이트·무결성 (audit-refactor-3)

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다.

**사용자 노출 변화**: 대부분 내부 정리지만 아래 셋은 사용자가 보는 로그가 바뀐다.

- **항목 16** — Debug > 액션 로그에서 **연속 타이핑 값이 실시간으로 갱신**된다. 지금은 같은 입력 필드에 이어서 타이핑하면 dedup 분기(`action-recorder.ts:261`)가 마지막 엔트리 값만 in-place로 고치고 `throttle.schedule()`을 부르지 않아, 그 값이 **다음 액션·stop·pagehide 전까지** 사이드패널에 안 흐른다. 고치면 최대 200ms(`FLUSH_INTERVAL_MS`) 안에 반영된다.
- **항목 31** — 네트워크 로그 상세의 **상태 줄이 번역된다**. 지금은 BugShot이 만든 영문 라벨(`Queued`·`Queue Full`·`Aborted`·`Timeout`)이 `statusText` 데이터 필드에 실려 `NetworkLogContent.tsx:508`에서 무번역으로 렌더된다. ko 로케일 사용자에게 영문이 그대로 보인다.
- **항목 35** — arm 직전에 `open()`된 XHR이 만들던 **빈 pending 행(`url:""` `method:""`)이 사라진다**. 지금은 그 행이 영구히 "응답 대기 중"으로 남고 `totalSeen` 카운트도 부풀린다.

나머지(6·7·8·9·15·66·67·77)는 사용자 눈에 보이는 변화가 없다. 항목 9는 정상 경로에서는 무변화지만 pre-arm 유예 시한(설계 문서 참조)을 넘긴 극단 케이스에서 로드 초반 로그가 덜 잡힐 수 있다 — 회귀 감시 지점에 명시한다.

## 배치 지도

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| ~~audit-refactor-1~~ (완료·문서 삭제) | 요청 경계·자격증명 가드 | 🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70 | 소 |
| ~~audit-refactor-2~~ (완료·문서 삭제) | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| **audit-refactor-3** | **레코더 게이트·무결성** | **🟡6~9,15,16,31,35 · ⚪66,67,77** | **중** |
| audit-refactor-4 | 세션·데이터 정합 | 🟡12~14,17,18 · ⚪71,73~76 | 중 |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

console/network/action 레코더는 MAIN world `document_start`에 주입돼 **페이지와 같은 realm**에서 돈다(`src/content/recorders-entry.ts`). 이 공존이 만드는 문제가 한 계열로 묶인다.

1. **페이지가 수집을 무력화할 수 있다.** sentinel 부트스트랩 채널이 고정 이름 CustomEvent(`__bugshot_net_setSentinel__` 등)이고, 레코더의 `setSentinel`은 무조건 `detachSentinelListeners()` → `currentSentinel` 교체를 수행한다(`network-recorder.ts:617-637`, `console-recorder.ts:311-336`, `action-recorder.ts:598-623`). 페이지가 이 이벤트 한 번을 쏘면 진짜 세션의 `stop`/`sync`/`clear` 리스너가 떨어지고 `data` 이벤트 이름도 바뀌어 브리지(`recorder-bridge.ts:14`의 `detail.sentinel !== networkSentinel` 필터)가 전량 drop한다 — **로그 수집이 무음으로 죽는다**. ARCHITECTURE.md:212가 수용한 건 *"페이지 스크립트가 자기 탭 로그를 위조 주입할 수는 있다 — 영향 범위는 해당 탭 로그 무결성 한정"* 이고, **가용성(수집 무력화)·강제 arm은 그 수용 범위 밖**이다.
2. **페이지가 게이트를 우회해 레코더를 켤 수 있다.** `readPreArmFlag()`가 읽는 `sessionStorage["__bugshot_recorder_active__"]`(`recorder-prearm.ts:4`)는 same-origin 페이지가 자유롭게 쓸 수 있다. 한 줄이면 `capturing=true` + `installEwWrap()`(`console-recorder.ts:95`)이 상시 켜져, ARCHITECTURE.md:214의 *"미armed origin·미활성 탭 트래픽에 일절 간섭하지 않는다"* 와 ARCHITECTURE.md:226의 *"오염 창을 arm 스코프로 좁힌다"* 가 둘 다 깨진다.
3. **페이지에 제어 함수가 노출돼 있다.** `window.__bugshot_net_ctrl__ = { setSentinel, clearBuffer }`(`network-recorder.ts:646` · `console-recorder.ts:350` · `action-recorder.ts:632`)는 저장소 전체에서 **읽는 곳이 0**이다(용도는 파일 첫 줄의 중복 초기화 가드뿐). 페이지가 캡처된 로그를 지우거나 sentinel을 갈아끼우는 직접 호출 지름길로만 남아 있다.
4. **마스킹이 페이지가 바꿀 수 있는 전역에 의존한다.** `maskBody`(`network-recorder-helpers.ts:118`)는 호출 시점의 전역 `JSON.parse`/`JSON.stringify`를 쓴다. fetch/XHR 원본은 document_start에 스냅샷하면서 `JSON`은 안 잡아, 페이지가 `JSON.parse`를 throw로 바꾸면 `catch { return body }`가 **마스킹 안 된 원문**을 버퍼 → IndexedDB → 이슈 본문/LLM으로 흘린다.
5. **게이트 밖 적재·throttle 누락이 남아 있다.** `console.count`의 `counters.set`·`console.time`의 `timers.set`은 `safeRecord`(capturing 게이트) 밖이고(`console-recorder.ts:181,199`), action input dedup 분기는 `throttle.schedule()`을 안 부르며(`action-recorder.ts:261`), network만 `pushEntry`에 자체 게이트가 없다(`network-recorder.ts:122`).
6. **arm 경계에서 XHR meta가 소실된다.** `capturing=false`인 `XHR.open`은 `delete this.__bugshot`(`:272-274`)하는데, 그 뒤 arm되고 `send`가 오면 `recordXhrSend`가 `meta` 없이 `url:"" method:""` 엔트리를 push하고(`:331-348`) `captureXhr`는 `!meta`로 즉시 return(`:358`)해 **영구 pending**으로 남는다.

## 목표

1. **가용성 — 위조 1회 사망 경로 제거**(부분 달성, 수용 위험 2건): `setSentinel` 한 번이 진짜 세션의 `data`/`stop`/`sync`/`clear` 리스너를 떼어내던 파괴적 교체를 없앤다(항목 6). **원천 차단은 아니다** — 비목표대로 위조 자체를 막을 수 없어 두 경로가 남는다: ① 위조 `setSentinel` 8회면 캡 FIFO가 진짜 sentinel을 evict한다(design.md 위험 요소 3), ② 위조 sentinel의 `stop`/`clear` 핸들러가 world 전역을 건드려 2이벤트면 적재가 멈춘다. 이 배치가 올리는 건 공격 비용(1 → 8 또는 2 이벤트)이다.
2. **직접 호출 경로 제거**: 페이지에서 `setSentinel`·`clearBuffer`를 호출할 수단이 사라진다(항목 7).
3. **마스킹 무결성**: 페이지가 `JSON`·`URLSearchParams`를 바꿔도 `maskBody`의 민감 키 마스킹이 유지된다(항목 8).
4. **오염 창 유한화**: 위조된 pre-arm 플래그로 켜진 wrap·적재가 무한정 지속되지 않는다(항목 9).
5. **게이트 일관성**: capturing 게이트 밖에서 무한 증가하는 상태가 없고(항목 15), network `pushEntry`도 console/action과 같은 첫 줄 게이트를 갖는다(항목 67).
6. **로그 정확성**: 연속 타이핑이 실시간 반영되고(16), BugShot 저작 상태 라벨이 UI에서 번역되며(31), arm 경계 XHR이 유령 pending을 남기지 않는다(35).
7. **문서 정합**: ARCHITECTURE.md의 `frame-geometry` 등록 핸드셰이크 서술과 action-recorder 주석이 코드 실제와 일치한다(66·77).

## 비목표 (Non-goals)

- **페이지의 sentinel 이벤트 위조 자체를 원천 차단하지 않는다.** MAIN world는 페이지와 같은 realm이고, MAIN 레코더가 sentinel을 모르는 상태에서 처음 받는 채널은 반드시 고정 이름이어야 한다(부트스트랩 제약). 완전 차단은 원리적으로 불가 — 판정 근거는 design.md "위협 모델 판정".
- **pre-arm 플래그 위조 자체를 원천 차단하지 않는다.** `sessionStorage`는 same-origin 페이지 소유이고, document_start에 **동기로** 읽을 수 있는 대체 채널이 없다(`chrome.storage.session`은 비동기, ISOLATED 브리지 통신도 비동기). 키를 바꾸거나 값에 서명해도 확장 번들이 공개돼 있어 무의미.
- **`statusText` 필드를 제거하거나 값을 바꾸지 않는다.** HAR export·LLM 프롬프트·이슈 본문 코드블록이 이 필드를 쓰고, `isStatusHidden`이 `"Network Error"` 문자열 동등 비교를 센티널로 쓴다. 병기 필드(`statusKind`)만 추가한다.
- **WebSocket의 `"Switching Protocols"`(`network-recorder.ts:486`)는 이번 스코프 밖.** 표준 HTTP reason phrase 문구이고 감사도 짚지 않았다.
- **레코더 아키텍처(2단 게이트·pre-arm·sentinel 모델) 자체를 바꾸지 않는다.** 항목별 외과적 수정만.
- **pre-arm self-contained 청크 제약을 건드리는 어떤 리팩터도 하지 않는다** — 새 공용 모듈로의 승격, `src/content/` 밖 런타임 값 import 금지.

## 성공 기준

- `pnpm typecheck` + `pnpm test` 통과, `pnpm build` 후 `pnpm check:prearm`이 `✓ pre-arm 청크 정상`(동기 IIFE, world=MAIN, document_start).
- 신규 순수 헬퍼(`maskBody` 스냅샷 경로·`statusKind` 매핑·sentinel 레지스트리)에 단위 테스트가 붙고 `pnpm test` green.
- 기존 e2e 스위트 중 레코더 관련(`logs-prearm`·`log-capture`·`logs-cross-page`·`logs-error-warn`·`logs-iframe`·`logs-origin-filter`·`action-log-scope`·`websocket-log`·`network-body-search`)이 전부 통과.
- 저장소 grep 결과: `window.__bugshot_*_ctrl__`가 객체가 아닌 불투명 마커, `detachSentinelListeners`로 진짜 세션이 끊기는 경로 소멸.
- ARCHITECTURE.md:167(등록 핸드셰이크)·:214(활성 게이트)·:226(console wrap 범위) 서술이 수정 후 코드 보장과 일치.

## 회귀 감시 지점

사용자 시나리오 대신, 이 배치가 깨뜨릴 수 있는 기존 동작을 감시 항목으로 둔다.

1. **pre-arm 소급 flush** — active origin reload 시 로드 초반(head/body) fetch·`console.error/warn`이 `preArm` 마커로 `logClear` 경계를 우회해 살아남아야 한다. 그물: `e2e/logs-prearm.spec.ts` 2케이스. 항목 9(유예 타이머)가 직접 건드리는 지점.
2. **동기 IIFE emit** — 항목 8의 내장 스냅샷, 항목 6의 sentinel 레지스트리가 새 모듈을 만들 때 `src/content/` 밖 런타임 import를 끌어들이면 crxjs가 async loader로 되돌아가 pre-arm이 조용히 죽는다. 그물: `pnpm check:prearm`(형태) + `e2e/logs-prearm.spec.ts`(행동).
3. **iframe sentinel 재발행** — `picker-control.ts:171-181`의 `rebroadcastSentinelsToFrame`이 늦게 뜬 iframe에 **같은 sentinel을 재전송**한다. sentinel 레지스트리 변경이 이 멱등 재수신을 깨면 iframe 로그가 사라진다. 그물: `e2e/logs-iframe.spec.ts`.
4. **재arm 사이클** — stop 후 새 arm은 매번 새 UUID(`picker-control.ts:713,732,751`의 `crypto.randomUUID()`)다. 레지스트리 캡·정리 규칙이 잘못되면 재arm 후 dispatch가 브리지에 안 닿는다. 그물: `e2e/log-capture.spec.ts`, 수동(패널 닫았다 다시 열기).
5. **페이지 무간섭 3원칙**(ARCHITECTURE.md:216) — 원본 먼저 호출 / 기록 throw 격리 / 응답 read를 await 안 함. 항목 8·15·35가 wrap 내부를 건드리므로 재확인 대상. 과거 회귀: POSTMORTEM 2026-07-23(MAIN world 레코더가 원본 `XHR.open`보다 먼저 기록해 페이지 요청을 깨뜨림).
6. **`isStatusHidden` 센티널** — `network-status.ts:8`이 `statusText === "Network Error"` 동등 비교다. 항목 31이 statusText를 건드리면 CORS 실패 행의 "실패 · 상태 가려짐" 표시와 `blockedHint`가 무음으로 죽는다. 그물: `src/lib/__tests__/network-status.test.ts`(6케이스 이미 존재).
7. **fetch 실패 statusText 분기** — `network-recorder.ts:204`는 `error instanceof Error`면 `error.message`를, 아니면 `"Network Error"`를 넣는다. 즉 `TypeError: Failed to fetch`는 지금도 `isStatusHidden`이 false다. `statusKind` 부여 조건을 이 분기와 **정확히 같게** 두지 않으면 blocked 표시 대상이 조용히 늘거나 준다.
8. **옛 저장 로그 하위호환** — IndexedDB `networkLogs` 스토어(`blob-db.ts:11`, `DB_VERSION=8`)와 `chrome.storage.session`에 이미 저장된 `NetworkRequest[]`에는 `statusKind`가 없다. 읽기 경로가 `statusKind` 존재를 전제하면 과거 이슈 draft의 네트워크 로그 상세가 깨진다.
9. **log-viewer 복제 사전** — `NetworkLogContent`는 log-viewer가 그대로 import한다(ARCHITECTURE.md:256). 새 i18n 키를 `src/i18n/namespaces/logs.ts`에만 넣으면 내보낸 `logs.html`에 raw 키가 노출된다. 그물: `src/log-viewer/__tests__/i18n.test.ts`(`pnpm test`에서만 잡힘, 저장 즉시 훅 없음).
10. **console.count/time 표시값** — 항목 15의 처리 방식에 따라 미armed 구간의 카운터·타이머 누적이 달라져, arm 후 `console.count` 로그 값이 DevTools 표시와 어긋날 수 있다(`originalCount`는 항상 먼저 호출되므로 페이지 자체 동작은 불변).
11. **action input 실시간 반영의 부작용** — 항목 16이 `throttle.schedule()`을 추가하면 타이핑 중 dispatch 빈도가 오른다. 버퍼 전량을 매 flush마다 보내는 구조(`dispatch()`가 `buffer.slice()`)라 대량 타이핑 시 메시지 크기·수신부 IDB 가드(`log-persist-guard`, ~1s trailing) 부하를 확인해야 한다.
