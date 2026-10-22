# 감사 후속 수정 지휘 기록

## 범위·기준

- 원본 계획: [tasks.md](./tasks.md), 직전 대화 감사 항목 1–6.
- 시작 dev: `d3df521443013b50b073f970cde7042457872b0d`.
- 구현은 Orca Codex 워커의 격리 워크트리, 지휘자는 리뷰·통합·문서·검증을 소유한다.
- 기존 미추적 `.scratch/brief-{viewer,connect,capture}.md`는 사용자 작업으로 보존하며 커밋하지 않는다.

## 결정 기록

- 사용자: 6건 전부 수정, orchestrate 수행 승인. dev push·CI 확인까지이며 main은 건드리지 않는다.
- C: AI 생성 동안 배경을 실제로 비활성화하는 최소 수정으로 편집 유실을 방지한다.
- D: 한국어 출력이 필요한 요청은 한국어여야 한다는 사용자 답변으로 확정. 영어 폴백 금지, Chrome 미지원 언어는 생성·다운로드를 막고 외부 AI 연결 안내.
- 모델·effort: 사용자 모델 지정이 없어 Orca의 설정된 Codex 모델·effort를 상속한다(현재 CLI coordinator-loop 규칙). 시작 영수증의 실제 값을 기록한다.

## 배치·소유권

| 배치 | 항목 | 소유 파일 | 선행 | 상태 |
|---|---|---|---|---|
| A settings | 1 | settings-ui-store, 새 app-settings 저장/동기화 leaf, main.tsx 및 해당 테스트, 설정 복구 안내 i18n, App 초기화 안내 effect | App effect만 C 통합 뒤 | dev 통합 완료 |
| B blobs | 2 | editor-store, blob 저장 회귀 테스트 | 없음 | dev 통합 완료 |
| C overlay | 3 | App.tsx, AI overlay 접근성 컴포넌트/테스트, 관련 e2e | 없음 | dev 통합 완료 |
| D1 native-cancel | 6 | ai-provider Chrome signal 경로, generateReproPrefill, 관련 테스트 | 없음 | dev 통합 완료 |
| D2 chrome-ai | 4–5 | useAI, ai-provider 언어/readiness, compact prompt, AI 설정 UI, i18n ai 사전 및 테스트/e2e | A·C·D1 통합, 언어 결정 완료 | 구현 중 |

## 겹침·순서

A/B/C 최초 소유 파일은 서로 겹치지 않아 병렬 실행했다. A 리뷰에서 추가된 App 초기화 안내 effect는 C 통합 후 rebase 신호를 받고 수정한다. A 설정 복구 안내 i18n도 D보다 먼저 통합한다. D는 UI와 settings 소비처를 건드리므로 A/C 뒤에 실행한다. 모든 배치에서 CLAUDE.md·AGENTS.md·스킬·ARCHITECTURE·DIRECTORY·POSTMORTEM·coverage baseline·계획 문서는 편집 금지이며 필요한 갱신 내용을 인계한다. 예기치 않은 파일 겹침은 수정 전에 지휘자에게 보고한다.

한국어 정책 응답을 기다리는 동안 독립 작업을 진행하기 위해 D를 D1(취소)과 D2(언어·준비 UI)로 직렬 분리한다. D1은 A/B/C와 파일이 겹치지 않는다. D2는 D1을 포함한 최신 dev에서 출발한다. D1도 동일한 Codex 기본 모델·effort를 상속한다.

## 검증·통합 기록

- 워커 게이트: `pnpm typecheck`, `pnpm test`, `pnpm sync:agents:check` 종료 코드. 파이프 필터 금지.
- 회귀를 고정한 테스트, 독립 리뷰, 수정 라운드, 커밋, 문서·런타임 검증, CI 증거를 아래 누적한다.
- 실제 Nano 다운로드·언어 출력은 mock으로 증명하지 않는다. 가능한 실제 Chrome 환경을 확인하고 미검증이면 명시한다.

## Orca 실행 기록

- Run: `run_ae89d710757f`.
- A: `task_8b772bc54360` / `ctx_9ba0b5175607`, `audit-settings`.
- B: `task_c32ddc597a2a` / `ctx_44a718f51d77`, `audit-blobs`.
- C: `task_257c401ef8d4` / `ctx_9591d2200e05`, `audit-overlay`.
- 시작 영수증은 전부 Codex, model/effort null(사용자 기본 설정 상속), ready/input_accepted/turn_started 확인.
- D PRD·설계는 `4c8bded4`. CPO/CDO/CTO/QA 독립 읽기 전용 검수 진행 중.
- B 테스트 커밋 `15e71dd4` 보고 후 독립 DataFlow/CodeHealth/CTO 리뷰를 별도 Orca 워커에 배정했다. 전체 게이트와 병행한다.
- D 설계 검수 완료: CPO(스타일링 언어 계약), CDO(짧은 높이 스크롤·hidden 탭 재활성 조회), QA(세 표면 focus 종료·실 useAI/repro 통합·Chrome mock fixture), CTO(모델 제거 후 일반 생성의 사전 availability 재확인) 권장을 계획에 반영했다. 기존 승인된 수정 범위의 구체화이며 새 제품 결정은 한국어 정책 한 건뿐이다.
- B 독립 리뷰 `ctx_adb8336ab4cf`: red/yellow 0, 로그 issue→pending·영상 pending→issue 복원 소비자 확인. 리뷰 워커 해제 완료.
- A 독립 리뷰 `ctx_6cf8abd15028`: 손상된 저장값 때문에 모든 후속 저장이 실패하는 문제, 동시 reorder 시 오래된 인덱스로 다른 섹션을 이동하는 문제를 발견해 소유 워커에 수정 요청. 리뷰 워커 해제 완료.
- C 독립 리뷰 `ctx_693483ce5890`: 닫히는 Dialog 애니메이션 중 AI가 즉시 종료되면 곧 제거될 입력창으로 포커스를 복원하는 문제 발견. 회귀 테스트 `0afef393` red→green 보고 후 재리뷰 배정. 첫 리뷰 워커 해제 완료.
- 병렬 전체 테스트의 자원 경합과 timeout 보고에 따라 후속 실행은 `pnpm test --maxWorkers=2`로 제한한다. 실패 결과는 보존하며 제한 실행의 종료 코드로 검증한다.
- C 재리뷰 `ctx_88a98b47a152`: 이전 P2 해결·red 0. draft e2e 이외 표면의 브라우저 증거와 빠른 응답 타이밍의 한계를 구분하도록 요청했고 styling e2e를 보강한다. 리뷰 워커 해제 완료.
- A 재리뷰 `ctx_eb23404e1797`: adapter 손상 복구·reorder 수정본 검수 중. App 안내 effect는 C 통합 대기 중이라는 선행 조건을 명시했다.
- 런타임 사전 확인: Ego Chrome 154에 스토어판 BugShot 1.7.61만 ENABLED(`FROM_STORE`), 개발판 없음. 새 탭에서 LanguageModel 함수는 존재하지만 availability 조회는 15초 timeout이어서 모델 준비/언어 지원을 확인했다고 보지 않는다. 조회만 했으며 모델 생성·다운로드는 실행하지 않았다. 사전 확인용 공간은 정리했다.
- B 완료: 원본 `15e71dd4`·`eb872fe7` → dev `886d6707`·`1fd0f382`. targeted 10 red→225 green, typecheck/sync exit0, 제한 전체 테스트 471 files·9196 passed·2 skipped(exit0). 초기 dummy env 누락과 병렬 timeout 실패 뒤 제한 재검증. 독립 리뷰 red/yellow0. 실 Chrome quota 고갈은 미실행이며 같은 탭 복원 소비자 대조와 false-save 계약 테스트가 수용 근거다. worker 해제, tracked clean 및 git cherry `+` 0 확인.
- D1: `task_6fcb80efad4d` / `ctx_aa49abdb2517`, `audit-native-cancel`. Codex 기본 모델·effort 상속, ready/input_accepted/turn_started 확인.
- C 완료: `5745fafd`·`0afef393`·`0eb777a8`·`88f3ca92` → dev `a206e0a6`·`6e9a58b8`·`843d8ff6`·`7c25e38b`. typecheck/sync exit0, 전체 472 files·9189 passed·2 skipped(exit0), draft/styling e2e 5개 2회 연속 exit0. 빠른 종료는 jsdom red→green, 실제 video-triggered repro·실 모델·픽셀/스크린리더는 미검증. A에게 C 통합 후 rebase/App effect 편집 신호 전달.
- C worker-release 결과는 `retained / user_takeover`다. 사용자 인계된 터미널·worktree를 닫거나 제거하지 않는다. B worker/worktree는 완료 증거 보존 후 정리했다.
- B 통합 직후 root typecheck/sync exit0. 전체 통합 게이트는 A·C·D1/D2 반영 뒤 실행한다.
- D1 리뷰 `ctx_3e5551b708ca`: red0, post-prompt abort 가드를 우회하는 늦은 성공 응답 회귀 테스트 공백 및 문서·주석 stale 2건. 테스트 보강과 주석 수정은 소유 워커, 공통 문서는 지휘자에게 배정. 리뷰 워커 해제 완료.
- A App 안내 최종 리뷰 `ctx_dabe17806bdf`: 초기 hydration/대상 선택 게이트에서 Toaster가 없는 동안 래치를 소비해 안내가 유실되는 P2 발견. 실제 렌더 안내까지 단언하는 회귀와 수정 요청. 리뷰 워커 해제 완료.
- D1 완료: 원본 `1f535898`·`93594f6e`·`704d5407`·`8eb2b3cc` → dev `a8f531b1`·`84657f0e`·`22c8d5e7`·`8795cb78`. 최초 red7→green180, 전체 471 files·9193 passed·2 skipped(exit0), 리뷰 보강 mutation red1→최종 targeted181, typecheck/sync exit0. native prompt signal 전달·late-create cleanup·멱등 destroy 검증. create 자체 즉시 중단 및 실제 모델 연산 중단은 미검증. 리뷰 yellow는 회귀 보강과 문서/주석 정합으로 해소. worker 해제, tracked clean/git cherry `+`0 확인.
- A 완료: 원본 `73257206`·`ab9cada8`·`f8dc5d69`·`2a4668e5`·`89787c02` → dev `2661c022`·`b3dc93fd`·`0d5e9794`·`cd4c3f73`·`1c72c606`. 최초9/복구5/동일 reorder1/실 알림2 red→green. 최종 전체 473 files·9218 passed·2 skipped(exit0), typecheck/sync/i18n21 exit0. store 재리뷰100, App 최종 재리뷰11 및 실제 Sonner StrictMode 보조 하네스 통과. Toaster를 AppContent보다 앞서 상시 마운트해 초기 안내 유실 해결. 실제 Chrome 다중 창/픽셀 및 문서 reload 후 알림 재생은 검증 범위 밖. worker 해제, tracked clean/git cherry `+`0 확인.
- A/B/C/D1 통합본 root typecheck/sync exit0, `pnpm test --maxWorkers=2 --minWorkers=1` exit0: 473 files·9227 passed·2 skipped(81.97s). D2는 한국어 정책 답변 대기이며 아직 구현·최종 push·CI·확장 빌드를 실행하지 않았다.

## D2 재개 — 한국어 출력 요구 확정

사용자: “한국어로 출력을 받아야하는 경우, 그렇게 출력이 되어야 함”. 영어 대체 성공은 금지하며, Chrome이 지원하지 않는 요청 언어는 생성·다운로드를 막고 외부 AI 연결을 안내한다. 정책 질문은 해소됐으며 기존 전체 수정 승인으로 D2를 재개한다. D1 취소 수정과 A/C 통합을 유지한다. 지휘자는 계획·문서, D2 워커는 제품 코드·테스트를 소유한다.

D2 dispatch: `ctx_0d3ab13d3046`, task `task_fbdfacee79c7`, terminal `term_d6b44dd4-2893-46fa-ac6a-8583a5edf784`. 시작 `c6d1d885`. 현재 체크아웃 배치로 잘못 시작했으나 제품 수정 전에 워커가 별도 child `/Users/sinhyeokkang/orca/workspaces/bugshot-2/audit-chrome-ai-d2` (`SinhyeokKang/audit-chrome-ai-d2`)를 생성해 수정 위치를 바로잡았다. 기존 root env는 보존한다. Codex 기본 설정 상속; worker-read 관측 모델 `gpt-6-astra`, effort 미노출.

### D2 검증 1차

- 구현 `e2741164`, 선행 red `fefd81ca`. 전체 476 files/9251 passed/2 skipped, typecheck/sync/i18n21 exit0. 관련 366건 통과.
- UI/security `ctx_c7545e4cdf05`, dataflow/codehealth `ctx_73e2840122bf` 독립 검수. dataflow 검수는 보고 확인 후 release. 두 관점 모두 지원 언어 en→ja 전환 중 native 준비가 중복되는 P2를 발견했다. dataflow는 readiness checking 중 native 재현 응답이 먼저 끝나면 결과가 버려지는 역순 완료 P2도 발견했다. 구현 워커에 red→green 회귀 수정 요청.
- 브라우저 mock은 다운로드→진행→준비→초안 생성, 실패/재시도/탭 재진입, ko/ja 안내를 통과했다. 확대400px의 기존 min-width/scrollbar와 테스트 단언 범위는 UI 검수로 재확인 중이다. 실제 모델을 검증했다고 주장하지 않는다.
