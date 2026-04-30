# 네트워크 로그 캡처 — 태스크

> PRD: `docs/network-log-prd.md` 기반. video 캡처 모드 전용, 동적 MAIN world 주입, 녹화 정지 시 일괄 전달.

## 의존 그래프

```
T1 타입 정의
 ├→ T2 blob-db
 ├→ T3 editor-store
 │    └→ T4 issues-store
 ├→ T5 network-recorder (MAIN world)
 │    └→ T6 picker.ts 브리지 (ISOLATED)
 │         └→ T7 picker-control + video-recorder 통합
 │              └→ T8 usePickerMessages + useEditorSessionSync
 │                   └→ T9 NetworkLogToggle + NetworkLogPreviewDialog
 │                        └→ T10 DraftingPanel 통합
 ├→ T11 buildHar
 │    └→ T12 빌더 확장 (markdown/adf/html)
 │         └→ T13 IssueCreateModal + DraftDetailDialog 첨부
 │              └→ T14 PreviewPanel 복사
 └→ T15 tab-bindings + 세션 훅 정리
T16 i18n (언제든)
```

---

## T1. 타입 정의

**파일**: `src/types/network.ts` (신규)

`NetworkLog`, `NetworkRequest`, `NetworkLogSelection` 타입을 PRD 7.5절 데이터 모델 그대로 정의.

```ts
export type NetworkRequestBody = string | { kind: "truncated" | "stream" | "binary" | "omitted" };

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  startTime: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: NetworkRequestBody;
  responseBody?: NetworkRequestBody;
  pageUrl: string;
  requestBodySize: number;
  responseBodySize: number;
  contentType: string;
}

export interface NetworkLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;
  captured: number;
  warnings: ("MEMORY_CAPPED" | "WS_UNSUPPORTED" | "BODY_TRUNCATED")[];
  requests: NetworkRequest[];
}

export interface NetworkLogSelection {
  selectedIds: string[];
}
```

**완료 기준**: `pnpm typecheck` 통과.

---

## T2. blob-db 확장

**파일**: `src/store/blob-db.ts`

IndexedDB에 `"networkLogs"` object store 추가. DB_VERSION bump (2 → 3).

```ts
export async function saveNetworkLog(key: string, log: NetworkLog): Promise<void>
export async function getNetworkLog(key: string): Promise<NetworkLog | null>
export async function deleteNetworkLog(key: string): Promise<void>
export async function getNetworkLogKeys(): Promise<string[]>
export async function clearNetworkLogs(): Promise<void>
```

- 키 체계: recording 중 `pending:${tabId}`, confirmDraft 시 `issueId`로 rename
- `renameNetworkLogKey(oldKey, newKey)` 유틸 추가

**완료 기준**: 함수 단위 동작 확인 (콘솔에서 save → get → delete 사이클).

---

## T3. editor-store 확장

**파일**: `src/store/editor-store.ts`

EditorState에 네트워크 로그 관련 필드 추가:

```ts
// 상태
networkLog: NetworkLog | null;
networkLogAttach: boolean;           // 토글 ON/OFF
networkLogSelectedIds: string[];     // 다이얼로그 선택

// 액션
setNetworkLog(log: NetworkLog): void;
setNetworkLogAttach(on: boolean): void;
setNetworkLogSelectedIds(ids: string[]): void;
```

- `startRecording()`: 네트워크 관련 필드 초기화 (`networkLog: null, networkLogAttach: false, networkLogSelectedIds: []`)
- `onRecordingComplete()`: 기존 로직 유지. networkLog는 외부에서 `setNetworkLog`로 세팅 (일괄 전달 수신 시)
- `reset()`: 네트워크 필드 초기화
- `initial` 객체에 네트워크 필드 기본값 추가

**완료 기준**: `pnpm typecheck` 통과.

---

## T4. issues-store 확장

**파일**: `src/store/issues-store.ts`

`IssueRecord`에 필드 추가:

```ts
networkLogBlobKey?: string;
networkLogSelectedIds?: string[];
```

정리 로직 보강:
- `stripSubmitted()`: `networkLogBlobKey`, `networkLogSelectedIds` 유지 (재제출용)
- `removeIssue()`: `deleteNetworkLog(issue.id)` 호출 추가
- `markSubmitted()`: blob 정리 시 네트워크 로그는 **유지** (재제출 가능해야 함)
- `clearIssues()`: `clearNetworkLogs()` 호출 추가
- `pruneOrphanBlobs()`: `getNetworkLogKeys()` 순회 → 고아 blob 정리

`editor-store.ts`의 `confirmDraft()`에서:
- `saveNetworkLog(issueId, networkLog)` 호출
- `renameNetworkLogKey("pending:${tabId}", issueId)` 호출
- `IssueRecord`에 `networkLogBlobKey: issueId`, `networkLogSelectedIds` 저장

**완료 기준**: `pnpm typecheck` 통과. removeIssue 시 blob 정리 확인.

---

## T5. network-recorder.ts (MAIN world)

**파일**: `src/content/network-recorder.ts` (신규)

`chrome.scripting.executeScript({ world: "MAIN", func, args })`로 주입될 함수.

**코드 구조**: 모듈에서 `export function networkRecorderScript(sentinel: string) { ... }` 형태로 정의. 내부 로직은 모두 이 함수 안에 self-contained (closure/import 접근 불가 — Chrome이 함수를 직렬화해서 페이지에 주입하므로). picker-control.ts에서 import해서 `func` 파라미터로 전달.

### 핵심 로직

1. **fetch wrap**: `window.fetch`를 래핑. 원본 호출 전에 request 메타 기록, body 캡처 (아래 3단계 가드 적용).
2. **XHR wrap**: `XMLHttpRequest.prototype.open/send`를 래핑. `load` 이벤트에서 response 캡처.
3. **버퍼**: 배열에 `NetworkRequest` 축적. 30MB cap 관리 (oldest body부터 drop).
4. **마스킹**: PRD 6.1절 룰 적용 (헤더, 쿼리 파라미터, request body JSON 재귀).
5. **body 읽기 3단계 가드**:
   - (a) **content-type 체크**: denylist(`image/*`, `audio/*`, `video/*`, `font/*`, `application/pdf`, `application/wasm`, `application/octet-stream`) 매치 시 `response.clone()` 자체를 안 함. 메타만 캡처 + `{ kind: "binary" }`.
   - (b) **Content-Length 사전 필터링**: 헤더 값이 1MB 초과 시 body 읽기 skip + `{ kind: "truncated" }`.
   - (c) **스트리밍 누적 체크**: `response.clone().body.getReader()`로 chunk 단위 읽기. 누적 바이트가 1MB 초과하면 버퍼 폐기 + `{ kind: "truncated" }`. Content-Length가 없거나 부정확한 경우 대비.
   - allowlist(`application/json`, `text/*`, `application/xml`, `application/x-www-form-urlencoded`)에 매치하면 body 읽기 진행.
6. **CustomEvent 수신**: SENTINEL로 검증. `stop` 이벤트 수신 시 버퍼 일괄 dispatch.

### 입력 (args)

```ts
args: [sentinel: string]
```

### 출력 (CustomEvent)

```ts
// MAIN → ISOLATED
document.dispatchEvent(new CustomEvent("__bugshot_net_data__" + sentinel, {
  detail: { requests: NetworkRequest[], totalSeen, warnings }
}));
```

### 마스킹 상수

```ts
const MASKED_HEADERS = new Set(["authorization", "cookie", "set-cookie", ...]);
const MASKED_HEADER_PATTERNS = [/^x-.*-token$/i, /^x-.*-key$/i, /^x-.*-secret$/i];
const MASKED_QUERY_KEYS = new Set(["token", "access_token", "api_key", ...]);
const MASKED_BODY_KEYS = new Set([...MASKED_QUERY_KEYS]);
```

**주의**: `sync` CustomEvent는 풀 페이지 네비게이션 후에는 동작하지 않음 (MAIN world context 파괴). sidepanel re-mount 시에만 유효. 풀 네비게이션 후에는 재주입이 필요 (T15 참조).

**완료 기준**: 테스트 페이지에서 fetch 래핑 동작 확인. 마스킹 적용 확인. cap 초과 시 oldest drop 확인.

---

## T6. picker.ts 브리지 (ISOLATED)

**파일**: `src/content/picker.ts`

메시지 핸들러 추가:

```ts
case "networkRecorder.setSentinel":
  // SENTINEL 저장. CustomEvent 리스너 등록.
  networkSentinel = msg.sentinel;
  document.addEventListener("__bugshot_net_data__" + networkSentinel, handleNetData);
  break;

case "networkRecorder.stop":
  // MAIN world에 stop 신호
  document.dispatchEvent(new CustomEvent("__bugshot_net_stop__" + networkSentinel));
  break;

case "networkRecorder.sync":
  // MAIN world에 sync 요청 (버퍼 재전달)
  document.dispatchEvent(new CustomEvent("__bugshot_net_sync__" + networkSentinel));
  break;
```

`handleNetData`: CustomEvent detail을 `chrome.runtime.sendMessage({ type: "networkRecorder.data", payload })`.

**완료 기준**: stop 메시지 → CustomEvent → MAIN world 반응 → data 이벤트 → ISOLATED → sendMessage 체인 동작.

---

## T7. picker-control + video-recorder 통합

**파일**: `src/sidepanel/picker-control.ts`, `src/sidepanel/video-recorder.ts`, `src/sidepanel/tabs/IssueTab.tsx`

### picker-control.ts

```ts
export async function injectNetworkRecorder(tabId: number): Promise<string>
// 1. await ensureContentScript(tabId)  ← picker.ts가 먼저 로드되어야 브리지 동작
// 2. sentinel = crypto.randomUUID()
// 3. chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: networkRecorderScript, args: [sentinel] })
// 4. await send(tabId, { type: "networkRecorder.setSentinel", sentinel })
// 5. return sentinel

export async function stopNetworkRecorder(tabId: number): Promise<void>
// send(tabId, { type: "networkRecorder.stop" })

export async function syncNetworkRecorder(tabId: number): Promise<void>
// send(tabId, { type: "networkRecorder.sync" })
```

### IssueTab.tsx `handleStartVideo`

```ts
async function handleStartVideo(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  useEditorStore.getState().startRecording({ tabId, url: tab.url ?? "", title: tab.title ?? "" });
  try {
    await injectNetworkRecorder(tabId);       // 네트워크 래퍼 주입 (실패해도 녹화는 진행)
  } catch (err) {
    console.warn("[bugshot] network recorder injection failed", err);
    // 주입 실패 시 네트워크 로그 없이 녹화만 진행 (graceful degradation)
  }
  try {
    await videoRecorder.startRecording(tabId); // 탭 캡처 시작
  } catch (err) {
    console.warn("[bugshot] video recording failed to start", err);
    useEditorStore.getState().cancelRecording();
  }
}
```

**주입 실패 케이스**: chrome:// 페이지, 웹스토어 페이지 등에서 `scripting.executeScript`가 거부됨. 이 경우 네트워크 로그 없이 비디오만 녹화. DraftingPanel에서 `networkLog === null`이면 토글 미표시.

### video-recorder.ts `stopRecording`

`stopRecording()`에서 `recorder.stop()` 호출 **전에** `stopNetworkRecorder(state.tabId)` 호출. 이유: `recorder.onstop` 콜백이 `state = null`로 초기화하므로 tabId가 사라짐.

```ts
export function stopRecording(): void {
  if (!state) return;
  void stopNetworkRecorder(state.tabId);  // fire-and-forget, tabId 먼저 캡처
  if (state.recorder.state === "recording") {
    state.recorder.stop();
  }
}
```

### Race condition 주의

`stopNetworkRecorder` → CustomEvent 체인 → `usePickerMessages`의 `networkRecorder.data` 수신과, `recorder.onstop` → `onRecordingComplete` → phase: drafting은 **독립적인 비동기 흐름**. 어느 쪽이 먼저 완료될지 보장 없음.

처리: `setNetworkLog`는 phase와 무관하게 동작하므로 순서 무관. 네트워크 데이터가 늦게 도착해도 store에 세팅되면 DraftingPanel이 반응.

**완료 기준**: 녹화 시작 → fetch 래핑 동작 → 녹화 정지 → 네트워크 데이터 수신. 주입 실패 시 비디오만 녹화 확인.

---

## T8. usePickerMessages + useEditorSessionSync

**파일**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`

### usePickerMessages.ts

`networkRecorder.data` 메시지 핸들러 추가:

```ts
case "networkRecorder.data":
  const log: NetworkLog = {
    id: crypto.randomUUID(),
    startedAt: ...,
    endedAt: Date.now(),
    totalSeen: msg.payload.totalSeen,
    captured: msg.payload.requests.length,
    warnings: msg.payload.warnings,
    requests: msg.payload.requests,
  };
  useEditorStore.getState().setNetworkLog(log);
  // blob-db에 임시 저장 (pending:${tabId})
  saveNetworkLog(`pending:${tabId}`, log).catch(() => {});
  break;
```

### useEditorSessionSync.ts

`EditorSnapshot`에 메타 추가:

```ts
networkLogCapturedCount: number;  // networkLog?.captured ?? 0
networkLogSelectedIds: string[];
networkLogAttach: boolean;
```

body 데이터는 포함하지 않음 (blob-db 전용). hydrate 시 blob-db에서 별도 로드:

```ts
if (snap.networkLogCapturedCount > 0) {
  getNetworkLog(`pending:${tabId}`).then(log => {
    if (log) useEditorStore.getState().setNetworkLog(log);
  });
}
```

**완료 기준**: 녹화 완료 후 sidepanel 닫았다 열어도 네트워크 로그 메타 유지.

---

## T9. NetworkLogToggle + NetworkLogPreviewDialog

**파일**: `src/sidepanel/components/NetworkLogToggle.tsx` (신규), `src/sidepanel/components/NetworkLogPreviewDialog.tsx` (신규)

### NetworkLogToggle

```
☑ 네트워크 로그 첨부   47건 캡처 · 3건 선택           [👁]
```

- shadcn `Switch` + 라벨 + 카운터 + IconButton (lucide `Eye`, `h-8 w-8`)
- `networkLog === null || networkLog.captured === 0` → 비활성 + 툴팁
- 토글 ON → 다이얼로그 자동 오픈
- 다이얼로그 닫을 때 0건 → 토글 OFF

### NetworkLogPreviewDialog

LNB + Content 좌우 2분할. shadcn `Dialog`.

**좌 LNB**:
- 에러(4xx/5xx) 상단, 나머지 하단
- 각 행: Checkbox · Method badge · Path (ellipsis) · Status · Time
- 행 클릭 → 우측 상세 표시 (체크박스와 독립)
- 하단: "N건 선택" 카운터 + 닫기

**우 Content**:
- General: URL, Method, Status, StatusText, Time, Size
- Request Headers (접힘) — 마스킹 항목은 🔒 + length
- Request Body — JSON pretty print 또는 raw
- Response Headers (접힘)
- Response Body — 동일
- 하단: curl 복사 버튼 (마스킹 헤더는 `# masked by BugShot` 코멘트)

**표시 규칙**: PRD 5.3.2절 그대로 (마스킹, 잘림, 바이너리, 스트림).

**완료 기준**: 다이얼로그 열고 요청 선택/해제, 상세 표시, curl 복사 동작.

---

## T10. DraftingPanel 통합

**파일**: `src/sidepanel/tabs/DraftingPanel.tsx`

- `captureMode === "video"` && `networkLog !== null` 일 때만 `NetworkLogToggle` 렌더링
- 위치: VideoPreview 아래, 사용자 정의 섹션 위 (Media 섹션 근처)

**완료 기준**: 비디오 녹화 후 Draft 화면에 토글 표시. element/screenshot 모드에서는 미표시.

---

## T11. buildHar.ts

**파일**: `src/sidepanel/lib/buildHar.ts` (신규)

`NetworkLog` + `selectedIds` → HAR 1.2 JSON 변환.

PRD 7.6절 기본값 룰 적용:
- `log.creator`: `{ name: "BugShot", version }`
- `httpVersion`: `"HTTP/1.1"`
- `cookies`: `[]`
- `headersSize`: `-1`
- `timings`: `{ send: 0, wait: durationMs, receive: 0, blocked: -1, dns: -1, connect: -1, ssl: -1 }`
- `_bugshot` entries 레벨 (truncation/masking/warnings)

```ts
export function buildHar(log: NetworkLog, selectedIds: string[]): object
export function serializeHar(har: object): string  // JSON.stringify(har, null, 2)
```

**완료 기준**: 샘플 NetworkLog → HAR JSON 생성 → DevTools Import에서 파싱 성공.

---

## T12. 빌더 확장 (markdown / adf / html)

**파일**: `src/sidepanel/lib/buildIssueMarkdown.ts`, `buildIssueAdf.ts`, `buildIssueHtml.ts`

### MarkdownContext 확장

```ts
networkLog?: {
  requests: NetworkRequest[];
  selectedIds: string[];
};
```

### 출력

요약 테이블만 inline (body 없음):

```markdown
### 네트워크 로그 (N건 첨부)

| Method | Path | Status | Time |
|--------|------|--------|------|
| POST | /api/users | 400 Bad Request | 124ms |
...

첨부: network-log.har (N건 — 상세 request/response body 포함)
```

- `POST_MEDIA_SECTION_IDS` 룰에 맞춰 미디어 블록 근처에 출력
- `networkLog` 필드 없거나 `selectedIds` 빈 배열이면 미출력

ADF: `table` 노드 + `paragraph` (첨부 안내).
HTML: `<table>` + `<p>`.

**완료 기준**: 3개 빌더 모두 네트워크 로그 섹션 출력 확인. 기존 출력 regression 없음.

---

## T13. IssueCreateModal + DraftDetailDialog 첨부

**파일**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`

### IssueCreateModal

video 모드 + `networkLogAttach && networkLogSelectedIds.length > 0` 일 때:
1. `buildHar(networkLog, selectedIds)` → JSON string
2. `Blob` → `blobToDataUrl`
3. `attachments.push({ filename: "network-log.har", dataUrl })`

`MarkdownContext`에 `networkLog` 필드 전달.

### DraftDetailDialog

재제출 경로:
1. `IssueRecord.networkLogBlobKey`가 있으면 `getNetworkLog(key)` 로드
2. `IssueRecord.networkLogSelectedIds`로 HAR 빌드
3. attachments에 추가

**완료 기준**: Jira 제출 시 network-log.har 첨부 확인. 재제출 시에도 HAR 첨부 확인.

---

## T14. PreviewPanel 마크다운 복사

**파일**: `src/sidepanel/tabs/PreviewPanel.tsx`

`handleCopyMarkdown`에서 video 모드 + 네트워크 로그 선택 시:
- 요약 테이블만 포함 (body 생략)
- HAR 파일은 클립보드에 넣을 수 없으므로 생략
- `text/html` 출력에도 동일 테이블

**완료 기준**: 복사 후 Slack/Notion에 붙여넣기 시 테이블 표시 확인.

---

## T15. tab-bindings + 세션 훅 정리

### background: tab-bindings.ts

**탭 닫힘 시** `onRemoved`에서:
- `deleteNetworkLog("pending:" + tabId)` 호출 추가

### sidepanel: useEditorSessionSync.ts

sidepanel은 이미 `chrome.tabs.onUpdated`를 리스닝 중. 여기에 추가:

**풀 페이지 네비게이션 중 녹화 재주입**:
`tabs.onUpdated` status=complete 시, phase === "recording" && captureMode === "video" → `injectNetworkRecorder(tabId)` 재주입. (background는 sidepanel의 `injectNetworkRecorder`를 호출할 수 없으므로 sidepanel에서 처리)

**origin 변경 시 네트워크 로그 버퍼 초기화**:
video 모드에서 origin 변경 감지 시:
- recording 중이면 content script에 reset 메시지 (기존 버퍼 drop, 데이터 전달 안 함)
- drafting 이후면 blob-db 데이터는 유지

**완료 기준**: 탭 닫힘 시 pending blob 정리 확인. 풀 네비게이션 중 녹화 시 재주입 확인. origin 변경 시 버퍼 초기화 확인.

---

## T16. i18n

**파일**: `src/i18n/ko.ts`, `src/i18n/en.ts`

추가할 키:
- `networkLog.toggle.label`: 네트워크 로그 첨부 / Attach network logs
- `networkLog.toggle.tooltip.empty`: 녹화 중 네트워크 요청이 감지되지 않았습니다 / No network requests captured during recording
- `networkLog.counter.captured`: {n}건 캡처 / {n} captured
- `networkLog.counter.selected`: {n}건 선택 / {n} selected
- `networkLog.dialog.title`: 네트워크 로그 / Network Logs
- `networkLog.dialog.errors`: 에러 / Errors
- `networkLog.dialog.other`: 기타 / Other
- `networkLog.dialog.footer.selected`: {n}건 선택 / {n} selected
- `networkLog.dialog.close`: 닫기 / Close
- `networkLog.detail.general`: 일반 / General
- `networkLog.detail.requestHeaders`: 요청 헤더 / Request Headers
- `networkLog.detail.requestBody`: 요청 본문 / Request Body
- `networkLog.detail.responseHeaders`: 응답 헤더 / Response Headers
- `networkLog.detail.responseBody`: 응답 본문 / Response Body
- `networkLog.detail.copyCurl`: curl 복사 / Copy as curl
- `networkLog.display.truncated`: 캡처: {captured} / 전체: {total} / Captured: {captured} / Total: {total}
- `networkLog.display.binary`: 이미지 응답 ({type} · {size}) · 본문 미저장 / Image response ({type} · {size}) · Body not saved
- `networkLog.display.stream`: 스트리밍 응답 ({type}) · 본문 캡처 안 됨 / Streaming response ({type}) · Body not captured
- `networkLog.privacy.warning`: response body에 포함된 개인정보는 사용자 책임입니다 / Personal information in response bodies is the user's responsibility
- `networkLog.har.summary`: 첨부: network-log.har ({n}건 — 상세 request/response body 포함) / Attached: network-log.har ({n} entries — includes request/response body details)

**완료 기준**: 한/영 전환 시 모든 라벨 표시.

---

## 구현 순서 (권장)

| 순서 | 태스크 | 예상 난이도 |
|------|--------|-----------|
| 1 | T1 타입 정의 | 낮음 |
| 2 | T2 blob-db | 낮음 |
| 3 | T3 editor-store | 중간 |
| 4 | T5 network-recorder | **높음** (핵심) |
| 5 | T6 picker.ts 브리지 | 중간 |
| 6 | T7 picker-control + video-recorder | 중간 |
| 7 | T8 hooks 확장 | 중간 |
| 8 | T4 issues-store | 중간 |
| 9 | T16 i18n | 낮음 |
| 10 | T11 buildHar | 중간 |
| 11 | T12 빌더 확장 | 중간 |
| 12 | T9 UI 컴포넌트 | **높음** |
| 13 | T10 DraftingPanel 통합 | 낮음 |
| 14 | T13 첨부 처리 | 중간 |
| 15 | T14 PreviewPanel 복사 | 낮음 |
| 16 | T15 tab-bindings | 중간 |

총 16개 태스크. T5(network-recorder)와 T9(UI 컴포넌트)가 가장 큰 작업.
