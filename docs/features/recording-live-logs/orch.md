# 녹화 중 로그 확인 — 오케스트레이션

계획 원본: [prd.md](./prd.md) · [design.md](./design.md) · [tasks.md](./tasks.md) (리뷰 반영 `2d0a4849`). 이 문서는 지휘 계획·진행 기록만 담고 원본을 복제하지 않는다.

## 착수·결정

- 시작 dev: `2d0a4849`, 미커밋 변경 없음. 지휘자: Claude Code(Opus). 워커 패밀리: Claude Code(Sonnet·Opus) — 교차 없음.
- 종착점: 원격 dev push + 그 HEAD의 CI(`verify`·`e2e-gate`) green. `/merge`·`/deploy`·`/sync` 없음.
- 설계 결정은 `/feature-review`(2026-10-11)에서 전부 받았다 — 폭 축소 3종 세트(✕ 아이콘·`barStop`·경과 시간만), 바 68px + `bottomInset` 유지, 반전은 CSS 전용 `.theme-inverse`, 정지 구간 마지막 값 유지, e2e는 `getDisplayMedia` stub PoC(실패 시 수동 폴백), 화면 녹화 노출은 design 정정 + 가이드 한 줄, 3종 폴링 확장 유지, 표면 `/90·blur-sm`, footer는 `disabled`(§14 예외), 취소 확인 없음, 펜 툴 수용, 취소 시 포커스 트리거 복귀. 상세는 원본 문서.
- 워커 런타임 검증 분류: (a) jsdom·node·e2e로 결정적으로 잴 수 있는 것은 테스트로, (b) 원리적으로 못 보는 것(탭 녹화 실경로·OS 테마 전환·reduced motion·화면 녹화 중 탭 이동·포커스 링 육안)만 런타임 목록에 남긴다.

## 배치·소유권

| 배치 | 태스크 | 소유 파일 | 선행 | 모델 / effort | 게이트 | 상태 |
|---|---|---|---|---|---|---|
| B1 | 1·2·5 | `sidepanel/hooks/useRecordingElapsed.ts`(+test), `sidepanel/tabs/IssueTab.tsx`(RecordingState만), `i18n/namespaces/issue.ts`, `sidepanel/components/RecordingFloatingBar.tsx`(+test) | 계획 커밋 | Sonnet / high — 기존 effect 이전·마크업이 설계에 박혀 있는 기계적 구현, 소스 스캔 단언만 주의 | typecheck·test·sync:agents:check | dev 통합(`e37967bd`..`fe5b3ca2`), 1라운드 |
| B2 | 4·6 | `styles/globals.css`, `styles/__tests__/tokens.test.ts`, `sidepanel/components/{Console,Network}LogContent.tsx`(+기존 test) | 계획 커밋 | Sonnet / high — 셀렉터 확장·optional prop. `parseTokens` 순서 의존과 공용 소비처 4곳 무변경이 위험축 | 동일 | dev 통합(`a93f0210`..`abc33041`), 1라운드 |
| B3 | 7·8·10·9 + 가이드 | `sidepanel/tabs/{Console,Network}SubTab.tsx`(+신규 test), `sidepanel/tabs/DebugTab.tsx`(+test), `e2e/recording-live-logs.spec.ts`, `docs/DESIGN.md`, `e2e/{GOTCHAS,COVERAGE}.md`, `guide/{ko,en}/video/record.md`·`logs/README.md` | B1·B2 dev 통합 | Opus / high — 서브탭 불변식(hideSubTabs·폴링 deps)·e2e stub PoC 판단 | 동일 + 신규 e2e spec green | 구현 중 |
| 리뷰 | 배치별 | 읽기 전용, `.scratch` 보고 | 각 배치 인계 | Opus / medium — 독립 리뷰 | 계획·인계 대조, 🔴 0 | 대기 |

## 겹침·순서

| 쌍 | 겹침 | 운영 |
|---|---|---|
| B1 / B2 | 없음(i18n은 B1 단독, 토큰·LogContent는 B2 단독) | 병렬 |
| B3 / B1·B2 | B3가 바 컴포넌트·`bottomInset` prop을 소비 | 직렬 — B1·B2 dev 통합 후 B3 착수 |
| 핫스팟 | `issue.ts`(B1), `DESIGN.md`·`GOTCHAS.md`(B3) | 각 단일 소유. CLAUDE·ARCHITECTURE·DIRECTORY 신선도는 지휘자가 통합 시점에 |

Task 7·8은 같은 배치(B3)다 — 8만 먼저 들어가면 녹화 중 [Clear] 활성 상태가 생긴다.

## 실행 기록

- 계획 커밋 `a3d795a8`. 브리프: `.scratch/rll/{common,brief-b1,brief-b2}.md`(git 제외).
- B1: Orca 워크트리 `rll-b1`(브랜치 `SinhyeokKang/rll-b1`, 시작 `a3d795a8`), terminal `term_504c83c9…`, `claude --model sonnet --effort high`, turn_started 확인.
- B2: Orca 워크트리 `rll-b2`(브랜치 `SinhyeokKang/rll-b2`, 시작 `a3d795a8`), terminal `term_cc1bc978…`, 같은 모델/effort, turn_started 확인.
- B2 인계: `64029a51`(red) → `76fff750` → `3bce6c7e`(red) → `0e21aa9a`. typecheck·test·sync:agents:check exit 0(test는 로그 파일로 재실행해 확인). 계획과 다른 점: globals.css 주석에 `:root {`/`.dark {` 문자열 금지(parseTokens indexOf 오매칭), 콘솔 목록 컨테이너는 testid 없이 parentElement로 조회. 인계에 /ship 자체 리뷰(4·5단계) 기록 없음 → 독립 리뷰로 보완.
- B2 리뷰: terminal `term_ae86c38b…`, `claude --model opus --effort medium`, 브리프 `.scratch/rll/brief-b2-review.md`, 보고 `.scratch/rll/review-b2.md`.
- B1 인계: `025ce175`(red) → `6a8214a8`. 게이트 exit 0(436파일·8,580 통과·2 skipped, `.env.ci` 복사 후). 계획과 다른 점 없음이라 주장. /ship code-review·refactor 스킬 미호출(자체 검토만) → 독립 리뷰로 보완. 문서 요청: DIRECTORY.md에 신규 2파일 등재(지휘자 소유).
- B1 리뷰: terminal `term_f3316345…`, opus/medium, 브리프 `.scratch/rll/brief-b1-review.md`, 보고 `.scratch/rll/review-b1.md`.
- B2 리뷰 결과: 🔴 0 / 🟡 1(tokens.test 19키·순서 고정 단언 과잉) / ⚪ 4. cascade 정적 분석으로 반전 동작 확인, 기본값 소비처 DOM은 래퍼 div 1개 추가뿐(e2e·log-viewer CSS 영향 없음). 리뷰 terminal 닫음.
- B2 수정 라운드 1(`.scratch/rll/brief-b2-fix1.md`): 🟡1 + ⚪2(`console-list-body` testid). ⚪1(`codeCollapse.test.ts:resolveMono`도 `:root {` 순서 의존)은 B3의 DESIGN §3 문구로 이관.
- B1 리뷰 결과: 🔴 0 / 🟡 3(focus 복귀 테스트가 손으로 만든 tabpanel — Radix 실트리 미고정, 치수 계약 클래스 미잠금, 훅 dead 조건) / ⚪ 4. 마크업·i18n 15값·RecordingState 무변경 확인. 리뷰 terminal 닫음.
- B1 수정 라운드 1(`.scratch/rll/brief-b1-fix1.md`): 🟡 3건 + ⚪1(동기 초기값)·⚪2(focus-before-cancel 단언)·⚪3(스캔 정규식 확장).
- B2 수정 `405150c4`: 키 단언 순서 무관화 + `console-list-body` testid. 게이트 exit 0(워커). 지휘자가 diff 직접 확인 후 통과 판정(🔴 0 유지, 재리뷰 생략 — 테스트 2줄·testid 1개).
- B2 dev 통합: cherry-pick `a93f0210`·`8162b874`·`fb75a7da`·`03e7344d`·`abc33041`. `git cherry` 전부 `-`, 추적 변경 0 확인 후 워크트리·브랜치 제거(인계 사본 `.scratch/rll/handoff-b2.md`).
- B1 수정 `f0f7fe9c`(test) → `31ce9e29`(refactor): 실 Radix Tabs 포커스 복귀 + 포커스 선행 단언, 치수 계약 클래스, 첫 렌더 동기값(`renderToString`), 스캔 정규식 확장, 훅 단순화. 워커 게이트 exit 0(8,582 통과). 지휘자 diff 확인 후 통과 판정.
- B1 dev 통합: cherry-pick `e37967bd`·`1e3f3e0a`·`dffabb50`·`fe5b3ca2`.
- 통합 게이트(main 체크아웃, HEAD `fe5b3ca2`): `pnpm typecheck` 0 · `pnpm test` 0 · `pnpm sync:agents:check` 0.
- B1 워크트리·브랜치 제거(`git cherry` 전부 `-`, 추적 변경 0, 인계 사본 `.scratch/rll/handoff-b1.md`).
- B3: Orca 워크트리 `rll-b3`(시작 `2f361a6f`), terminal `term_22205ce5…`, `claude --model opus --effort high`, 브리프 `.scratch/rll/brief-b3.md`, turn_started 확인. B1·B2와 달리 /code-review·/refactor 스킬을 실제 호출하도록 지시.
- B3 인계: `5bd1fc3a`(red) → `0b9d0214` → `ba070bb2`(refactor) → `efefb07c`(e2e) → `83905102`(DESIGN) → `d620156f`(guide). 게이트 exit 0(8,607 통과), e2e PoC 성공 → 시나리오 7개 spec, 2회 연속 green + 전체 e2e 397 green. 계획과 다른 점: `SettingsTab.tsx`에 `settings-theme` testid 1줄(소유 밖 — 리뷰 수용), 가이드 노출 문구를 "전체 화면·Chrome 창 공유 시"로 한정(리뷰 수용, 더 정확), logs/ 가이드 무변경(접근 조건 서술 없음). 인계 사본 `.scratch/rll/handoff-b3.md`.
- B3 리뷰(opus/medium): 🔴 0 / 🟡 2(OS 테마·reduced-motion 잔여가 실은 `emulateMedia`로 자동화 가능, GOTCHAS의 0바이트 원인 단정 + 고정 sleep) / ⚪ 6. 지휘자 문서 드리프트: ARCHITECTURE.md:385(3종 폴링 조건), DIRECTORY.md(신규 3파일). README 기능 목록 추가는 하지 않음(리뷰 추천 — 녹화의 하위 기능).
- B3 수정 라운드 1(`.scratch/rll/brief-b3-fix1.md`): 🟡1(지휘 규칙상 e2e로 잴 수 있는 (b)는 테스트로 — 사용자 결정 불요) + 🟡2 + ⚪1·⚪5.

## 잔여

(진행하며 갱신)
