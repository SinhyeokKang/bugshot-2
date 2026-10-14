# 코드 감사 후속 오케스트레이션

## 범위와 권한

- 원본: [report.md](./report.md). 검증된 A01–A08 전부.
- 시작 dev: `50558ad7abb65a1e17971024d72120b06dcf8a75`.
- 사용자 지시: `$orchestrate orch 세션으로 진행하자.`
- Run: `run_085e5d05abf9`. 지휘자는 코드 수정 없이 브리프·리뷰·통합·문서·push를 담당한다.
- 종료: 원격 dev와 최종 HEAD 일치, 해당 SHA의 verify/e2e-gate 성공. main 병합·배포 제외.

## 결정 기록

- A01은 신원뿐 아니라 재연결 grant 세대를 구분한다. Jira의 세대 필드 부재를 설계에서 다룬다.
- A03은 background writer와 패널 persist 모두 대상으로 한다. 로컬 큐만 추가하는 수정은 불충분하다.
- A02는 복구한 로그를 파일과 본문 요약 모두에 반영한다. 로그 off 및 element 모드 게이트를 유지한다.
- A04는 저장 초안의 마지막 첨부 삭제를 포함한다.
- UI 변경은 기존 레이아웃·번역 체계를 유지한다. 추가 제품 결정은 현재 없다.
- 모델/effort는 모든 워커에서 사용자 Orca Codex 설정을 상속한다. 인증·독립 리뷰에는 충분한 추론이 필요하지만 사용자가 모델을 지정하지 않았으므로 CLI 가이드에 따라 override하지 않는다.
- 공용 문서와 coverage baseline은 지휘자 단독 소유. 워커는 변경 제안·회고 초안을 handoff에 남기고 직접 수정하지 않는다.

## 배치와 소유권

| 배치 | 항목 | 소유 파일 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| AUTH | A01·A03 | settings-storage, settings-store, 인증 refresh/OAuth/type, 전용 storage adapter·sync, 관련 테스트 | 인증 설계·검수 | grant 교차 요청 금지, 다중 writer 보존, 전체 게이트 | 설계 초안 완료·검수 미실행 |
| CAPTURE | A02·A04 | editor-store, useEditorSessionSync, IssueCreateModal, buildEditorCapture, 관련 테스트/e2e | 없음 | 재개→전송 로그/요약, 첨부 삭제→저장 초안 제출 | 워커 시작 실패·미착수 |
| CONNECT | A05 | background/messages.ts의 notion.testToken, 연결 레인 회귀 테스트 | 없음 | 신규 토큰 401의 전역 만료 이벤트 없음, 기존 인증 만료 유지 | 워커 시작 실패·미착수 |
| VIEWER | A06–A08 | log-viewer ProgressBar/VideoPlayer, SettingsTab, linearFields/PrioritySelect·LinearIssueFields, 관련 테스트/e2e | 없음 | MIME 파일명, 키보드 seek, 표시 라벨 연결 | 워커 시작 실패·미착수 |

AUTH가 messages.ts 변경을 필요로 하면 CONNECT 통합 뒤 rebase하고 진행한다. i18n·메시지 union·공용 scan 목록을 바꿔야 하면 먼저 지휘자에게 파일 소유권을 요청한다.

## 겹침 행렬과 순서

| | AUTH | CAPTURE | CONNECT | VIEWER |
|---|---|---|---|---|
| AUTH | — | 없음 | messages.ts 잠재 겹침(직렬) | 없음 |
| CAPTURE | 없음 | — | 없음 | 없음 |
| CONNECT | 잠재 겹침 | 없음 | — | 없음 |
| VIEWER | 없음 | 없음 | 없음 | — |

1. CAPTURE·CONNECT·VIEWER는 별도 워크트리 병렬. 동시에 지휘자가 AUTH 설계를 확정한다.
2. AUTH는 feature 설계와 독립 검수 후 실행. 공용 파일 겹침은 선행 통합 후 해소한다.
3. 배치별 독립 코드 리뷰, 소유 워커 수정, dev cherry-pick.
4. 통합 typecheck/test/sync 검사, 문서 신선도·회고, /push.
5. /build 1회와 가능한 런타임 검증. 최종 /push 후 정확한 HEAD CI 확인.

## 공통 게이트

- 워커는 `/ship bypass`의 11단계 커밋까지. push/merge/sync/deploy/build 금지.
- `pnpm install --frozen-lockfile`; 필요한 환경은 `.env.ci`에서만 복사.
- TDD red→green, 전문 자체 검증, `pnpm typecheck`, `pnpm test`, `pnpm sync:agents:check` 각각 종료 코드 0. 출력 파이프 금지.
- build:e2e는 /e2e-write 안에서만. 테스트로 판정할 수 있는 항목을 수동 검증으로 미루지 않는다.
- `.scratch/handoff-<batch>.md`: 커밋, 종료 코드, 계획 차이, 문서/가이드/회고 초안, 미완·실 외부 서비스 검증 한계.
- 완료는 Orca Dispatch의 worker_done으로만 인정. 인계 증거를 확인 후 즉시 리뷰/수정 작업으로 재사용하거나 release한다.

## 진행·검증 증거

- 재개(2026-10-14, 두 폴더 명시 호출): 시작 dev `1aa1243bc2953405400e60b90cbfa9253c9ab412`. 감사 전체와 AUTH 설계 폴더를 함께 범위로 확인했다. 기존 Run을 재바인딩했고, 이전 워커는 모두 failed이며 소유 터미널은 released다. 사용자 재개 지시에 따라 기존 Task와 최신 실패 Dispatch를 유지한 공식 retry를 사용한다. 모델·effort는 사용자 설정 상속, 기존 소유권과 검증 순서 유지.
- 이번 재개 결과: CONNECT `ctx_2e3f31541a7f`·VIEWER `ctx_9a4bef9706cd`는 `agent_readiness: timeout`, CAPTURE `ctx_c279e8ab58f7`는 `agent_readiness: terminal_handle_stale`로 종료 코드 1. 모두 `mode=terminal`, `reason=user_default`. Task 프롬프트 실행 전 실패했다. 공식 worker-release가 모두 released/closed_agent_terminal 및 archive captured를 반환했다. 세 워크트리의 미커밋 변경과 dev 미통합 커밋이 없음을 확인했다. AUTH 검수·구현·테스트·빌드·push·CI는 미실행이며, 워커 준비 경로 복구 전 동일 조건 재시도를 중단한다.

- 초기 상태: dev clean. 감사 기준 이후 프로덕션 코드 차이 없음.
- 계획 커밋: `8cb79a36`. AUTH 설계 초안: `77c41393`, [설계 폴더](../codebase-audit-auth-2026-10-14/). `/feature` 형식으로 작성했으며 feature-review CTO·QA는 아직 미실행이다.
- 2026-10-14 Orca 1.4.224 기본 launch mode가 terminal이며 새 워커 3개 모두 `agent_readiness: timeout`. 작업 프롬프트 미실행.
- CAPTURE: task `task_ff474320cef2`, 최초 dispatch `ctx_ec9d312f1a44`, 기존 터미널 재사용 retry `ctx_3824b3ea9669`도 동일 timeout.
- CONNECT: task `task_bc7493c069b2`, dispatch `ctx_889a6e8650c6`, 준비 실패 후 worker-release 완료.
- VIEWER: task `task_d99e30aa6a25`, dispatch `ctx_cd11ce33100a`, 준비 실패 후 worker-release 완료.
- 모든 구현 배치 미착수. 프로덕션 수정·테스트·빌드·push·CI 미실행. AUTH 설계는 검수 전 초안이다.
- 사용자에게 네이티브 세션 기본값 변경 후 재시도 또는 터미널 준비 감지 복구를 요청했다. CLI worker-start에는 launch mode override가 없다. 임의 설정 변경·권한 우회는 하지 않는다.
- 재개 시 같은 Run/Task에서 마지막 실패 Dispatch를 `--retry-of`로 지정하고 현재 dev에서 워크트리를 준비한다. 새 Run으로 실패 이력을 우회하지 않는다.
- 워커 브리프는 main 체크아웃 `.scratch/brief-{capture,connect,viewer}.md`에 있다. 감사 구현 권한·소유권·게이트·커밋 제한을 포함한다.
- 재개(2026-10-14): 사용자 지정 폴더의 전체 배치를 같은 Run으로 재개한다. 재개 dev는 `948a8a0b`. 기존 워크트리는 제거되어 새 워크트리를 현재 dev에서 만든다. CAPTURE 최신 실패는 `ctx_78c857d568a8`이며 총 3회 준비 실패이므로 circuit breaker를 우회하지 않는다. CONNECT·VIEWER는 각 기존 Task의 실패 Dispatch를 지정해 재시도하고, CAPTURE는 공식 복구 응답에 따라 처리한다.
- 재개 결과: 같은 Task의 `--retry-of`로 세 시작 요청 모두 접수됐지만 `agent_readiness: timeout`으로 종료 코드 1. CONNECT `ctx_ab20f821e1d7`, VIEWER `ctx_1c2193a8ce93`, CAPTURE `ctx_25c7f617726e`. 모두 `mode=terminal`, `reason=user_default`; 작업 프롬프트는 실행되지 않았다. CONNECT·VIEWER의 출력에는 Codex v0.154.0 입력 화면과 plugin hooks의 `unknown field modules` 경고가 보였으나, 경고가 준비 감지 실패 원인인지는 미확정이다.
- 실패 응답의 공식 `worker-release`를 실행해 세 터미널 종료 및 출력 아카이브를 확인했다. 세 워크트리 모두 `git status --porcelain`과 `git cherry dev HEAD`가 비어 있음을 확인한 뒤 제거했다. 재개에서도 구현·설계 검수·테스트·빌드·push·CI는 미실행이다. 동일 조건의 추가 재시도는 하지 않는다. Orca 워커 준비 감지 복구가 필요하다.

## 대체 머신 재개 (2026-10-14)

- 사용자: 기존 머신 장애로 현재 머신으로 이동했으며, 새 Run으로 진행을 명시 승인했다. 로컬 dev를 origin/dev `38156c2a`로 hard reset한 뒤 시작한다.
- 현재 Run: `run_001caa6dc623`. 기존 Run `run_085e5d05abf9`는 현재 런타임에서 run_not_found이며 기존 실패 이력은 위에 보존한다.
- 배치·소유권·겹침 행렬·검증 게이트는 기존 계획을 유지한다. 모델/effort는 사용자 Codex 설정 상속.
- CAPTURE·CONNECT·VIEWER는 별도 child worktree에서 구현한다. 배치별 커밋 및 테스트 산출물(dist-log-viewer/dist-e2e)이 서로 덮이지 않도록 격리한다.
- AUTH는 기존 설계에 대한 CTO·QA 독립 검수를 먼저 수행한다. 검수는 현재 체크아웃 읽기 전용이며 보고서는 배치별 .scratch 경로에만 쓴다.
- 지휘자는 전체 배치의 리뷰·문서·통합·push·정확한 HEAD CI를 담당한다. 상태: 재개 준비 완료, 구현/검수 미착수.

### 현재 머신 Dispatch

| 작업 | Task | Dispatch | 상태 |
|---|---|---|---|
| CAPTURE | task_4e289b5d8979 | ctx_f4baaa05287b | ready·turn_started 확인 |
| CONNECT | task_41c84982077c | ctx_954a0e973061 | ready·turn_started 확인 |
| VIEWER | task_d839fe41bf00 | ctx_dadb6295048a | ready·turn_started 확인 |
| AUTH CTO 검수 | task_f3765e723a6c | ctx_e0a5e405716c | ready·turn_started 확인 |
| AUTH QA 검수 | task_2df121e1fce5 | ctx_1ca23de97039 | ready·turn_started 확인 |

CTO 최초 ctx_bedb656f6e6d는 agent_readiness/terminal_handle_stale로 실패했고 worker-release로 정리했다. 같은 Task의 공식 retry는 성공했다. 모든 모델/effort는 사용자 설정 상속이며 실행 모드는 terminal이다.

### AUTH 검수 결정

- CTO 심각 3/권장 3, QA 심각 4/권장 2를 기술 계약 보완으로 수용했다. 새 제품 결정은 없으며 기존 구현 승인 범위에서 grant 승격·명시적 account/prefill intent·pending/ack/hydration/migration 상태 전이와 테스트 모델을 design/tasks에 명시했다.
- 파일 겹침 변경: AUTH가 IssueCreateModal/DraftDetailDialog의 grant/prefill 배선도 소유한다. **AUTH는 CAPTURE와 CONNECT 통합 뒤 직렬 착수**한다. VIEWER와는 독립이다.
- Orca nested depth=1로 하위 전문 에이전트는 실행 불가. CTO·QA 직접 독립 검수는 완료했고 구현 전문 리뷰는 지휘자 소유 별도 Dispatch로 수행한다. 미할당 보조 터미널 5개는 소유 워커가 확인 후 정리했다.

### CONNECT 통합

- 원본 acc17229·298e64b6 → dev 9243a4ab·201d05e9. 신규 토큰 2건 red 후 57개 대상·8629개 전체 테스트 green, typecheck/sync exit 0. 독립 Security/DataFlow/CodeHealth/CTO 지적 0.
- 첫 전체 테스트의 기존 Jira env 누락은 .env.ci 더미 적용 후 해소했다. 프로덕션 빌드·외부 Notion 호출은 하지 않았다. 추가 런타임 전용 검증 없음.
- ARCHITECTURE 연결 레인 설명과 POSTMORTEM을 갱신한다. guide/README/privacy/PERMISSION/CI/CLAUDE/DIRECTORY 변경 불필요(기존 동작 복구, 새 파일은 테스트뿐).

- CONNECT 통합 검증: pnpm typecheck / pnpm test / pnpm sync:agents:check 모두 exit 0, 441파일·8629테스트 통과(2 skip). postmortem:check/report exit 0.

### CAPTURE·VIEWER 통합 / AUTH 착수

- VIEWER be0f9437·99dcecaf·ce54628b → dev 5488a849·c49b2b7d·0ca08095. 독립 검수의 어두운 테마 focus 대비 지적을 수정했고 키보드 seek·ARIA·양 테마 대비 e2e 6개를 두 번 통과했다. 마지막 전체 테스트 8633 통과(2 skip), typecheck/sync exit 0. 첫 실행의 기존 SlackConnectForm 타이밍 실패는 코드 변경 없이 재실행해 통과했다.
- CAPTURE 4d764fc9·5d1945e1 → dev ed29fdc6·1631a039. 복구 owner/취소·빈 첨부 metadata 회귀와 실제 제출 body/logs.html 출력까지 검증했다. 독립 CTO 최종 PASS, 전체 8644 통과(2 skip), typecheck/sync exit 0.
- dev 통합 게이트: pnpm typecheck / pnpm test / pnpm sync:agents:check 모두 exit 0. 445파일·8658테스트 통과(2 skip).
- AUTH 설계 CTO 최종 READY·QA READY. 연결 후보 문맥 및 durable grant 분리 계약까지 승인됐다. CAPTURE/CONNECT 통합 선행 조건을 충족했으므로 현재 dev에서 AUTH A01+A03 구현을 시작한다. 지휘자가 별도 전문 리뷰 Dispatch를 담당하며 nested worker는 만들지 않는다.

- AUTH 구현: task `task_69e2efda9102`, dispatch `ctx_2c1ff996a303`, child `audit-1014-auth`, ready/turn_started 확인. 코드 기준 1631a039, 최신 통합 증거 e488d9d8는 별도 전달했다.
- AUTH 소유권 보완: Jira 저장 전 후보 프로필 조회에서 갱신 인증을 최종 연결로 전달해야 하므로 `jira.myself` 요청·응답 타입과 `messages.ts` 해당 핸들러·연결 호출부·테스트의 좁은 변경을 허용한다. 신규 메시지보다 기존 메시지의 명시적 후보 문맥을 우선하며, 연결 중 갱신 결과를 반환해 connect/replace에 실어야 한다. CONNECT의 Notion 오류 레인은 유지한다. 다른 배치는 통합·종료돼 파일 충돌이 없다.
- AUTH 중간 검수는 읽기 전용 두 Dispatch로 나눈다: grant/egress/후보 연결(Security·CTO), 설정 transaction/pending/rehydrate/제출 prefill(DataFlow·CTO). 구현 워커가 테스트를 보완하는 동안 구조적 결함을 먼저 전달하고, 최종 커밋과 gate 완료 후 변동분·지적을 재검수한다. 중간 결과는 최종 승인으로 간주하지 않는다.
- AUTH 중간 지적을 수정 라운드로 전달했다: Jira 미디어 GET/HEAD 재시도의 grant 재확인, 같은 후보 grant의 공유 refresh 대기자마다 갱신 결과 전달, Notion 비동기 schema callback의 시작 인증을 accountPatch에 전달. 마지막 항목의 NotionConnectForm·관련 테스트도 AUTH 소유로 포함한다. 모두 기존 승인 계약의 구현 누락이므로 새 제품 결정은 없다. 검수 Dispatch는 grants `ctx_2bad27d9bf75`, settings `ctx_a436e15b7239`다.
- CONNECT push `023fa08e` CI [38492124085](https://github.com/SinhyeokKang/bugshot-2/actions/runs/38492124085): verify·4개 e2e 샤드·e2e-gate success.
- CAPTURE/VIEWER 문서 트라이아지: ARCHITECTURE의 복원/제출·빈 첨부·탐색 계약, ko/en 뷰어 가이드, e2e/COVERAGE와 CI 테스트 수, POSTMORTEM 3건 갱신. DIRECTORY는 테스트 디렉터리 단위 설명이라 새 개별 테스트 열거 불필요. CLAUDE/README/PERMISSION/privacy는 기존 동작 복원과 접근성 배선이며 새 수집·저장·전송 목적이 없어 변경 불필요. 평상시 화면은 동일하고 focus는 키보드 상태이므로 스크린샷 교체는 최종 guide-shots에서 판정한다.

### AUTH 통합과 최종 검증

- AUTH 원본 38aeb1b3·b6dd4f2b → dev 0827f5a3·2c45682d. grant별 요청/refresh 격리, 명시적 후보 연결, 공통 설정 transaction과 pending intent, 출발 인증에 묶인 제출 prefill·Notion schema patch를 구현했다.
- 초기 전문 검수의 Jira 재시도·공유 후보 결과·Notion 늦은 patch 결함을 red로 재현 후 수정했다. 기존 writer 단언, 실제 onChanged·migration 경쟁, stale hydration·pending read/lock 실패, 다섯 제공자의 동시 다른 grant·실패 flight 정리까지 보완했다. 잠금 제거 mutation은 red다.
- 최종 독립 검수 grants `ctx_66e95d3e0ed7`·settings `ctx_15f550d38bef` 모두 PASS, 잔여 지적 0. 각각 최종 192개 대상 테스트를 독립 실행했다. 소유자 전체 452파일·8731개 통과(기존 2 skip), typecheck/sync exit 0.
- 테스트 도구 실패도 분리 기록한다: 검수용 .test.ts 복사본이 .scratch에서 수집돼 실패한 실행은 무효이며 복사본을 저장소 밖으로 옮겼다. 기존 editor-store 테스트의 누락 onStateSaveFailed mock은 한 줄 보완을 허용했고, assertion 변경 없이 최종 전체 gate를 통과했다.
- dev 통합 후 pnpm typecheck / pnpm test / pnpm sync:agents:check 모두 exit 0, 452파일·8731개 통과(2 skip). CAPTURE/VIEWER push `360e08c6` CI [38493044674](https://github.com/SinhyeokKang/bugshot-2/actions/runs/38493044674)도 verify/e2e-gate success다.
- AUTH 문서 트라이아지: ARCHITECTURE·DIRECTORY·PERMISSION·POSTMORTEM 갱신. CLAUDE는 해당 세부 구현을 직접 서술하지 않아 원본 수정 불필요. privacy ko/en의 로컬 자격증명·연동 설정 저장 설명과 대조했으며 grant 메타·원자적 쓰기는 기존 목적 안이므로 새 수집·외부 전송 문구/시행일 변경 불필요. README·가이드 연결 절차와 권한은 동일하다. e2e 개수는 83파일·400개로 유지한다.
- 실 제공자 동의·로그인·Chrome identity 리다이렉트는 실제 계정이 없어 미검증이다. 저장·grant·동기화·메시지·prefill 경쟁은 이 한계로 미루지 않고 결정적 테스트로 검증했다. 전체 build 및 가능한 런타임 점검 후 최종 push/정확한 HEAD CI를 확인한다.
