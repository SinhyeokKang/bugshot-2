# 다중 요소 캡처 — orchestration

## 범위와 기준

- 계획 원본: [PRD](./prd.md), [설계](./design.md), [태스크](./tasks.md).
- 시작 dev: `3274f95fcea8e64d91bf1790f8f0f3db0f918492`.
- 사용자 승인: 전체 feature와 리뷰 7건 반영, `/orchestrate`로 구현·검증·dev push·해당 SHA CI 확인.
- 종료: origin/dev와 로컬 HEAD 일치, 해당 ci.yml의 verify/e2e-gate green. merge/deploy 없음.
- 지휘자는 코드 수정 금지. 코드는 소유 워커, 계획·브리프·통합·문서 신선도는 지휘자.

## 결정 기록

- 같은 요소도 새 캡처 ID로 누적; 마지막 이미지 삭제 금지; 이미지 우상단 직접 액션.
- 추가 취소/실패·quota 경합·navigation에서 기존 자료 보존; Blob은 버전별 불변 슬롯.
- 다른 페이지에서 추가 거부 및 원점 복귀 안내. 스크롤/포커스 복귀와 낮은 이미지 여백 확보.
- 별도 새 제품 결정 없음. 런타임과 테스트의 결정적 검증을 구분한다.
- Orca CLI `/usr/local/bin/orca`, Codex 패밀리만. 모델/effort는 사용자 설정 상속: 버전별 Orca 가이드가 사용자 명시 없는 모델 override를 금지하므로 flags를 생략한다. 불변식이 무거운 구현과 독립 리뷰 모두 같은 설정을 유지한다.
- 기존 미추적 `.scratch/`는 내용 변경/커밋 없이 `.git/info/exclude`로 로컬 제외. 새 인계도 이 경로 사용.
- A는 새 배열 API를 구축하되 소비처가 연결되기 전 기존 최초 캡처 동작을 유지한다. 전체 배열 활성화는 C에서 완성한다. 임시 사용자 설정/기능 플래그는 추가하지 않는다.

## 배치와 소유권

| 배치 | 계획 항목 | 소유 파일 | 선행 | 모델/effort | 검증 | 상태 |
|---|---|---|---|---|---|---|
| A core | Task 1–3 | types/element-shot.ts, lib/elementShots.ts·elementShotBudget.ts, editor/issues/blob stores, picker-control, usePickerMessages, useEditorSessionSync, liteSnapshot, useIssueImages, background tab-bindings/index, 해당 테스트 | 없음 | Codex 사용자 기본값 상속 / 동일; 저장 불변식 집중 | typecheck/test/sync, 독립 리뷰 | 실행 중 |
| B viewer | Task 6 중 로그 뷰어 계약 | types/log-viewer.ts, log-viewer/**, lib/buildLogsHtml.ts 및 해당 테스트 | 없음 | Codex 사용자 기본값 상속 / 동일; 하위호환 | typecheck/test/sync, 독립 리뷰 | 통합 완료 |
| C flow | Task 4–6 나머지 및 노출 e2e | DraftingPanel/IssueTab/PreviewPanel/DraftDetailDialog/AiDraftDialog, ElementShotMedia, buildEditorCapture/buildMarkdownContext/buildReportData/buildCaptureFiles, submissionRecovery/uploadPayload/submissionAdapter/submitTo*, i18n, 해당 테스트와 e2e. A/B 계약 소비에 필요한 변경은 선행 통합 후만 | A+B 통합 | Codex 사용자 기본값 상속 / 동일; UI부터 복구까지 | typecheck/test/sync, e2e 연속 통과, 독립 리뷰 | 예정 |
| D validation | Task 7 | e2e 보강, guide ko/en 및 assets 계획, 가이드 문서 | C 통합 | Codex 사용자 기본값 상속 / 동일; 출력 검증 | e2e/가이드 대칭, 독립 리뷰 | 예정 |
| R runtime | 모든 인계의 비결정적 항목 | 주 체크아웃 dist에서 read-only 검증, guide-shots 자산만 | A–D 통합 + build | Codex 사용자 기본값 상속 / 동일 | 수동 픽셀·iframe·좁은 패널, 이슈 라우팅 | 예정 |

핫스팟 소유: stores/background는 A→C 순차, UI i18n은 C, log-viewer 사전은 B→C 순차. 메시지 union 신설 없음. bundleBoundary/locale wrapper/coverage 목록은 필요 시 담당 배치가 정확한 이유를 인계한다. ARCHITECTURE/DIRECTORY/DESIGN/POSTMORTEM은 워커 제안만 받고 지휘자가 통합 시 문서별 커밋한다. 워커는 원본 계획과 orch.md를 수정하지 않는다.

## 겹침 행렬과 순서

| 조합 | 파일 겹침 | 실행 |
|---|---|---|
| A/B | 없음 | 병렬 |
| A/C | stores·picker·이미지 로더의 계약 연결 가능 | A 통합 후 C |
| B/C | buildLogsHtml·log-viewer 타입 소비 | B 통합 후 C |
| C/D | e2e·가이드 | C 통합 후 D |
| R/통합 | dist와 소스 일치 필요 | R 종료 전 cherry-pick/build 금지 |

A/B 완료→독립 리뷰→수정→통합 게이트→C→리뷰/통합→D→리뷰/통합→push→build→R→결함은 소유 워커 수정→최종 push와 CI 확인→정리.

## 워커 공통 계약

브리프는 파일로 읽는다. 별도 Orca worktree는 로컬 dev에서 생성. 첫 명령 `pnpm install --frozen-lockfile`. `/ship bypass`는 step 11 커밋까지만 수행; push/build/merge/deploy/sync 금지. `.env.local` 필요 시 `.env.ci`만 복사. 게이트 출력 파이프 금지, 종료 코드 기록. `.scratch/handoff-<batch>.md`에 커밋·검증·설계 차이·미완·실런타임 항목을 남기고 live dispatch의 worker_done을 한 번 전송한다. 단위/e2e로 검증 가능한 것은 런타임으로 미루지 않는다.

## 진행·증거

- 인테이크: dev, 추적 변경 없음, 설계 커밋 2개는 아직 origin/dev보다 앞섬.
- Run/Dispatch, 리뷰 라운드, 통합 해시, 게이트·CI·런타임 결과는 진행 시 이 절에 기록한다.

- Run: `run_73eb56bede49`; coordinator `term_0c57b1ff-ecc8-4b5c-8629-a93a46f95f50`.
- A: task `task_f2b629ea3550`, dispatch `ctx_40412b8a5db7`, worktree `/Users/sinhyeokkang/orca/workspaces/bugshot-2/mec-core`, handle `term_240e9fb1-edaa-48a5-ac34-edc5ee8d6e37`.
- B: task `task_800c7a5b5766`, dispatch `ctx_9e149baaebcd`, worktree `/Users/sinhyeokkang/orca/workspaces/bugshot-2/mec-viewer`, handle `term_727a8884-f903-440d-92c9-0c311c1a0446`.
- Runtime 사전 제약: manual-smoke 스킬은 Codex에서 Aside 특권 브라우저 능력 부재 시 실행 불가, guide-shots는 stale 탐지만 허용한다. 최종 단계에서 허용된 범위와 미검증을 분리해 보고하며 e2e 결과로 실사이트 관측을 대체하지 않는다.

- B 경계 확장 승인: `sidepanel/lib/aiLogsManual.ts`와 exhaustive schema 테스트는 screenshots 계약 동반 수정으로 B 소유. 프롬프트 생성 동작 변경 없음.
- Orca nested depth 1 제한으로 구현 워커의 하위 리뷰 생성이 거부됨(effectsApplied=false). 권한/설정을 바꾸지 않고 지휘자 깊이에서 독립 리뷰를 생성한다. 구현 워커 자체 검토와 독립 리뷰를 별도로 기록한다.
- A API 결정: 기존 confirmDraft boolean 소비처 회귀를 피하려고 배열 전용 `confirmElementShotDraft(): Promise<boolean>`를 제공하며 C가 적절한 분기를 await한다. 최종 배열 단일 출처 규칙은 유지한다.

- B 구현 1차: `2ec78d17`, `5ae277be`, `e3f053f8`; 477 test files / 9261 pass / 2 skip, typecheck·mirror exit 0. 최초 Jira config_missing는 .env.ci 적용 후 해소.
- B 독립 리뷰 `ctx_6542ca1fd095`: red 0 / yellow 2 — 낮은 이미지 overlay 침범, 결정적 목록 기하 검증 누락. 동일 viewer 워크트리 수정 라운드에 e2e/logview 소유를 추가했다. 원 구현·리뷰 터미널은 settlement 확인 후 release 완료.
- C task `task_0fec19836284` (A/B 의존), D task `task_13b692686e6b` (C 의존). 시작은 선행 리뷰·dev 통합 완료 후 지휘자가 명시 수행한다.

- B 수정/재리뷰: `96313de9`, `86d1e0eb`; 독립 `ctx_b26223be9765` red 0/yellow 0. 최초 start 응답 outcome_unknown은 live 확인 후 재시작 없이 기다려 정상 settlement; 리뷰 터미널 release 완료.
- B 통합: `9d7e2b90`, `4516def8`, `c66213f8`, `b543e77b`, `3b02e300`. 지휘자 통합 게이트 typecheck/test/sync exit 0, 477 files / 9262 pass / 2 skip. 워커 브라우저 4/4 두 번 연속 통과, build:e2e exit 0.
- B 계약: buildLogsHtml 마지막 optional screenshots 배열(명시 빈 배열 포함)이 legacy screenshot보다 우선하며 legacy bytes를 중복 싣지 않는다. 단일 contain·다중 세로 목록·영상 우선. C가 최초로 live/saved/submission 소비처를 연결한다.
- B 문서 트라이아지: DIRECTORY/ARCHITECTURE/CI/POSTMORTEM 갱신. 현재 기존 생산 호출은 배열 미전달이므로 README/guide의 기존 동작 설명은 유지; 사용자 다중 캡처 가이드는 C 이후 D 소유. 신규 수집·저장·전송 호출/권한 변경 없음. 전체 기능 privacy 검토는 A/C 통합 시 수행.
- B 회고 형식 검사 exit 0; 컴포넌트×미검증단언 25건, e2e×미검증단언 16건 반복 축. 실제 디코딩·기하 단언으로 보강.

- B 중간 push `8642988f`: CI https://github.com/SinhyeokKang/bugshot-2/actions/runs/40437114059 verify 성공, e2e 3번 실패. 실패는 기존 `repro-prefill.spec.ts:90`의 opt-out 재열기 영속 단언(checked로 복귀), 재시도도 동일. B viewer 파일과 직접 겹치지 않아 CI 보수 배치 E를 새 워커에 배정한다. 소유권은 해당 e2e spec과 관련 독립 테스트로 한정하며, 생산 저장소/fixture 변경 필요 시 A/C와 겹침 검토 후 허용한다. 독립 리뷰와 동일 게이트를 거친다.
- B 워크트리: tracked clean·git cherry에 + 0 확인, 인계 보존 후 Orca 제거 완료.
