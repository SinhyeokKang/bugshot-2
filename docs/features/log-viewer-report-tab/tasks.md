# Log Viewer — Report 탭 — 구현 태스크

## 선행 조건

- 신규 권한·env·OAuth·외부 API 없음. 클립보드 write는 user gesture로 동작(권한 불요).
- log-viewer 변경은 `pnpm build:log-viewer`로 `dist-log-viewer/index.html` 갱신 후 사이드패널 inline에 반영(빌드는 사용자 요청 시에만 실행).
- 영향 호출처 2곳: `IssueCreateModal.tsx:250`, `DraftDetailDialog.tsx:294`.

## 태스크

### Task 1: `LogViewerData.report` 타입 추가
- **변경 대상**: `src/types/log-viewer.ts`
- **작업 내용**: `LogViewerReportSection`, `LogViewerReport` 인터페이스 추가 + `LogViewerData`에 `report: LogViewerReport | null` 필드 추가(design.md 시그니처).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 기존 `LogViewerData` 사용처 컴파일 에러 없음(report 누락은 다음 태스크에서 채움)

### Task 2: `buildMarkdownContext` 추출 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildMarkdownContext.ts`(신규), `__tests__/buildMarkdownContext.test.ts`(신규)
- **작업 내용**: `PreviewPanel.handleCopyMarkdown`의 캡처모드 4분기 ctx 빌드(`PreviewPanel.tsx:116-210`)를 순수 함수로 이전. **`PreviewPanel` copy 한정**(IssueCreateModal/DraftDetailDialog ctx는 통합 대상 아님). 입력은 captureMode·draft·resolvedSections·sectionConfig·os·browser·캡처모드별 부가값. `useEditorStore.getState()` 직접 읽기(`freeformViewport`/`freeformCapturedAt`)·`?? Date.now()` 폴백은 전부 인자로 주입. 반환은 `MarkdownContext`.
- **검증**:
  - [x] 테스트: screenshot/freeform/video/element 각 모드에서 기대 `MarkdownContext` 생성
  - [x] `Date.now()` 등 비결정 입력은 인자로 주입(테스트 가능하게)
  - [x] `pnpm test` 통과

### Task 3: `PreviewPanel`을 `buildMarkdownContext` 사용으로 정리 (순수 리팩터)
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: `handleCopyMarkdown` 내부 4분기를 `buildMarkdownContext` 호출로 치환. 외부 동작·copy 결과 동일.
- **검증**:
  - [ ] Chrome 수동: 각 캡처모드에서 Copy markdown 결과가 변경 전과 동일
  - [x] `pnpm typecheck` 통과

### Task 4: `IssuePreviewView` 공유 컴포넌트 추출
- **변경 대상**: `src/sidepanel/components/IssuePreviewView.tsx`(신규)
- **작업 내용**: 제목 헤더(+Copy 버튼, `copied` 토글 내부 상태 + `aria-live="polite"`)·환경 rows 렌더·텍스트 섹션 매핑·media/logCards optional slot 삽입(`POST_MEDIA_SECTION_IDS` 기준)을 props 기반으로 구현. design.md `IssuePreviewViewProps`. **라벨(copyMarkdown/copied/untitled/emptyValue/env 제목)은 전부 prop 주입 — 내부에서 `t` 호출 금지. 본문은 `DocSectionBody` 미사용, dataURL value 직접 렌더 경량 렌더러**(blob-db/IndexedDB import 회피).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] media/logCards 미전달 시 슬롯 없이 제목+env+섹션만 렌더(Report 탭 용) — composePreviewLayout.test로 순서 검증
  - [x] 컴포넌트 import 그래프에 `blob-db`/IndexedDB 미포함(log-viewer 번들 안전) — CTO madge 정적 검증

### Task 5: `PreviewPanel`이 `IssuePreviewView`를 사용하도록 치환 (순수 리팩터)
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: 제목 헤더(`:231-245`)+섹션 합성 IIFE(`:264-329`)를 `IssuePreviewView` 렌더로 치환. env rows는 PreviewPanel에서 평탄화(element=EnvParagraph rows, 비-element=NonElementEnvSection rows)해 전달. media/logCards slot 채워 전달. 라벨은 `useT()`로 채워 주입. 빈 섹션은 `emptyVariant="muted"`(placeholder) 유지. onCopy=기존 handleCopyMarkdown.
- **검증**:
  - [ ] Chrome 수동: 각 캡처모드 프리뷰 화면이 변경 전과 시각적으로 동일(media/log 카드 위치 포함)
  - [ ] 빈 섹션 placeholder, 미연결 플랫폼 alert 등 기존 UX 유지
  - [x] `pnpm typecheck` 통과

### Task 6: `buildReportData` 헬퍼 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildReportData.ts`(신규), `__tests__/buildReportData.test.ts`(신규)
- **작업 내용**: design.md `BuildReportDataInput`을 받아 `LogViewerReport` 생성. 섹션은 `sectionConfig.filter(enabled)` 순서로, **`renderAs==="paragraph"` 섹션만** `resolveInlineImages`로 dataURL 치환(현 copy 로직 `PreviewPanel.tsx:107`과 일치, orderedList는 미치환). copy는 호출처가 넘긴 `markdownContext`를 그대로 받아 `buildIssueMarkdown/Html`(재빌드 없음).
- **검증**:
  - [x] 테스트: enabled 섹션만·순서 유지·label override 반영
  - [x] 테스트: `paragraph` 섹션의 `inline:` 마커가 dataURL로 치환됨(resolveInlineImages mock)
  - [x] 테스트: `orderedList` 섹션은 `inline:` 마커 미치환(paragraph 전용 게이트 고정)
  - [x] 테스트: copy.markdown이 `buildIssueMarkdown(context)`와 일치
  - [x] `pnpm test` 통과

### Task 7: `buildLogsHtml`에 report 주입
- **변경 대상**: `src/sidepanel/lib/buildLogsHtml.ts`, `__tests__/buildLogsHtml.test.ts`
- **작업 내용**: 시그니처 **맨 마지막 positional**에 `report: LogViewerReport | null` 추가(기존 8개 순서 유지), `data.report`에 설정. `LogViewerData`에서 **`report`를 `meta`보다 앞 필드로 직렬화**해 `injectIssueUrl`의 `lastIndexOf('"issueUrl":""')` 마커가 meta 말미만 잡도록 보장.
- **검증**:
  - [x] 테스트: report 주입 시 `__BUGSHOT_DATA__` JSON에 report 포함
  - [x] 테스트: report=null도 정상 직렬화
  - [x] 테스트: report에 빈 `issueUrl`-유사 문자열 포함 시 `injectIssueUrl`이 **meta 말미만** 치환(마커 충돌 회귀) — report가 meta보다 앞 + 마지막 마커 뒤 `}}` 단언
  - [x] 기존 issueUrl 말미 치환 테스트(`inject-issue-url.test.ts`) 통과
  - [x] `pnpm test` 통과

### Task 8: `buildCaptureFiles`에서 report 빌드·전달
- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`, `__tests__/buildCaptureFiles.test.ts`
- **작업 내용**: `BuildCaptureFilesInput`에 Report 입력(draft·issueSections·envRows·markdownContext 또는 빌드용 원시값) 추가. 로그 게이팅(`supportsConsoleNetworkLog` + 로그 존재) 통과 시에만 `buildReportData` 호출 후 `buildLogsHtml`에 전달.
- **검증**:
  - [x] 테스트: report 입력이 `buildLogsHtml` 마지막 인자로 전달됨(spy)
  - [x] 테스트: 로그 없음 → `buildLogsHtml`/`buildReportData` 미호출(기존 게이팅 유지)
  - [ ] 수동: 큰 inline 이미지 draft → Notion 제출 시 `logs.zip` 크기가 무료 워크스페이스 5 MiB 한도 내(report dataURL이 media 임베드 위에 추가됨 — 한도 초과 회귀 확인)
  - [x] `pnpm test` 통과

### Task 9: 호출처에서 Report 입력 전달
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`(`:250`), `src/sidepanel/tabs/DraftDetailDialog.tsx`(`:294`)
- **작업 내용**: `buildCaptureFiles` 호출에 draft·issueSections·env(os/browser/url/viewport/capturedAt/custom rows 평탄화)·markdownContext 전달. **이미 만들어진 `ctx`를 `markdownContext`로 그대로 재사용**(재빌드 없음). env 평탄화는 `deriveReadonlyEnvRows`/`filterEnvironmentRows`/`getOsInfo` 재사용(viewport `{w,h}`→`{width,height}` 키 변환 주의). `isElementNoDiff`일 때 기존대로 `captureMode:"screenshot"`을 넘기므로 **Report도 screenshot 기준으로 빌드**(ctx의 element captureMode와 일관 정렬).
- **검증**:
  - [ ] Chrome 수동: 제출 시 첨부된 `logs.html`의 Report 탭 내용이 프리뷰와 일치
  - [ ] Chrome 수동: DraftDetailDialog에서 만든 `logs.html`도 동일
  - [ ] Chrome 수동: element-no-diff(diff 없는 element) 제출 시 Report 메타가 screenshot 기준으로 어긋남 없이 표시
  - [x] `pnpm typecheck` 통과

### Task 10: log-viewer App에 Report 탭 추가
- **변경 대상**: `src/log-viewer/App.tsx`
- **작업 내용**: `LogTab`에 `"report"` 추가(맨 앞). `hasReport=!!data?.report`. `TabsList`는 이미 `CollapsingTabsList`+`TabLabel` 패턴이므로 Report `TabsTrigger`도 **`<TabLabel>`로 감싸고 아이콘 `FileText`+동일 클래스(`min-w-0 gap-1.5`)**를 따른다(natural width 측정 누락·접힘 비대칭 방지). disabled=`!hasReport`. `TabsContent`(`data-[state=inactive]:hidden` 유지) 추가. `IssuePreviewView`에 `data.report` 전달(media/logCards 미전달, 라벨은 log-viewer `t()`로 채움). **defaultTab fallback은 console→network→action 그대로**(Report 제외, report 분기 없음). **Report 탭 활성 시 PageFooter 우하단 Export 버튼 없음**(추출 대상 없음). `disabled`는 구버전 logs.html(report 없음) 하위호환에서만 발생.
- **검증**:
  - [ ] 빌드 후 수동: Report 탭이 맨 앞에 보이고 기본 선택은 Console
  - [ ] Console 없으면 Network, 둘 다 없으면 Action이 기본
  - [ ] Report 탭 클릭 시 프리뷰와 동일한 본문 표시(Media/Log attachments 없음)
  - [ ] Report 탭 활성 시 footer 우하단 Export 버튼 미노출
  - [ ] 좁은 폭에서 4개 탭 라벨 접힘(아이콘만)이 대칭으로 동작
  - [ ] Copy markdown 동작

### Task 11: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/log-viewer/i18n.ts`, 필요 시 `src/i18n/`(사이드패널)
- **작업 내용**: `IssuePreviewView`는 라벨을 prop으로 받으므로, 키는 **호출처별 i18n**에 둔다. log-viewer 측(`src/log-viewer/i18n.ts`): `logViewer.tab.report`(ko "리포트"/en "Report") + Report 탭이 채워 넘길 라벨(copyMarkdown/copied/untitled/env 섹션 제목/emptyValue) 중 없는 키 추가. 사이드패널 측(`src/i18n/`): `PreviewPanel`이 넘기는 라벨 키는 대부분 기존 존재, 신규 키만 ko/en 추가.
- **검증**:
  - [x] log-viewer에서 키 문자열 노출 없음 — i18n.ts ko/en 대칭, Report 라벨 키 6개 추가(IssuePreviewView prop 주입). 사이드패널 i18n은 기존 키 재사용이라 신규 키 없음
  - [ ] `src/i18n/` 편집 시 PostToolUse 훅의 locales 대칭 테스트 통과
  - [x] `pnpm test` 통과

### Task 12: logs 첨부 드랍 경고 토스트 (전 플랫폼 silent drop 개선)
- **변경 대상**: `src/types/platform.ts`, `src/sidepanel/lib/submitToNotion.ts`·`submitToLinear.ts`, `src/background/messages.ts`(Jira·GitHub·GitLab·Asana 첨부 격리 + BG 응답), `src/store/editor-store.ts`, `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/IssueTab.tsx`, `src/i18n/`
- **작업 내용**: `NormalizedSubmitResult`에 `logsDropped?: boolean` 추가(`:89-92`). **6개 플랫폼 각 제출 경로**에서 logs(`category==="log"`) 첨부가 격리 처리로 빠졌는지 판정해 `logsDropped: true` 설정 — 감지 지점은 플랫폼마다 다름(Notion `:105-109` continue / Linear `:110-130` filter / GitLab·Jira·Asana·GitHub는 background `messages.ts`·`github-upload.ts`의 per-file null). background 경로는 **BG 응답 타입에 `logsDropped`를 실어** 사이드패널까지 전파. `editor-store.submitResult` 타입 확장 + `onSubmitted` 체인 전달. `SubmitSuccessView`(`IssueTab.tsx:346-377`)에서 `logsDropped`면 `useEffect`로 `toast.warning`(sonner) 1회. 문구는 **공통 i18n 키 1개 + `{platformName}` 보간**(키는 하나; ko 예: "{platformName} 첨부 파일 용량 한도로 logs.html이 누락되었습니다" / en 대응). 보간값은 제출 플랫폼명. 첨부 파일 용량 한도 탓임을 명확히 드러내 버그샷 결함처럼 보이지 않게. **실패 반응형**(사전 바이트 크기 예측 아님). image/video 첨부 실패의 기존 동작(throw/전체 실패 또는 본문 "not inlined" 노트)은 보존.
- **검증**:
  - [x] 테스트: 각 플랫폼 제출 경로가 logs 첨부 실패 시 `logsDropped: true` 반환(Notion·Linear·GitLab·GitHub·Asana 회귀 테스트)
  - [x] 테스트: logs 첨부 성공 시 `logsDropped` falsy
  - [x] 테스트: image/video 실패 분기는 기존대로(Notion·Linear 이미지 실패 전체 reject 보존 확인)
  - [ ] 테스트: background 경로(Jira)의 BG 응답에 `logsDropped`가 직렬화돼 사이드패널 결과까지 도달 — Jira BG submitIssue 단위 테스트 미작성(타입 전파만 확인). GitHub·GitLab·Asana는 사이드패널에서 per-file null로 감지(BG 타입 변경 불요)
  - [ ] Chrome 수동: 큰/영상 임베드 draft로 GitLab(10MB)·Notion(5MiB) 제출 → 이슈는 생성되고 제출 완료 화면에 경고 토스트 1회
  - [x] `src/i18n/` 편집 시 PostToolUse 훅 locales 대칭 테스트 통과
  - [x] `pnpm test` 통과

## 테스트 계획

- **단위 테스트**:
  - `buildMarkdownContext.test.ts`: 4개 캡처모드별 ctx 생성. `?? Date.now()`/`?? {width:0,height:0}` 폴백 분기를 인자 주입으로 결정적 커버.
  - `buildReportData.test.ts`: 섹션 필터·순서·라벨·**paragraph만 inline resolve(orderedList 미치환)**·copy 일치.
  - `buildLogsHtml.test.ts`: report 직렬화 포함/null, **report가 meta보다 앞 + 빈 issueUrl-유사 문자열 포함 시 injectIssueUrl이 meta 말미만 치환**.
  - `buildCaptureFiles.test.ts`: report 전달·게이팅.
  - **Report Copy == 프리뷰 Copy 고정**: 동일 `markdownContext`에서 `buildReportData(...).copy.markdown` == `buildIssueMarkdown(ctx)` 임을 자동 검증(수동 의존 제거).
- **수동 테스트(Chrome)** 체크리스트:
  - [ ] screenshot+로그 제출 → logs.html Report 탭 = 프리뷰(Media/Log 제외)
  - [ ] freeform/video 동일 확인
  - [ ] 기본 탭 Console, Report는 클릭해야 보임
  - [ ] Console 없는 경우 Network 기본, 둘 다 없으면 Action 기본
  - [ ] Report Copy markdown 결과 = 프리뷰 Copy 결과
  - [ ] 본문 inline 이미지 정상 표시
  - [ ] DraftDetailDialog 경유 logs.html 동일
  - [ ] 사이드패널 PreviewPanel 회귀 없음(각 모드 시각 동일)
  - [ ] 큰 inline draft Notion 무료 플랜 제출 → logs 누락 경고 토스트(제출 완료 화면)

## 구현 순서 권장

- Task 1 → (2,4 병렬 가능) → 3,5(리팩터, 각각 2·4 의존) → 6(4의 데이터 형태 의존) → 7 → 8 → 9 → 10 → 11 → 12.
- Task 2와 Task 4는 독립(병렬 가능). Task 6은 Task 2(markdownContext)·Task 1(타입) 이후.
- Task 10·11은 사이드패널 직렬화(Task 7~9)가 끝나야 실데이터로 검증 가능.
- Task 12(logs 드랍 경고)는 Report와 독립적이나, Report dataURL이 드랍 트리거를 늘리므로 함께 묶는다. Task 8/9(제출 경로) 이후 권장.

## 가이드 영향

사용자 노출 UX(log-viewer에 새 탭)이므로 갱신 필요.
- `guide/ko/log-viewer.md`·`guide/en/log-viewer.md`(또는 AUTHORING.md의 log-viewer 페이지 슬러그) — Report 탭 설명 추가(이슈 본문을 logs.html에서 확인, Copy markdown). 기존 좌측 패널/탭 설명과 일관되게.
- 작성·검증은 `guide/AUTHORING.md` 규칙대로 구현 후 `/guide`로 처리.
