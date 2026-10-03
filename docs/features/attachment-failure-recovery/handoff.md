# Claude Code 인계 — attachment-failure-recovery

## 중단 상태

2026-10-04 KST 사용자가 Codex 작업 중단, 모든 작업 워크트리 회수, Claude Code 인계를 지시했다. **자동 재개하지 않는다.** B6는 미완·미리뷰이며 B7–B9는 착수하지 않았다. 실행 중이던 B6 구현 워커와 남아 있던 B3/조사 워커 터미널을 모두 종료했고, 주 체크아웃 외 작업 워크트리는 제거했다. 미완 소스는 아래 로컬 브랜치와 bundle에 보존했다. 미완 코드를 dev에 통합하거나 원격에 push하지 않았다.

작업 위치: `/Users/sinhyeok/code/bugshot-2`, 브랜치 `dev`. 기준 계획은 [prd.md](./prd.md), [design.md](./design.md), [tasks.md](./tasks.md), 전체 실행 이력은 [orch.md](./orch.md).

## 완료된 1단계와 배포

- Tasks1–8의 코드·자동 검증·독립 리뷰 완료. PR [#247](https://github.com/SinhyeokKang/bugshot-2/pull/247)을 squash 머지했다.
- main / origin/main / 배포 태그 `v1.7.46`: `eca47ebaa712b67516ce21a46a82e64f9164ba0e`.
- dev는 내용 동일성을 확인한 뒤 위 main으로 동기화했다. 현재 로컬 dev에는 배포 완료·B6 착수·인계 문서 커밋이 추가돼 있다.
- 버전은 사용자 명시 지시로 **patch 1.7.46**. 이전 minor1.8.0 언급은 폐기됐다.
- [Release 초안](https://github.com/SinhyeokKang/bugshot-2/releases/tag/untagged-13b83d770efe4be081db), asset `bugshot-v1.7.46.zip` 4,249,801 bytes. 로컬 파일은 저장소 루트에 있다. SHA256 `75d771af989bd85f272ba9d6888870aaa78af7adc5e73934d68611158a56fd77`.
- 스토어 빌드 exit0, manifest1.7.46 및 dev key 부재, ZIP 무결성 확인 완료. **스토어 업로드·심사 제출·GitHub Release 공개는 하지 않았다.** `/deploy` 규칙에 따라 사용자 수동 단계다.
- PR의 verify·4개 E2E 샤드·e2e-gate 모두 성공. 동기화된 dev의 [CI37138600081](https://github.com/SinhyeokKang/bugshot-2/actions/runs/37138600081)도 성공했다. 이후 로컬 인계 문서는 push하지 않았다.

### 검증 근거와 남은 한계

- Root typecheck / 전체 단위·DOM8141 passed, 2 skipped / mirror / 별도 locale20 모두 직접 exit0. Playwright discovery351tests81files.
- 독립 main browser40cases ×2 =80passed, native Web Locks·focus·quota·layout7cases 두 번 및 독립 재실행 통과. B5 acceptance와 CTO PASS.
- 커버리지 실행 통과: 로직92.3%(+1.3pp). `submitToClickup.ts`100→99% 하락이 있어 baseline은 갱신하지 않았다.
- 실제 provider 업로드·원격 렌더링·GitHub MAIN-world 실탭 업로드·OS crash/eviction·물리 픽셀/AA는 미검증. 실제 업로드0.
- Ego TaskSpace7에는 FROM_STORE1.7.45만 있고 UNPACKED 확장은 없었다. 새 recovery detail `integrations-issue-tracking-3` 및 video completion `video-issue-6`의 ko/en4장은 placeholder다. 사용자 중단/인계이므로 TaskSpace7은 finish하지 않고 보존했다. 후임은 새 space를 중복 생성하지 말고 필요 시 같은7을 재개한다.
- 확인/로컬 삭제로 복구 행 버튼이 사라진 뒤 포커스는 connected BODY로 간다. 일반 Close/Escape는 남아 있는 버튼으로 복귀한다. 독립 리뷰에서 비차단 한계로 기록했다.

## B6 미완 작업 보존 및 복원

| 항목 | 위치 / 값 |
|---|---|
| 보존 브랜치 | `handoff/attachment-recovery-b6` |
| 기반 dev | `fd4e8ab1c59a4290f46fd09bfac0d9f3899c43f6` |
| 테스트 우선 커밋 | `0306918382d47d54f72d13a96f114d0975a0a6e8` |
| 중단 시 WIP 스냅샷 | `c14ad183d472edde00a9b6e66e158abc1a49662d` |
| 추가 보존 원래 브랜치 | `SinhyeokKang/attachment-recovery-b6` |
| bundle | `.scratch/attachment-handoff-20261004/b6.bundle` (verify 통과, 기반 커밋 필요) |
| 로그·조사 사본 | `.scratch/attachment-handoff-20261004/b6-evidence/` |

후임이 작업을 재개할 때 별도 checkout에서 위 보존 브랜치를 열거나, 현재 dev 기반 새 작업 브랜치에 **두 커밋을 순서대로** 적용하면 된다. 완료된 구현으로 취급하지 말고 먼저 diff·테스트를 검토한다. 현재 dev 원본에는 이 변경이 없다.

```bash
# 재개를 승인받은 후, 후임이 선택한 작업 브랜치에서 실행
# 둘째 커밋은 중단 시 보관본이며 승인된 구현이 아니다.
git cherry-pick 0306918382d47d54f72d13a96f114d0975a0a6e8 c14ad183d472edde00a9b6e66e158abc1a49662d
```

### 마지막 구현 범위

- 테스트3파일: `src/background/__tests__/attachment-retry-api.test.ts`, `src/lib/__tests__/attachment-identity.test.ts`, 기존 `src/store/__tests__/blob-db-recovery.test.ts` 확장.
- WIP11파일: 8플랫폼 background API 모듈, `src/store/blob-db.ts`, `src/types/attachment.ts`, 신규 `src/lib/attachment-identity.ts`.
- 기존 이슈 읽기/GitHub body-only 갱신, Notion child pagination·100개 append, Slack grant/bytes/complete 분리의 기본 API, provider별 locator를 담는 checkpoint/snapshot 타입, IDB attempt/revision 검사 초안이 들어갔다.
- 제안된 저장 API: `initializeAttachmentRetry(issueId, attemptId, snapshot)`(prepared-only), `checkpointAttachmentRetry(issueId, attemptId, expectedRevision, { checkpoint?, bodyPlan? })`(다음 revision 반환). 최종 승인된 공용 계약이 아니라 구현 중 초안이다.
- **남은 B6**: 메시지 union/handler/type map 연결, 검증된 계정 신원 조회·연결, 실제 초기 제출 어댑터의 snapshot/fileCheckpoint 기록, 저장 schema/재시작·expiry·삭제 경계 완결, 전체 회귀·타입·미러 검사, 독립 API/storage 리뷰와 최종 CTO. B7의 retry runner와 3-way patch, B8 UI는 아직 없다.
- 중단 직전 `B6-contract-green.log`에 3파일78tests pass가 있다. coordinator가 해당 프로세스의 직접 종료 코드를 수신하기 전에 중단했으므로 **최종 게이트 통과로 주장하지 않는다**. 전체 테스트·타입·E2E·최종 독립 리뷰는 미실행/미완이다. 초기 red 로그도 함께 보관했다.

### 유지할 계약과 조사 결과

[공식 제공자 계약 조사](./retry-api-research.md)는 소스 수정 없는 조사이며 구현 승인이나 실계정 검증을 대신하지 않는다.

- 초기 제출·reconcile·삭제·unknown 확인·재시도는 같은 `withIssueOperationLock` / `bugshot-submission:<issueId>`를 쓴다. 어댑터 안에서 같은 락을 재획득하지 않는다.
- upload/link/body 성공 locator를 정규화 전에 저장하고 후속 외부 쓰기 전 checkpoint한다. token·signed upload URL·raw response/error는 저장하지 않는다. 업로드 RPC는 파일당1개.
- 초기 identity 조회 실패가 정상 최초 제출을 새롭게 막아서는 안 된다. 검증된 snapshot 없는 항목만 retry를 막고 다운로드를 유지한다. 기존 phase1 기록에 현재 계정을 역으로 채우지 않는다.
- GitHub numeric user ID와 Linear organization ID는 기존 권한으로 조회 가능한 공식 응답이 있다. 현재 저장 필드 누락을 API 불가로 오분류하지 않는다.
- Notion 최신 `/users/me`의 `bot.workspace_id`는 고정2022-06-28 응답에서 확인이 필요하다. API 버전·scope를 임의 확대하지 않는다. append 응답 block ID가 없고 파일 동일성을 확인할 수 없으면 재append하지 않는다. nullable expiry만으로 목표 page 연결을 단정하지 않는다.
- Slack complete는 한번만 가능하며 응답 유실뿐 아니라 `internal_error`/`fatal_error`도 부분 성공 가능성이 있다. 현재 files:read/history scope가 없으므로 ambiguous complete는 자동 재호출·새 업로드를 하지 않는다.
- bodyLocale·목적지·계정 신원·제출 당시 파일은 snapshot에서 읽는다. 원격404/403/계정 변경 시 create fallback은 없다. Webhook은 자동 재첨부 미지원이다.

## 후속 순서와 실행 원칙

1. 사용자의 재개 지시를 받은 Claude Code가 **배치별 모델·effort·선정 근거를 먼저 확정하고 orch.md에 기록**한다.
2. B6 복원·완성 → 독립 API/storage 리뷰 → 수정 → CTO → dev 통합/검증.
3. B7 Task10(retry runner·3-way body patch) → B8 Task11(UI) → B9 Task12(e2e·문서·runtime). 이전 브리프 초안은 root `.scratch/brief-attachment-b7.md`~`b9.md`; 확정된 B6 인터페이스에 맞춰 갱신한다.
4. `/orchestrate`의 정상 종료는 **원격 dev push + 같은 SHA의 verify/e2e-gate green 확인**이다. merge/deploy는 별도 사용자 지시가 있어야 한다. 1단계 배포는 이번에만 명시 승인받았다. 2단계 배포 권한은 없다.
5. root는 지휘·문서·통합만 하고 소스 결함은 소유 워커에게 보낸다. 워커는 ship step11까지만, no push/normal build. 네이티브 headed E2E는 워커 간 직렬로 실행한다. Orca FIFO delivery는 처리 후 반드시 ACK한다.

### 이번 지휘의 모델 계획 오류

기존 모든 워커를 Codex/gpt-6-astra 기본 상속으로 실행했고 effort는 실행 기록에 노출되지 않았다. 필수 인테이크의 **배치별 모델·effort 결정**을 수행하지 않은 오류다. 기존 실행을 사후에 명시적 선정으로 포장하지 않는다. 사용자 지적 후 추가 워커 실행을 중단했고, 이어 사용자가 Claude Code 인계를 지시하여 모델 재계획은 완료하지 않았다. 현재 `worker-start --help`는 `--model`·`--effort`를 지원한다. 후임은 실제 지원 모델을 확인해 명시적으로 정한다.

## 정리 및 추가 증거

- B3는 이미 phase1에 통합됐으며 미커밋 변경0이었다. 이력 보전용 `handoff/attachment-recovery-b3` → `d1dcf2ed8fdadd0df347c9b4830162e51c3790a8` 및 `b3.bundle`/`b3-evidence`를 같은 archive 폴더에 남겼다. B3를 다시 dev에 cherry-pick하지 않는다.
- B3/B6 워크트리와 소속 터미널은 사용자 명시 정리 지시로 모두 제거했다. Orca가 user_owned라 자동 release/stop을 거절한 항목은 그 지시에 따라 해당 두 workspace의 terminal close --all로 종료 후 제거했다. root 터미널과 다른 프로젝트는 건드리지 않았다.
- 기존 B1–B5 인계·리뷰는 root `.scratch/handoff-B*.md`, `.scratch/review-B*.md`; R는 `.scratch/handoff-R.md`. 핵심 결론은 orch.md와 본 문서에 있다.
- Orca run `run_4c4aa54a7bb3`, 중단된 B6 task `task_f7207f18a833` / dispatch `ctx_67e4ea28e025`. 새 Claude 세션은 종료된 Codex dispatch로 완료를 보고하지 않는다.
- 원격 push·추가 build/test·모델 재계획·새 워커 시작은 중단 이후 수행하지 않았다. 인계 문서와 WIP 보관 커밋만 로컬에 남겼다.
