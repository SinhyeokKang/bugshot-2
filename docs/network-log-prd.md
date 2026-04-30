# 네트워크 로그 캡처 — PRD

> bugshot-2가 녹화 중 페이지의 네트워크 요청을 함께 캡처해 Jira 이슈에 첨부하는 기능.

## 1. 배경

bugshot-2는 디자인 QA를 본업으로 하는 Chrome MV3 사이드패널 확장이다. 현재 비디오 녹화·DOM·스타일 정보를 Jira 이슈에 첨부할 수 있다.

사용자(디자이너·QA 엔지니어·PM) 중 50% 이상이 시각/CSS가 아닌 **기능·API 버그**를 다룬다. 이 경우 현재 워크플로우는 다음과 같다:

1. 버그 발견
2. Chrome DevTools Network 탭에서 요청 조사 (1차 재현)
3. client/server 책임 분기 판단
4. bugshot 녹화로 다시 재현 (2차 재현)
5. 이슈 작성·제출

문제:
- step 4의 "재현 2차"가 race·타이밍 의존 버그에서 유실될 위험
- step 2~3에서 본 네트워크 정보가 이슈에 명시적으로 전달되지 않음
- 결과: 이슈 받은 dev가 책임 분기를 다시 판단하거나 직접 재현 → 핑퐁 비용

## 2. 목표

DevTools에서 사용자가 이미 본 네트워크 요청을 bugshot **비디오 녹화**에 함께 캡처해 Jira 이슈에 자동 첨부한다. dev가 이슈를 받았을 때 첨부된 정보만으로 책임 분기와 재현 시도가 가능해야 한다.

**포지셔닝**: DevTools의 **보완재** (대체재 아님). 사용자는 평소처럼 DevTools에서 조사하고, 보고할 가치가 있다고 판단되면 bugshot 녹화로 그 시점의 네트워크 정보를 함께 전달한다.

**v1 스코프**: 네트워크 로그는 **video 캡처 모드에서만** 동작한다. element/screenshot 모드는 v2 후보.

### Non-goals

- DevTools 대체
- 항상 켜진 백그라운드 모니터링 / 사용자 미인지 silent bug 감지 (RUM·error tracking 영역)
- WebSocket / EventSource / gRPC 캡처 (page injection으로 잡히지 않음)
- Element ↔ Network 자동 매핑 (휴리스틱 정확도 부족)
- element / screenshot 캡처 모드에서의 네트워크 로그 (v2 후보)
- iframe 내부 요청 캡처 (cross-origin iframe은 보안상 불가, same-origin도 v1 제외)

## 3. 사용자

### Producer (이슈 생산자)
- 디자이너, QA 엔지니어, PM
- bugshot 사이드패널을 사용해 이슈 작성
- DevTools 익숙도는 다양

### Consumer (이슈 소비자)
- 프론트엔드 / 백엔드 개발자
- Jira 이슈를 받아 디버깅·재현·수정

## 4. 사용자 플로우

### Producer

1. 버그 발견 → DevTools에서 조사 (요청 확인, 책임 분기 판단)
2. bugshot 사이드패널에서 녹화 시작
3. 버그 재현
4. 녹화 정지
5. Draft에서 "네트워크 로그 첨부" 토글 ON
6. 다이얼로그 자동 오픈 → 이슈에 적재할 엔드포인트를 명시적으로 선택 (1건 이상 필수)
7. 이슈 작성 → Jira 제출

생산자가 본인이 첨부하는 요청에 책임을 진다. 자동 큐레이션·자동 핀 룰은 없음.

### Consumer

1. Jira 이슈 본문 확인 — 생산자가 선택한 엔드포인트의 요약 테이블 (method + path + status + time)
2. 첨부된 HAR 파일을 DevTools/Charles 등에서 열어 request/response body 확인
3. 책임 분기 즉시 판단

## 5. 기능 요구사항

### 5.1 캡처(수집)과 첨부(적재) 구분

용어 정의:
- **캡처(수집)**: 녹화 중 fetch/XHR 요청·응답 데이터를 메모리 버퍼에 기록하는 행위
- **첨부(적재)**: Draft 단계에서 사용자가 캡처된 요청 중 이슈에 포함할 것을 선택하는 행위

### 5.2 캡처 동작

- **시점**: 녹화 시작 → 정지 사이에만 캡처. 녹화 외 시간엔 캡처 안 함. video 캡처 모드 전용.
- **대상**: `window.fetch` + `XMLHttpRequest`. WebSocket/EventSource/gRPC 제외.
- **데이터**: URL, method, request headers, request body, response status, response headers, response body, timing, pageUrl(캡처 시점의 `location.href`).
- **자동 ON**: 녹화 시작 시 사용자가 별도 토글하지 않음. 비디오와 같은 lifecycle.
- **첨부 결정**: Draft 시점에 토글 ON → 다이얼로그 자동 오픈 → 사용자가 적재할 엔드포인트를 명시적으로 선택. 1건 이상 선택 필수. 0건 선택 후 다이얼로그 닫으면 토글 자동 OFF.
- **데이터 전달**: content script(MAIN world)가 자체 버퍼에 축적. **녹화 정지 시** MAIN → ISOLATED → sidepanel으로 일괄 전달 (1회 메시지). 녹화 중에는 sidepanel과 통신하지 않음.

### 5.3 사이드패널 UI (Producer)

#### 5.3.1 Draft 메인 화면

`DraftingPanel`의 Media 섹션 근처에 한 줄 추가:

```
☑ 네트워크 로그 첨부   47건 캡처 · 3건 선택           [👁]
```

- shadcn `Switch` + 라벨 + 카운터 + IconButton (`h-8 w-8`, lucide `Eye`)
- 캡처 0건 시 비활성 + 툴팁("녹화 중 네트워크 요청이 감지되지 않았습니다")
- 토글 디폴트: OFF
- 토글 ON 시 다이얼로그 자동 오픈 (사용자가 선택 강제)
- 다이얼로그 닫을 때 0건 선택이면 토글 자동 OFF (invalid)
- 1건 이상 선택 후 닫히면 토글 ON 유지, 카운터에 "N건 선택" 표시
- [👁] 버튼은 토글 ON 후에도 다이얼로그 다시 열어 선택 변경 시 사용
- 녹화 중 별도 UI 없음 (실시간 카운터 안 함)

#### 5.3.2 미리보기 다이얼로그 (NetworkLogPreviewDialog)

DevTools Network 탭 형태의 **LNB + Content 2분할**.

- 좌 (LNB): 캡처된 API 리스트, 각 행에 체크박스 (이슈에 적재할 엔드포인트 선택)
- 우 (Content): 행 클릭 시 표시되는 상세
- 긴 JSON은 우측 panel 내부 스크롤
- shadcn `Dialog` 패턴 (기존 `DraftDetailDialog` 답습)
- 선택 상태는 즉시 반영 (별도 저장 버튼 없음)
- 다이얼로그 닫을 때 0건이면 토글 자동 OFF

##### 좌 LNB

- ⚠ Errors (4xx/5xx) 상단
- Other (200대) 하단
- 각 행: ☐ 체크박스 · Method · Path · Status (Time은 우측 작게)
- Path overflow ellipsis, hover 시 full URL 툴팁
- 행 클릭 → 우측 Content에 상세 표시 (선택 토글과 별도)
- 체크박스 클릭 → 적재 대상 토글
- 하단 푸터: "N건 선택" 카운터 + 닫기 버튼

##### 우 Content

행 클릭 시 표시되는 상세:

- **General**: URL (full), Method, Status, Status text, Time, Size (req/res)
- **Request Headers** (접힘 디폴트): 마스킹 항목은 🔒 + length
- **Request Body**: JSON parse 가능하면 pretty print, 아니면 raw text
- **Response Headers** (접힘 디폴트)
- **Response Body**: 동일
- **하단 액션**: `[📋 curl 복사]` — 마스킹된 헤더는 `# Authorization: masked by BugShot` 코멘트로 표시

##### 표시 규칙

- 마스킹: `Authorization: ***[len:142]` (가린 길이 표시)
- 잘림: "캡처: 1.0 MB / 전체: 5.2 MB" 명시 + 잘린 위치에 구분선
- 바이너리: "🖼 이미지 응답 (image/png · 124 KB) · 본문 미저장"
- 스트림: "🌊 스트리밍 응답 (text/event-stream) · 본문 캡처 안 됨"

### 5.4 Consumer 산출물 (Jira 이슈 본문)

`buildIssueMarkdown` / `buildIssueAdf` / `buildIssueHtml`에서 `POST_MEDIA_SECTION_IDS` 룰로 미디어 블록 근처에 출력.

#### 마크다운 예시

```markdown
## Media

비디오: recording.webm (45초)

### 네트워크 로그 (3건 첨부)

| Method | Path | Status | Time |
|--------|------|--------|------|
| POST | /api/users | 400 Bad Request | 124ms |
| GET | /api/orders/123 | 500 Internal Server Error | 340ms |
| POST | /api/checkout | 422 Unprocessable Entity | 89ms |

첨부: network-log.har (선택된 3건 — 상세 request/response body 포함)
```

#### 출력 룰

- 사용자가 다이얼로그에서 선택한 엔드포인트만 적재
- Jira 본문에는 **요약만 inline** (method + path + status + time 테이블). request/response body는 포함하지 않음
- **상세 body는 HAR 첨부 전용**: consumer가 HAR 파일을 DevTools/Charles 등에서 열어 확인
- 선택 안 된 요청은 본문에도 HAR에도 들어가지 않음 (노이즈 0)

#### 마크다운 복사 (PreviewPanel)

클립보드 복사 시에도 동일하게 요약 테이블만 포함. body는 생략 (HAR 파일은 클립보드에 넣을 수 없으므로).

### 5.5 첨부 파일

- **파일명**: `network-log.har`
- **포함 범위**: 사용자가 선택한 엔드포인트만 (선택 안 된 요청은 HAR에도 없음)
- **포맷**: HAR 1.2 표준 (DevTools/Charles/Insomnia 호환)
- **자체 메타**: `_bugshot` 키로 truncation/masking/warnings 표현 (표준 파서 호환 유지)
- **Jira REST 첨부**: 기존 `recording.webm` 경로에 동일 패턴으로 푸시 (`background/messages.ts:73-78`, `IssueCreateModal.tsx:112-114`)
- **첨부 limit 초과 시**: 다이얼로그 — "용량 초과, body 제외하고 메타만 첨부"

## 6. 비기능 요구사항

### 6.1 보안 (Redaction)

#### 자동 마스킹

**헤더 (요청·응답 모두)**:
- 정확 매치: `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-Auth-Token`, `X-Api-Key`, `X-Csrf-Token`, `X-XSRF-Token`
- 패턴 (case-insensitive): `X-*-Token`, `X-*-Key`, `X-*-Secret`
- 값 → `***[len:N]`

**URL 쿼리 파라미터**:
- 키 매치: `token`, `access_token`, `id_token`, `refresh_token`, `api_key`, `apikey`, `key`, `secret`, `password`, `pwd`, `auth`
- 값 → `***`

**Request body (JSON)**: 위 키 이름 대상 재귀 마스킹 (깊이 제한 10, 배열 내 객체도 탐색, leaf key 단독 매칭). `application/x-www-form-urlencoded` body도 동일 키 목록 적용. `multipart/form-data`는 메타만 캡처, body skip.

**Response body 자동 마스킹 안 함** — false positive 위험. 다이얼로그에 "response body에 포함된 개인정보는 사용자 책임" 경고 문구 표시.

**URL path segment**: 쿼리 파라미터만 마스킹. path 내 민감 정보(`/api/users/john@example.com` 등)는 패턴 정의가 어려워 미처리 (Known Limitation).

#### 사용자 정의 (settings 탭)

- 추가 마스킹 헤더 이름
- 도메인 deny list (이 도메인 응답 body는 캡처 안 함)

### 6.2 용량 cap

| 항목 | 한도 | 초과 시 |
|---|---|---|
| per-response body | 1 MB | body 미저장, 메타만 캡처 + `{ kind: "truncated" }` |
| 세션 메모리 | 30 MB | oldest body부터 drop, 메타 유지, warning 추가 |
| content-type allowlist | `application/json`, `text/*`, `application/xml`, `application/x-www-form-urlencoded` | 외 content-type은 메타만 캡처 |
| content-type denylist | `application/pdf`, `application/wasm`, `application/octet-stream`, `image/*`, `audio/*`, `video/*`, `font/*` | body 읽기 자체를 skip (clone 안 함) |
| Jira 첨부 | 동적 (Jira 응답에 따름) | 다이얼로그로 사용자 옵션 제시 |

### 6.3 성능

- page injection 일반 사용에서 사용자 체감 영향 없음 (요청당 0.5~2ms)
- 60초 녹화 × 100req × 평균 20KB body ≈ 5~10 MB 메모리 (30 MB cap 내 여유)
- streaming/대용량 다운로드 등 sharp edge는 위 cap으로 가드
- body 읽기 3단계 가드:
  1. **content-type 체크**: denylist 매치 시 `response.clone()` 자체를 안 함 (메타만 캡처)
  2. **Content-Length 사전 필터링**: 헤더 값이 1MB 초과 시 body 읽기 skip
  3. **스트리밍 누적 체크**: Content-Length가 없거나 부정확한 경우를 대비해 `body.getReader()`로 읽는 중 누적 바이트가 1MB 초과하면 버퍼 폐기 + `{ kind: "truncated" }` 기록

### 6.4 권한

추가 권한 없음. 현재 매니페스트의 `scripting`, `activeTab`만으로 동적 page injection 가능 (`chrome.scripting.executeScript({ world: "MAIN" })`).

`chrome.debugger`, `chrome.webRequest`는 사용 안 함.

## 7. 기술 결정

### 7.1 캡처 방식

**Page injection (MV3 `world: "MAIN"`, 동적 주입)**:
- manifest에 정적 등록하지 **않음**. `chrome.scripting.executeScript({ world: "MAIN" })`로 **녹화 시작 시에만** 주입
- 페이지 컨텍스트에서 `window.fetch` / `XMLHttpRequest.prototype` wrap
- CSP 영향 없음 (content script는 페이지 CSP와 독립적으로 실행됨)
- 트레이드오프: 녹화 시작 전에 이미 완료된 요청은 캡처 불가. 대부분의 use case에서 사용자가 버그를 발견한 후 녹화를 시작하므로, 이후 재현 시점의 요청을 캡처하는 것으로 충분

**미사용**:
- `chrome.debugger` — 노란 배너·DevTools 충돌 회피
- `chrome.webRequest` — body 캡처 불가
- manifest 정적 content_scripts (MAIN world) — 모든 페이지에 불필요한 래핑, 웹스토어 심사 리스크

### 7.2 두 world 간 브리지

- `CustomEvent("__bugshot_net__" + SENTINEL, { detail })`
- SENTINEL 생성·전달:
  1. **sidepanel**이 `crypto.randomUUID()`로 SENTINEL 생성
  2. **MAIN world**에는 `chrome.scripting.executeScript({ world: "MAIN", args: [sentinel] })`로 직접 전달 (DOM 노출 없음)
  3. **ISOLATED world**(picker.ts)에는 `chrome.tabs.sendMessage(tabId, { type: "networkRecorder.setSentinel", sentinel })`로 전달
  4. 이후 ISOLATED ↔ MAIN 간 CustomEvent 통신에 동일 SENTINEL 사용
- **검증**: `e.isTrusted`는 CustomEvent에서 항상 false이므로 사용 불가. 대신 이벤트 `detail`에 sentinel을 포함시켜 검증.
- **한계**: 페이지 JS가 `document.addEventListener`로 CustomEvent를 가로채면 sentinel 탈취 가능. 완전한 보안은 불가능하며, 실용적 수준의 위조 방지로 판단.

### 7.3 라이프사이클

- **녹화 시작 시** 동적 주입(`scripting.executeScript`) → wrap 적용 + flag ON + 버퍼 초기화
- 녹화 정지 → flag OFF → **버퍼 일괄 전달** (MAIN → ISOLATED → sidepanel, 1회 메시지) → wrap은 그대로 (unpatch 안 함)
- 다른 라이브러리가 우리 wrap 위에 wrap한 경우 unpatch 시 그 wrap이 사라지므로
- **풀 페이지 네비게이션**: MAIN world context가 파괴되어 래핑이 사라짐. 녹화 중 풀 네비게이션 감지 시 자동 재주입 (`tabs.onUpdated` status=complete → 녹화 중이면 재주입). 네비게이션 전 버퍼는 유실 (재현 시점의 요청이 중요하므로 허용 가능).
- **SPA 네비게이션**: wrap 유지됨. 영향 없음.

**메시지 흐름**:
1. sidepanel `handleStartVideo()`:
   - SENTINEL 생성 (`crypto.randomUUID()`)
   - `chrome.scripting.executeScript({ world: "MAIN", func: networkRecorderScript, args: [sentinel] })` → wrap 적용 + flag ON
   - `chrome.tabs.sendMessage(tabId, { type: "networkRecorder.setSentinel", sentinel })` → ISOLATED에 SENTINEL 전달
2. sidepanel `videoRecorder.stopRecording()` → `chrome.tabs.sendMessage(tabId, { type: "networkRecorder.stop" })` → ISOLATED → CustomEvent(SENTINEL) → MAIN world flag OFF
3. MAIN world → 버퍼 전체를 CustomEvent(SENTINEL)로 ISOLATED에 전달 → ISOLATED → `chrome.runtime.sendMessage({ type: "networkRecorder.data", payload })` → sidepanel store
4. sidepanel re-mount 시: `chrome.tabs.sendMessage(tabId, { type: "networkRecorder.sync" })` → 현재 버퍼 재전달 (녹화 완료 후 탭 전환했다 돌아온 경우)

### 7.4 저장

**위치**: `src/store/blob-db.ts` 확장 — `saveNetworkLog(issueId, log)` / `getNetworkLog(issueId)`

**포맷**: 자체 JSON (편집·검색 용이)

**HAR 변환**: Jira 첨부 시점에 export

**저장 시점**: `onRecordingComplete` (recording → drafting 전이) 시 sidepanel이 수신한 네트워크 로그를 blob-db에 저장. 이 시점에 `currentIssueId`가 아직 없으므로 임시 키(`pending:${tabId}`)를 사용하고, `confirmDraft` 시 `issueId` 기반 키로 migration.

**세션 동기화**: `EditorSnapshot`에는 메타만 포함 (`networkLogCapturedCount: number`, `networkLogSelectedIds: string[]`). body 데이터는 blob-db 전용 — `chrome.storage.session` quota(10MB)를 초과하므로 직접 넣지 않음.

**보존 정책 (phase별)** — 기존 보존 룰과 일관:

| phase | networkLog |
|---|---|
| `recording` | content script 메모리 buffer (MAIN world) |
| `drafting` | blob-db에 유지 (`pending:${tabId}` → `issueId` 키), 페이지 떠나도 보존 |
| `done` | 첨부됐으면 유지, draft 폐기 시 동반 삭제 |
| 탭 닫힘 (`onRemoved`) | 해당 tabId의 `pending:${tabId}` blob 정리 |
| origin 변경 (`clearIfOriginChanged`) | video 세션은 보존하되 네트워크 로그 버퍼만 초기화 (content script에 reset 메시지). blob-db에 이미 저장된 데이터(drafting 이후)는 유지 |

**재제출 (DraftDetailDialog)**: `IssueRecord`에 `networkLogBlobKey?: string` + `networkLogSelectedIds?: string[]`를 저장. 재제출 시 blob-db에서 로드 → HAR 변환 → 첨부.

### 7.5 데이터 모델

```ts
type NetworkLog = {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;       // wrap이 본 총 개수
  captured: number;        // 저장된 개수
  warnings: ("MEMORY_CAPPED" | "WS_UNSUPPORTED" | "BODY_TRUNCATED")[];
  requests: NetworkRequest[];
};

type NetworkRequest = {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  startTime: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string | { kind: "truncated" | "stream" | "binary" | "omitted" };
  responseBody?: string | { kind: "truncated" | "stream" | "binary" | "omitted" };
  pageUrl: string;               // 캡처 시점의 location.href (SPA 내비게이션 추적)
  requestBodySize: number;       // bytes, HAR 호환
  responseBodySize: number;      // bytes, HAR 호환
  contentType: string;           // response Content-Type, HAR 호환
};

// 다이얼로그에서 선택된 요청 ID. editor-store에 별도 보관.
// draft가 done으로 가면서 첨부 확정.
type NetworkLogSelection = {
  selectedIds: string[];
};
```

### 7.6 HAR 변환 룰

HAR 1.2 스펙 필수 필드 중 fetch 래핑으로 알 수 없는 값은 합리적 기본값으로 채움:

| HAR 필드 | 값 |
|---|---|
| `log.creator` | `{ name: "BugShot", version: "<package.json version>" }` |
| `httpVersion` | `"HTTP/1.1"` (fetch API는 HTTP 버전 미노출) |
| `cookies` | `[]` (Cookie 헤더는 마스킹됨) |
| `headersSize` | `-1` (알 수 없음) |
| `bodySize` | `requestBodySize` / `responseBodySize` |
| `timings` | `{ send: 0, wait: durationMs, receive: 0, blocked: -1, dns: -1, connect: -1, ssl: -1 }` |
| `response.content.mimeType` | `contentType` |
| `response.redirectURL` | `""` |

`_bugshot` 커스텀 키는 entries 레벨에만 추가 (truncation/masking/warnings 표현). HAR 1.2 스펙은 `_` 접두사 키를 허용하므로 표준 파서 호환 유지.

### 7.7 빌더 분리

`buildIssueMarkdown` / `buildIssueAdf` / `buildIssueHtml`은 `editor-store` + `selectedIds`를 입력으로 받아 선택된 요청만 출력.

- **Jira 본문**: 요약 테이블만 inline (method + path + status + time). body는 포함하지 않음.
- **HAR 첨부**: 선택된 요청의 풀 디테일 (request/response body 포함)
- **`MarkdownContext` 확장**: optional `networkLog?: { requests: NetworkRequest[], selectedIds: string[] }` 추가. 필드 존재 시에만 네트워크 로그 섹션 emit.
- **ADF code block**: JSON body를 HAR에서 표시할 때 `codeBlock` 노드 + `language: "json"` 사용. (본문 inline에는 body 없으므로 v1에서는 불필요할 수 있으나, AI 메타 파일에서 활용 가능)

## 8. Out of Scope

다음은 v1에서 만들지 않는다.

### 기능
- element / screenshot 캡처 모드에서의 네트워크 로그 (v2 후보)
- iframe 내부 요청 캡처 (cross-origin 보안 불가, same-origin도 v1 제외)
- 고급 필터/검색 toolbar (DevTools 영역)
- 응답 body inspector (JSON tree, search)
- 통계·집계·엔드포인트 빈도 분석
- waterfall timing 시각화
- request replay·breakpoint·throttling
- WebSocket / EventSource / gRPC 캡처
- Element ↔ Network 자동 매핑
- 항상 켜진 백그라운드 모니터링
- 사용자 미인지 silent bug 감지

### UI
- 녹화 중 실시간 카운터·배지 (일괄 전달 방식이므로 녹화 중 UI 없음)
- 4xx/5xx 발생 시 토스트 알림
- 응답 body 자동 마스킹
- URL path segment 내 민감 정보 마스킹 (패턴 정의 어려움)

### 기술
- `chrome.debugger`
- `chrome.webRequest`
- 별도 창/탭으로 다이얼로그 분리
- syntax highlighting 라이브러리 (Prism.js 등)
- JSON tree viewer 라이브러리 (react-json-view 등)
- fetch 래핑 시 AbortSignal disconnect/reconnect 처리 (body 읽기 중 abort 전파 방지). 발생 빈도 낮고, clone된 response는 독립 스트림이라 실질적 영향 미미. 문제 리포트 시 v2에서 대응

## 9. v2 후보 (참고)

- WebSocket / SSE 캡처
- Passive circular buffer (NVIDIA Shadowplay 모델 — 사이드패널 열려있는 동안 last N초 백그라운드 buffer)
- 별도 창으로 다이얼로그 확장
- "DevTools 안 열어도 됨" 경량 모드
- JSON tree view, syntax highlighting, body 검색

## 10. 변경되는 파일

| 파일 | 변경 |
|---|---|
| `src/content/network-recorder.ts` | 신규 — page injection wrap (MAIN world), 버퍼 관리, CustomEvent 브리지 |
| `src/content/picker.ts` | ISOLATED 측 브리지 리스너 + networkRecorder.start/stop/sync 메시지 핸들러 |
| `src/store/editor-store.ts` | `networkLog` 필드 + 토글 ON/OFF + `selectedIds` 상태 |
| `src/store/blob-db.ts` | `saveNetworkLog` / `getNetworkLog` / `deleteNetworkLogBlob` + `"networkLogs"` object store |
| `src/store/issues-store.ts` | `IssueRecord`에 `networkLogBlobKey` + `networkLogSelectedIds` 추가. `removeIssue`, `markSubmitted`, `clearIssues`, `pruneOrphanBlobs`에 네트워크 로그 blob 정리 호출 |
| `src/sidepanel/components/NetworkLogToggle.tsx` | 신규 — Switch + 카운터 + IconButton |
| `src/sidepanel/components/NetworkLogPreviewDialog.tsx` | 신규 — LNB + Content 2분할 |
| `src/sidepanel/tabs/IssueTab.tsx` | DraftingPanel에 NetworkLogToggle 통합 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | NetworkLogToggle 렌더링 |
| `src/sidepanel/lib/buildIssueMarkdown.ts` | 네트워크 로그 요약 테이블 출력 |
| `src/sidepanel/lib/buildIssueAdf.ts` | 동일 (요약 테이블) |
| `src/sidepanel/lib/buildIssueHtml.ts` | 동일 (요약 테이블) |
| `src/sidepanel/lib/buildHar.ts` | 신규 — NetworkLog → HAR 1.2 변환 |
| `src/sidepanel/tabs/IssueCreateModal.tsx` | HAR 첨부 처리 |
| `src/sidepanel/tabs/DraftDetailDialog.tsx` | 재제출 시 네트워크 로그 blob 로드 + HAR 첨부 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 마크다운 복사 시 네트워크 로그 요약 포함 |
| `src/sidepanel/hooks/usePickerMessages.ts` | `networkRecorder.data` 메시지 수신 핸들러 |
| `src/sidepanel/hooks/useEditorSessionSync.ts` | `EditorSnapshot`에 네트워크 로그 메타 추가 (카운트 + selectedIds만, body 제외) |
| `src/sidepanel/picker-control.ts` | `startNetworkRecorder` / `stopNetworkRecorder` / `syncNetworkRecorder` 래퍼 |
| `src/background/messages.ts` | HAR 첨부 핸들러 (기존 attachments 배열에 푸시) |
| `src/background/tab-bindings.ts` | origin 변경 시 네트워크 로그 버퍼 reset 메시지 + `pending:${tabId}` blob 정리 |
| `src/i18n/` (ko/en) | 라벨 추가 |
