# Log Viewer — Report 탭 — 기술 설계

## 개요

log-viewer는 standalone HTML이라 Zustand store·IndexedDB에 접근할 수 없다. 따라서 Report 탭이 보여줄 이슈 본문(제목·환경·텍스트 섹션·copy용 마크다운)을 **사이드패널에서 직렬화해 `LogViewerData.report`로 주입**한다. UI는 `PreviewPanel`과 동일해야 하므로, 프리뷰의 렌더 골격을 **props 기반 공유 컴포넌트 `IssuePreviewView`** 로 추출해 사이드패널과 log-viewer가 함께 쓴다. Media·Log attachments 삽입은 공유 컴포넌트의 optional slot으로 두어, `PreviewPanel`만 채우고 Report 탭은 비운다.

**공유 컴포넌트의 의존성 격리**: log-viewer i18n은 사이드패널(`@/i18n` `useT()` 훅)과 log-viewer 자체(`src/log-viewer/i18n.ts` `t()` 함수)로 **이중 구조**다. 또 `DocSectionBody`는 `getInlineImage`(blob-db/IndexedDB)를 import한다. 따라서 `IssuePreviewView`는 (1) 모든 라벨(Copy 버튼 텍스트·copied·환경 섹션 제목·섹션 라벨 등)을 **prop으로 주입**받아 내부에서 `t`를 호출하지 않고, (2) 본문은 `DocSectionBody` 대신 **dataURL이 박힌 value를 그대로 렌더하는 경량 렌더러**를 쓴다(blob-db/IndexedDB import 회피). 호출처(PreviewPanel·log-viewer App)가 각자 자기 i18n으로 라벨을 채워 넘긴다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/components/IssuePreviewView.tsx`** — props 기반 이슈 프리뷰 렌더 골격(공유). 제목+Copy 버튼, 환경 rows, 텍스트 섹션 매핑(경량 렌더러), optional media/logCards slot 삽입 로직(`POST_MEDIA_SECTION_IDS` 기준)을 담는다. **라벨은 전부 prop 주입, 본문은 dataURL value 직접 렌더(DocSectionBody 미사용)**. `PreviewPanel`에서 현재 인라인으로 가진 IIFE 합성 로직(`PreviewPanel.tsx:264-329`)과 제목 헤더(`231-245`)를 이 컴포넌트로 이전.
- **`src/sidepanel/lib/buildReportData.ts`** — `LogViewerData["report"]`를 만드는 순수/async 헬퍼. 제목·환경 rows·섹션(`renderAs==="paragraph"`만 inline 이미지 resolve)·copy(markdown/html) 빌드.
- **`src/sidepanel/lib/buildMarkdownContext.ts`** — `PreviewPanel.handleCopyMarkdown`의 캡처모드 4분기 ctx 빌드 로직(`PreviewPanel.tsx:116-210`)을 순수 함수로 추출. **`PreviewPanel` copy 한정 리팩터**다. Report copy는 호출처(IssueCreateModal·DraftDetailDialog)에 이미 만들어진 `ctx`를 재사용하므로, 이 두 곳의 ctx 빌드 중복은 이번 스코프에서 통합하지 않는다.
- 테스트: `src/sidepanel/lib/__tests__/buildReportData.test.ts`, `buildMarkdownContext.test.ts`.

### 변경 파일

- **`src/types/log-viewer.ts`** — `LogViewerData`에 `report` 필드 추가. **`report`는 `meta`보다 앞에 선언**한다(아래 위험요소 참조 — `injectIssueUrl`의 `lastIndexOf('"issueUrl":""')` 마커가 meta 말미를 정확히 잡도록).
- **`src/sidepanel/lib/buildLogsHtml.ts`** — 시그니처 **맨 마지막에 `report: LogViewerReport | null` positional 인자 추가**(기존 8개 positional 순서 유지), `data.report`에 주입.
- **`src/sidepanel/lib/buildCaptureFiles.ts`** — `BuildCaptureFilesInput`에 Report 빌드용 입력(draft/issueSections/envRows/markdownContext) 추가, 로그 게이팅 통과 시에만 `buildReportData` 호출 후 `buildLogsHtml`에 전달.
- **`src/sidepanel/tabs/IssueCreateModal.tsx`** (`:250`) / **`src/sidepanel/tabs/DraftDetailDialog.tsx`** (`:294`) — `buildCaptureFiles` 호출에 Report 입력 전달. **이미 만들어둔 `ctx`를 `markdownContext`로 그대로 넘긴다**(ctx 재빌드 없음). `isElementNoDiff`일 때 `buildCaptureFiles`에 `captureMode:"screenshot"`을 넘기는 기존 동작과 일관되게 — **Report도 `buildCaptureFiles` 기준(screenshot) captureMode로 빌드**한다(ctx의 `element` captureMode와 어긋나는 메타는 buildReportData가 screenshot 기준으로 정렬).
- **`src/sidepanel/tabs/PreviewPanel.tsx`** — 제목 헤더+섹션 합성을 `IssuePreviewView`로 치환(media/logCards slot은 채워서 전달, 라벨은 `useT()`로 채워 주입). copy는 `buildMarkdownContext` 사용으로 정리. **외부 동작·표시 결과는 동일**(순수 리팩터).
- **`src/log-viewer/App.tsx`** — `LogTab`에 `"report"` 추가. `TabsList`는 이미 `CollapsingTabsList`+`TabLabel` 패턴이므로(좁은 폭에서 라벨 접고 아이콘만 — natural width 측정), Report `TabsTrigger`도 **반드시 `<TabLabel>`로 라벨을 감싸고 아이콘(`FileText`)+동일 클래스(`min-w-0 gap-1.5`)를 따른다**(측정 로직 누락·접힘 비대칭 방지). 칸 수가 3→4로 늘어 collapse 임계가 더 자주 걸린다. `TabsContent`(`data-[state=inactive]:hidden`) 추가. fallback 로직은 그대로(Report 제외, 라벨은 log-viewer `t()`로 채워 `IssuePreviewView`에 주입). **Report 탭 활성 시 PageFooter 우하단 Export 버튼은 없다**(다른 탭은 로그 JSON export가 있으나 Report는 추출 대상이 없음 — Copy는 본문 상단 제목 옆에만).
- **`src/log-viewer/i18n.ts`** — `logViewer.tab.report` 키(ko/en) + `IssuePreviewView`가 쓰는 키(`preview.copyMarkdown`, `preview.copied`, `section.env`, `common.empty`, `common.untitled` 등) 중 log-viewer i18n에 없는 것 추가.
- **`src/i18n/`**(사이드패널) — `IssuePreviewView`가 새로 쓰는 키 + logs 드랍 경고 토스트 문구 키 ko/en 추가.

#### logs 첨부 드랍 경고 경로 (신규 — 전 플랫폼 silent drop 개선)

**배경**: 제출 전 byte-size 사전 체크가 코드베이스에 없고, 6개 플랫폼 모두 첨부 실패를 격리(throw 없이 null/continue)해 logs가 **알림 없이 사라진다**. video 모드는 영상이 logs.html에 임베드돼(`buildCaptureFiles.ts:58-69`) 파일이 수십 MB로 부푸는 게 주 트리거, Report dataURL은 그 위에 가산. 플랫폼별 실질 한도: GitLab.com 10MB(하드캡), Linear ~10MB(추정), Notion 5MiB(무료), GitHub 영상 10MB(logs.html 자체는 25MB 여유), Jira 1GB·Asana 100MB(사실상 무위험). 위험은 다르지만 **드랍 감지·경고는 공통 경로로 일원화**한다.

- **`src/types/platform.ts`** — `NormalizedSubmitResult`(`:89-92`)에 `logsDropped?: boolean` 추가.
- **플랫폼별 드랍 감지** — 격리 지점이 제각각이라 각 경로에서 logs(category==="log") 첨부가 빠졌는지 판정해 결과에 `logsDropped: true` 설정:
  - Notion: `submitToNotion.ts:105-109`(`category==="log"` → `continue`)
  - Linear: `submitToLinear.ts:110-130`(`uploadFile().catch(()=>null)` 후 `.filter()`)
  - GitLab: `src/background/messages.ts:390-408`(per-file try/catch, null url — 주석 "10MB 초과 등")
  - GitHub: `github-upload.ts:120-123,164-167`(null href; 본문 "not inlined" 노트는 별개 유지)
  - Jira: `src/background/messages.ts:543-561`(per-att try/catch, `console.warn`)
  - Asana: `src/background/messages.ts:474-496`(per-file 격리, null gid)
  - background(Jira·GitHub·GitLab·Asana) 경로는 **BG 응답 타입에 `logsDropped`를 실어** 사이드패널까지 전파.
- **`src/store/editor-store.ts`** — `submitResult` 타입(`:104,222,611` 부근)을 `{ key; url; logsDropped? }`로 확장, `onSubmitted` 체인으로 전달.
- **`src/sidepanel/tabs/IssueCreateModal.tsx`** — 각 플랫폼 `handle*Submit`에서 `onSubmitted`에 `logsDropped` 포함.
- **`src/sidepanel/tabs/IssueTab.tsx`** — `SubmitSuccessView`(`:346-377`, 제출 완료 화면)에서 `submitResult.logsDropped`가 true면 `useEffect`로 `toast.warning(...)`(sonner) 1회 노출. 문구는 **공통 i18n 키 1개 + `{platformName}` 보간**(키는 하나, 값에 플랫폼명 토큰; 예: "{platformName} 첨부 파일 용량 한도로 `logs.html`이 누락되었습니다"). 무엇이 문제인지(플랫폼의 첨부 파일 용량 한도)를 드러내 버그샷 결함처럼 보이지 않게 한다 → `SubmitSuccessView`에 `submitResult`의 플랫폼(또는 제출 플랫폼)을 보간값으로 전달.

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

// LogViewerData에 추가 — meta보다 앞 필드로 선언(injectIssueUrl 마커 보호)
report: LogViewerReport | null;
```

### 공유 렌더 컴포넌트 (`IssuePreviewView.tsx`)

```ts
interface IssuePreviewViewProps {
  title: string;
  envRows: { label: string; value: string }[];
  sections: { id: string; label: string; renderAs: "paragraph" | "orderedList"; value: string }[];
  // 라벨 prop 주입(공유 컴포넌트 내부에서 t를 호출하지 않음 — 호출처가 자기 i18n으로 채움)
  labels: {
    untitled: string;       // 제목 비었을 때 표시
    copyMarkdown: string;   // Copy 버튼 기본 텍스트
    copied: string;         // 복사 직후 토글 텍스트
    emptyValue: string;     // 빈 섹션 placeholder("(없음)" 등)
  };
  // Copy 버튼: 콜백 주입. PreviewPanel은 런타임 빌드, log-viewer는 미리 박힌 문자열 복사.
  onCopy?: () => void | Promise<void>;
  // media/logCards slot — PreviewPanel만 채움. Report 탭은 미전달(undefined).
  media?: React.ReactNode;
  logCards?: React.ReactNode;
  postMediaSectionIds?: Set<string>;   // slot 삽입 위치(기본 POST_MEDIA_SECTION_IDS)
}
```

- `copied` 토글 상태는 컴포넌트 내부에서 관리(현 `PreviewPanel.tsx:80-85` 이전). 접근성을 위해 토글 영역에 `aria-live="polite"`를 추가한다.
- 본문은 `DocSectionBody`를 쓰지 않는다(blob-db/IndexedDB import 회피). 대신 **dataURL이 박힌 `value`를 그대로 마크다운 렌더하는 경량 렌더러**를 둔다. 빈 섹션은 `emptyVariant="muted"`(placeholder, `labels.emptyValue`)로 표시 — `PreviewPanel`과 동일, 숨김 아님.
- media/logCards 미전달 시 마지막 텍스트 섹션이 `Section`의 `last:border-b-0` 대상이 되어 하단 border가 사라진다(`PreviewPanel`은 항상 media 블록이 말미). "동일 UI"의 미세한 허용 예외다.

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

- 섹션: `sectionConfig.filter(enabled)` 순서로 `{ id, label, renderAs, value }`. **inline 이미지 resolve는 `renderAs==="paragraph"` 섹션만** 적용한다(`resolveInlineImages(value).resolved`). 이는 현 copy 로직(`PreviewPanel.tsx:107`)·`DocSectionBody`의 orderedList 분기(inline 마커 미resolve)와 정확히 일치한다 — orderedList엔 inline 이미지 입력 경로가 없다. paragraph 외 섹션은 `value`를 그대로 사용.
- copy: `{ markdown: buildIssueMarkdown(markdownContext), html: buildIssueHtml(markdownContext) }`. `markdownContext`는 호출처가 넘긴 ctx 그대로(재빌드 없음) → Report Copy 결과 == 프리뷰 Copy 결과 보장.

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

- 기존 `PreviewPanel.handleCopyMarkdown`의 4분기 로직(freeform/video/element/screenshot)을 그대로 옮긴다. `MarkdownContext`는 `buildIssueMarkdown.ts`의 입력 타입. **`PreviewPanel` copy 한정 추출**이며, `useEditorStore.getState()`로 직접 읽던 값(`freeformViewport`/`freeformCapturedAt` 등)·`?? Date.now()` 폴백은 전부 **인자로 주입**해 순수·결정적으로 만든다(인자 표면이 10개+로 커지지만 테스트 가능성 우선).

### log-viewer 탭 (`App.tsx`)

```ts
type LogTab = "report" | "console" | "network" | "action";
const hasReport = !!data?.report;
// 기본 탭 fallback: Report 제외(보조 탭이라 자동 선택 안 함, 의도). report 분기 없음.
const defaultTab: LogTab = hasConsole ? "console" : hasNetwork ? "network" : "action";
// CollapsingTabsList에 Report TabLabel(FileText)을 맨 앞에 추가, disabled={!hasReport}
```

- `disabled={!hasReport}`가 실제로 걸리는 경우는 **구버전 `logs.html`(report 필드 없음)을 여는 하위호환 케이스뿐**이다(신규 생성 경로는 게이팅 통과 시 report가 항상 채워짐). 이때도 다른 탭과 동일하게 grid 자리를 차지하고, `TabsContent`는 빈 상태 메시지를 따른다(탭 자체를 숨기지 않음).

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
- **log-viewer i18n 누락**: 공유 컴포넌트가 쓰는 키가 log-viewer i18n에 없으면 런타임 키 노출. 단 `IssuePreviewView`는 라벨을 prop으로 받으므로 키 누락은 **호출처(log-viewer App)에서 라벨을 채울 때** 드러난다 — log-viewer i18n에 `logViewer.tab.report` 외 라벨 키(copyMarkdown/copied/untitled/env 섹션 제목/emptyValue)를 빠짐없이 추가.
- **`injectIssueUrl` 마커 충돌**: `injectIssueUrl`은 `json.lastIndexOf('"issueUrl":""')`로 빈 마커를 치환한다. report 본문에 빈 문자열 필드가 **meta보다 뒤에** 직렬화되면 마지막 매치가 엉뚱한 곳을 가리킬 수 있다 → `LogViewerData`에서 `report`를 `meta`보다 **앞**에 선언해 회피. 회귀 테스트로 "report에 빈 `issueUrl`-유사 문자열 포함 시 meta 말미만 치환" 케이스 추가.
- **`buildLogsHtml` positional 취약성**: 9번째 positional로 report를 추가하므로 인자 순서가 더 취약해진다(현재도 `issueUrl=undefined`를 명시 전달). 호출처·테스트에서 위치 정합 확인.
- **inline 이미지 resolve 범위(확정: paragraph만)**: `buildReportData`는 `renderAs==="paragraph"` 섹션만 `resolveInlineImages`한다 — 현 copy 로직(`PreviewPanel.tsx:107`)·`DocSectionBody` orderedList 분기(inline 미resolve)와 일치. enabled 전체에 돌리면 안 됨(과거 본 명세의 모순을 수정함).
- **번들 크기 / Notion 5 MiB 한도**: Report 본문(특히 inline dataURL)이 `logs.html` 크기를 키운다. 영상/스크린샷도 이미 dataURL로 임베드되므로 일반 경로의 상대적 증가는 작지만, **Notion은 `zipLogsHtml`로 deflate 후 무료 워크스페이스 5 MiB 한도**에 묶인다. report의 inline dataURL이 기존 media 임베드 위에 **추가**되므로, 대규모 inline draft에서 한도 초과로 logs 첨부가 빠질 수 있다. 현재 이 드랍은 **silent**(`submitToNotion.ts:105-109` 격리 catch — 이슈는 생성, logs만 누락, 알림 없음)라 사용자가 인지 못 한다 → Task 12에서 **제출 완료 화면 경고 토스트**로 노출(실패 반응형). 크기 영향도 수동 검증 항목으로 둔다(tasks.md).
- **`buildCaptureFiles` 입력 비대화**: Report 입력 필드가 늘어 시그니처가 커진다. 호출처 2곳에서 동일하게 채워야 하므로 env 평탄화는 기존 헬퍼로 일관 처리한다 — 실제 export는 `deriveReadonlyEnvRows`/`filterEnvironmentRows`(`environmentRows.ts`)와 `getOsInfo`(`osInfo.ts`). 단 `deriveReadonlyEnvRows`의 viewport는 `{w,h}`라 `MarkdownContext`의 `{width,height}`로 **키 변환**이 필요하다.
