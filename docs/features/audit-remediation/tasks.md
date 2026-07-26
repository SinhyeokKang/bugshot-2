# 감사 후속 정비 — 구현 태스크

> 🚫 **이 문서는 아직 삭제하지 않는다.** 구현은 끝났지만 "인계 사항" 3·4번(oauth-proxy 배포 순서 제약,
> `ALLOWED_ORIGINS` 실값 확인)이 **미이행**이다. `oauth-proxy`를 배포하고 그 두 항목이 해소된 뒤에
> 삭제한다 — 저장소에서 그 제약을 아는 문서가 여기와 `.claude/commands/deploy.md` 절차 8뿐이다.
> (feature 문서는 구현 완료 시 삭제가 기본 방침이라, 이 예외를 명시해 둔다.)

`/audit`(2026-07-26) 발견 63건을 `A-01`~`A-63`으로 번호 고정했다. 번호는 원 리포트 순번과 1:1이다.

## 진행 현황 (2026-07-26 갱신)

| 웨이브 | 상태 | 비고 |
|---|---|---|
| W0 (2건) | ✅ 완료 | `225ecb4` |
| W1 (8건) | ✅ 완료 | A-02·A-03은 W0 그물과 짝지어 `55e5915`, 나머지 6건은 `fe5e2ba`~`24246ad` 항목별 커밋 |
| W2 (5건) | ✅ 종결 | A-04 보류(재결정)·A-08 인계·A-12/20/32는 W6에서 코드 반영 |
| W3 (5건) | ✅ 완료 | `f5cddd4`~`4e84ece` 항목별 커밋. e2e 238 green |
| W4 (19건 + A-04) | ✅ 완료 | `07f93f2`(store)·`8459e4d`(css)·`7f705c4`(frame)·`93363b1`(sidepanel)·`ba583ca`(A-04 문서). e2e 238 green |
| W5 (10건) | ✅ 완료 | `35c9d3f`(a11y)·`48e1878`(토큰·다이얼로그)·`002daf9`(A-34)·`060ed9d`(A-39). e2e 238 green |
| W6 (13건 + W2 잔여) | ✅ 완료 | `4599ad8` 단일 커밋. e2e 238 green |

**전체 결과**: 유닛 255 files / 4051 tests green, `pnpm typecheck` 클린, e2e 238 green(`e2e/.last-green` = `4599ad8`). 미적용으로 남긴 항목과 그 근거는 아래 "적용하지 않은 항목" 참조.

### 적용하지 않은 항목 (근거 포함)

| 항목 | 처리 | 근거 |
|---|---|---|
| A-04 | 보류 + 문서화 | (b)안이 구현 불가 — 위 "A-04 재결정" |
| A-08 | 사용자 인계 | Cloudflare 대시보드 작업(아래 인계 사항 2) |
| A-34 일부 | Button/DropdownMenu 전환 미실시 | DESIGN이 그 전환을 규정하지 않고, 트리거가 Badge를 감싸 Button 패딩이 레이아웃을 바꾼다. 접근성 결함(순수 disabled)은 수정 |
| A-36 (2) | 미실시 + DESIGN 예외 문서화 | Button 최소 사이즈(h-9 w-9)가 입력 필드 안에 안 들어가 결국 직접 스타일링이 된다. `aria-label`은 적용 |
| A-43 | 주석 + 대조 테스트만 | 중앙화하면 recorders-entry 동기 IIFE가 깨져 pre-arm 사망 |
| A-55·56·60 | 기록만 | dead code·중복 골격 — CLAUDE.md 방침 |
| A-57 | 주석만 | 리네임 churn 대비 이득 없음 |
| A-62 | 미적용 | GitLab project path 이중 인코딩 404 위험 |
| A-63 | 수용 | 잔여 위험 문서화 완료 |

### W2 결정 기록

| 항목 | 결정 |
|---|---|
| A-04 frameToken | **(c) 보류 + 위험 문서화**로 최종 확정 (W4에서 (b) 착수 중 재검토) — 아래 "A-04 재결정" 참조 |
| A-08 rate limit | **코드 스코프 밖** — Cloudflare 대시보드 작업으로 사용자에게 인계 |
| A-12 `setItem` 삼킴 | **보류** — A-02 착지 후 근거를 보고 판단 (W6) |
| A-20 `http://` 허용 | **(c)** loopback 예외 + 그 외 https 강제 — W6 |
| A-32 `ActionEntry` union | **(a)** 소비처에만 exhaustive check — W6 |

### A-04 재결정 (W4, 2026-07-26)

(b)안(핸드오프 직전 chrome 경로 ping)은 **그대로는 구현 불가**임이 코드 확인에서 드러났다.

1. **top에는 특정 iframe으로 가는 chrome 경로가 없다.** content script의 `chrome.runtime.sendMessage`는 background/사이드패널로만 간다. 사이드패널을 경유하려면 그 자식의 `frameId`가 필요한데, top이 쥔 건 `<iframe>` 엘리먼트뿐이고 둘을 잇는 유일한 다리가 지금 문제 삼는 `event.source`(postMessage)다.
2. **postMessage로 오가는 값은 어떤 형태로도 인증에 못 쓴다.** 자식이 `targetOrigin: "*"`로 보내는 순간 부모 MAIN world가 읽고 자기 iframe에서 재생할 수 있다 — 새 nonce·회전·해싱 모두 원 설계의 "하면 안 되는 것"과 같은 이유로 착시다.
3. **토큰 유출의 증분 위험이 원 서술보다 좁다.** picker는 `all_frames: true`라 **악성 페이지가 만든 iframe에도 진짜 picker가 주입돼 정상 announce로 등록된다** — 토큰을 훔칠 필요가 없다. 실제 증분은 "picker가 없는 iframe(sandbox·2-depth+)을 등록시켜 blocker 핸드오프를 여는 것"뿐이다.

→ **보류.** 위험을 `docs/ARCHITECTURE.md` "등록 핸드셰이크"에 경고 블록으로, `CLAUDE.md` iframe 항목에 한 줄로 명시했다("registry는 인증이 아니라 힌트"). 근본 해결은 chrome 경로 challenge-response 프로토콜 신설이 필요하고, iframe picker는 회귀 밀집 구간이라 **수용된 잔여 위험**으로 남긴다.

**A-51 부수 발견**: 원 태스크의 1줄 수정(`data.token !== frameToken`이면 거부)은 **프로토콜을 깨뜨린다** — `OFFSET_REQ`의 `token`은 자식이 응답을 짝지으려 만든 correlation nonce다. 세션 토큰을 별도 `frameToken` 필드로 함께 실어 검증하는 방식으로 구현했다.

### W1에서 계획과 달라진 것 (착수 전 필독)

- **A-02**: `design.md` 함정 8의 예측이 **틀렸다**. `chromeLocalStorage.getItem`을 통째로 rethrow로 바꾸면 `settings-store`의 rehydrate가 에러 경로를 타고, zustand가 `onFinishHydration`을 영영 발화하지 않아 `App.tsx:208`의 렌더 게이트에서 **사이드패널이 빈 화면으로 굳는다**. 그래서 공용 어댑터는 삼킴을 유지하고 `failClosedLocalStorage`를 신설해 **issues-store에만** 연결했다. 상세는 POSTMORTEM 2026-07-26.
- **A-03**: 누락 키가 10개가 아니라 **12개**였다(`common.expand`/`common.collapse` 추가). 후자 2개는 `Section`의 collapsible 토글 경로라 log-viewer가 실제로 렌더하지는 않지만, 스캐너가 모듈 그래프 기준이라 요구한다 — 의도한 트레이드오프. 상세는 POSTMORTEM 2026-07-26.
- **A-07**: `LlmRedirectError`가 UI에 안 닿던 구멍을 함께 메웠다(`llmErrorToast.ts` 분기 + `LlmConnectDialog.tsx` 타입 캐치). 원 태스크 범위 밖이었으나 이게 없으면 문구를 추가한 의미가 없다.
- **A-05**: e2e 게이트가 회귀를 하나 잡았다. 가드를 background 관문으로 승격하자 뷰포트 캡처 spec이 죽었는데, **원인은 프로덕션 코드가 아니라 하네스**다 — e2e에선 사이드패널이 탭이라 패널이 앞에 있으면 fixture 탭이 비활성이다. 스크롤 캡처 spec에만 있던 `bringToFront` 우회를 뷰포트 spec에도 적용하고 `e2e/GOTCHAS.md` 항목의 적용 범위를 넓혔다. **앞으로 캡처 경로를 건드리는 spec은 이 우회가 필요하다.** 상세는 POSTMORTEM 2026-07-26.
- **A-09**: 단위 테스트로 `createFinalizeGuard()` 상태 전이는 고정했으나, **실제 MediaRecorder 경로는 수동 검증이 남아 있다**(아래 "인계 사항" 참조).

## 선행 조건

- 브랜치: `dev` 기준. 웨이브 단위 커밋.
- 🔴 9건(A-01·02·03·04·05·06·07·08·09)은 감사 시점에 **해당 라인을 직접 열어 재확인 완료**. 나머지는 하위 에이전트 보고 기준이므로 **착수 시 라인 재확인 필요**(그 사이 코드가 움직였을 수 있다).
- 각 웨이브 착수 전 `grep -ni -e '<대상 파일명>' -e '<영역 키워드>' docs/POSTMORTEM.md`로 회고 소환.
- 웨이브 종료 조건: `pnpm test --run` 전체 green + `pnpm typecheck` + `/e2e-run` green.
- **`pnpm build`는 돌리지 않는다**(A-03 검증 시 `pnpm build:log-viewer`만 예외).

### TDD 분류 규약

각 항목의 **TDD** 표기:
- `강제` — 순수 함수·마이그레이션·정규식·매핑 테이블·재현되는 버그. **red 먼저.**
- `스킵` — React 컴포넌트 동작, content script DOM 측정, MV3 메시지 라우터, OAuth 플로우, SW lifecycle, chrome API 직접 의존. 이유를 커밋 메시지에 남기고 사후 검증.

---

## W0 — 그물 먼저 (선행, 2건)

> 이 웨이브가 없으면 A-03·A-02를 고쳐도 **같은 사각지대가 다음번에 또 뚫린다.** 위험도 밖에 따로 둔 이유는 `design.md` "대안 2" 참조.

### W0-1: log-viewer 키 스캐너를 공용 컴포넌트까지 확장
- **변경 대상**: `src/log-viewer/__tests__/i18n.test.ts:66-94` (`walk(srcRoot)`)
- **작업 내용**: 스캔 루트에 log-viewer가 import하는 공용 컴포넌트를 추가한다 — `src/sidepanel/components/NetworkLogContent.tsx`·`ConsoleLogContent.tsx`·`ActionLogContent.tsx`·`IssuePreviewView.tsx`와 그 하위(`OriginFilterBar`·`LogSeekChip`·`JsonTreeViewer`). 이 파일들이 `t("리터럴")`로 참조하는 키가 `koDict`/`enDict`에 **전부 존재**함을 강제.
- **검증**:
  - [ ] 확장 직후 **테스트가 실패**한다 (A-03의 WS 키 10개가 잡혀야 함 — 안 잡히면 스캔 범위가 틀렸다)
  - [ ] A-03 수정 후 green
  - [ ] 공용 컴포넌트에 존재하지 않는 키를 임시로 넣으면 다시 red (스캐너가 실제로 동작함을 확인)
- **TDD**: 강제 (테스트 자체가 산출물)
- **리스크**: 스캔 범위를 너무 넓히면 log-viewer가 실제로 렌더하지 않는 경로의 키까지 요구해 false red가 난다. **`log-viewer/App.tsx`의 import 그래프를 따라간 파일만** 넣는다.
- **관련 회고**: POSTMORTEM 2026-06-28 (복제 dict 미동기화 — "대칭 ≠ 완전성")

### W0-2: `pruneOrphanBlobs` fail-closed 회귀 테스트
- **변경 대상**: `src/store/__tests__/issues-store.test.ts` (케이스 추가)
- **작업 내용**: storage 조회가 reject/실패할 때 **삭제가 0건**임을 고정. 현재 `grep -rn "pruneOrphanBlobs" src/store/__tests__` → 0건.
- **검증**:
  - [ ] 수정 전 red (현재는 전 blob 삭제가 일어남)
  - [ ] A-02 수정 후 green
  - [ ] 정상 rehydrate 시에는 진짜 고아가 삭제되는 케이스도 함께 고정(과잉 스킵 방지)
- **TDD**: 강제
- **리스크**: `pruneOrphanBlobs`가 모듈 스코프 함수라 직접 호출이 안 되면 A-02에서 분리하는 `shouldPruneAfterRehydrate`를 먼저 export한다.
- **관련 회고**: POSTMORTEM 2026-07-23 재발방지 (4) "조회 reject 시 삭제 0건 회귀 테스트를 반드시 둔다" — **이 항목이 미이행 상태였다.**

---

## W1 — 🔴 즉시 (8건)

### A-01: logs.html 이슈 링크 스킴 미검증 (`javascript:` XSS) 🔴
- **대상**: `src/log-viewer/App.tsx:251` / 올바른 선례 `src/log-viewer/components/IssueTitleOverlay.tsx:17`
- **검증(red)**: `isSafeExternalUrl("javascript:alert(1)")` → `false`, `"https://x"` → `true`. 컴포넌트 레벨은 스킵.
- **수정**: `src/lib/external-url.ts` 신설(`isSafeExternalUrl`/`safeExternalHref`) → `App.tsx:251`과 `IssueTitleOverlay.tsx:17`이 **공유**. 인라인 정규식 2벌로 만들지 않는다.
- **회귀 테스트**: `src/lib/__tests__/external-url.test.ts` — `javascript:`·`data:`·`vbscript:`·대소문자 혼합(`JaVaScRiPt:`)·선행 공백/제어문자(`\x01javascript:`)·프로토콜 상대(`//evil`) 전부 거부, `http(s)`만 통과.
- **리스크**: 낮음. 단 `logs.html`은 **CSP가 없고**(`src/log-viewer/index.html` 확인) React 프로덕션 빌드가 `javascript:`를 막지 않으므로, 가드가 유일한 방어선이다. 사이드패널 쪽 `SubmitSuccessView.tsx:23`은 MV3 기본 CSP로 보호되므로 이번 스코프 밖.
- **TDD**: 강제

### A-02: rehydrate 실패 시에도 `pruneOrphanBlobs`가 전 blob 삭제 🔴
- **대상**: `src/store/issues-store.ts:433-435`, `src/store/chrome-storage.ts:4-12`
- **검증(red)**: W0-2 케이스.
- **수정**: ① `chrome-storage.getItem`이 실패를 삼키지 않고 **rethrow** ② `onRehydrateStorage: () => (_state, error) => { if (!shouldPruneAfterRehydrate(error)) return; void pruneOrphanBlobs(); }` ③ 판정을 export된 순수 함수로 분리.
- **회귀 테스트**: W0-2 + `shouldPruneAfterRehydrate(new Error())===false` / `(undefined)===true`.
- **리스크**: **중.** `chromeLocalStorage`는 `settings-store`도 쓴다(`design.md` 함정 8). rethrow가 두 스토어의 rehydrate 에러 경로를 함께 태우므로 양쪽을 확인한다. `setItem`의 실패 삼킴은 **이번에 건드리지 않는다**(A-12에서 별도 판단).
- **TDD**: 강제
- **관련 회고**: POSTMORTEM 2026-07-23

### A-03: log-viewer 사전에 WebSocket i18n 키 10개 누락 🔴
- **대상**: `src/log-viewer/i18n.ts` (`koDict`/`enDict`) — 메인 정본 `src/i18n/namespaces/logs.ts:35-44`(ko)·`:165-174`(en)
- **누락 키**: `networkLog.filter.ws`, `networkLog.tab.messages`, `networkLog.ws.{all,send,receive,framesCount,dropped,empty,opened,closed}`
- **검증(red)**: W0-1 확장 후 자동 red.
- **수정**: ko/en 양쪽에 20개 항목 추가. **값은 메인 테이블과 일치**해야 한다(기존 drift 검사가 잡는다).
- **회귀 테스트**: W0-1 스캐너 + 기존 drift 대조.
- **리스크**: 낮음. 단 **이미 내보낸 `logs.html`은 소급 수정되지 않는다** — 검증하려면 `pnpm build:log-viewer` 후 재내보내기.
- **TDD**: 강제
- **관련 회고**: POSTMORTEM 2026-06-28 (같은 함정의 2회차)

### A-05: `captureVisibleTab`이 스로틀 대기 후 탭 소유권을 재확인하지 않음 🔴
- **대상**: `src/background/messages.ts:204-216`
- **검증(red)**: `capture-throttle.test.ts` 옆에, "큐 대기 중 탭이 비활성으로 바뀌면 캡처하지 않고 실패한다"를 fake chrome API로 고정. 라우터 자체가 아니라 **가드 로직만** 순수 함수로 뽑으면 테스트 가능.
- **수정**: `captureThrottle.run()` **콜백 안에서** `chrome.tabs.get(tabId)` 재조회 → `!tab.active`면 throw. 큐 밖에서 검사하면 의미가 없다(대기 시간이 문제).
- **회귀 테스트**: 위 케이스 + 정상 경로(계속 active면 캡처 수행).
- **리스크**: **중.** 조용한 오캡처가 명시적 실패로 바뀌므로 30s replay 폴링·요소 스냅샷 경로에서 실패 토스트가 새로 보일 수 있다. 폴링(`use-30s-replay.ts`)은 이미 에러를 삼키므로 영향 없고, 사용자 액션 경로는 실패가 **올바른** 결과다.
- **TDD**: 강제(가드 로직) / 라우터 배선은 스킵
- **관련 회고**: POSTMORTEM 2026-06-29 (같은 관문의 쿼터 회고 — 이번엔 소유권)

### A-06: 네트워크 마스킹 키가 exact-match라 자격증명이 평문 기록 🔴
- **대상**: `src/content/network-recorder-helpers.ts:32-45`(`MASKED_QUERY_KEYS`, `MASKED_BODY_KEYS`는 현재 **별칭**), 판정부 `:59`·`:82`·`:106`
- **검증(red)**: `maskUrl("https://app/cb?code=4/0AY&state=x")` → `code` 마스킹 기대 / `maskBody('{"currentPassword":"a","newPassword":"b"}', "application/json")` → 둘 다 마스킹 기대.
- **수정**: ① 두 Set을 **분리** ② body 키 추가: `client_secret`·`newpassword`·`new_password`·`currentpassword`·`current_password`·`oldpassword`·`old_password`·`session_token`·`sessiontoken`·`refreshtoken`·`accesstoken`·`idtoken`·`credential`·`private_key`·`privatekey`·`passwd`·`otp` ③ query 전용으로 `code` 추가 ④ `maskBody`에 "본문이 `{`/`[`로 시작하면 content-type 무관 JSON 시도" 휴리스틱(파싱 실패 시 원문).
- **회귀 테스트**: 위 positive 케이스 + **오탐 negative 케이스 필수** — `?code=KR`류 손실을 인지하고 고정, `error_code`·`status_code`·`zipcode`는 **본문에서** 마스킹되지 않음(그래서 `code`를 query 전용으로 좁혔다).
- **리스크**: **중.** 과잉 마스킹은 재현값을 죽인다(`design.md` 함정 3). **부분일치로 확장하지 않는다** — exact-match Set 확장으로 제한.
- **TDD**: 강제
- **관련 회고**: POSTMORTEM 2026-07-14 (마스킹 강화 시 오탐 동시 고정), 2026-07-2x (필터 커버리지 과장 금지)

### A-07: Anthropic BYOK `x-api-key`가 `redirect:"follow"`로 나감 🔴
- **대상**: `src/sidepanel/lib/ai-provider.ts:219`(`fetchWithRetry`의 `fetch`), `:468-488`, `:541`(`pingAnthropic`), `:567`(`fetchModels`)
- **검증(red)**: fetch를 목킹해 Anthropic 경로 호출의 `init.redirect === "manual"`을 단언.
- **수정**: `x-api-key`를 싣는 요청에 `redirect:"manual"` + `res.type === "opaqueredirect" || res.status === 0`이면 전용 에러. **OpenAI-compatible 경로는 그대로 둔다** — `Authorization`은 스펙상 cross-origin 리다이렉트에서 제거되므로 누출 경로가 없고, 건드리면 더 많은 사용자의 게이트웨이를 깰 위험이 크다.
- **회귀 테스트**: `redirect` 옵션 단언 + opaqueredirect 응답 시 명시적 에러.
- **리스크**: **중.** 끝 슬래시 차이로 301/308을 내는 프록시가 있으면 실패한다(`design.md` 함정 4). 그래서 에러 메시지에 "엔드포인트가 리다이렉트를 반환했습니다" 취지를 담아 사용자가 baseUrl을 고칠 수 있게 한다. i18n ko/en 동시 추가.
- **TDD**: 강제

### A-09: 녹화 중지 후 썸네일 생성 구간에서 취소가 no-op 🔴
- **대상**: `src/sidepanel/video-recorder.ts:67`(`state = null`), `:74`(`await generateThumbnail`), `:190`(`cancelRecording`의 `if (!state) return`)
- **검증(red)**: MediaRecorder·DOM 의존이라 단위 red 어려움 → **수동 재현 절차를 고정**: 탭 녹화 시작 → 중지 → 썸네일 생성 중(느린 페이지) 취소 클릭 → 현재는 drafting으로 커밋됨.
- **수정**: `finalizing` 모듈 상태 도입. `onstop`이 `state=null` 후 `finalizing = { tabId }` 설정 → `cancelRecording()`이 `!state && finalizing`이면 취소 플래그를 세우고 store `cancelRecording()` 호출 → finalize 계속부가 커밋 전 플래그를 확인해 폐기. finalize 종료 시 `finalizing = null`.
- **회귀 테스트**: 순수 상태 전이만 뽑아낼 수 있으면 단위, 아니면 수동 체크리스트.
- **리스크**: **중.** 녹화 종료 경로는 e2e 커버가 얕다. `state=null`을 되돌리면 이중 stop 재진입이 열리므로 **`state`는 그대로 두고 별도 플래그**로 간다.
- **TDD**: 스킵 (MediaRecorder/DOM 의존) — 수동 체크리스트로 대체

### A-22: oauth-proxy Atlassian 핸들러만 가드 누락 + 와일드카드 Origin 반사 🔴(묶음)
- **대상**: `oauth-proxy/worker.ts:279-320`(Atlassian), `:435`(`if (list.includes("*")) return origin`)
- **검증(red)**: 워커 단위 테스트가 있으면 "ATLASSIAN_CLIENT_SECRET 미설정 시 503" + "`ALLOWED_ORIGINS='*'`면 요청 거부"를 red로.
- **수정**: ① Atlassian에 나머지 7개와 동일한 `if (!env.ATLASSIAN_CLIENT_ID || !env.ATLASSIAN_CLIENT_SECRET) return 503` + `if (body.client_id !== env.ATLASSIAN_CLIENT_ID) return 400` ② `resolveCorsOrigin`이 `*`를 **거부**(secret을 다루는 프록시에 와일드카드 모드가 존재할 이유가 없다) ③ `wrangler.toml:35`의 와일드카드 문서화 제거.
- **회귀 테스트**: 8개 핸들러 전부에 대해 "미설정 → 503" / "client_id 불일치 → 400" 파라미터라이즈드 테스트(신규 provider 추가 시 누락을 잡는 그물).
- **리스크**: 낮음. 단 `*`를 실제로 쓰는 배포가 있으면 즉시 차단되므로 **배포 전 `ALLOWED_ORIGINS` 실값 확인**.
- **TDD**: 강제

---

## W2 — 설계 결정 필요 (5건, 합의 전 코드 금지)

> 이 웨이브의 항목은 **수정 방향이 확정돼 있지 않다.** 선택지와 트레이드오프만 정리한다. 보류가 정상 종료 상태다.

### A-04: frameToken이 `postMessage(…, "*")`로 페이지에 노출 🔴 — **부분 수정 금지**
- **대상**: `src/content/frame-geometry.ts:85`(유출), `:119-129`(그 토큰을 신뢰하는 검증)
- **문제**: postMessage는 world를 구분하지 않아 부모의 **MAIN world(페이지) 리스너도 토큰을 받는다.** 즉 `data.token !== frameToken` 검증이 **페이지에 공개된 값으로 페이지를 인증**한다. CLAUDE.md·ARCHITECTURE.md의 "chrome 경로라 페이지가 위조 불가"가 성립하지 않는다.
- **영향**: 악성 페이지가 토큰을 훔쳐 자기 iframe을 registry에 등록 → `picker.ts:789`의 blocker 핸드오프가 열려 요소 선택 클릭이 페이지로 샌다(내비게이션·결제 버튼). `iframeUnsupported` 안내도 안 뜬다.
- **선택지**:
  - **(a) chrome 경로 registry로 교체** — 자식이 `chrome.runtime`으로 사이드패널에 자기 존재를 알리고(`sender.frameId`는 위조 불가), 사이드패널이 `webNavigation.getAllFrames`로 부모-자식 관계를 확정한 뒤 top에 "등록 허용 frameId"를 chrome 경로로 내려준다. **문제**: top이 frameId → `<iframe>` 엘리먼트를 매핑할 방법이 여전히 필요하다(현재는 `event.source` 동일성이 그 역할).
  - **(b) 핸드오프 시점 실검증** — 등록 여부와 무관하게, blocker를 넘기기 직전 그 iframe에 chrome 경로로 ping을 보내 **실제 picker가 살아 있는지** 확인. 페이지는 chrome 경로 응답을 위조할 수 없다. registry는 힌트로 강등.
  - **(c) 보류** — 위험을 문서화하고 열어둔다.
- **하면 안 되는 것**: targetOrigin 조이기, 토큰 회전, 토큰 해싱. **수신 window의 페이지 스크립트가 여전히 읽으므로 전부 착시**다(`design.md` 함정 7).
- **리스크**: iframe picker는 ARCHITECTURE가 "회귀 함정이 많다"고 명시한 영역이고 e2e 커버가 얕다. **(b)가 변경 표면이 가장 작다.**
- **TDD**: 강제 (`frame-geometry.test.ts` 존재)

### A-08: oauth-proxy가 Origin 헤더만으로 인증 + rate limit 전무 🔴 — **인프라**
- **대상**: `oauth-proxy/worker.ts:51-62`, `wrangler.toml`(바인딩 없음)
- **문제**: `Origin`은 브라우저만 강제한다. 공개 확장 ID + 번들에서 읽히는 `VITE_*_CLIENT_ID`만 알면 `curl`로 6개 토큰 경로를 무제한 호출해 **우리 `client_secret`으로 상류를 릴레이**시킬 수 있다. 상류 abuse 정지 시 전체 사용자 연결이 죽는다.
- **선택지**: (a) Cloudflare Rate Limiting 규칙(코드 변경 0, 대시보드 설정) (b) KV/Durable Object 기반 IP·client_id별 토큰 버킷 (c) Turnstile 등 추가 검증.
- **이 트랙 밖인 이유**: 바인딩 추가 + 배포 파이프라인 변경이라 코드 정비가 아니다. **(a)가 가장 싸다** — 먼저 검토.
- **코드로 닫히는 부분은 A-22로 이미 분리**했다.
- **TDD**: 해당 없음

### A-12: `chrome.storage` 쓰기 실패를 삼켜 저장이 조용히 no-op 🟡
- **대상**: `src/store/chrome-storage.ts:14-19`
- **문제**: QUOTA 초과·IO 에러 시 `setItem`이 reject하지만 catch가 흡수 → `confirmDraft`(`editor-store.ts:943`)가 `true`를 반환해 "초안 저장됨" 토스트가 뜨는데 레코드가 없다. blob 저장 실패엔 `onBlobSaveFailed` 알림 채널이 있는데 **레코드 본체엔 없다.**
- **선택지**: (a) rethrow — zustand persist가 어떻게 다루는지 확인 필요, unhandled rejection 노이즈 위험 (b) 실패를 이벤트로 올려 토스트(`onBlobSaveFailed`와 대칭인 `onStateSaveFailed` 신설) (c) 현행 유지 + 문서화.
- **왜 W2인가**: A-02에서 `getItem`은 이미 rethrow로 바꾼다. `setItem`까지 같이 바꾸면 **A-02의 회귀 표면이 두 배**가 된다. 분리해서 순차 판단.
- **TDD**: 강제(선택지 확정 후)

### A-20: GitLab self-managed·BYOK LLM에 `http://` 허용 🟡
- **대상**: `src/sidepanel/tabs/connect/gitlabInstanceUrl.ts:15`, `src/sidepanel/tabs/settings/LlmConnectDialog.tsx:146-151`
- **문제**: `gitlab.com`만 https 강제. `http://gitlab.corp` 입력 시 `Authorization: Bearer <PAT>`(보통 `api` 전체 스코프)가 평문 전송. LLM도 `new URL()` 파싱 가능성만 검사.
- **선택지**: (a) https 강제 — **사내 http GitLab 사용자를 차단**한다 (b) 경고 표시 후 진행 허용 (c) loopback 예외 + 그 외 https 강제 — LLM은 ollama(`http://localhost:11434/v1`)가 있어 loopback 예외가 **필수**.
- **왜 W2인가**: (a)는 기능 차단이라 제품 결정이다. (b)는 UI 추가라 정비 범위를 넘는다.
- **TDD**: 강제(`gitlabInstanceUrl` 순수 함수)

### A-32: `ActionEntry`가 discriminated union이 아님 🟡 — **일부만 채택 권장**
- **대상**: `src/types/action.ts:20-45`, 소비부 `src/sidepanel/lib/buildLogSummary.ts:76-100`(`:99` 무조건 fallback)
- **문제**: `kind`는 있으나 나머지 필드가 전부 optional인 단일 wide interface. `ActionEntryKind`에 `"scroll"`을 추가하면 **타입 에러 없이** 새 kind 전부가 `"Clicked: "`로 라벨링되고, 그 문자열이 `useReproPrefill`을 타고 LLM 프롬프트로 나가 **사실과 다른 재현 단계**가 자동 삽입된다.
- **선택지**:
  - **(a) 소비부만 exhaustive 처리** — `buildLogSummary`에 `const _exhaustive: never` 추가. **변경 1파일, 위험 최소, 실제 고장(환각 재현 단계)을 막는다.** 권장.
  - **(b) 타입을 진짜 union으로 분해** — 정공법이지만 `action-recorder`·`markers.ts`·`TimelineRow`·`buildActionLogJson` 등 소비처 전반이 바뀌고 저장된 로그의 하위호환까지 봐야 한다.
- **권장**: **(a)만 채택하고 (b)는 보류.** (a)는 W6로 내려도 무방하나, 판단이 갈려 W2에 둔다.
- **TDD**: 강제 (`buildLogSummary` 순수 함수)

---

## W3 — content script 무간섭 3원칙 (5건)

> **절대 제약**: 이 웨이브가 손대는 3개 레코더는 `recorders-entry` self-contained 청크의 구성원이다. **공용 헬퍼를 `src/lib/`로 빼면 동기 IIFE emit이 깨져 pre-arm이 무력화된다.** 수정은 각 파일 안에서 끝낸다.
> 원칙: ① 원본 **먼저** 호출 ② 기록 로직 throw 격리 ③ 응답 read가 settle을 await 안 함.

### A-14: `console.*` wrap 16개가 try/catch 없음 + 게이트보다 직렬화가 먼저 🟡
- **대상**: `src/content/console-recorder.ts:92-98`(log/info/debug), `:104-231`(trace/assert/dir/dirxml/table/group*/count*/time*/timeStamp/clear)
- **문제**: `error/warn`만 `console-recorder-helpers.ts:168-181`의 try/catch 보호를 받는다. `:96`은 `pushEntry(level, serializeArgs(args))`를 맨몸 호출 → `throttle.schedule()`이 호출 시점 전역 `setTimeout`을 조회하므로 이를 교체하는 사이트에서 **페이지의 모든 `console.log`가 throw**한다. 또 `capturing` 게이트가 `pushEntry` **내부**(`:55`)라, 녹화를 켠 적 없는 사용자도 매 console 호출마다 깊이 5 재귀 `JSON.stringify`를 하고 결과를 버린다.
- **수정**: 각 wrap을 `original(...args); if (!capturing) return; try { pushEntry(...) } catch {}` 형태로. 게이트를 **직렬화 앞**에 둔다.
- **회귀 테스트**: `console-recorder-helpers.test.ts`에 "record가 throw해도 wrap이 throw하지 않는다" + "비capturing 시 직렬화가 호출되지 않는다"(스파이).
- **리스크**: 낮음. 단 `capturing`이 IIFE 클로저 변수라 wrap 밖에서 읽는 형태를 유지해야 한다.
- **TDD**: 강제(helpers) / IIFE 배선은 스킵
- **관련 회고**: POSTMORTEM 재발방지 "각 wrapper가 비활성 gate → 원본 호출 우선 → 기록 전체 try/catch 순서를 지키는지"

### A-15: action-recorder click/keydown/input에 `capturing` 게이트 없음 🟡
- **대상**: `src/content/action-recorder.ts:367-384`(click), `:483-508`(keydown), `:511-531`(input/change)
- **문제**: `pointerdown`(`:392`)·`dragstart`(`:453`)는 게이트가 있는데 셋만 없다. 비녹화 상태에서도 키스트로크마다 `composedPath()` 2회 + `document.querySelector('label[for]')` + 정규식이 돌고 `pushAction`(`:89`)에서 버려진다.
- **수정**: 세 핸들러 선두에 `if (!capturing) return;`.
- **검증 전 확인 필수**: click 핸들러의 `suppressNextClick` 소비, keydown의 IME/조합 상태 리셋처럼 **비녹화 시에도 돌아야 하는 부수효과가 있는지** 먼저 읽는다. 있으면 게이트를 그 뒤로 내린다.
- **회귀 테스트**: 스파이로 "비capturing 시 DOM 질의 0회".
- **리스크**: **중** — 위 부수효과 확인을 빠뜨리면 드래그 후 클릭 억제가 깨진다.
- **TDD**: 스킵 (IIFE + DOM 이벤트) — 수동/스파이 검증

### A-16: `XHR.setRequestHeader`가 원본보다 먼저, 보호 없이 기록 🟡
- **대상**: `src/content/network-recorder.ts:287-293`(기록 `:290`, 원본 `:292`)
- **문제**: 규칙 ①② 동시 위반. 헤더명을 객체로 넘기는 라이브러리에서 `name.toLowerCase()`가 `TypeError` → 원본 호출 전이라 **페이지 XHR이 깨진다**. 부수: `send()` 이후 호출돼 네이티브가 거부한 헤더도 로그에는 남는다.
- **수정**: 원본을 먼저 호출하고, 성공한 경우에만 try/catch 안에서 기록.
- **회귀 테스트**: `network-recorder.test.ts`에 "toLowerCase 불가 헤더명에도 원본이 호출되고 throw하지 않는다".
- **리스크**: 낮음.
- **TDD**: 강제(테스트 파일 존재)

### A-17: `sendBeacon` 기록 블록만 try/catch 부재 🟡
- **대상**: `src/content/network-recorder.ts:426-462` (원본은 `:425`로 먼저 호출됨 ✅)
- **수정**: `if (capturing) { … }` 본문 전체를 try/catch로.
- **회귀 테스트**: `classifyBeaconBody`가 throw하는 body(프로토타입 trap)에도 `sendBeacon`이 정상 반환.
- **리스크**: 낮음. sendBeacon은 `pagehide` 핸들러 안에서 불리는 경우가 많아 **파급이 크다**(뒤따르는 teardown 중단).
- **TDD**: 강제

### A-18: `SENSITIVE_NAME_RE`에 `key`·OTP류 없음 🟡
- **대상**: `src/content/action-recorder-helpers.ts:6`
- **문제**: `<input name="apiKey">`의 `sk_live_…`가 라벨(키워드 미포함)·값(`isSensitiveValue`는 이메일/9자리+ 숫자만) 양쪽을 통과해 평문으로 액션 로그 → 이슈 첨부. **네트워크 쪽 `MASKED_QUERY_KEYS`엔 `key`/`api_key`가 있어 두 층의 키 집합이 어긋나 있다.**
- **수정**: `key`·`otp`·`passphrase`·`mnemonic`·`credential` 추가. 영문은 기존대로 `\b` + `normalizeName`(camel/snake 분해) 유지 — `\bkey\b`는 `monkey`·`keyword`에 안 걸린다.
- **회귀 테스트**: positive(`apiKey`·`API Key`·`one-time-code`) + **negative 필수**(`keyword`·`monkey`·`donkey`·`keyboard`가 마스킹되지 않음).
- **리스크**: **중** — 판정 소스가 placeholder·라벨 문구라 부분일치 오탐이 정상 폼을 죽인다.
- **TDD**: 강제 (`action-recorder-helpers.test.ts` 존재, 기존에 오탐 케이스 선례 있음)
- **관련 회고**: POSTMORTEM 2026-07-14

---

## W4 — 세션·데이터 흐름 (19건)

### A-10: `stripSubmitted`가 `bufferedElements`를 안 지움 🟡
- **대상**: `src/store/issues-store.ts:33-58`
- **검증(red)**: `stripSubmitted(issueWithBuffer, {})` → `bufferedElements === undefined` 기대.
- **수정**: 폐기 목록에 `bufferedElements: undefined` 추가.
- **회귀 테스트**: `issues-store.test.ts` 케이스 추가.
- **리스크**: 낮음. `markSubmitted`는 이미 `deleteImageBlobs(id)`로 `b${i}-before/after`를 지우므로 **플래그만 남아 blob과 불일치**하던 상태가 해소된다.
- **TDD**: 강제

### A-11: `saveDraft`가 레코드를 통째 교체해 optional 필드 소실 🟡
- **대상**: `src/store/issues-store.ts:339-350`
- **검증(red)**: 재현 — draft 저장 → `patchIssue(id,{logsAttached:false})` → `saveDraft` 재호출 → `logsAttached`가 남아 있어야 함.
- **수정**: 기존 레코드를 찾아 `{...existing, ...record, createdAt, updatedAt}`로 병합.
- **회귀 테스트**: 위 시나리오 + `bufferedElements`가 빈 세션 재확정에서 사라지지 않음.
- **리스크**: **중** — 병합으로 바꾸면 "의도적으로 비운 필드"가 살아남을 수 있다. `confirmDraft`가 undefined로 명시 폐기하는 필드가 있는지 확인 후 진행.
- **TDD**: 강제

### A-13: refresh 토큰 회전 시 in-flight 락이 완료된 refresh를 못 막음 🟡
- **대상**: `src/background/github-oauth.ts:203-212`, `gitlab-oauth.ts:204-213`, `linear-oauth.ts:200-209`, `jira-api.ts:73-86`
- **문제**: 락은 `.finally`에서 풀리고 refresh는 **인자로 받은 stale `auth.refreshToken`**만 쓴다. 병렬 요청 A가 RT1을 소모한 뒤 B가 소모된 RT1로 재요청 → `invalid_grant` → storage엔 RT2가 있는데 **재인증 강요**.
- **수정**: 락 획득 **후** 저장된 auth를 재조회해, `stored.refreshToken !== auth.refreshToken`이면 **refresh 없이 stored를 반환**.
- **회귀 테스트**: OAuth 플로우라 단위는 스킵. 저장소 재조회 분기만 순수 헬퍼로 뽑을 수 있으면 강제.
- **리스크**: **중** — 4개 모듈 동형 수정. OAuth는 e2e 커버가 없다. 최악의 경우 stored도 stale이라 기존과 동일한 401 경로로 떨어지므로 **회귀 방향은 안전** 쪽.
- **TDD**: 스킵(OAuth) — 분기만 강제

### A-24: `css-source-cache.invalidate()`가 진행 중 로드를 취소하지 않음 🟡
- **대상**: `src/content/css-source-cache.ts:51-57`, `:69-77`, cross-origin `:844-881`
- **문제**: 패널 열기(외부 시트 fetch 중) → 즉시 닫기(`isReady=false`) → 옛 promise resolve → `isReady=true`. 재오픈 시 `picker.ts:882`의 대기가 스킵돼 **raw 캐시가 빈 상태로 확정 발화** → shorthand `var()` 원문이 CSSOM explode 값으로 강등. cross-origin은 두 로드가 `seq`를 0부터 중복 발급해 `sort` 동점에서 last-wins가 깨진다.
- **수정**: 에폭 카운터 도입. `loadAll`/`loadCrossOrigin`이 시작 시 에폭을 캡처하고, resolve 시 현재 에폭과 다르면 **결과를 버린다**. `invalidate()`가 에폭 증가.
- **회귀 테스트**: `css-source-cache.test.ts`에 "invalidate 후 도착한 옛 로드가 isReady를 켜지 않는다".
- **리스크**: 낮음.
- **TDD**: 강제(테스트 파일 존재)

### A-25: fallback이 공용 토큰일 때 `resolvedName`을 안 살림 🟡
- **대상**: `src/content/css-resolve.ts:1160-1162`. 현행을 고정한 테스트 `css-resolve.test.ts:419-422`
- **문제**: `var(--pad-legacy, var(--spacing-4))`에서 primary 미정의면 원문 반환 → `firstVarName`·`tokenUtils.extractTokenRefs`가 **죽은 변수 `--pad-legacy`**만 노출하고 실효 토큰이 안 뜬다. ARCHITECTURE "fallback은 fallback 이름으로 resolve" 위반.
- **수정**: fallback 해소 결과의 `resolvedName`을 전파.
- **회귀 테스트**: 기존 `:419-422` 케이스의 기대값을 **고치고**(리포트가 지목한 잘못된 기대값), 신규 케이스 추가.
- **리스크**: **중** — 토큰 표시가 바뀌므로 인스펙터·TokenChip·CSS 뷰 swatch에 파급. `pnpm test` 전체로 다른 골든이 깨지는지 확인.
- **TDD**: 강제

### A-26: 인라인 영역 캡처 취소가 frameId 없이 broadcast 🟡
- **대상**: `src/sidepanel/tabs/DraftingPanel.tsx:388` (같은 우회 `src/sidepanel/hooks/useEditorSessionSync.ts:215`·`:257`)
- **문제**: content `handleCancelAreaSelect`가 `restoreAfter`를 무시하고 `handleClear()`→`restoreAll()` → **element 스타일 편집이 페이지에서 전부 사라지는데 store는 `styleEdits`를 보유**(store-DOM 분기). broadcast라 iframe 편집까지 날아간다.
- **수정**: `picker-control.ts`의 `cancelAreaCapture`(frameId 0 명시)를 쓰도록 교체. `chrome.tabs.sendMessage` 직접 호출을 제거해 `send(tabId,msg,frameId)` 규약으로 복귀.
- **회귀 테스트**: 컴포넌트라 스킵. 수동: element 편집 → drafting → 이미지 삽입 → 취소 → **페이지 편집이 유지되는지**.
- **리스크**: 낮음(규약 복귀 방향).
- **TDD**: 스킵(컴포넌트/메시지 배선)

### A-27: `captureElementShot`이 캡처 큐 대기 후 소유권 재검사 없음 🟡
- **대상**: `src/sidepanel/hooks/usePickerMessages.ts:344` (선례 `:361` `captureAndCrop`)
- **수정**: `captureAndCrop`과 동일한 `phase !== "capturing" || target?.tabId !== tabId` 재확인 추가.
- **회귀 테스트**: 훅이라 스킵. 수동: 요소 클릭 직후 취소 → **유령 drafting이 안 뜨는지**.
- **리스크**: 낮음.
- **TDD**: 스킵(훅)

### A-28: cross-tab 격리 가드가 `myTabId != null` 조건부 🟡
- **대상**: `src/sidepanel/hooks/usePickerMessages.ts:77-83`, 개별 가드 `:201`·`:206`·`:219`
- **문제**: tabId 미해소 구간(`useBoundTabId`의 `chrome.tabs.query` 왕복, 실패 시 영구 `null`)에 **필터가 전면 해제**된다. 다른 탭의 `logClear`를 받으면 누적 로그가 통째 소실.
- **수정**: fail-closed로 전환 — `myTabId == null`이면 메시지를 **드롭**.
- **회귀 테스트**: 순수 판정 함수로 뽑으면 강제.
- **리스크**: **중** — `?tabId=` 없이 뜬 self-recover 패널이 tabId 해소 전 메시지를 전부 버린다. 해소 후 재동기화 경로(`visibilitychange` 재주입)가 있는지 확인 필요.
- **TDD**: 강제(판정 분리 시)

### A-29: `chrome.tabs.get`이 try 블록 밖이라 스트림 누수 🟡
- **대상**: `src/sidepanel/video-capture.ts:51`, `:91`
- **수정**: `tabs.get`을 try 안으로 옮겨 실패 시 `stream.getTracks().stop()`이 돌게.
- **회귀 테스트**: 스킵. 수동: 화면 공유 승인 후 대상 탭을 닫아 **공유 표시줄이 사라지는지**.
- **리스크**: 낮음. **user gesture 순서는 건드리지 않는다** — `getDisplayMedia`/`getMediaStreamId`가 첫 await인 현 구조 유지(감사에서 정상 확인됨).
- **TDD**: 스킵

### A-30: inline refId 정규식 두 벌, GC 쪽이 더 좁음 🟡
- **대상**: `src/store/blob-db.ts:563`(`INLINE_REF_SCAN_RE`, 삭제 predicate) vs `src/sidepanel/lib/resolveInlineImages.ts:3`(`INLINE_REF_RE`, 해석). 같은 파일 `:578`은 persist 키를 리터럴로 재선언.
- **문제**: 삭제 기준이 해석보다 **좁다**. refId 생성 규칙에 `_`·`.`이 들어오면 GC만 못 보고 **살아있는 이미지를 고아로 삭제**한다.
- **수정**: 삭제 predicate를 해석과 **같거나 더 넓게**. 정규식을 한 곳에서 export해 공유(둘 다 sidepanel/store 계층이라 content 청크 제약 무관). `:578`의 `"bugshot-issues"` 리터럴은 `issues-store`의 상수를 import.
- **회귀 테스트**: `blob-db-inline-origins.test.ts`에 "특수문자 refId도 활성으로 인식".
- **리스크**: 낮음(삭제가 보수적으로 바뀌는 방향).
- **TDD**: 강제
- **관련 회고**: POSTMORTEM 2026-07-23 (fail-closed)

### A-31: Notion 빌더만 `orderedList`를 불릿으로 emit 🟡
- **대상**: `src/sidepanel/lib/buildNotionIssueBody.ts:254`. 골든 `__tests__/buildNotionIssueBody.test.ts:85`
- **문제**: 8개 빌더 중 유일하게 재현 과정 번호가 사라진다. `types/notion.ts:108`·`notion-api.ts:515`에 `rich_numbered_list_item`→`numbered_list_item` 경로가 **이미 있다.**
- **수정**: `bulleted_list_item` → 번호 목록 블록 타입으로 교체. `markdownToNotionBlocks.ts:50`이 쓰는 타입과 일치시킨다.
- **회귀 테스트**: 골든 기대값 갱신 + 8개 빌더 중 이 섹션만 바뀌는지 확인.
- **리스크**: 낮음.
- **TDD**: 강제

### A-47: `pruneOrphanBlobs`의 image 루프만 `pending:` 스킵 가드 없음 ⚪
- **대상**: `src/store/issues-store.ts:72-80`
- **문제**: video/network/console/action/attachment는 전부 `if (key.startsWith("pending:")) continue;`인데 image만 없다. 썸네일을 pending 미러링하는 순간 `"pending:5:before".split(":")[0] === "pending"`이 `currentIds`에 없어 **전 탭 pending 이미지 일괄 삭제**.
- **수정**: 가드 추가(1줄).
- **회귀 테스트**: W0-2와 같은 파일에 케이스 추가.
- **리스크**: 없음. **A-02와 함께 처리하면 자연스럽다.**
- **TDD**: 강제

### A-48: hydrate의 IDB 복원이 세션 세대 검사 없이 store에 set ⚪
- **대상**: `src/sidepanel/hooks/useEditorSessionSync.ts:114-131` (+`:282` pagehide flush의 lite 폴백 부재)
- **문제**: `cancelled` 플래그가 바깥 `.then`에만 걸려 있다. 오픈 직후 IDB 읽기 중 새 캡처를 시작하면 **직전 세션 로그·videoBlob이 재주입**된다.
- **수정**: 내부 콜백에도 `cancelled` 확인. `:282` flush에 debounce 경로(`:159-186`)와 같은 lite 폴백 추가.
- **회귀 테스트**: 훅이라 스킵.
- **리스크**: 낮음.
- **TDD**: 스킵(훅)

### A-49: `childFrames` WeakSet이 세션 종료 시 안 비워짐 ⚪
- **대상**: `src/content/frame-geometry.ts:89`, `handleClear`(`picker.ts:490`)의 `setFrameToken(null)`
- **수정**: `setFrameToken(null)` 시 `childFrames`를 **새 WeakSet으로 교체**(WeakSet은 clear 불가).
- **회귀 테스트**: `frame-geometry.test.ts`에 "세션 리셋 후 이전 등록이 무효".
- **리스크**: 낮음. **A-04와 같은 파일이므로 A-04 방향이 정해지면 함께 처리**할지 판단.
- **TDD**: 강제

### A-50: CSS 캐시 MutationObserver가 picker 캐시를 무효화하지 않음 ⚪
- **대상**: `src/content/picker.ts:110-128`, 트리거 `css-source-cache.ts:341-345`
- **문제**: raw 캐시는 갱신되지만 `tokenLookup`·`inspectorCache`(WeakMap)는 주입 이전 시트로 굳는다. picker 활성 중 다크모드 토글·SPA 라우트에서 옛 토큰명이 세션 내내 유지.
- **수정**: 재로드 완료 시 `scheduleTokenBuild()` 재호출 + `inspectorCache` 무효화.
- **회귀 테스트**: DOM 의존이라 스킵. 수동: picker 켠 채 다크모드 토글.
- **리스크**: 낮음. **A-24와 같은 파일군이라 함께 처리 권장**.
- **TDD**: 스킵(DOM)

### A-51: `OFFSET_REQ`의 token이 `frameToken`과 대조되지 않음 ⚪
- **대상**: `src/content/frame-geometry.ts:132-140`
- **문제**: `typeof data.token === "string"`만 검사(PRESENT의 `:123`과 달리 대조 없음). 게이트는 `childFrames.has(iframe)` 프레임 단위뿐이라 **등록된 iframe의 페이지 스크립트**가 1회성 arm을 선점해 정상 캡처를 실패시키고 top geometry를 얻는다.
- **수정**: PRESENT와 동일하게 `data.token !== frameToken`이면 거부(1줄).
- **회귀 테스트**: `frame-geometry.test.ts`.
- **리스크**: 낮음. **단 A-04가 미해결이면 페이지가 토큰을 알고 있어 방어 효과가 제한적**이다 — A-04 의존을 명시.
- **TDD**: 강제

### A-52: element 분기만 `captureMode`를 ctx에 안 실음 ⚪
- **대상**: `src/sidepanel/lib/buildMarkdownContext.ts:84`
- **문제**: `ctx.captureMode`가 `undefined`. 8개 빌더가 element를 **부정형**으로 판정해 우연히 흡수될 뿐. 대조군 `buildEditorCapture.ts:114`·`DraftDetailDialog.tsx:334`는 명시한다.
- **수정**: 반환 객체에 `captureMode` 추가.
- **회귀 테스트**: `buildMarkdownContext` 테스트에 단언 추가.
- **리스크**: 낮음. 빌더의 부정형 판정이 **긍정형으로 바뀌면서 동작이 달라지지 않는지** 확인.
- **TDD**: 강제

### A-53: `showLogCards`가 `captureLogSupport` 게이트를 우회 ⚪
- **대상**: `src/sidepanel/tabs/DraftingPanel.tsx:168` (바로 윗줄 `:167`은 `supportsActionLog` 사용)
- **문제**: `captureMode !== "element"` 하드코딩. 현재 `CaptureMode` 4종이라 값이 같아 무해하나, **POSTMORTEM 2026-07-14와 정확히 같은 파일·같은 우회 방식**.
- **수정**: `supportsConsoleNetworkLog(captureMode)`로 교체(`PreviewPanel.tsx:128`·`DraftDetailDialog.tsx:1150`과 대칭).
- **회귀 테스트**: 동작 불변이므로 기존 테스트 통과로 갈음.
- **리스크**: 없음.
- **TDD**: 스킵(동작 불변 치환)

### A-54: `SIMPLE_VAR_FALLBACK_RE`가 2단 이상 중첩 fallback 미매치 ⚪
- **대상**: `src/content/css-resolve.ts:214`, 사용처 `:1154`
- **문제**: `[^)]*`가 `)`를 못 먹어 `var(--a, var(--b, var(--_ink)))`에서 private alias가 리터럴까지 안 펼쳐진다(1단만 동작, 테스트 `:400-404`가 1단만 커버).
- **수정**: 정규식 대신 괄호 깊이를 세는 파서로 교체하거나, 재귀 resolve로 위임.
- **회귀 테스트**: 2·3단 중첩 케이스 추가.
- **리스크**: **중** — 정규식 교체는 기존 1단 동작을 깨기 쉽다. **A-25와 같은 함수군이라 함께 처리**하고 `css-resolve.test.ts` 전체 green을 확인.
- **TDD**: 강제

---

## W5 — UI / i18n 컨벤션 (10건)

### A-33: picker 인스펙터 카드가 색 토큰의 세 번째 미검증 사본 🟡
- **대상**: `src/content/overlay.ts:69-72`(light), `:150-153`(dark)
- **문제**: light `--popover-foreground: hsl(224 71.4% 4.1%)` vs `globals.css:21` `222.2 84% 4.9%` — **이미 drift**. dark `--border: hsl(215 27.9% 16.9%)`는 **채도 27.9%**로 DESIGN §2 "다크=neutral(채도 0)" 위반(`globals.css:68`은 `0 0% 14.9%`). `tokens.test.ts`가 두 표만 대조해 이 사본을 커버하지 않는다.
- **수정**: 값을 `globals.css` 실값과 일치시킨다. (content script라 CSS 변수를 import할 수 없어 **사본 자체는 불가피** — 값만 맞춘다.)
- **회귀 테스트**: `tokens.test.ts`에 세 번째 사본 대조를 추가할지 검토(`overlay.ts`의 CSS 문자열을 파싱). 넣으면 영구 잠금.
- **리스크**: 낮음(시각 변경만). 다크모드에서 눈으로 확인.
- **TDD**: 강제(대조 테스트 추가 시)
- **관련 회고**: POSTMORTEM "복제본은 늘 대조 테스트로 묶는다"

### A-34: statusBadges 7개 raw `<button>` + 스피너 보유 버튼에 순수 `disabled` 🟡
- **대상**: `src/sidepanel/tabs/statusBadges/{Github,Asana,Clickup,Gitlab,Jira,Linear,Notion}StatusBadge.tsx` (예: `GithubStatusBadge.tsx:82-96`). 같은 반패턴: `ReplayTrimDialog.tsx:348`, `StyleChangesDialog.tsx:286`
- **수정**: shadcn `Button`/`DropdownMenu`로 전환 + `disabled` → `aria-disabled` + **핸들러 가드**.
- **선행 필수**: e2e가 이 배지를 `data-testid`로 잡는지 확인. 아니면 **testid를 먼저 추가**한 뒤 전환(`/e2e-write`가 src에 허용하는 유일한 수정).
- **회귀 테스트**: 컴포넌트 테스트(`*.test.tsx`)로 "updating 중 재클릭이 핸들러를 두 번 호출하지 않는다".
- **리스크**: **높음** — 7개 파일 DOM 구조·클래스 변경으로 e2e 셀렉터가 흔들린다(`design.md` 함정 6). **웨이브 내에서도 마지막에, 단독 커밋으로.**
- **TDD**: 강제(핸들러 가드) / 시각은 수동

### A-35: 아이콘 전용 버튼 `aria-label` 누락 다수 🟡
- **대상**: `PreviewPanel.tsx:174,209,238` / `DraftingPanel.tsx:184,238,249,259,292,562,603,640` / `settings/LlmConnectForm.tsx:146,191`
- **수정**: `aria-label` 추가(속성 추가만, DOM 구조 무변경). 문구는 기존 `title`의 i18n 키 재사용.
- **회귀 테스트**: 없음(속성 추가). 원하면 `getByRole("button", {name})` 스모크.
- **리스크**: 없음. **A-34와 달리 e2e 위험이 0이므로 먼저 처리**한다.
- **TDD**: 스킵(a11y 속성)

### A-36: 검색 클리어 버튼 4곳 raw `<button>` + idle `text-muted-foreground` 🟡
- **대상**: `ActionLogContent.tsx:259`, `ConsoleLogContent.tsx:151`, `NetworkLogContent.tsx:315`, `log-viewer/TimelinePanel.tsx:107`, `IssueListTab.tsx:128-135`
- **수정**: 2단계로 쪼갠다 — **(1) `aria-label` 추가**(무위험, A-35와 함께) **(2) shadcn `Button` 전환 + idle 색 교정**(A-34와 같은 e2e 위험).
- **리스크**: (1) 없음 / (2) 중. `TimelinePanel`은 log-viewer라 별도 빌드 — 변경 시 `pnpm build:log-viewer` 필요.
- **TDD**: 스킵(컴포넌트)

### A-37: 다이얼로그 표준 클래스 이탈 🟡
- **대상**: `LogInsertDialog.tsx:75`, `LogPreviewDialog.tsx:64` — `max-h-[80vh]` 대신 `h-[80vh]` 고정 높이
- **수정**: `max-h-[80vh]`로 교체.
- **부수**: DESIGN §11 원문의 `max-w-[90vw]`는 실제 코드 전수가 `max-w-[800px]`로 통일돼 있다 → **코드가 아니라 문서를 고친다**(A-63과 함께 `/doc-check` 트랙으로).
- **리스크**: 낮음(콘텐츠가 짧을 때 다이얼로그 높이가 줄어드는 시각 변경). 수동 확인.
- **TDD**: 스킵(컴포넌트)

### A-38: `JiraConnectForm` 사이트 선택 버튼만 순수 `disabled` 🟡
- **대상**: `src/sidepanel/tabs/connect/JiraConnectForm.tsx:258`
- **수정**: 8개 폼 공통 패턴(`disabled={!canValidate && !validating} aria-disabled={validating}`) + **핸들러 가드**로 정렬.
- **회귀 테스트**: "connecting 중 재클릭이 중복 요청을 만들지 않는다".
- **리스크**: **중** — `aria-disabled`는 클릭이 실제로 들어온다. 가드 누락 시 중복 OAuth 시작.
- **TDD**: 강제(가드)

### A-39: `FieldRow` 미사용 신규 사례 🟡
- **대상**: `settings/LlmConnectDialog.tsx:215,281`, `styleEditor/StylePropEditors.tsx:216-225`(`PropRow`)
- **수정**: `FieldRow`로 교체. (DESIGN이 예외로 명시한 건 `tabs/connect/`의 42건뿐 — 이 3건은 목록 밖.)
- **리스크**: **중** — DOM 구조가 바뀌어 e2e·레이아웃에 파급. `StylePropEditors`는 845줄 컴포넌트라 영향 확인 필요.
- **TDD**: 스킵(컴포넌트) — 수동 시각 확인

### A-57: OAuth `notConfigured` i18n 키 네임스페이스 불일치 ⚪
- **대상**: `src/background/oauth/config.ts:38`(jira), `:51`(github) vs 나머지 6개
- **문제**: 6개는 `{platform}.oauth.notConfigured`, jira·github만 `oauth.error.*` 하위. 전부 정상 resolve되나 9번째 플랫폼 추가 시 상반된 선례 2개.
- **수정**: 통일하려면 i18n 키 리네임 + ko/en 동시 갱신. **가치 대비 churn이 크다** — 통일 대신 `config.ts`에 "선례는 `{platform}.oauth.notConfigured`" 주석 한 줄로 대체하는 것을 권장.
- **리스크**: 리네임 시 낮으나 불필요. **스킵 권장.**
- **TDD**: 강제(리네임 시 `locales.test.ts` 자동)

### A-58: `.box-label` 폰트 스택 발산 + z-index 매직 리터럴 ⚪
- **대상**: `src/content/overlay.ts:157`(형제 4곳 `:39,65,79,181`과 다름), z-index `:48,54,194` / `annotation.ts:25,39,219`
- **수정**: 폰트 스택만 형제와 일치시킨다. **z-index 상수화는 하지 않는다** — 두 파일의 레이어 서열이 구조적으로 다르고(overlay는 label이 blocker 위, annotation은 svg가 blocker 아래) 공용 상수로 묶으면 그 차이가 가려진다.
- **리스크**: 없음.
- **TDD**: 스킵(CSS 문자열)

### A-59: log-viewer 아이콘 버튼 사이즈·`aria-label` ⚪
- **대상**: `log-viewer/components/VideoPlayer.tsx:149,163`(`h-12 w-12`), `JsonTreeViewer.tsx:145`, `TimelineRow.tsx:77`
- **수정**: `aria-label`만 추가. **`h-12 w-12`는 유지** — 미디어 플레이어의 주 컨트롤로 의도된 크기이고, `h-8`로 줄이면 UX가 나빠진다. DESIGN §10에 **예외로 문서화**하는 쪽이 맞다.
- **리스크**: 없음.
- **TDD**: 스킵

---

## W6 — 코드 헬스 · 정리 (13건)

### A-19: GitHub 업로드가 임의 github.com 탭을 재사용 🟡
- **대상**: `src/background/github-upload.ts:8`(`chrome.tabs.query`), `:154-159`(MAIN world 주입)
- **문제**: `args:[repoId, files]`의 `files`에 스크린샷·영상 base64가 들어간다. 그 탭의 유저스크립트·타 확장 MAIN world가 후킹하면 **캡처 원본과 `asset_upload_authenticity_token`**을 가져갈 수 있다.
- **수정**: `ensureGithubTab`이 **항상 전용 탭을 생성**하고 끝나면 제거(`:11-14`·`:169` 경로만 사용).
- **회귀 테스트**: 스킵(chrome API). 수동: GitHub 이미지 업로드가 정상 동작하는지.
- **리스크**: **중** — 업로드마다 탭 생성/제거라 느려지고 탭 깜빡임이 생길 수 있다(`active:false`라 포커스는 안 뺏김). `pageBatchUploadFn`의 self-contained 성질은 감사에서 확인됨 — **건드리지 않는다.**
- **TDD**: 스킵

### A-21: `analytics.capture`에 event/property 허용목록 없음 🟡
- **대상**: `src/background/messages.ts:695-696`, `src/background/analytics.ts:82-92`
- **문제**: 임의 문자열·임의 `Record<string,string>`을 검증 없이 PostHog로 흘린다. 현재 호출자 4곳은 깨끗함이 전수 확인됐으나 **런타임 방어가 0**이다. Privacy 코어밸류의 유일한 무방비 지점.
- **수정**: 허용 event 5종 + event별 허용 property 키 화이트리스트. 목록 밖은 드롭(+ dev 경고).
- **회귀 테스트**: `analytics.test.ts`에 "목록 밖 property는 전송 payload에 없다".
- **리스크**: 낮음. 기존 4개 호출자의 키를 빠짐없이 목록에 넣는다.
- **TDD**: 강제
- **부수 기록**: 텔레메트리 **opt-out 설정이 코드에 없다**(빌드 키 유무만 검사) — 별도 제품 결정.

### A-23: `serializeOAuthError`가 모든 비취소 에러를 "세션 만료"로 뭉갬 🟡
- **대상**: `src/background/oauth.ts:26-33`(`:32`)
- **문제**: `VITE_OAUTH_PROXY_URL` 없이 빌드된 확장에서 "GitHub 연결" 클릭 → `notConfiguredProxy` → `App.tsx:143`이 **"세션이 만료되었습니다"**. 연결한 적 없는 사용자에게 만료 안내. storage 쓰기 실패도 같은 경로.
- **수정**: `OAuthError`에 설정 오류 플래그를 두고 `{status:400, body:{oauthNotConfigured:true, platform}}`로 분기 → `messages.ts`가 `onOAuthExpired`를 **발화하지 않게**. i18n ko/en 문구 추가.
- **회귀 테스트**: `oauth.test.ts`에 직렬화 분기 케이스.
- **리스크**: 낮음. 기존 `isOAuthCancelled`/`getOAuthErrorPlatform` 규약을 따라 **정규식 매칭을 도입하지 않는다.**
- **TDD**: 강제

### A-42: `escapeHtml` 3중 구현, 하나는 quote 미이스케이프 🟡
- **대상**: `buildIssueMarkdown.ts:476`·`renderMarkdown.ts:4`(4종) vs `markdownToAsanaHtml.ts:226`(**3종, `"` 누락**)
- **수정**: 단일 헬퍼로 통합(4종 기준). 셋 다 sidepanel 계층이라 공유에 제약 없다.
- **회귀 테스트**: `"` 포함 문자열이 Asana HTML 경로에서도 이스케이프됨을 고정.
- **리스크**: 낮음. Asana html_notes의 골든 테스트가 있으면 기대값 갱신.
- **TDD**: 강제

### A-43: FIFO 캡 상수 3중 중복 🟡 — **중앙화 금지, 주석만**
- **대상**: `sidepanel/lib/log-merge.ts:8-10`(5000/2000/1000) vs `content/network-recorder.ts:12`(동기화 주석 **있음**) / `console-recorder.ts:21`·`action-recorder.ts:21`(**주석 없음**)
- **수정**: **공용 상수 모듈로 빼지 않는다.** 이 중복은 번들 격리의 결과이고, 중앙화하면 `recorders-entry` 청크에 외부 static import가 생겨 **동기 IIFE emit이 깨지고 pre-arm이 무력화된다.** 허용되는 수정은 `console-recorder.ts`·`action-recorder.ts`에 **`log-merge.ts`와 동기화해야 한다는 주석 추가**뿐.
- **회귀 테스트**: 값 일치를 대조하는 테스트를 `log-merge` 쪽에 둘 수 있다(문자열 파싱). 넣으면 영구 잠금.
- **리스크**: **중앙화를 시도하는 것 자체가 리스크다.** 이 항목은 "고치면 안 되는 것"의 기록이다.
- **TDD**: 강제(대조 테스트 추가 시)

### A-44: `"pending:"` 매직 스트링 미중앙화 🟡
- **대상**: `pending-log-prune.ts:14`에 `PENDING_PREFIX` 상수 존재. 미사용처 — `editor-store.ts`(547,554,780,963,970,977,1016-1017), `issues-store.ts`(67,83,90,97,104-105), `blob-db.ts`(199,658) 등 15곳+
- **수정**: 상수를 `src/lib/session-keys.ts`로 옮기고(그쪽이 세션 키 단일 출처) 전 사용처가 import. **content script는 해당 없음** — 전부 store/lib 계층이라 청크 제약 무관.
- **회귀 테스트**: 동작 불변. 기존 테스트 통과 + `grep -rn '"pending:"' src` 결과가 상수 정의 1곳으로 줄었는지 확인.
- **리스크**: 낮으나 **15곳+ 기계적 치환**이라 오타 위험. `pnpm typecheck` + 전체 테스트로 확인.
- **TDD**: 강제(`session-keys.test.ts` 존재)

### A-46: 테스트 공백 (순수 함수) 🟡
- **대상**: `prompts/stylingCompact.ts:25`·`stylingRich.ts:11`·`draftCompact.ts:51`(전용 테스트 없음), `settings-store.ts:291 isJiraAccountComplete`(동형 2개는 테스트 있음), `lib/utils.ts`(twMerge `text-mono` 그룹), `store/chrome-storage.ts`(catch 분기)
- **수정**: 각 sibling `__tests__/`에 케이스 추가. `chrome-storage`는 **A-02에서 동작이 바뀌므로 A-02와 함께**.
- **리스크**: 없음.
- **TDD**: 강제(테스트가 산출물)

### A-55: Dead export ⚪ — **언급만, 삭제 금지**
- `blob-db.ts:482 clearInlineImages`(자기 인정 주석 `:496`), `30s-replay/frame-buffer.ts:6 REPLAY_MAX_FRAMES`, `buildAiStylingPrompt.ts:37 isDeniedStyleProp`, `markdown-logs-link.ts:5 LOGS_FILENAME`, `GithubStatusBadge.tsx:18 toGithubTargetState`(export만 제거 가능)
- CLAUDE.md "기존 dead code는 언급만 하고 삭제하지 않는다". **목록 유지가 산출물이다.**

### A-56: Dead i18n 키 3개 ⚪ — **언급만**
- `logs.ts`의 `networkLog.dialog.title`·`consoleLog.dialog.title`·`actionLog.dialog.title`(842개 중 확정 dead 3개, 모달 기반 옛 설계 잔재)

### A-60: 중복 골격 ⚪ — **기록만**
- `oauth-proxy/worker.ts` 8개 핸들러(검증 5단계 반복 — **A-22가 그 실례**), `recorder-bridge.ts:8-137`(3벌), `background/index.ts:176-231`(8개 `*Error` 분기), `messages.ts:466,547,621`(격리 업로드 루프 3벌), 플랫폼별 `*Combobox` 15개(`jiraFields/FieldCombobox.tsx`가 통합 가능함을 자체 증명)
- **수정하지 않는다** — 구조 리팩터라 비목표. A-22처럼 **중복이 실제 결함을 낳은 경우에만** 개별 대응.

### A-61: 컨벤션 잔재 ⚪
- `createRefreshRunner.ts:3`만 `../oauth/errors` 상대경로(1-2행은 `@/`) → **`@/`로 교체**(1줄, 무위험)
- `css-source-cache.ts:464,476,615,650,655` 영어 WHAT-주석, `log-viewer/markers.ts:98 // action` → **건드리지 않는다**(주석 churn)
- `TiptapEditor.tsx:517` `as unknown as` → 스코프 내 유일. 타입 정의 개선이 가능하면, 아니면 유지

### A-62: URL 경로 `encodeURIComponent` 누락 ⚪ — **적용 금지**
- **대상**: notion(`:257,683,695`), gitlab(`:180~281` 7곳), clickup(10곳), asana(5곳), `jira-api.ts:68`(cloudId)
- **왜 안 하는가**: `gitlab-api.ts`의 `/projects/${projectId}`에는 **이미 URL-encoded된 project path**(`group%2Fsub%2Frepo`)가 올 수 있어, 일괄 인코딩하면 `%` → `%25` **이중 인코딩으로 404**가 된다. 값은 전부 플랫폼 발급 ID이고 감사도 **공격 경로 미확인**으로 분류했다. 일관성만을 위한 변경은 순이익이 음수.
- **기록만 남긴다.**

### A-63: `ssrf-guard` 잔여 갭 ⚪ — **수용**
- 우회 12종을 실측한 결과 정수/8진/16진 IP, `127.1`, 후행 점, `::ffff:` 매핑, `foo.localhost` **전부 정상 차단**. 통과하는 건 `.local`(mDNS)·사내 DNS 이름뿐이고 `ssrf-guard.ts:25` 주석이 이미 한계를 문서화 + content-type/2MB/50개/8s로 완화 → **수용된 잔여 위험**. (비착취: `fec0::/10`, NAT64 미처리.)
- **기록만.**

---

## 비목표 — 구조 리팩터 (3건, 별도 트랙 승격 여부만 기록)

| ID | 내용 | 왜 이 트랙 밖인가 |
|---|---|---|
| **A-40** | `DraftDetailDialog.tsx:402-808` / `IssueCreateModal.tsx:158-532`의 8종 submit 핸들러 16곳 복붙(clearPicker 4줄 블록만 8회). `DraftDetailDialog` 본문 938줄의 주원인 | 8개 플랫폼 **제출 경로 핵심 파일**이 통째로 바뀐다. 회귀 시 귀속 불가 |
| **A-41** | `*SubmittedBadge.tsx` 7개의 폴링 로직 복제(공용 훅 부재) | 동일. 상태 폴링은 e2e 커버가 얕다 |
| **A-45** | 오버사이즈 모듈 — `ai-provider.ts`(581), `buildIssueMarkdown.ts`(540), `picker-control.ts`(770), `messages.ts`(954, 그 안 `submitIssue` 120줄·순수 함수들 무테스트) | CLAUDE.md "요청하지 않은 추상화 금지". **단 `messages.ts`의 순수 함수(`snapshotRow`/`buildIssueUrl`) 분리+테스트는 A-46 연장선으로 검토 가능** |

---

## 테스트 계획

**단위 테스트 (신규/확장)**
- `src/lib/__tests__/external-url.test.ts` (신규) — A-01
- `src/store/__tests__/issues-store.test.ts` — A-02(fail-closed)·A-10·A-11·A-47
- `src/log-viewer/__tests__/i18n.test.ts` — W0-1 스캐너 확장, A-03
- `src/background/__tests__/capture-throttle.test.ts` 인접 — A-05
- `src/content/__tests__/network-recorder-helpers.test.ts` — A-06 (positive + **오탐 negative**)
- `src/content/__tests__/action-recorder-helpers.test.ts` — A-18 (positive + **`keyword`/`monkey` negative**)
- `src/content/__tests__/network-recorder.test.ts` — A-16·A-17
- `src/content/__tests__/console-recorder-helpers.test.ts` — A-14
- `src/content/__tests__/css-source-cache.test.ts` — A-24
- `src/content/__tests__/css-resolve.test.ts` — A-25(**기존 `:419-422` 기대값 갱신**)·A-54
- `src/content/__tests__/frame-geometry.test.ts` — A-49·A-51 (A-04 방향 확정 시 확대)
- `src/store/__tests__/blob-db-inline-origins.test.ts` — A-30
- `src/sidepanel/lib/__tests__/buildNotionIssueBody.test.ts` — A-31(골든 갱신)
- `src/sidepanel/lib/__tests__/buildLogSummary.test.ts` — A-32(a)
- `src/background/__tests__/analytics.test.ts` — A-21
- `src/background/__tests__/oauth.test.ts` — A-23
- `src/styles/__tests__/tokens.test.ts` — A-33(세 번째 사본 대조 추가 시)
- A-46의 신규 테스트 5종

**e2e 시나리오** (`/e2e-write` 입력)
- WS 트래픽이 있는 세션의 로그를 내보내면 `logs.html`에 `networkLog.ws.` 접두 raw 키가 **나타나지 않는다** — A-03
- 요소 스타일을 편집한 뒤 drafting에서 본문 이미지 삽입을 취소하면 **페이지의 편집이 유지된다** — A-26
- 요소 캡처 모드에서 요소 클릭 직후 취소하면 **drafting으로 전이하지 않는다** — A-27
- 이슈를 제출하면 목록의 해당 항목에 **스타일 덤프가 남지 않는다**(저장 용량 회귀) — A-10
- Notion으로 제출한 페이지의 재현 과정이 **번호 목록으로 렌더된다** — A-31
- 상태 배지가 갱신 중일 때 재클릭해도 **요청이 한 번만 나간다** — A-34·A-38

**수동 테스트 (Chrome, 자동화 불가)**
- [ ] A-05 — 30s replay 버퍼링 중 탭 전환 시 **다른 탭 화면이 캡처되지 않는다**
- [ ] A-09 — 녹화 중지 후 썸네일 생성 중 취소가 **실제로 취소된다**
- [ ] A-19 — GitHub 이미지 업로드가 전용 탭 경로로 정상 동작
- [ ] A-24·A-50 — picker 켠 채 다크모드 토글 시 **인스펙터 토큰명·색이 갱신된다**
- [ ] A-29 — 화면 공유 승인 후 대상 탭을 닫으면 **공유 표시줄이 사라진다**
- [ ] A-33 — 다크모드에서 인스펙터 카드 색이 사이드패널과 일치
- [ ] A-34·A-37·A-39 — 시각 회귀(배지 팝오버, 다이얼로그 높이, 필드 행 정렬)
- [ ] A-04(방향 확정 시) — **실 Chrome에서 1-depth iframe 요소 선택·캡처 전 경로**. ARCHITECTURE가 경고하는 회귀 밀집 구간이라 자동화로 대체 불가

## 구현 순서 권장

```
W0 (그물)  ─┬─► W1 (🔴 즉시)  ─┬─► W3 (무간섭)  ─┐
            │                  │                 ├─► W5 (UI)  ─► W6 (정리)
            └─────────────────►└─► W4 (데이터흐름)┘

W2 (설계 결정) ── 독립. 합의되면 해당 항목만 위 흐름에 합류
```

- **W0 → W1은 엄격한 순서**다. W0-1이 A-03의 red를 만들고, W0-2가 A-02의 red를 만든다.
- **W3·W4는 병렬 가능**(파일이 겹치지 않는다: W3=content 레코더 3종, W4=store·hooks·css·빌더). 단 A-24·A-50·A-54·A-25는 `css-*` 파일군을 공유하므로 **그 넷은 순차**.
- **W5는 W3·W4 이후**. UI 변경이 e2e 셀렉터를 흔들면 앞 웨이브의 회귀와 섞인다.
- **A-34·A-36(2)·A-39는 웨이브 안에서도 마지막, 단독 커밋.** e2e 위험이 가장 크다.
- **A-35는 W5 선두**(속성 추가만, 무위험).
- **A-47은 A-02와 같은 커밋**(같은 함수).
- **A-46의 `chrome-storage` 테스트는 A-02와 같은 커밋**(A-02가 동작을 바꾼다).
- **A-51은 A-04에 의존**(A-04 미해결이면 방어 효과 제한적 — 그래도 넣는 것이 옳다).

각 웨이브 종료 시: `pnpm test --run` + `pnpm typecheck` + `/e2e-run` green → 커밋. 빨강이면 **그 웨이브만** 되돌리고 항목별로 쪼갠다.

## 가이드 영향

**없음** — 63건 전부 내부 결함 정비이고 사용자 노출 UX·기능의 추가/변경이 아니다.

단, 아래 두 항목은 구현 시 **문서 갱신이 딸려온다**(`guide/`가 아니라 저장소 문서):
- **A-37** — DESIGN.md §11 다이얼로그 관용구 원문(`max-w-[90vw]`)이 실제 코드(`max-w-[800px]`)와 어긋난다. **코드가 아니라 문서를 고친다.**
- **A-59** — DESIGN.md §10에 미디어 플레이어 아이콘 버튼(`h-12 w-12`) 예외를 명시한다.
- **A-06·A-18** — 마스킹 대상 키가 바뀌면 `docs/privacy.{ko,en}.md`의 "무엇을 가리는가" 서술을 대조한다(ko 원본 + en 번역 **양쪽** + 상단 시행일). POSTMORTEM이 "필터 커버리지 주장은 정규식이 실제로 achieve하는 범위로 정확히 적는다"고 경고한 지점이다.

---

## 인계 사항 (코드 밖 / 다음 세션이 이어받을 것)

### 1. A-09 수동 검증 (미이행)
`createFinalizeGuard()`의 상태 전이는 단위로 고정했지만 **실제 MediaRecorder 경로는 검증되지 않았다.** 절차:
1. `src/sidepanel/video-recorder.ts`의 `void hideAnnotation(localTabId);` 바로 뒤에 임시로 `await new Promise((r) => setTimeout(r, 8000));` 삽입
2. `pnpm build` → 확장 재로드
3. 탭 녹화 시작 → 중지 → 8초 창 동안 취소 클릭 → **drafting으로 넘어가지 않고 idle 복귀**해야 정상
4. 취소하지 않은 경우 정상 커밋되는지도 확인
5. 임시 지연 제거

### 2. A-08 인프라 (사용자 작업)
oauth-proxy에 rate limit이 전무하다. Cloudflare 대시보드에서 WAF Rate Limiting Rule을 건다 — 코드 변경 없음. 권장: `/oauth/*` 경로에 IP당 분당 20회.

### 3. Atlassian `client_id` — **확장 쪽 수정 완료, 배포 순서 제약은 유효** ⚠️
`src/background/oauth.ts`의 `exchangeCodeForTokens`·`refreshOAuthToken`이 Atlassian `/token` 요청에 `client_id`를 안 싣던 문제는 **수정됐다**(`OAUTH_CONFIG.jira.clientId` 추가, 나머지 7개 플랫폼과 동일 형태). 회귀 테스트: `src/background/__tests__/oauth-client-id.test.ts` — 인가코드 교환·토큰 갱신 양쪽 body에 `client_id`가 실리는지 고정한다(프록시 쪽 대응 그물은 `oauth-proxy/__tests__/client-id-required.test.ts`).

**그래도 배포 순서 제약은 남는다** — 이미 설치된 구버전 확장은 여전히 `client_id`를 안 보내므로, 프록시를 먼저 배포하면 그 사용자들의 Jira 연동·토큰 갱신이 400으로 죽는다.

- 안전한 순서: ① 이 수정을 포함한 스토어 배포 → ② **리뷰 통과 + 자동 업데이트 전파 대기**(리뷰 통과만으론 부족 — Chrome 자동 업데이트는 수 시간~수 일에 걸쳐 퍼진다) → ③ 그다음 프록시 배포.
- 프록시 수정을 더 빨리 넣어야 하면, A-22의 세 변경 중 **Atlassian `client_id` 검사 줄만** 빼고 배포한다(나머지 둘 — 미설정 시 503, `ALLOWED_ORIGINS: "*"` 거부 — 은 배포 제약이 없다). 전파 후 그 줄을 되살린다. 참고로 `client_id`는 번들에서 읽히는 공개값이라 이 검사의 보안 이득은 크지 않다 — 주 목적은 나머지 7개와의 일관성이다.

### 4. `ALLOWED_ORIGINS` 실값 확인 (배포 전)
A-22가 `resolveCorsOrigin`에서 `*`를 거부하도록 바꿨다. `ALLOWED_ORIGINS`는 wrangler secret이라 저장소에서 실값을 볼 수 없다 — **배포 전 대시보드에서 `*`가 들어있지 않은지 확인**한다. 들어있으면 배포 즉시 전 origin이 차단된다.

### 5. 사용자 영향이 있는 동작 변경 2건 (가이드 대조 필요)

W6에서 A-20 (c)안을 적용해 **평문 http 엔드포인트가 거부**된다(loopback 예외).
- GitLab self-managed: `http://gitlab.corp` 입력 시 연결 거부 + 전용 안내(`gitlab.instanceUrl.insecure`).
- BYOK LLM: `http://` base URL 거부 + 전용 안내(`llm.error.insecureUrl`). ollama `http://localhost:11434/v1`은 그대로 동작.

사내 http GitLab을 쓰던 사용자가 있으면 이 변경으로 연결이 막힌다 — **제품 결정으로 확정된 (c)안**이지만, `guide/ko`·`guide/en`의 GitLab 연동·AI 설정 문서에 https 요구가 적혀 있는지 `/guide`로 대조가 필요하다. (이번 세션에서는 미이행.)

### 6. privacy 문서 — A-18 반영 완료

A-18로 액션 로그 마스킹에 `key`·`otp`·`passphrase`·`mnemonic`·`credential`·autocomplete `one-time-code`가 추가돼 `docs/privacy.{ko,en}.md`의 키워드 예시와 단어 경계 규칙을 갱신하고 시행일을 2026-07-26으로 올렸다(ko/en 양쪽).

### 7. privacy 문서 — A-06 판단 근거 (유지)
A-06은 마스킹 **대상을 넓히기만** 했다(superset). `docs/privacy.ko.md`의 "`token`·`password`·`secret` 등 민감 키" 서술과 WebSocket "JSON 형식 프레임에 한하며" 서술 모두 여전히 참이고, 새 수집·전송 동작이 없다. **A-18(W3) 착수 시 다시 대조**한다 — 그때는 서술 범위가 바뀔 수 있다.
