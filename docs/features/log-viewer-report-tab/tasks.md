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
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `LogViewerData` 사용처 컴파일 에러 없음(report 누락은 다음 태스크에서 채움)

### Task 2: `buildMarkdownContext` 추출 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildMarkdownContext.ts`(신규), `__tests__/buildMarkdownContext.test.ts`(신규)
- **작업 내용**: `PreviewPanel.handleCopyMarkdown`의 캡처모드 4분기 ctx 빌드(`PreviewPanel.tsx:103-210`)를 순수 함수로 이전. 입력은 captureMode·draft·resolvedSections·sectionConfig·os·browser·캡처모드별 부가값. 반환은 `MarkdownContext`.
- **검증**:
  - [ ] 테스트: screenshot/freeform/video/element 각 모드에서 기대 `MarkdownContext` 생성
  - [ ] `Date.now()` 등 비결정 입력은 인자로 주입(테스트 가능하게)
  - [ ] `pnpm test` 통과

### Task 3: `PreviewPanel`을 `buildMarkdownContext` 사용으로 정리 (순수 리팩터)
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: `handleCopyMarkdown` 내부 4분기를 `buildMarkdownContext` 호출로 치환. 외부 동작·copy 결과 동일.
- **검증**:
  - [ ] Chrome 수동: 각 캡처모드에서 Copy markdown 결과가 변경 전과 동일
  - [ ] `pnpm typecheck` 통과

### Task 4: `IssuePreviewView` 공유 컴포넌트 추출
- **변경 대상**: `src/sidepanel/components/IssuePreviewView.tsx`(신규)
- **작업 내용**: 제목 헤더(+Copy 버튼, `copied` 토글 내부 상태)·환경 rows 렌더·텍스트 섹션 매핑·media/logCards optional slot 삽입(`POST_MEDIA_SECTION_IDS` 기준)을 props 기반으로 구현. design.md `IssuePreviewViewProps`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] media/logCards 미전달 시 슬롯 없이 제목+env+섹션만 렌더(Report 탭 용)

### Task 5: `PreviewPanel`이 `IssuePreviewView`를 사용하도록 치환 (순수 리팩터)
- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: 제목 헤더(`:231-245`)+섹션 합성 IIFE(`:264-329`)를 `IssuePreviewView` 렌더로 치환. env rows는 PreviewPanel에서 평탄화(element=EnvParagraph rows, 비-element=NonElementEnvSection rows)해 전달. media/logCards slot 채워 전달. onCopy=기존 handleCopyMarkdown.
- **검증**:
  - [ ] Chrome 수동: 각 캡처모드 프리뷰 화면이 변경 전과 시각적으로 동일(media/log 카드 위치 포함)
  - [ ] 빈 섹션 placeholder, 미연결 플랫폼 alert 등 기존 UX 유지
  - [ ] `pnpm typecheck` 통과

### Task 6: `buildReportData` 헬퍼 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildReportData.ts`(신규), `__tests__/buildReportData.test.ts`(신규)
- **작업 내용**: design.md `BuildReportDataInput`을 받아 `LogViewerReport` 생성. 섹션은 `sectionConfig.filter(enabled)` 순서로 `value`를 `resolveInlineImages`로 dataURL 치환(현 copy 로직과 동일하게 `paragraph` 대상 — `renderAs` 처리 일치 확인). copy는 `buildIssueMarkdown/Html`.
- **검증**:
  - [ ] 테스트: enabled 섹션만·순서 유지·label override 반영
  - [ ] 테스트: `inline:` 마커가 dataURL로 치환됨(resolveInlineImages mock)
  - [ ] 테스트: copy.markdown이 `buildIssueMarkdown(context)`와 일치
  - [ ] `pnpm test` 통과

### Task 7: `buildLogsHtml`에 report 주입
- **변경 대상**: `src/sidepanel/lib/buildLogsHtml.ts`, `__tests__/buildLogsHtml.test.ts`
- **작업 내용**: 시그니처에 `report: LogViewerReport | null` 인자 추가, `data.report`에 설정. 기존 인자 순서·`meta` 말미 issueUrl 규칙 유지(injectIssueUrl 회귀 주의).
- **검증**:
  - [ ] 테스트: report 주입 시 `__BUGSHOT_DATA__` JSON에 report 포함
  - [ ] 테스트: report=null도 정상 직렬화
  - [ ] 기존 issueUrl 말미 치환 테스트(`inject-issue-url.test.ts`) 통과
  - [ ] `pnpm test` 통과

### Task 8: `buildCaptureFiles`에서 report 빌드·전달
- **변경 대상**: `src/sidepanel/lib/buildCaptureFiles.ts`, `__tests__/buildCaptureFiles.test.ts`
- **작업 내용**: `BuildCaptureFilesInput`에 Report 입력(draft·issueSections·envRows·markdownContext 또는 빌드용 원시값) 추가. 로그 게이팅(`supportsConsoleNetworkLog` + 로그 존재) 통과 시에만 `buildReportData` 호출 후 `buildLogsHtml`에 전달.
- **검증**:
  - [ ] 테스트: report 입력이 `buildLogsHtml` 마지막 인자로 전달됨(spy)
  - [ ] 테스트: 로그 없음 → `buildLogsHtml`/`buildReportData` 미호출(기존 게이팅 유지)
  - [ ] `pnpm test` 통과

### Task 9: 호출처에서 Report 입력 전달
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`(`:250`), `src/sidepanel/tabs/DraftDetailDialog.tsx`(`:294`)
- **작업 내용**: `buildCaptureFiles` 호출에 draft·issueSections·env(os/browser/url/viewport/capturedAt/custom rows 평탄화)·markdownContext 전달. env 평탄화·markdownContext 구성은 Task 2/5에서 만든 헬퍼 재사용.
- **검증**:
  - [ ] Chrome 수동: 제출 시 첨부된 `logs.html`의 Report 탭 내용이 프리뷰와 일치
  - [ ] Chrome 수동: DraftDetailDialog에서 만든 `logs.html`도 동일
  - [ ] `pnpm typecheck` 통과

### Task 10: log-viewer App에 Report 탭 추가
- **변경 대상**: `src/log-viewer/App.tsx`
- **작업 내용**: `LogTab`에 `"report"` 추가(맨 앞). `hasReport=!!data?.report`. `TabsList` `grid-cols-3`→`grid-cols-4`, Report `TabsTrigger`(아이콘 예: `FileText`, disabled=`!hasReport`)·`TabsContent`(`data-[state=inactive]:hidden` 유지) 추가. `IssuePreviewView`에 `data.report` 전달(media/logCards 미전달). **defaultTab fallback은 console→network→action 그대로**(Report 제외).
- **검증**:
  - [ ] 빌드 후 수동: Report 탭이 맨 앞에 보이고 기본 선택은 Console
  - [ ] Console 없으면 Network, 둘 다 없으면 Action이 기본
  - [ ] Report 탭 클릭 시 프리뷰와 동일한 본문 표시(Media/Log attachments 없음)
  - [ ] Copy markdown 동작

### Task 11: i18n 키 추가 (ko/en 동시)
- **변경 대상**: `src/log-viewer/i18n.ts`, 필요 시 `src/i18n/`(사이드패널)
- **작업 내용**: `logViewer.tab.report`(ko: "리포트"/en: "Report") + `IssuePreviewView`가 쓰는 키 중 log-viewer i18n에 없는 것(`preview.copyMarkdown`, `preview.copied`, `section.env`, `common.empty`, `common.untitled`, 섹션 라벨 키 등) 추가. 사이드패널 i18n에 신규 키가 있으면 ko/en 양쪽 추가.
- **검증**:
  - [ ] log-viewer에서 키 문자열 노출 없음(모든 라벨 정상 번역)
  - [ ] `src/i18n/` 편집 시 PostToolUse 훅의 locales 대칭 테스트 통과
  - [ ] `pnpm test` 통과

## 테스트 계획

- **단위 테스트**:
  - `buildMarkdownContext.test.ts`: 4개 캡처모드별 ctx 생성.
  - `buildReportData.test.ts`: 섹션 필터·순서·라벨·inline resolve·copy 일치.
  - `buildLogsHtml.test.ts`: report 직렬화 포함/null, issueUrl 말미 규칙.
  - `buildCaptureFiles.test.ts`: report 전달·게이팅.
- **수동 테스트(Chrome)** 체크리스트:
  - [ ] screenshot+로그 제출 → logs.html Report 탭 = 프리뷰(Media/Log 제외)
  - [ ] freeform/video 동일 확인
  - [ ] 기본 탭 Console, Report는 클릭해야 보임
  - [ ] Console 없는 경우 Network 기본, 둘 다 없으면 Action 기본
  - [ ] Report Copy markdown 결과 = 프리뷰 Copy 결과
  - [ ] 본문 inline 이미지 정상 표시
  - [ ] DraftDetailDialog 경유 logs.html 동일
  - [ ] 사이드패널 PreviewPanel 회귀 없음(각 모드 시각 동일)

## 구현 순서 권장

- Task 1 → (2,4 병렬 가능) → 3,5(리팩터, 각각 2·4 의존) → 6(4의 데이터 형태 의존) → 7 → 8 → 9 → 10 → 11.
- Task 2와 Task 4는 독립(병렬 가능). Task 6은 Task 2(markdownContext)·Task 1(타입) 이후.
- Task 10·11은 사이드패널 직렬화(Task 7~9)가 끝나야 실데이터로 검증 가능.

## 가이드 영향

사용자 노출 UX(log-viewer에 새 탭)이므로 갱신 필요.
- `guide/ko/log-viewer.md`·`guide/en/log-viewer.md`(또는 AUTHORING.md의 log-viewer 페이지 슬러그) — Report 탭 설명 추가(이슈 본문을 logs.html에서 확인, Copy markdown). 기존 좌측 패널/탭 설명과 일관되게.
- 작성·검증은 `guide/AUTHORING.md` 규칙대로 구현 후 `/guide`로 처리.
