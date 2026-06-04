# Log Viewer — Report 탭 — 기술 설계

## 개요

log-viewer는 standalone HTML이라 Zustand store·IndexedDB에 접근할 수 없다. 따라서 Report 탭이 보여줄 이슈 본문(제목·환경·텍스트 섹션·copy용 마크다운)을 **사이드패널에서 직렬화해 `LogViewerData.report`로 주입**한다. UI는 `PreviewPanel`과 동일해야 하므로, 프리뷰의 렌더 골격을 **props 기반 공유 컴포넌트 `IssuePreviewView`** 로 추출해 사이드패널과 log-viewer가 함께 쓴다. Media·Log attachments 삽입은 공유 컴포넌트의 optional slot으로 두어, `PreviewPanel`만 채우고 Report 탭은 비운다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/components/IssuePreviewView.tsx`** — props 기반 이슈 프리뷰 렌더 골격(공유). 제목+Copy 버튼, 환경 rows, 텍스트 섹션 매핑, optional media/logCards slot 삽입 로직(`POST_MEDIA_SECTION_IDS` 기준)을 담는다. `PreviewPanel`에서 현재 인라인으로 가진 IIFE 합성 로직(`PreviewPanel.tsx:264-329`)과 제목 헤더(`231-245`)를 이 컴포넌트로 이전.
- **`src/sidepanel/lib/buildReportData.ts`** — `LogViewerData["report"]`를 만드는 순수/async 헬퍼. 제목·환경 rows·섹션(inline 이미지 resolve 후)·copy(markdown/html) 빌드.
- **`src/sidepanel/lib/buildMarkdownContext.ts`** — `PreviewPanel.handleCopyMarkdown`의 캡처모드 4분기 ctx 빌드 로직(`PreviewPanel.tsx:103-210`)을 순수 함수로 추출. `PreviewPanel` copy와 `buildReportData`의 copy가 공유.
- 테스트: `src/sidepanel/lib/__tests__/buildReportData.test.ts`, `buildMarkdownContext.test.ts`.

### 변경 파일

- **`src/types/log-viewer.ts`** — `LogViewerData`에 `report` 필드 추가.
- **`src/sidepanel/lib/buildLogsHtml.ts`** — 시그니처에 `report` 인자 추가, `data.report`에 주입.
- **`src/sidepanel/lib/buildCaptureFiles.ts`** — `BuildCaptureFilesInput`에 Report 빌드용 입력(draft/issueSections/env 정보) 추가, 내부에서 `buildReportData` 호출 후 `buildLogsHtml`에 전달.
- **`src/sidepanel/tabs/IssueCreateModal.tsx`** (`:250`) / **`src/sidepanel/tabs/DraftDetailDialog.tsx`** (`:294`) — `buildCaptureFiles` 호출에 Report 입력 전달.
- **`src/sidepanel/tabs/PreviewPanel.tsx`** — 제목 헤더+섹션 합성을 `IssuePreviewView`로 치환(media/logCards slot은 채워서 전달). copy는 `buildMarkdownContext` 사용으로 정리. **외부 동작·표시 결과는 동일**(순수 리팩터).
- **`src/log-viewer/App.tsx`** — `LogTab`에 `"report"` 추가, `TabsList`를 4칸으로, Report `TabsTrigger`/`TabsContent` 추가. fallback 로직은 그대로(Report 제외). `data.report`를 `IssuePreviewView`에 전달.
- **`src/log-viewer/i18n.ts`** — `logViewer.tab.report` 키(ko/en) + `IssuePreviewView`가 쓰는 키(`preview.copyMarkdown`, `preview.copied`, `section.env`, `common.empty`, `common.untitled` 등) 중 log-viewer i18n에 없는 것 추가.
- **`src/i18n/`**(사이드패널) — `IssuePreviewView`가 새로 쓰는 키가 있으면 ko/en 추가(대부분 기존 존재).

## 데이터 흐름

```
[사이드패널] 제출/draft → IssueCreateModal | DraftDetailDialog
    │  draft, issueSections, captureMode, env(viewport/capturedAt/url/os/browser/custom rows)
    ▼
buildCaptureFiles(input)
    │  └─ buildReportData(input) ──► resolveInlineImages (IndexedDB→dataURL)
    │                              └─ buildMarkdownContext → buildIssueMarkdown/Html
    ▼
buildLogsHtml(..., report)
    │  report를 LogViewerData에 직렬화 → __BUGSHOT_DATA__ 스크립트 태그
    ▼
logs.html (standalone)
    ▼
[log-viewer] main.tsx → App → Report 탭 → IssuePreviewView(data.report)
```

- Report 데이터는 **빌드 시점에 완전히 직렬화**(이미지 dataURL·copy 문자열 포함)되어 주입된다. log-viewer는 store/IndexedDB/async resolve 없이 순수 렌더 + 클립보드 write만 한다.

## 인터페이스 설계

### `LogViewerData.report` (`src/types/log-viewer.ts`)

```ts
export interface LogViewerReportSection {
  id: string;
  label: string;                       // labelOverride || t(sectionLabelKey(id))
  renderAs: "paragraph" | "orderedList";
  value: string;                       // inline 이미지가 dataURL로 resolve된 본문
}

export interface LogViewerReport {
  title: string;
  env: { label: string; value: string }[];   // 평탄화된 환경 rows
  sections: LogViewerReportSection[];          // issueSections 순서·enabled만
  copy: { markdown: string; html: string };    // 미리 빌드된 클립보드 페이로드
}

// LogViewerData에 추가
report: LogViewerReport | null;
```

### 공유 렌더 컴포넌트 (`IssuePreviewView.tsx`)

```ts
interface IssuePreviewViewProps {
  title: string;
  envRows: { label: string; value: string }[];
  sections: { id: string; label: string; renderAs: "paragraph" | "orderedList"; value: string }[];
  // Copy 버튼: 콜백 주입. PreviewPanel은 런타임 빌드, log-viewer는 미리 박힌 문자열 복사.
  onCopy?: () => void | Promise<void>;
  // media/logCards slot — PreviewPanel만 채움. Report 탭은 미전달(undefined).
  media?: React.ReactNode;
  logCards?: React.ReactNode;
  postMediaSectionIds?: Set<string>;   // slot 삽입 위치(기본 POST_MEDIA_SECTION_IDS)
}
```

- `copied` 토글 상태는 컴포넌트 내부에서 관리(현 `PreviewPanel.tsx:80-85` 이전).
- `DocSectionBody`는 `value`에 `inline:` 마커가 없으면 그대로 마크다운 렌더하므로, dataURL이 박힌 `value`를 주면 IndexedDB 접근 없이 동작 → 공유 컴포넌트에서 그대로 사용 가능.

### `buildReportData` (`buildReportData.ts`)

```ts
interface BuildReportDataInput {
  title: string;
  sections: Record<string, string>;        // draft.sections
  sectionConfig: IssueSection[];           // issueSections (enabled/order/labelOverride)
  envRows: { label: string; value: string }[];  // 호출처에서 평탄화해 전달
  markdownContext: MarkdownContext;        // buildMarkdownContext 결과
}
async function buildReportData(input: BuildReportDataInput): Promise<LogViewerReport>;
```

- 섹션: `sectionConfig.filter(enabled)` 순서로 `{ id, label, renderAs, value: resolveInlineImages(value).resolved }`.
- copy: `{ markdown: buildIssueMarkdown(markdownContext), html: buildIssueHtml(markdownContext) }`.

### `buildMarkdownContext` (`buildMarkdownContext.ts`)

```ts
function buildMarkdownContext(args: {
  captureMode: CaptureMode;
  draft: EditorDraft;
  resolvedSections: Record<string, string>;
  sectionConfig: IssueSection[];
  os: string | null; browser: string | null;
  // 캡처모드별 부가 입력(selection, diffs, viewport, capturedAt, log summaries 등)
  ...
}): MarkdownContext;
```

- 기존 `PreviewPanel.handleCopyMarkdown`의 4분기 로직(freeform/video/element/screenshot)을 그대로 옮긴다. `MarkdownContext`는 `buildIssueMarkdown.ts`의 입력 타입.

### log-viewer 탭 (`App.tsx`)

```ts
type LogTab = "report" | "console" | "network" | "action";
const hasReport = !!data?.report;
// 기본 탭 fallback: Report 제외, 기존 그대로
const defaultTab: LogTab = hasConsole ? "console" : hasNetwork ? "network" : "action";
// TabsList grid-cols-3 → grid-cols-4, Report Trigger를 맨 앞에 추가(disabled={!hasReport})
```

## 기존 패턴 준수

- **standalone 직렬화**: 영상/스크린샷이 dataURL로 주입되는 것과 동일하게(`buildLogsHtml`), Report도 이미지·copy 문자열을 빌드 시점에 직렬화. log-viewer는 async/IO 없이 렌더.
- **i18n 동시 갱신**: 공유 컴포넌트가 쓰는 키는 사이드패널 i18n(`src/i18n/`)과 log-viewer i18n(`src/log-viewer/i18n.ts`) **양쪽에 존재**해야 한다(`@/i18n` alias가 컨텍스트별로 다른 파일을 가리킴). 누락 시 log-viewer에서 키 문자열이 그대로 노출됨. PostToolUse 훅은 `src/i18n/` 대칭만 검사하므로 log-viewer i18n은 수동 확인.
- **테스트 우선**: 신규 헬퍼(`buildReportData`, `buildMarkdownContext`)는 순수 함수이므로 단위 테스트를 먼저 작성. `buildLogsHtml`/`buildCaptureFiles` 기존 테스트에 report 주입 케이스 추가.
- **UI 컴포넌트**: 새 스타일링 없이 기존 `Section`/`DocSectionBody`/`Button` 재사용. 직접 스타일링 금지 준수.
- **빌드 의존**: log-viewer 변경은 `pnpm build:log-viewer`로 `dist-log-viewer/index.html`이 갱신돼야 사이드패널 inline에 반영(빌드는 사용자 요청 시에만).

## 대안 검토

1. **copy 마크다운을 log-viewer 런타임에서 빌드** — `MarkdownContext` 전체를 직렬화해 주입하고 log-viewer에서 `buildIssueMarkdown` 호출. → 컨텍스트 직렬화 표면이 커지고 `buildIssueMarkdown` 의존을 log-viewer 번들에 추가. 미리 빌드한 문자열 주입이 단순하고 결과 동일하므로 기각.
2. **`PreviewPanel`을 통째로 log-viewer에서 재사용** — store 결합(13개 상태)·IndexedDB·`IssueCreateModal` 의존이라 떼어내기 비현실적. 렌더 골격만 props 컴포넌트로 추출하는 쪽 채택.
3. **Report 탭에서 본문을 HTML 문자열로 통째 주입(렌더 컴포넌트 없이)** — 사이드패널과 UI 일관성이 깨지고 향후 프리뷰 변경 시 이중 관리. 공유 컴포넌트가 일관성 보장하므로 기각.

## 위험 요소

- **`PreviewPanel` 리팩터 회귀**: 제목 헤더·섹션 합성·media/logCards 삽입 위치를 공유 컴포넌트로 옮길 때, 현재의 "POST_MEDIA 섹션 앞에 media+logCards 삽입, 없으면 말미" 로직(`:309-327`)을 정확히 보존해야 한다. 시각 결과 동일성 수동 확인 필요.
- **log-viewer i18n 누락**: 공유 컴포넌트가 쓰는 키가 log-viewer i18n에 없으면 런타임 키 노출. 추가 키를 빠짐없이 양쪽에 반영.
- **inline 이미지 미resolve**: `buildReportData`에서 resolve를 빠뜨리면 standalone에서 깨진 이미지. `orderedList`/`paragraph` 둘 다 resolve 대상인지(현재 copy 로직은 `renderAs==="paragraph"`만 resolve, `PreviewPanel.tsx:107`) 일치시켜야 한다.
- **번들 크기**: Report 본문(특히 inline dataURL)이 `logs.html` 크기를 키운다. 영상/스크린샷도 이미 dataURL로 임베드되므로 상대적 증가는 작음.
- **`buildCaptureFiles` 입력 비대화**: Report 입력 필드가 늘어 시그니처가 커진다. 호출처 2곳에서 동일하게 채워야 하므로 env 평탄화는 공유 헬퍼(`environmentRows`/`getOsInfo` 기존 사용)로 일관 처리.
