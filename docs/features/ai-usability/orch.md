# ai-usability — 지휘 계획 (orchestrate)

원본: [prd.md](./prd.md) · [design.md](./design.md) · [tasks.md](./tasks.md) — 이 문서는 복제하지 않고 가리킨다.

- 착수 dev 해시: `8132f40c`
- 지휘자: Claude Code(이 세션). 워커: Claude Code(Sonnet·Opus) — 패밀리 교차 없음.
- 끝: 원격 dev push + 최종 HEAD CI(`verify`·`e2e-gate`) green. merge·deploy는 범위 밖.

## 결정 기록

| # | 결정 | 근거 |
|---|---|---|
| D1 | **가드레일**: 사람 UI(사이드패널 정상 모드) 변경 0. 예외는 실패 토스트·접힌 탭 `sr-only`(화면 변화 0)뿐 | 사용자 지시(feature-review) — prd 가드레일 |
| D2 | Task 5 프로브는 지휘자가 인테이크에서 ego(스토어판)로 수행 — 결과 아래 | 사용자 결정. Chrome API 동작이라 우리 빌드 무관 |
| D3 | 배치 분할·모델은 아래 표대로 | 사용자 승인 |
| D4 | e2e 하네스 전제 반전(우회 정리)은 B2a가 hold 코어와 **같은 배치**에서 처리 | 중간 dev CI red 방지 |
| D5 | 워커는 `/ship bypass`의 9단계 `/guide`·10단계 `/doc-check`를 **건너뛰고** 문서 영향을 인계에 적는다. 핫스팟 문서(CLAUDE·ARCHITECTURE·DIRECTORY)는 지휘자가 통합 `/push` 때 문서별 커밋, 탭 모드 섹션·DESIGN §14·MANUAL-SMOKE는 B3, 가이드는 C | 병렬 워커의 핫스팟 충돌 방지 |
| D8 | **Phase C(가이드·README) 전부 드랍** — 에이전트 페이지·FAQ·AUTHORING IA·README 한 줄·`screenshot/capture.md` 실패 토스트 단락 모두 반영하지 않는다. C 워커 커밋(`283b61bf`)은 통합하지 않고 폐기. 에이전트 안내의 정본은 매뉴얼(`#__BUGSHOT_AGENT__`) 한 곳 | 사용자 결정(C 리뷰 후 — 공개 가이드에 확장 ID를 어떻게 적을지 논의 중 "가이드 그냥 적지 말자") |
| D7 | **탭 모드 전체 페이지 캡처 취소 = 패널 탭으로 돌아가기**(다음 타일에서 중단 → inactive 토스트 1회 + reset). 코드 변경 없이 문서만 정정, Esc 리스너 미추가 | 사용자 결정(B2a 리뷰). Esc 추가는 사이드패널 동작 변경이라 D1 위반 |
| D6 | **런타임 검증은 ego에 dev 빌드(`dist`)를 마운트해서** 한다 — 스토어판으로 검증 금지. 스토어판은 손대지 않고, 끝나면 dev 빌드를 제거한다. 아래 "런타임 검증 절차" | 사용자 지시(2026-10-15 두 차례) |

### D2 프로브 결과 (2026-10-15, ego 스토어판, 같은 창)

- `chrome.runtime.getContexts({contextTypes:["TAB"]})` → 패널 탭 항목에 `tabId`(패널 자신)·`documentUrl`(`?tabId=<T>` 쿼리 포함)·`windowId` 전부 있음. `tabs` 권한 불필요. 확장 페이지에서 부른 결과에 BACKGROUND 컨텍스트도 함께 나와 SW 호출도 같은 범위로 판단(SW 직접 평가는 ego CDP 제약으로 미실행).
- `tabs.get(panel)`·`tabs.getCurrent()`·`tabs.query` → 패널 탭의 `url`·`pendingUrl`·`title` **없음**(tabs 권한 부재로 자기 확장 페이지 URL도 가려짐). `getCurrent()`는 `id`·`windowId`·`openerTabId`만. → design의 `getContexts` 선택이 맞고, `getSelfTab`은 id만 쓰고 self 판정 URL은 `location.href`를 쓴다(이미 design대로).
- 일반 탭 T의 `url`은 `<all_urls>`로 보임.
- 사이드패널 문서의 `getCurrent()===undefined`는 **미확인**(에이전트가 사이드패널을 못 연다) — 런타임 검증 단계에서 사람 손으로 확인(Chrome 문서상 비탭 컨텍스트는 undefined).

## 배치

| 배치 | Task | 범위 요약 | 소유 파일(주요) | 선행 | 모델/effort | 상태 |
|---|---|---|---|---|---|---|
| A1 | 1·2·3 + inactive 토스트 e2e | 캡처 실패 분류·토스트 | `src/lib/capture-messages.ts`(신규), `background/capture-throttle.ts`, `sidepanel/scroll-capture.ts`, `lib/app-events.ts`(+test), `sidepanel/lib/capture-error.ts`(+test), `i18n/namespaces/issue.ts`, `sidepanel/capture.ts`, `sidepanel/hooks/usePickerMessages.ts`, `sidepanel/tabs/IssueTab.tsx`, `sidepanel/App.tsx`, e2e 신규 spec | — | Opus / high — 권한 만료 deferred·발화 지점 단일화 불변식 | dev 통합 `ef6103ac..980c927e` (리뷰 1회·수정 1라운드, 🔴0) |
| A2 | 4 + Custom Webhook 탭 e2e | 접힌 탭 `sr-only`·아이콘 aria-hidden | `components/ui/collapsing-tabs.tsx`(+test), `sidepanel/tabs/SubmitPlatformTabs*`(+test), `docs/DESIGN.md`(:268만), `e2e/webhook-submit.spec.ts` | — | Sonnet / medium — 기계적 | dev 통합 `3a60eb9e..87345ef0` (리뷰 1회·수정 1라운드, 🔴0) |
| B1 | 6·7 | background 정지 예외 | `src/lib/panel-tab-url.ts`(신규), `background/tab-bindings.ts`(+test), `sidepanel/__tests__/agentManual.test.ts`(:260 바인딩 교체만) | — | Opus / high — 레코더 정지 불변식 | dev 통합 `4155c0e7..2b802c4a` (리뷰 1회·수정 1라운드, 🔴0) |
| B2a | 8·9 + 13(하네스 우회 정리·S1·S2·로그 유지·재캡처·패널→X·별도 창 e2e) | hold 코어 | `sidepanel/lib/tab-mode.ts`(신규), `sidepanel/tab-mode.ts`(신규), `sidepanel/hooks/useTabModeHold.ts`(신규), `capture.ts`, `usePickerMessages.ts`, `IssueTab.tsx`, `App.tsx`, `scripts/coverage-report.mjs`, `e2e/fixtures/extension.ts`, 우회 spec들, `e2e/GOTCHAS.md` | A1·B1 dev 통합 | Opus / high — 캡처 관문·hold 경쟁·하네스 반전 | dev 통합 (10커밋, 리뷰 1회·수정 1라운드, 🔴0) |
| B2b | 10 + picker·hint e2e | 대상 선택 화면·안내 | `components/TabTargetPicker.tsx`·`TabModeAgentHint.tsx`(신규, +test), `App.tsx`, `IssueTab.tsx`(영역 안내), `i18n/namespaces/app.ts`·`issue.ts` | B2a | Sonnet / high — UI 다수, 경계는 B2a가 깔아 둠 | dev 통합 (7커밋, 리뷰 1회·수정 1라운드 — 🔴1(D1 사이드패널 대기) 해소) |
| B3 | 11·12 | 매뉴얼 그물·문서 | `sidepanel/index.html`, `agentManual.test.ts`, `docs/ARCHITECTURE.md`(탭 모드 섹션), `docs/DESIGN.md`(§14), `e2e/MANUAL-SMOKE.md` | B2b | Sonnet / high — 뮤테이션 실측 | dev 통합 (12커밋, 리뷰 1회·수정 1라운드, 🔴0) |
| C | 14 | 가이드(`/guide`) | `guide/{ko,en}/**`, `guide/AUTHORING.md` | B3 | Sonnet / medium | **드랍(D8)** — 리뷰 1회 후 미통합 폐기 |
| R | — | 배치별 독립 리뷰(리포트 전용) | — | 각 배치 인계 | Opus / high | — |

### 파일 겹침 행렬 (✕ = 겹침)

|  | A1 | A2 | B1 | B2a | B2b | B3 | C |
|---|---|---|---|---|---|---|---|
| A1 | | | | ✕ capture·usePickerMessages·IssueTab·App | ✕ issue.ts·App·IssueTab | | |
| A2 | | | | | | ✕ DESIGN.md(다른 절) | |
| B1 | | | | | | ✕ agentManual.test | |
| B2a | | | | | ✕ App·IssueTab | | |
| B2b | | | | | | | |

→ **1파 병렬: A1 · A2 · B1** (상호 겹침 0). 이후 직렬 B2a → B2b → B3 → C. A2↔B3의 DESIGN.md는 절이 달라 직렬 순서로 해소.

## 워커 공통 규칙 (브리프에 포함)

- 워크트리는 로컬 `dev`에서 갈라진다(`--base-branch dev`). 첫 단계 `pnpm install --frozen-lockfile`.
- `/ship bypass` 재정의: 브랜치 = dev 등가, **11단계 커밋까지만**. 9·10단계 스킵(D5). `/push`·`/merge`·`/sync`·`/deploy`·`git push`·`/build` 금지. `build:e2e`는 `/e2e-write` 안에서만.
- `.env.local`이 필요하면 `cp .env.ci .env.local`만.
- 게이트: `pnpm typecheck && pnpm test && pnpm sync:agents:check` — 종료 코드만 근거, **파이프 금지**.
- 런타임 검증 목록엔 e2e가 원리적으로 못 보는 축만(각 항목 사유 한 줄).
- 인계: `.scratch/handoff-<batch>.md`(커밋 해시·게이트 명령과 종료 코드·「계획과 다른 점」·문서 영향·미완·런타임 검증 목록) 작성 후 완료 1회 알림, 대기.

## 런타임 검증 절차 (D6 — 모든 배치 dev 통합 뒤)

1. 지휘자가 `/build` 1회(`dist` 갱신).
2. 검증 워커(main 체크아웃)가 ego에 **dev 빌드 `dist`를 unpacked로 마운트**한다.
   - dev ID `dhmffogmoohdjficicjjfolcheklngfm`로 로드됐는지 확인(스토어판 ID `ohakhekagkodklkickemonmifdcbhmig`과 구분).
   - **스토어판은 건드리지 않는다**(비활성화·업데이트·설정 변경 전부 금지 — 사용자 지시). 둘이 함께 켜져 있으므로 패널은 반드시 dev ID URL로 열고, 툴바 아이콘·단축키·컨텍스트 메뉴처럼 어느 확장인지 모호한 진입은 쓰지 않는다.
   - **검증이 끝나면 dev 빌드를 제거한다**(사용자 지시). 제거 확인까지가 검증 완료다.
   - 로드된 빌드가 최신인지 확인: `chrome.runtime.getManifest().version` + 이번 변경의 식별 가능한 표지(예: 탭 모드 안내 testid 존재). `/build` 후엔 확장 **reload** 필수(stale dist 헛테스트 방지).
   - unpacked 로드에 네이티브 파일 피커가 필요해 자동화가 막히면 사용자에게 1회 요청한다(권한 세탁 금지).
3. 범위: 각 인계의 런타임 검증 목록 + prd 인수(ego S1 — 별도 창 없이 제출까지) + 사이드패널 정상 모드 무변화(가드레일, 사람이 사이드패널을 열어 확인 — `getCurrent()` undefined 포함).
4. 결함은 `gh issue create`(`[<batch>]` 태그) → 소유 배치 워커로 라우팅.

## 진행 로그

- 2026-10-15 인테이크: D1–D6 기록, 프로브 완료.
- 2026-10-15 1파 착수(A1·A2·B1). A2 리뷰 🔴0·🟡2 → fix1(측정 등가성 e2e `tab-label-measure.spec.ts`, nowrap 제거) → dev 통합. 런타임 이월: 옛 구현 대비 절대 폭 비교, log-viewer 육안. SlackIcon `aria-hidden` prop 추가는 범위 밖이나 리뷰 승인.
- 2026-10-15 A2 통합분 CI `8087d83e` green(verify·e2e-gate).
- 2026-10-15 B1 리뷰 🔴0·🟡4 → fix1 발송(실행 시점 재판정 가드 + POSTMORTEM 1건 예외 허용). 이관: 🟡2 SW `getContexts` 쿼리 포함 `documentUrl` 실측 e2e → **B2a 브리프**(`evalInExt`로 — crxjs module SW에선 `worker.evaluate`가 hang, `e2e/fixtures/extension.ts:31-33`). 🟡3 문서(ARCHITECTURE.md:357 자기 패널 예외, PERMISSION.md 의존 API 표에 `runtime.getContexts`) → 지휘자 B1 통합 `/push`. 🟡4 B2a 착수 전 B1 통합 HEAD의 CI e2e 결과를 따로 확인.
- 2026-10-15 B1 fix1 통합(실행 시점 재판정 가드, POSTMORTEM 1건). 문서: DIRECTORY(panel-tab-url)·ARCHITECTURE(활성 게이트 절 자기 패널 예외)·PERMISSION(getContexts 행·tabs.get url 가려짐) 지휘자 반영. 런타임 이월: Memory Saver discard 시 T→P.
- 2026-10-15 A1 통합(POSTMORTEM 충돌은 B1·A1 회고 둘 다 유지로 해소). 문서: DIRECTORY·ARCHITECTURE(캡처 실패 표면화)·PERMISSION(:325 지연 플래그 위치)·CI(85 spec/403). B2a 브리프에 A1 리뷰 이관 4건 반영(우회 spec 추가·뷰포트 함수 추출·발화 단일 지점·지연 플래그 단일 출처). 가이드 `screenshot/capture.md` 토스트 한 줄은 C. 런타임 이월: 사이드패널 정상 모드 토스트 노출, rate-limit 문구, 뷰포트 !ok(B2a 추출 시 단위로 이관 가능).
- 2026-10-15 B2a 인계(5커밋, e2e 361 green) → 리뷰 🔴0·🟡6 + D7 → fix1 발송(직렬화·재확인 가드 테스트, before hold 제거 검토, 인라인·취소 경로 e2e, capture-context 래치, COVERAGE stale, useTabModeHold BROWSER_BOUND 해제, 제3 탭 포커스 탈취 방지, POSTMORTEM 2건 예외 허용).
- 2026-10-15 B2a fix1 통합(before hold 제거, area hold·뷰포트 5초 상한·buffer 전환 묶음·제3 탭 포커스 탈취 방지, POSTMORTEM 2건). 지휘자 반영: design.md(before 근거 정정·진입점 표 #1/#4/#6/#7·returnToPanel·HoldReason·D7 취소 문구), tasks.md(:79·:188), DIRECTORY(tab-mode 셸·lib·viewport-capture·useTabModeHold·e2e 헬퍼·spec), CI(86/412), ARCHITECTURE(:513 keepFixtureActive). 탭 모드 섹션·CLAUDE 캡처 줄은 B3. 런타임 이월: 사이드패널 정상 모드 무변화, 전체 페이지 소요 시간, Memory Saver discard, 실 Chrome visibilitychange 재무장, ego 제어권 오판.
- 2026-10-15 B2b fix1 통합: 정수 쿼리면 getSelfTab 대기 없이 bound(D1). 지휘자 반영: DIRECTORY(TabTargetPicker·TabModeAgentHint·useSelfTab·tabModeGate·spec)·CI(87/415)·design.md:54. 런타임 이월: 실제 사이드패널에서 탭 모드 UI 미노출·시작 지연 없음.
- 2026-10-15 B3 fix1 통합(매뉴얼 탭 모드 계약 + agentManual 바인딩, ARCHITECTURE 탭 모드 섹션, DESIGN §14, MANUAL-SMOKE S7–S13 사람·ego 블록, CLAUDE 한 줄, POSTMORTEM 1건). 지휘자 반영: COVERAGE 수동 잔여(S8·S12·S13 + S7/S9/S10/S11 링크, 섹션 위치 정정), `/manual-smoke` 스킬 stale(별도 창 강제 삭제), DIRECTORY agentManual, design.md 매뉴얼 절.
- 2026-10-15 C 인계 → 리뷰 🔴1(확장 ID 안내 실행 불가) → 사용자 결정 D8: C 전부 드랍, 커밋 미통합·워크트리 폐기.
- 2026-10-15 런타임 검증(ego, dev 빌드 — 사용자 수동 마운트, 스토어판 무변경, dev 빌드 uninstallSelf 제거 확인): S12 PASS(별도 창 0·제어권 오판 0, 미리보기까지 — 제출 생략), S9 PASS(13.6s·20타일 상한, Esc 무반응, 패널 복귀 = inactive 토스트 1 + idle), S13 PASS(360px 아이콘·이름 유지, log-viewer 정상; 옛 구현 대비 절대 폭 skip), S2 FAIL → #263 [B2a](hover 후 클릭 시 before에 picker 오버레이), S10·S11 skip(환경 — ego는 탭이 뒤로 가도 visible, chrome://discards 비활성). 사람 몫 남음: S7·S8(진짜 사이드패널) + S10·S11(실 Chrome). #263은 사용자 결정으로 지금 수정 — F263 워커(Opus/high, H1 탭 모드 hold 깜빡임 vs H2 afterPaint 폴백 판정부터).
- 2026-10-15 F263(#263) 통합: H1(탭 모드 hold 깜빡임) 제품 코드상 배제, H2(afterPaint 150ms 폴백) 확정 — visible이면 1s(`PAINT_WAIT_CAP_MS`)까지 프레임 대기, frame-geometry 1.5s. 리뷰 🔴0, fix1(근거 문구 정정). 문서: ARCHITECTURE(:298·:538·:546)·DIRECTORY(:53). 재검증 대기: ego hover 후 클릭 3회 + 클릭→첫 rAF·숨김→첫 rAF 간격 + 패널 onActivated 로그.
- 2026-10-15 RV2: 사용자 지시로 **이번엔 dev 빌드를 제거하지 않는다**(사용자가 사이드패널 UI를 직접 확인). 제거는 사용자 확인 후.
- 2026-10-15 RV2 결과: #263 PASS 3/3(hover 300ms 후 클릭, before 깨끗) + 대조군 깨끗, H1을 ego에서도 배제(숨김~캡처 사이 패널 onActivated 0회). **주의: 상한 여유 ~50ms** — hover 후 대상 rAF가 ~1Hz로 떨어져 숨김→첫 rAF 940–954ms(`PAINT_WAIT_CAP_MS` 1000 바로 안쪽). 1Hz 규칙성은 프레임 클록 throttle 정황(ego 환경 의심, 원인 미규명). #263은 사이드패널 정상 모드 사람 확인까지 열어 둠. dev 빌드는 사용자 확인용으로 ego에 유지.
