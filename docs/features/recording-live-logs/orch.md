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
| B1 | 1·2·5 | `sidepanel/hooks/useRecordingElapsed.ts`(+test), `sidepanel/tabs/IssueTab.tsx`(RecordingState만), `i18n/namespaces/issue.ts`, `sidepanel/components/RecordingFloatingBar.tsx`(+test) | 계획 커밋 | Sonnet / high — 기존 effect 이전·마크업이 설계에 박혀 있는 기계적 구현, 소스 스캔 단언만 주의 | typecheck·test·sync:agents:check | 대기 |
| B2 | 4·6 | `styles/globals.css`, `styles/__tests__/tokens.test.ts`, `sidepanel/components/{Console,Network}LogContent.tsx`(+기존 test) | 계획 커밋 | Sonnet / high — 셀렉터 확장·optional prop. `parseTokens` 순서 의존과 공용 소비처 4곳 무변경이 위험축 | 동일 | 대기 |
| B3 | 7·8·10·9 + 가이드 | `sidepanel/tabs/{Console,Network}SubTab.tsx`(+신규 test), `sidepanel/tabs/DebugTab.tsx`(+test), `e2e/recording-live-logs.spec.ts`, `docs/DESIGN.md`, `e2e/{GOTCHAS,COVERAGE}.md`, `guide/{ko,en}/video/record.md`·`logs/README.md` | B1·B2 dev 통합 | Opus / high — 서브탭 불변식(hideSubTabs·폴링 deps)·e2e stub PoC 판단 | 동일 + 신규 e2e spec green | 대기 |
| 리뷰 | 배치별 | 읽기 전용, `.scratch` 보고 | 각 배치 인계 | Opus / medium — 독립 리뷰 | 계획·인계 대조, 🔴 0 | 대기 |

## 겹침·순서

| 쌍 | 겹침 | 운영 |
|---|---|---|
| B1 / B2 | 없음(i18n은 B1 단독, 토큰·LogContent는 B2 단독) | 병렬 |
| B3 / B1·B2 | B3가 바 컴포넌트·`bottomInset` prop을 소비 | 직렬 — B1·B2 dev 통합 후 B3 착수 |
| 핫스팟 | `issue.ts`(B1), `DESIGN.md`·`GOTCHAS.md`(B3) | 각 단일 소유. CLAUDE·ARCHITECTURE·DIRECTORY 신선도는 지휘자가 통합 시점에 |

Task 7·8은 같은 배치(B3)다 — 8만 먼저 들어가면 녹화 중 [Clear] 활성 상태가 생긴다.

## 실행 기록

(진행하며 갱신)

## 잔여

(진행하며 갱신)
