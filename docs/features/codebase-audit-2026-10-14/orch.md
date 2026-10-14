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
| AUTH | A01·A03 | settings-storage, settings-store, 인증 refresh/OAuth/type, 전용 storage adapter·sync, 관련 테스트 | 인증 설계·검수 | grant 교차 요청 금지, 다중 writer 보존, 전체 게이트 | 설계 대기 |
| CAPTURE | A02·A04 | editor-store, useEditorSessionSync, IssueCreateModal, buildEditorCapture, 관련 테스트/e2e | 없음 | 재개→전송 로그/요약, 첨부 삭제→저장 초안 제출 | 대기 |
| CONNECT | A05 | background/messages.ts의 notion.testToken, 연결 레인 회귀 테스트 | 없음 | 신규 토큰 401의 전역 만료 이벤트 없음, 기존 인증 만료 유지 | 대기 |
| VIEWER | A06–A08 | log-viewer ProgressBar/VideoPlayer, SettingsTab, linearFields/PrioritySelect·LinearIssueFields, 관련 테스트/e2e | 없음 | MIME 파일명, 키보드 seek, 표시 라벨 연결 | 대기 |

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

- 초기 상태: dev clean. 감사 기준 이후 프로덕션 코드 차이 없음.
- 구현·리뷰·통합·CI: 미실행.
