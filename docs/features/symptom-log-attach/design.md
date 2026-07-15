# 발생 현상 로그 첨부 — 기술 설계

## 개요

새 영속 상태 없이, "선택한 로그 1건을 코드블럭 텍스트로 tiptap 에디터에 삽입"하는 에디터 커맨드로 구현한다. 세 조각으로 나뉜다: (1) 순수 직렬화 함수(로그 → 코드블럭 텍스트), (2) 삽입 다이얼로그(기존 로그 뷰 컴포넌트 재사용 + 단일 선택), (3) TiptapEditor 핸들에 코드블럭 삽입 메서드 추가. 여기에 (4) Notion 코드블럭 2000자 청킹 픽스(선행 버그)를 더한다.

## 변경 범위

### 신규 파일

**`src/sidepanel/lib/logToCodeBlock.ts`** — 순수 직렬화 함수 (단위 테스트 대상).
- `serializeNetworkRequest(req: NetworkRequest): string` — endpoint/status 헤더 라인 + payload/response 섹션.
- `serializeConsoleEntry(entry: ConsoleEntry): string` — `[level] args` + (error면 stack).
- 내부 헬퍼: JSON 정렬(`formatBody`와 동일 로직 — `JSON.parse`→`JSON.stringify(_, null, 2)`, 실패 시 raw), body descriptor 라벨, 16KB truncate.
- `formatBody`/`bodyLabel` 로직은 현재 `NetworkLogContent.tsx` 내부에 비-export로 존재 → 이 파일에 삽입 전용 버전을 둔다(표시용과 요구가 달라 공유하지 않음. WHY 주석 한 줄).

**`src/sidepanel/lib/__tests__/logToCodeBlock.test.ts`** — 직렬화 단위 테스트.

**`src/sidepanel/components/LogInsertDialog.tsx`** — 삽입 다이얼로그.
- shadcn `Dialog` + 상단 `Tabs`(network/console) + 하단 `NetworkLogContent`/`ConsoleLogContent` 재사용 + `DialogFooter`에 닫기·삽입 버튼.
- 자체 상태: `tab: "network" | "console"`, `activeNetworkId: string | null`, `activeConsoleId: string | null`.
- 현재 탭의 선택 id가 있어야 삽입 버튼 활성. 삽입 클릭 → 해당 로그를 직렬화 → `onInsert(text, lang)` 콜백 → 다이얼로그 닫힘.
- `NetworkLogPreviewDialog`(80vw×80vh, rounded-3xl)와 동일 레이아웃 관례 따름.

### 변경 파일

**`src/sidepanel/components/TiptapEditor.tsx`**
- 현재 역할: 마크다운 기반 WYSIWYG 에디터, `forwardRef`로 `TiptapEditorHandle` 노출.
- 변경: `TiptapEditorHandle`에 `insertCodeBlock(text: string, language?: string): void` 추가(`:86`). `useImperativeHandle`(`:249`)에 구현 추가:
  ```ts
  insertCodeBlock: (text, language) => {
    editor?.chain().focus().insertContent([
      { type: "codeBlock", attrs: { language: language ?? null },
        content: text ? [{ type: "text", text }] : [] },
      { type: "paragraph" },
    ]).run();
  }
  ```
  StarterKit의 codeBlock 노드 사용(disable 안 됨). 뒤에 빈 paragraph를 함께 삽입해 코드블럭 끝에서 커서가 갇히지 않게 한다. `.focus()`가 blur된 선택 위치를 복원 → 커서 위치 삽입.

**`src/sidepanel/components/NetworkLogContent.tsx`**
- 현재 역할: 네트워크 로그 master-detail 뷰. 내부 `activeId` 단일 선택.
- 변경: optional prop `onActiveChange?: (id: string | null) => void` 추가. `handleSelect`에서 `activeId` 변경 시 호출. 미공급 시 기존 동작 그대로(비침습).

**`src/sidepanel/components/ConsoleLogContent.tsx`**
- 위와 동일하게 `onActiveChange?: (id: string | null) => void` 추가. (콘솔은 현재 단일 activeId 선택이 있는지 확인 필요 — 없으면 표시 전용이므로 선택 하이라이트 상태를 추가하거나, 다이얼로그에서 controlled로 관리. Task에서 실제 구조 확인 후 최소 침습 경로 선택.)

**`src/sidepanel/tabs/DraftingPanel.tsx`** (`SectionTextarea`, `:653`)
- 현재 역할: 각 이슈 섹션 렌더. paragraph 섹션 헤더 `action` 슬롯에 Camera·ImagePlus 버튼. `editorRef`(TiptapEditorHandle) 보유.
- 변경: `isParagraph` 분기의 `action`에 **로그 첨부 버튼** 추가(모든 문단 섹션 — 사용자 결정). 클릭 → `LogInsertDialog` 오픈. 다이얼로그의 `onInsert`가 `editorRef.current?.insertCodeBlock(text, lang)` 호출.
- 로그 존재 여부(`useEditorStore(s => s.networkLog)`, `s.consoleLog`)로 버튼 disabled 판정(둘 다 비면 비활성). 다이얼로그에 `networkLog?.requests`·`consoleLog?.entries` 전달.
- `SectionTextarea`가 dialog open 상태(`useState`)를 자체 보유. (섹션마다 독립 다이얼로그 인스턴스 — 섹션별 editorRef가 다르므로.)

**`src/background/notion-api.ts`** (`richText`, `:366`) — 선행 버그 픽스
- 현재 역할: NotionBlock text → Notion API rich_text 배열. 현재 단일 `{ text: { content } }` 반환 → 2000자 초과 시 API 400.
- 변경: content를 2000자 청크로 분할해 rich_text 배열 반환:
  ```ts
  function richText(content: string): NotionRichTextInput[] {
    if (!content) return [];
    const CHUNK = 2000;
    const out: NotionRichTextInput[] = [];
    for (let i = 0; i < content.length; i += CHUNK)
      out.push({ type: "text", text: { content: content.slice(i, i + CHUNK) } });
    return out;
  }
  ```
  이 함수는 heading/paragraph/code/list 전 블록에 공통 → 코드블럭 포함 모든 긴 텍스트가 안전해진다. 16KB/2000 = 8청크로 Notion rich_text 배열 100개 한도 내. `expandRichText`(인라인 포맷 경로)는 이 기능이 안 쓰므로 스코프 밖(기존 그대로).

**i18n** (`src/i18n/namespaces/*.ts`, ko/en 동시)
- 버튼 tooltip, 다이얼로그 title, 탭 라벨, 삽입 버튼 라벨, payload/response 구분자 텍스트 등. Task에 키 목록.

## 데이터 흐름

```
[SectionTextarea] 로그 첨부 버튼 클릭
    → setDialogOpen(true)
[LogInsertDialog] (networkLog.requests / consoleLog.entries 주입)
    → NetworkLogContent(onActiveChange) / ConsoleLogContent(onActiveChange)
    → 사용자 행 선택 → activeId 상태 갱신
    → 삽입 버튼 클릭
    → serializeNetworkRequest(req) 또는 serializeConsoleEntry(entry)  [순수]
    → onInsert(text, lang)
[SectionTextarea] editorRef.current.insertCodeBlock(text, lang)
[TiptapEditor] editor.chain().focus().insertContent(codeBlock + paragraph)
    → onChange(editorMarkdown(...)) → draft.sections[id] 갱신 (마크다운 fence)
    → 제출 시 각 build*IssueBody가 fence를 트래커별 코드블럭으로 변환
```

로그 데이터 출처는 `useEditorStore`(네트워크·콘솔). 삽입 결과는 섹션 마크다운 문자열에 녹아들 뿐, 새 상태·스토리지·메시지 없음.

## 인터페이스 설계

```ts
// logToCodeBlock.ts
export function serializeNetworkRequest(req: NetworkRequest): string;
export function serializeConsoleEntry(entry: ConsoleEntry): string;
// 반환: 코드블럭 안에 들어갈 순수 텍스트(펜스·백틱 없음)

// TiptapEditor.tsx
export interface TiptapEditorHandle {
  insertImageFile: (file: File) => void;
  insertCodeBlock: (text: string, language?: string) => void; // 신규
}

// NetworkLogContent.tsx / ConsoleLogContent.tsx (기존 props에 추가)
onActiveChange?: (id: string | null) => void;

// LogInsertDialog.tsx
interface LogInsertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: NetworkRequest[];
  entries: ConsoleEntry[];
  syncBaseMs?: number;
  onInsert: (text: string, language?: string) => void;
}
```

### 직렬화 포맷 (확정)

네트워크(body 있음):
```
POST /api/orders/123 → 200 OK
--- payload ---
{
  "items": [ ... ]
}
--- response ---
{
  "result": "FAILED"
}
```
- 헤더 라인: `${method} ${path} → ${status} ${statusText}` (path는 `networkLogPath` 또는 URL pathname).
- payload/response: body가 string이면 JSON 정렬 시도(실패 시 raw), descriptor면 라벨 한 줄, 없으면 섹션 생략.
- 각 body 섹션 16KB 초과 시 자르고 `…(truncated)`.
- WS: 헤더 라인만 (`WS ${url} → 101`), body 섹션 없음.
- 언어 태그: 정렬 성공(JSON) 시 `"json"`, 아니면 `undefined`.

콘솔:
```
[error] Uncaught TypeError: x is not a function
  at foo (app.js:12:3)
  at bar (app.js:34:5)
```
- `[${level}] ${args}` + level이 error이고 stack 있으면 개행 후 stack.

## 기존 패턴 준수

- **store가 sidepanel/tabs를 import하지 않는다**: 직렬화 로직은 `sidepanel/lib/`에 순수 함수로 둔다(store 오염 방지 원칙 — CLAUDE.md). `SectionTextarea`(tabs)만 이걸 소비.
- **i18n ko/en 동시 갱신**: 새 키는 양쪽 동시 추가. PostToolUse 훅이 대칭 검사.
- **테스트 우선**: 신규 순수 함수(`serializeNetworkRequest`/`serializeConsoleEntry`)와 변경 함수(`richText`)는 `/tdd interface`로 테스트 먼저.
- **다이얼로그 레이아웃 관례**: `NetworkLogPreviewDialog`의 사이즈·클래스(80vw×80vh, rounded-3xl, gap-5, p-6) 따름.
- **비침습 prop 추가**: content 컴포넌트의 `onActiveChange`는 optional. 기존 호출부(SubTab·PreviewDialog) 무변경.

## 대안 검토

- **A. content 컴포넌트에 selectable 모드 prop 추가(채택)**: 필터·검색·행 렌더·상세 패널 100% 재사용. 최소 침습(`onActiveChange` 콜백 하나). 사용자가 응답을 상세 패널로 확인 후 삽입 가능.
- **B. 선택 전용 경량 리스트 새로 작성(기각)**: 행 렌더·필터·상세를 다시 짜야 해 중복·드리프트. 상세 패널 없어 삽입 전 응답 확인 불가.
- **다중 선택(기각)**: 1회성 삽입 모델과 어긋나고 상태 배열이 늘어 결합도↑. 단일 선택이 삽입=액션 1:1로 단순.
- **status 기반 자동 첨부(기각)**: "200인데 FAILED" 케이스를 놓쳐 범용성 없음. 사람이 고르는 단일 선택이 근본 해법.
- **삽입을 markdown 문자열 파싱으로 처리(기각)**: tiptap-markdown이 `insertContent`에서 마크다운을 파싱하지 않음. ProseMirror `codeBlock` 노드 직접 삽입이 확실.

## 위험 요소

- **커서 위치**: 사용자가 에디터를 한 번도 포커스 안 한 상태에서 버튼을 누르면 선택 위치가 문서 시작일 수 있다. `.focus()`가 마지막 선택을 복원하지만, 최초엔 시작 위치 삽입 가능 → 허용(사용자가 이후 이동). 회귀 아님.
- **Notion 청킹 회귀**: `richText`는 모든 블록 공통 경로 → 기존 짧은 텍스트 동작이 바뀌지 않는지(단일 청크 = 기존과 동일 배열 형태) 테스트로 고정. 빈 문자열 `[]` 반환 유지.
- **body descriptor 다양성**: `NetworkRequestBody` union 5종(string/truncated/binary/stream/omitted) 전부 직렬화 분기 필요. 누락 시 `[object Object]` 노출 → 테스트로 전 케이스 커버.
- **큰 응답 성능**: 16KB slice는 즉시. 문제 없음.
- **ConsoleLogContent 선택 구조**: 네트워크와 달리 콘솔이 내부 activeId 선택을 안 가질 수 있음(표시 전용). 그 경우 최소 침습으로 선택 하이라이트를 추가할지, 다이얼로그 controlled로 갈지 Task에서 실제 코드 확인 후 결정 — 표시 컴포넌트 대규모 개조는 피한다.
- **e2e**: 다이얼로그 열기·행 선택·삽입은 DOM 인터랙션이라 e2e 커버 가능(단, tiptap 삽입 결과 검증은 에디터 마크다운 상태로). 캔버스·드래그 아님.
