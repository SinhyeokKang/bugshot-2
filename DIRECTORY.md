# DIRECTORY.md

디렉터리 구조 + 파일별 역할. 테스트 파일은 대상과 같은 디렉터리의 `__tests__/*.test.ts`에 위치.

```
src/
├── assets/icons/    # 확장 아이콘 리소스
├── background/      # service worker
│   ├── index.ts         # 메시지 라우터 + 전역 sidePanel 비활성화
│   ├── tab-bindings.ts  # 탭별 side panel on/off (활성화 셋 기반)
│   ├── jira-api.ts      # Jira REST 래퍼 (Basic + Bearer, 401 시 refresh 재시도, getTransitions/transitionIssue로 상태 변경)
│   ├── oauth.ts         # Atlassian 3LO (launchWebAuthFlow + proxy 교환)
│   ├── github-api.ts    # GitHub REST 래퍼 (PAT/Bearer, 401 refresh hook 주입형, updateIssueState로 상태 변경)
│   ├── github-oauth.ts  # GitHub Web Flow (launchWebAuthFlow + proxy 교환) + refresh hook 자동 등록
│   ├── github-upload.ts # GitHub 파일 업로드 (MAIN world page injection, GitHub-Verified-Fetch 인증, batch uploadGithubFiles)
│   ├── linear-api.ts    # Linear GraphQL 래퍼 (API Key/Bearer, 401 refresh hook 주입형, getWorkflowStates/updateIssueState로 상태 변경)
│   ├── linear-oauth.ts  # Linear OAuth (PKCE, launchWebAuthFlow, proxy 불필요) + refresh hook 자동 등록
│   ├── notion-api.ts    # Notion REST 래퍼 (apiKey/Bearer, 401 → notion.oauthExpired, refresh 없음, updatePageStatus로 상태 변경)
│   ├── notion-oauth.ts  # Notion Web Flow (launchWebAuthFlow + proxy 교환, public integration — refresh 토큰 없음)
│   └── messages.ts      # 메시지 핸들러 디스패치 (jira.* / github.* / linear.* / notion.* namespace)
├── content/
│   ├── picker.ts          # DOM picker 메인 (메시지 라우터 + 모드 FSM + hover/select 이벤트)
│   ├── css-resolve.ts     # CSS 스타일 수집·토큰 resolve (resolveVarChain, collectSelection, collectTokens)
│   ├── css-source-cache.ts# raw CSS 텍스트 캐시 (CSSOM shorthand explode 우회, fetch + 경량 파서 + MutationObserver)
│   ├── dom-describe.ts    # DOM 트리 직렬화 (buildSelector, buildInitialTree, buildChildrenResponse)
│   ├── overlay.ts         # Shadow DOM 오버레이 (아웃라인·배너·블로커·프리뷰)
│   ├── area-select.ts     # 영역 드래그 선택 (dimming + 사이즈 라벨)
│   ├── recorders-entry.ts # MAIN world content_scripts entry (document_start) — network/console 레코더 자기 호출
│   ├── network-recorder.ts# MAIN world 네트워크 캡처 (fetch/XHR/sendBeacon 래핑, send 시점 phase="pending" entry push → 완료/에러 시 in-place 갱신, body omission에 size/limit/contentType context, 50MB body cap + 5000 entry FIFO)
│   ├── network-recorder-helpers.ts# classifyResponseBody / classifyBeaconBody 순수 헬퍼 + BODY_CAP (3MB)
│   ├── console-recorder.ts# MAIN world 콘솔 캡처 (log/info/debug + trace/assert/dir/table/group*/count*/time* wrap, error/warn은 chrome://extensions attribution noise 회피로 의도적 제외 — throw 에러는 window.error/unhandledrejection으로 별도 캡처, 2000건 FIFO, document_start부터 무조건 buffer, clearBuffer는 counters/timers Map도 함께 리셋)
│   └── console-recorder-helpers.ts# formatErrorEvent / formatRejectionReason / shouldCaptureAssertion 순수 헬퍼
├── sidepanel/
│   ├── App.tsx          # Radix Tabs 4개 (디버그/이슈 목록/연동/설정) + TabNavContext Provider, 설정 sub-tab을 controlled로 보유
│   ├── main.tsx
│   ├── tab-nav.ts       # TabNavContext — 메인 탭(+설정 sub-tab) 전환 setter를 하위 컴포넌트에 노출 (App↔하위 순환 import 회피)
│   ├── capture.ts       # 요소 크롭 스냅샷
│   ├── picker-control.ts
│   ├── recorder-control.ts# MAIN world 레코더 버퍼 clear sender (clearNetworkRecorder/clearConsoleRecorder) — editor-store가 직접 호출하므로 picker-control과 분리해 순환 import 차단
│   ├── video-capture.ts # 영상 녹화 시작 (startVideoCapture) — 버튼·단축키 공용, video-recorder 순환 회피로 별도 모듈
│   ├── video-recorder.ts# MediaRecorder 녹화 세션 관리
│   ├── 30s-replay/      # 30s Replay 캡처 — frame-buffer(직전 30초 순환 버퍼), mp4-encoder(WebCodecs VideoEncoder→mp4-muxer H.264 인코딩), use-30s-replay(captureVisibleTab 폴링 훅 + capture()), replay-context(ReplayProvider로 isReady/isEncoding/bufferedSeconds/capture 공유)
│   ├── hooks/           # useBoundTabId, useAI, useBackgroundRecorder, useCaptureShortcuts, useCommandShortcuts, useEditorSessionSync, useIssueImages, usePickerMessages, usePlatformFields(SubmitFieldsDialog 공용 platform fields state + open/draft 전환 시 idempotent reset), useThemeEffect
│   ├── components/      # 공통 UI (Section/AnnotationOverlay/TiptapEditor/DocSectionBody/DocTable/ConsoleLogContent/ConsoleLogPreviewDialog/NetworkLogContent/NetworkLogPreviewDialog/JsonTreeViewer/LogAttachmentCards/StyleChangesTable/CancelConfirmDialog/FieldRow(label+required 표기 공통)/ConnectedBadge(플랫폼 연결 완료 녹색 배지 공용))
│   ├── tabs/            # 탭별 진입점 + 편집 패널 (DebugTab(→IssueTab/ConsoleSubTab/NetworkSubTab)/IssueListTab(+IssueRow + issueListUtils 순수 헬퍼)/IntegrationsTab/SettingsTab/StyleEditorPanel/DraftingPanel/DraftDetailDialog/AiDraftDialog/IssueCreateModal/SubmitFieldsDialog(IssueCreateModal·DraftDetailDialog 공용 platform 선택 + 필드 입력 다이얼로그)/PreviewPanel/DomTreeDialog/IssueTypeCombobox/ProjectCombobox)
│   │   ├── styleEditor/   # AiStylingDialog, ValueCombobox, StylePropEditors와 헬퍼 (propMetadata, tokenUtils, styleHooks, TokenChip, colorLiteral, hexUtils)
│   │   ├── settings/      # AI 모델 설정 (LlmConnectDialog, LlmConnectForm) — SettingsTab의 AI 모델 sub-tab content
│   │   ├── connect/       # 플랫폼별 연결 폼 (JiraConnectForm, GithubConnectForm, LinearConnectForm, NotionConnectForm) — IntegrationsTab의 sub-tab content
│   │   ├── jiraFields/    # Jira 메타 필드 컴포넌트 (IssueTypeField, AssigneeField, PriorityField, EpicField, JiraIssueFields 묶음 + FieldCombobox 공용 셸 + useDebouncedSearch/useJiraConfig 훅 + resolve-epic-parent(에픽 이슈 타입일 때 parent 필드 대신 linked issue fallback)) — SubmitFieldsDialog의 Jira 탭에서 사용
│   │   ├── githubFields/  # GitHub 메타 필드 컴포넌트 (RepoCombobox, LabelCombobox, AssigneeCombobox, GithubIssueFields 묶음) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   ├── linearFields/  # Linear 메타 필드 컴포넌트 (TeamCombobox, ProjectCombobox, LabelCombobox, PrioritySelect, AssigneeCombobox, LinearIssueFields 묶음) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   ├── notionFields/  # Notion 메타 필드 컴포넌트 (DatabaseCombobox, StatusSelect, PropertiesFieldset, PropertySelectCombobox, NotionIssueFields 묶음, reconcileNotionFields 헬퍼) — IntegrationsTab/IssueCreateModal 양쪽에서 controlled로 재사용
│   │   ├── statusBadges/  # 이슈 목록 상태 badge — SubmittedBadge 디스패처 + 플랫폼별 SubmittedBadge(fetch + read-only fallback) + 동명 StatusBadge(편집 가능 popover) 4종(Jira/Github/Linear/Notion) + PlatformChip(브랜드 아이콘 + 라벨) + constants(STATUS_CATEGORY_COLORS, LINEAR_STATE_TYPE_COLORS, LINEAR_STATE_I18N) + utils(classifyBadgeError — 404→deleted 분류)
│   │   └── notionStatusColors.ts  # Notion status option color → STATUS_CATEGORY (new/indeterminate/done) 매핑
│   └── lib/             # buildIssueMarkdown, buildIssueAdf, buildGithubIssueBody, buildLinearIssueBody, buildNotionIssueBody, submitToGithub, submitToLinear, submitToNotion(NormalizedSubmitResult), buildCaptureFiles(captureMode → {video, images, logs} 정규화 — Jira는 attachments에 spread, GH/Linear/Notion은 그대로 어댑터에 전달), markdownToAdf(markdown-it→ADF 변환), markdownToNotionBlocks(markdown-it→Notion 변환), renderMarkdown(markdown→HTML 프리뷰), compactImage(이미지 리사이즈·webp 변환), findClosingToken(markdown-it 토큰 탐색), buildAiDraftPrompt, buildAiStylingPrompt, aiStylingPostProcess, ai-provider(BYOK 프로바이더 팩토리·프리셋·멀티턴 세션), video-mime(MediaRecorder mime 우선순위·확장자 매핑), environmentRows(재현 환경 row 필터·모드별 readonly 파생 헬퍼), osInfo(UserAgentData 기반 OS 이름·버전 파싱), buildAiMetaAttachment, buildConsoleLogJson, buildHar, buildLogSummary, formatBytes, formatTimestamp, resolveInlineImages, capture-error(isActiveTabPermissionError — captureVisibleTab/tabCapture의 activeTab 만료 에러 식별), log-merge(cross-page 로그 누적 — mergeLogItems id 기준 dedup·시간순 정렬·maxEntries 트림, trimByTime, rebuildNetworkLog/rebuildConsoleLog, isLogFrozen) 등 순수 유틸
├── store/               # Zustand 스토어 (editor/issues/settings/settings-ui), chrome-storage(Zustand↔chrome.storage 바인딩), blob-db(IndexedDB 이미지·비디오·네트워크/콘솔 로그 저장, blobToDataUrl/dataUrlToBlob 유틸), issues-migrations(이슈 스토어 마이그레이션)
│                        # settings v6: accounts: { jira?, github?, linear?, notion? } + lastSubmitFields per platform + global titlePrefix
│                        # settings-ui v5: LlmConfig { baseUrl, apiKey, modelId } + replayEnabled(30s Replay 토글) 전부 chrome.storage.local 영속
│                        # issues v5: entry에 platform: PlatformId 필드 + notion 한정 메타 (notionPageId/notionDatabaseId 등)
├── i18n/                # 다국어 (ko/en 로케일, t()/useT() 훅). ko.ts/en.ts는 namespaces/{common,app,issue,editor,integrations,settings,logs,ai}.ts 8개 도메인 번들을 spread merge하는 진입점
├── lib/                 # 공용 유틸 (session-keys, adf-sentinels, url-support, settings-storage, notion-page-id, key-obfuscation, pending-log-prune, capture-commands, element-label, utils)
├── components/ui/       # shadcn 컴포넌트
├── styles/
└── types/               # platform.ts (PlatformId/Accounts/LastSubmitFieldsByPlatform), github.ts, jira.ts, linear.ts, notion.ts, environment.ts (EnvironmentRow), console.ts, network.ts, messages.ts, picker.ts, user-agent-data.d.ts (NavigatorUAData 타입 보강) 등
oauth-proxy/             # Cloudflare Worker — Atlassian /token + GitHub /github/{token,refresh} + Notion /notion/token 교환 (client_secret 서버 보관, Linear는 PKCE라 proxy 불필요)
docs/
├── features/        # 기능 기획 문서 (PRD·설계·태스크) — dev에서 작업, 구현 완료 시 삭제
└── privacy.md       # 개인정보처리방침 (GitHub Pages)
```
