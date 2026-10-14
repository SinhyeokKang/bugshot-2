# 코드베이스 감사 — 2026-10-14

## 인계 요약

- 기준 브랜치: `dev`
- 기준 커밋: `dae38c6b52d81d8778e08a95f1ff49d19bce48d4` (`v1.7.54`)
- 요청: `$audit 코드 전체 감사`, 이후 다음 세션 인계를 위한 리포트 저장.
- 결과: **🔴 심각 4건 / 🟡 권장 4건 / ⚪ 참고 0건**. 모두 미수정.
- 검증 수준: 정적 분석과 호출 경로 대조. 아래 재현 조건은 코드에서 도출했으며 실행 재현은 하지 않았다.
- 이번 감사에서는 테스트·타입 검사·빌드·커밋·푸시를 실행하지 않았다. 이 리포트만 새로 저장했다.
- **작업 권한:** 사용자가 구현 시작 또는 구현 커맨드·스킬을 명시적으로 요청하기 전에는 인테이크만 한다. 이 문서의 수정 방향과 검증 목록은 구현 승인이 아니다.

파일 위치와 줄 번호는 위 기준 커밋 기준이다. 이후 변경이 있으면 심볼과 호출 경로를 다시 확인한다.

## 검사 범위와 한계

`source-command-audit` 스킬에 따라 UI·보안·데이터 흐름·코드 건강도 전문 에이전트 4개와 통합 검토로 조사했다. CLAUDE·ARCHITECTURE·DESIGN 및 관련 POSTMORTEM 기록과 대조해 의도된 예외·수용된 트레이드오프는 발견에서 제외했다.

- `src`·`oauth-proxy`의 프로덕션 TS/TSX 544개를 AST 정적 스캔했다. import 선언 3,060개를 검사했으며, 검사한 store→tabs 비타입 의존 및 background/store/types/i18n 동일 최상위 디렉터리 alias 규칙 위반 후보는 0건이었다.
- background 메시지 요청 union을 템플릿까지 확장한 133개와 handler·매핑 133개의 일치를 확인했다. 제출 어댑터 9개 경로도 대조했다.
- UI 담당은 파일 446개를 패턴/AST 검사하고 최소 24개를 전문 정독했다. 메인 사전 1,043키×5개 로케일 및 로그 뷰어 130키×5개 로케일의 키·placeholder 대칭 불일치는 없었다.
- 보안 담당은 비테스트 70개 파일을 전문 검토하고 추가 호출부를 부분 검토했다. background 비테스트 36개 전체, OAuth 프록시·manifest, 인증 관련 lib/types, 주요 content recorder 경계를 포함했다.
- 데이터 흐름 담당은 53개 파일을 전문 또는 관련 경로 중심으로 검토했다. 코드 건강도 담당은 11개 파일 전문과 추가 인증·스토리지 경로를 검토했다. 통합 검토에서 로그 복원·제출·첨부·스토리지·미디어 경로를 추가 대조했다. 담당 간 파일 중복이 있으므로 개수를 합산하지 않는다.
- **전체 파일의 모든 줄을 사람이 읽듯 정독한 전수 감사는 아니다.** CSS·picker·overlay·일반 UI 전체의 수동 검토 및 브라우저 실동작 검증은 남아 있다.
- `src/components/ui` 생성물 내부와 테스트 코드의 스타일은 감사 대상에서 제외했다. 실제 외부 계정 재연결·교차 워크스페이스 요청·동시 토큰 갱신은 실행하지 않았다.

## 발견 사항

### A01 · 🔴 기존 요청이 재연결한 다른 계정의 인증으로 재시도됨

**근거**

- [rotatedAuth.ts](../../../src/background/lib/rotatedAuth.ts) `pickRotated` (13줄): refresh token이 달라지면 신원·워크스페이스·grant 세대를 확인하지 않고 저장된 인증 전체를 반환한다.
- [jira-api.ts](../../../src/background/jira-api.ts) 85–104줄: 플랫폼 단위 `refreshInFlight`와 저장된 인증을 재사용한다. 80줄의 URL 구성 및 120–124줄의 재시도는 반환받은 인증의 `cloudId`로 기존 요청을 보낸다.
- [POSTMORTEM.md](../../POSTMORTEM.md) 415줄 인근: 이전 writer 수정에서 read-side가 범위 밖으로 남았다고 기록되어 있다. 수용된 설계 예외가 아니라 알려진 미해결 경로다.

**발생 조건 / 영향**

계정 A의 요청이 진행 중일 때 B로 재연결하고 A 요청이 401을 받으면, B의 인증을 회전된 A 인증으로 오인할 수 있다. Jira에서 동일 이슈 키가 B 사이트에도 존재하면 기존 요청이 B의 이슈를 변경하거나 첨부를 전송할 수 있다. 플랫폼 단위 진행 중 refresh 공유도 서로 다른 grant를 혼용할 수 있다.

**수정 방향:** 동일 신원·동일 grant인 경우에만 회전된 인증을 재사용하고, 진행 중 refresh 공유도 그 범위로 제한한다.

**수정 후 검증:** A 요청을 보류한 채 B로 재연결한 뒤 A의 401/refresh를 해제한다. B 토큰·cloudId로 A 요청을 재시도하지 않는지 확인한다. 같은 grant의 정상 토큰 회전은 계속 재사용되어야 한다.

### A02 · 🔴 확인한 초안을 패널 재개 후 제출하면 캡처 로그가 누락됨

**근거**

- [editor-store.ts](../../../src/store/editor-store.ts) `persistAttachedLogs` (543–568줄): 로그를 issueId 소유로 저장한 뒤 pending 소유 로그를 지운다. 세션 스냅샷에는 실제 로그 데이터가 포함되지 않는다.
- [useEditorSessionSync.ts](../../../src/sidepanel/hooks/useEditorSessionSync.ts) 145–153줄: 로그 복원 시 `pendingKey(tabId)`만 읽는다.
- [IssueCreateModal.tsx](../../../src/sidepanel/tabs/IssueCreateModal.tsx) 531–533줄: `loadSubmissionLogs(...)`의 반환값을 사용하지 않고 editor 메모리 기반 `buildEditorCaptureFiles(ctx)`를 호출한다.
- [buildEditorCapture.ts](../../../src/sidepanel/lib/buildEditorCapture.ts): editor의 캡처 로그와 첨부 설정을 이용해 제출 파일을 만든다.

**발생 조건 / 영향**

로그가 있는 screenshot/video/freeform 초안을 확인해 previewing으로 이동 → 패널 닫기 → 다시 열기 → 제출. 로그가 issueId 아래에만 남아 있으면 세션 복원 후 editor의 로그는 비어 있다. 동결된 단계에서는 recorder가 다시 채우지 않으므로 logs.html에 캡처 로그가 빠질 수 있다. 성공 제출 후 정리까지 이루어지면 저장된 원본도 사라질 수 있다.

**수정 방향:** 영상 복원처럼 `currentIssueId` 소유 로그를 복원하고, 제출 직전 복구한 로그가 실제 파일 생성 입력에 반영되도록 연결한다.

**수정 후 검증:** 세 가지 capture mode에서 로그 포함 초안 확인→세션 재개→제출 파일 생성까지 검증한다. pending 로그가 없어도 issueId에 저장된 console/network/action 로그가 logs.html에 포함되어야 한다.

### A03 · 🔴 다른 플랫폼의 동시 토큰 갱신이 최신 토큰을 덮어씀

**근거**

- [settings-storage.ts](../../../src/lib/settings-storage.ts) `writer`: 134줄에서 설정 envelope 전체를 읽고, 대상 인증 필드를 바꾼 뒤 158줄에서 `bugshot-settings` 전체를 저장한다.
- 각 플랫폼의 `refreshInFlight`는 모듈별로 독립되어 있으며, 서로 다른 플랫폼의 envelope 읽기·수정을 직렬화하지 않는다.
- [main.tsx](../../../src/sidepanel/main.tsx) 36–40줄의 rehydrate 및 [chrome-storage.ts](../../../src/store/chrome-storage.ts)의 전체 상태 저장은 이미 덮인 최신 토큰을 복구하지 못한다.

**발생 조건 / 영향**

Linear와 GitLab 등의 refresh가 같은 이전 envelope를 읽음 → Linear가 새 토큰 저장 → GitLab이 이전 Linear 토큰과 새 GitLab 토큰을 포함한 envelope 저장. Linear의 회전된 refresh token이 소비된 이전 토큰으로 돌아가며, 다음 refresh에서 `invalid_grant`와 재연결 요구로 이어질 수 있다.

**수정 방향:** envelope를 쓰는 경로 전체를 검토해 최신 상태 병합과 쓰기의 일관성을 보장한다. background writer 내부의 로컬 큐만 추가하면 다른 realm의 설정 저장과의 경쟁은 남으므로 저장 소유권까지 고려한다.

**수정 후 검증:** 두 플랫폼이 동일 초기 상태를 읽도록 제어한 뒤 저장 순서를 교차시켜도 두 새 토큰이 모두 보존되어야 한다. UI 설정 변경과 background 토큰 갱신이 겹치는 경우도 확인한다.

### A04 · 🔴 마지막 첨부를 삭제한 초안에 오래된 메타데이터가 남아 제출을 차단함

**근거**

- [editor-store.ts](../../../src/store/editor-store.ts) 1123줄: `state.attachments.length && state.target`일 때만 IssueRecord의 attachments를 갱신한다.
- 같은 파일 `removeAttachment` (1206–1213줄): editor 메타데이터 및 pending/issueId 소유 blob을 제거한다.
- [issues-store.ts](../../../src/store/issues-store.ts) `saveDraft` (647줄 인근): 전달되지 않은 기존 첨부 메타데이터는 병합 과정에서 유지된다.
- [DraftDetailDialog.tsx](../../../src/sidepanel/tabs/DraftDetailDialog.tsx) 833–834줄 및 [submissionRecovery.ts](../../../src/sidepanel/lib/submissionRecovery.ts) 473–480줄: 저장된 메타데이터에 해당하는 파일이 없으면 `MissingSubmissionFilesError`로 막는다.

**발생 조건 / 영향**

파일 1개 첨부 → 초안 저장/미리보기 → 편집 복귀 → 마지막 첨부 삭제 → 다시 저장 → 이슈 목록에서 저장 초안 제출. editor와 blob에서는 파일이 지워졌지만 IssueRecord에는 첨부가 남아, 사용자가 의도적으로 삭제한 파일을 누락 파일로 판단한다.

**수정 방향:** 첨부 배열이 비어도 저장 메타데이터를 갱신한다. 길이 조건은 blob rekey에만 적용한다.

**수정 후 검증:** 마지막 첨부 삭제 후 다시 저장한 IssueRecord의 attachments가 빈 배열이며, 저장 초안 제출 검증을 통과하는지 확인한다. 일부 첨부만 삭제하는 경우도 함께 확인한다.

### A05 · 🟡 Notion 수동 토큰 오입력이 전역 OAuth 만료 알림으로 처리됨

**근거**

- [messages.ts](../../../src/background/messages.ts) `notion.testToken` (488줄): `inConnectLane` 없이 `notionGetMyself`를 호출한다.
- [notion-api.ts](../../../src/background/notion-api.ts) 75–85줄: 401을 `refreshFailed: true`인 OAuth 오류로 변환한다.
- [bg-client.ts](../../../src/lib/bg-client.ts) 30–31줄: reject 전에 `onOAuthExpired.fire`를 호출한다. App은 이를 전역 재연결 모달로 표시한다.
- OAuth 연결 경로인 [notion-oauth.ts](../../../src/background/notion-oauth.ts) 141줄은 연결 레인을 구분하고 있다.

**발생 조건 / 영향:** 최초 수동 연동에서 잘못된 토큰을 입력하면 입력 검증 오류 외에 기존 연결이 만료된 것처럼 전역 재연결 모달이 열린다.

**수정 방향:** 수동 토큰 검증도 연결 레인으로 감싸 연결 시도 실패와 기존 인증 만료를 구분한다.

**수정 후 검증:** 잘못된 신규 토큰은 연결 폼 오류만 표시하고 전역 만료 이벤트를 발생시키지 않아야 한다. 실제 저장 인증의 만료 알림은 유지되어야 한다.

### A06 · 🟡 로그 뷰어에서 WebM 영상을 .mp4로 다운로드함

**근거:** [VideoPlayer.tsx](../../../src/log-viewer/components/VideoPlayer.tsx) 70줄에서 다운로드 파일명을 `recording.mp4`로 고정한다. [video-mime.ts](../../../src/sidepanel/lib/video-mime.ts)는 WebM 폴백과 MIME에 맞는 `recordingFilename(mime)`을 지원하며, 첨부 생성 시 원래 MIME이 유지된다.

**발생 조건 / 영향:** WebM 폴백으로 녹화한 영상을 logs.html에서 내려받으면 파일 내용과 확장자가 달라진다. 확장자로 형식을 판별하는 앱·업로드 대상에서 잘못 분류할 수 있다.

**수정 방향:** 실제 영상 MIME에 맞는 다운로드 확장자를 사용한다. 별도 빌드인 로그 뷰어의 import 경계는 유지한다.

**수정 후 검증:** MP4와 WebM 입력 각각의 다운로드 파일명과 MIME 일치를 확인한다.

### A07 · 🟡 로그 뷰어 영상 탐색 막대를 키보드로 조작할 수 없음

**근거:** [ProgressBar.tsx](../../../src/log-viewer/components/ProgressBar.tsx) 85줄의 `role="slider"`에는 aria 값이 있지만 `tabIndex`와 키보드 핸들러가 없다. 탐색 동작은 포인터 경로이며 영상에는 native controls가 없다.

**발생 조건 / 영향:** 키보드만 사용하는 사용자는 탐색 막대에 포커스하거나 원하는 재생 위치로 이동할 수 없다.

**수정 방향:** 접근 가능한 Slider를 사용하거나 포커스와 표준 탐색 키 동작을 구현한다.

**수정 후 검증:** Tab 접근, 방향키 탐색, Home/End 경계 이동, aria 값 갱신을 확인한다.

### A08 · 🟡 일부 입력 컨트롤이 화면 라벨과 연결되지 않음

**근거**

- [SettingsTab.tsx](../../../src/sidepanel/tabs/SettingsTab.tsx) 184줄: titlePrefix FieldRow 라벨의 `htmlFor`가 없지만 Input에는 `id="title-prefix"`가 있다.
- [PrioritySelect.tsx](../../../src/sidepanel/tabs/linearFields/PrioritySelect.tsx) 35줄: SelectTrigger에 id·aria-label·aria-labelledby가 없고 외부 FieldRow 라벨과 연결되지 않는다.
- [FieldRow.tsx](../../../src/sidepanel/components/FieldRow.tsx) 20줄: 라벨은 컨트롤을 감싸지 않는 별도 형제다.

**발생 조건 / 영향:** 라벨 클릭으로 입력에 포커스되지 않으며, 보조기술에서 표시된 필드 이름을 컨트롤의 이름으로 식별하지 못한다. Select의 현재 값만으로 필드 목적을 구분하기 어렵다.

**수정 방향:** FieldRow의 라벨과 컨트롤 id를 연결하고 SelectTrigger에도 표시 라벨 기반 접근 가능한 이름을 부여한다.

**수정 후 검증:** 표시된 필드 이름으로 컨트롤을 조회할 수 있고, 라벨 클릭으로 올바른 입력에 포커스되는지 확인한다.

## 다음 세션 진행 기준

1. 이 문서와 현재 diff를 먼저 확인한다. **명시적인 구현 요청이 없으면 인테이크만 유지한다.**
2. 구현 승인이 나면 A01·A03 인증 신원/저장 경쟁을 우선 다루고, A02·A04 로그/첨부 보존을 이어서 다룬다. 인증 두 항목은 관련성이 있지만 서로 다른 read-side·write-side 문제이므로 각각 회귀 검증을 남긴다.
3. 위 발생 조건을 실패 테스트로 고정한 뒤 수정한다. 현재 감사는 실행 재현을 제공하지 않았으므로 테스트 작성 단계에서 전제를 다시 검증한다.
4. A05–A08은 연결 오류 표시·다운로드 MIME·접근성 변경으로 나누어 검증한다. UI 수정 전 DESIGN, 각 영역 수정 전 POSTMORTEM과 ARCHITECTURE를 다시 확인한다.
5. 버그 수정 후 `/postmortem` 기록 및 문서·가이드·e2e 영향 판단은 해당 구현 스킬 절차를 따른다. 이번 감사의 과거 테스트 결과를 새 변경의 검증 결과로 재사용하지 않는다.

현재 완료한 것은 감사와 이 인계 문서 저장뿐이다. 코드 수정·재현 테스트 작성·빌드·커밋·푸시·병합·배포는 이 문서 저장 요청에 포함되지 않는다.
