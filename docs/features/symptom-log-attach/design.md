# 발생 현상 로그 삽입 — 기술 설계

## 개요

새 영속 상태 없이, "선택한 로그 1건을 코드블럭 텍스트로 tiptap 에디터에 삽입"하는 에디터 커맨드로 구현한다. 세 조각으로 나뉜다: (1) 순수 직렬화 함수(로그 → 코드블럭 텍스트), (2) 삽입 다이얼로그(기존 로그 뷰 컴포넌트 재사용 + 단일 선택), (3) TiptapEditor 핸들에 코드블럭 삽입 메서드 추가. 여기에 (4) Notion 코드블럭 2000자 청킹 픽스(선행 버그)를 더한다.

## 변경 범위

### 신규 파일

**`src/sidepanel/lib/logToCodeBlock.ts`** — 순수 직렬화 함수 (단위 테스트 대상).
- `serializeNetworkRequest(req: NetworkRequest): { text: string; language?: string }` — endpoint/status 헤더 라인 + payload/response 섹션.
- `serializeConsoleEntry(entry: ConsoleEntry): { text: string; language?: string }` — `[level] args` + (error면 stack).
- 반환은 **object**(text + optional language) — `insertCodeBlock`/`onInsert`에 language를 전달해야 하므로. (string 반환 아님 — 인터페이스 섹션 참조.)
- 내부 헬퍼: JSON 정렬(`formatBody`와 동일 로직 — `JSON.parse`→`JSON.stringify(_, null, 2)`, 실패 시 raw), body descriptor 라벨, 16K chars truncate.
- `formatBody`/`bodyLabel` 로직은 현재 `NetworkLogContent.tsx` 내부에 비-export로 존재 → 이 파일에 삽입 전용 버전을 둔다(표시용과 요구가 달라 공유하지 않음. WHY 주석 한 줄).

**`src/sidepanel/lib/__tests__/logToCodeBlock.test.ts`** — 직렬화 단위 테스트.

**`src/sidepanel/components/LogInsertDialog.tsx`** — 삽입 다이얼로그.
- shadcn `Dialog` + 상단 `Tabs`(network/console) + 하단 `NetworkLogContent`/`ConsoleLogContent` 재사용(selectable) + `DialogFooter`에 닫기·삽입 버튼.
- 다이얼로그 title·삽입 버튼 라벨은 "본문에 삽입" 계열(`draft.insertLog` 등) — 기존 "로그 첨부"와 구분.
- 자체 상태: `tab: "network" | "console"`, `activeNetworkId: string | null`, `activeConsoleId: string | null`.
- 현재 탭의 선택 id가 있어야 삽입 버튼 활성. 삽입 클릭 → 해당 로그를 직렬화 → `onInsert(text, language)` 콜백 → 다이얼로그 닫힘. (삽입 후 toast 없음 — 사용자 결정.)
- `NetworkLogPreviewDialog`(80vw×80vh, rounded-3xl, gap-5, p-6)와 동일 레이아웃 관례 따름.
- e2e 스코프: 다이얼로그 루트에 `data-testid="log-insert-dialog"` — 재사용 content의 testid(`network-search`·`network-filter-*` 등)가 라이브 SubTab과 중복되므로 e2e는 이 dialog testid로 스코프.

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
  StarterKit의 codeBlock 노드 사용(disable 안 됨, `:170-177` 확인). 뒤에 빈 paragraph를 함께 삽입해 코드블럭 끝에서 커서가 갇히지 않게 한다. `.focus()`가 blur된 선택 위치를 복원 → 커서 위치 삽입.
- **왕복 검증됨(CTO)**: `insertContent` codeBlock → `getMarkdown()` fence → 각 트래커 빌더(markdownToAdf codeBlock+lang / markdownToNotionBlocks:74 code+lang / GH·GL·Linear·ClickUp raw fence / Slack fence 보존 / Asana `<pre>`)가 코드블럭으로 변환하는 것까지 코드로 추적. 단, tiptap-markdown이 `language`를 ```` ```json ```` fence로 내보내는 라이브러리 내부 동작은 구현 시 `getMarkdown` 결과 눈으로 1회 확인(Task 2 수동 게이트).

**`src/sidepanel/components/NetworkLogContent.tsx`**
- 현재 역할: 네트워크 로그 master-detail 뷰. 내부 `activeId` 단일 선택.
- 변경: optional prop `onActiveChange?: (id: string | null) => void` 추가. `activeId`에 `useEffect`를 걸어 발화한다(단순 `handleSelect` 훅이 아니라 — activeId는 초기값·scroll-to-entry `onFound`에서도 set되므로 useEffect가 견고). 미공급 시 기존 동작 그대로(비침습). 재클릭 시 activeId=null 토글 → 콜백 null → 삽입 버튼 비활성(수용).

**`src/sidepanel/components/ConsoleLogContent.tsx`**
- 현재 역할: 표시 전용. 행 클릭 = expand 토글만(`EntryAccordion` 로컬 `expanded`), user-click 선택 상태 없음. 기존 `activeId`(`:97`)는 영상 sync `activeTs` 파생 read-only(다이얼로그엔 activeTs 없어 항상 null).
- 변경: `selectable?: boolean` + `selectedId?: string | null` + `onActiveChange?: (id: string | null) => void` 추가. `selectable`일 때:
  - 행 클릭 = **선택**(selectedId 설정 + `onActiveChange` 호출) **+ expand**(펼쳐 args/stack 확인) 이중 동작. 재클릭은 접기(선택은 유지).
  - 선택 하이라이트는 **배경색이 아니라 `ring-2 ring-primary` 계열** — 콘솔 행엔 이미 레벨 틴트(error=red/warn=amber)·sync 하이라이트가 있어 배경 경합을 피해야 함(CDO). 배경-독립 신호로 표현.
  - 미공급 시 기존 동작 완전 동일(비침습).

**`src/sidepanel/tabs/DraftingPanel.tsx`** (`SectionTextarea`, `:653`)
- 현재 역할: 각 이슈 섹션 렌더. paragraph 섹션 헤더 `action` 슬롯에 Camera·ImagePlus 버튼(개별 나열, `title`-only 레거시). `editorRef`(TiptapEditorHandle) 보유.
- 변경: `isParagraph` 분기의 `action`을 **`ButtonGroup`으로 재구성** — tiptap에 콘텐츠를 삽입하는 세 버튼 `[로그 | 캡처 | 업로드]`(이 순서)를 하나의 `ButtonGroup`에 담아 `action`으로 넘긴다. 아코디언(collapsible chevron)은 Section이 `{action}` 뒤에 자동 렌더(`Section.tsx:76-84`, `flex gap-1`)하므로 **ButtonGroup 밖에 자연히 분리** → `[로그|캡처|업로드] [▾]`. Section은 무변경. (선례: `IssueTab:482` ButtonGroup + TooltipIconButton 3개, `IssueRow:92` ButtonGroup + size=icon.)
  - 로그 버튼 클릭 → `LogInsertDialog` 오픈. 다이얼로그 `onInsert` → `editorRef.current?.insertCodeBlock(text, language)`.
  - 그룹핑 근거: 세 버튼은 "이 섹션에 콘텐츠 삽입"으로 응집 / chevron은 접기(구조 조작)라 성격이 달라 분리.
  - **버튼 접근성**: 세 버튼(로그·캡처·업로드)을 전부 `TooltipIconButton`으로 통일한다(DESIGN.md §9·§13 — 신규 아이콘 버튼은 aria-label/툴팁 필수, `IssueTab:482` 선례). 기존 Camera·ImagePlus의 `title`-only 레거시를 이 그룹 재구성 시 함께 승급. 로그 버튼 아이콘은 `FileCode`(코드블럭 삽입 의미, Camera/ImagePlus와 변별).
  - 로그 버튼 `data-testid="section-log-insert-${section.id}"`(e2e 시나리오 1·3용).
- 로그 존재 여부(`useEditorStore(s => s.networkLog)`, `s.consoleLog`)로 로그 버튼만 disabled 판정(둘 다 비면 비활성, 캡처·업로드는 유지). `TooltipIconButton`의 `ariaDisabled`로 잠금(툴팁 유지). 다이얼로그에 `networkLog?.requests`·`consoleLog?.entries` 전달.
- `SectionTextarea`가 dialog open 상태(`useState`)를 자체 보유. (섹션마다 독립 다이얼로그 인스턴스 — 섹션별 editorRef가 다르므로.)
- 폭 주의: ButtonGroup은 테두리만 공유하고 가로 폭은 안 줄인다. 아이콘 3개+chevron+타이틀이 좁은 사이드패널에서 눌리면(실측 확인) 삽입 3개를 단일 `[+]` 드롭다운으로 접는 것을 후속 고려 — 이번 스코프는 ButtonGroup.

**`src/background/notion-api.ts`** (`richText`, `:366`) — 선행 버그 픽스
- 현재 역할: NotionBlock text → Notion API rich_text 배열. 현재 단일 `{ text: { content } }` 반환(비-export private) → 2000자 초과 시 API 400.
- 변경: (1) `richText`를 **export**한다(단위 테스트 대상). (2) content를 2000자 청크로 분할해 rich_text 배열 반환:
  ```ts
  export function richText(content: string): NotionRichTextInput[] {
    if (!content) return [];
    const CHUNK = 2000;
    const out: NotionRichTextInput[] = [];
    for (let i = 0; i < content.length; i += CHUNK)
      out.push({ type: "text", text: { content: content.slice(i, i + CHUNK) } });
    return out;
  }
  ```
  이 함수는 heading/paragraph/**code(`:443`)**/list/table/title 전 블록에 공통 → 코드블럭 포함 모든 긴 텍스트가 안전해진다. 16384/2000 = 9청크로 Notion rich_text 배열 100개 한도 내. `expandRichText`(인라인 포맷 경로)는 이 기능이 안 쓰므로 스코프 밖(기존 그대로).

**`docs/privacy.ko.md` · `docs/privacy.en.md`** — 노출 동작 반영(ko 원본 + en 번역 동시). 캡처 로그를 이슈 본문에 삽입하는 새 동작 + 마스킹 범위 명시. (prd.md Privacy 영향 참조.)

**i18n** (`src/i18n/namespaces/*.ts`, ko/en 동시)
- `draft.insertLog`(버튼 tooltip), 다이얼로그 title, 탭 라벨, 삽입 버튼 라벨 등. Task에 키 목록.

## 데이터 흐름

```
[SectionTextarea] 로그 삽입 버튼 클릭
    → setDialogOpen(true)
[LogInsertDialog] (networkLog.requests / consoleLog.entries 주입)
    → NetworkLogContent(onActiveChange) / ConsoleLogContent(selectable, onActiveChange)
    → 사용자 행 선택 → active id 상태 갱신
    → 삽입 버튼 클릭
    → serializeNetworkRequest(req) 또는 serializeConsoleEntry(entry)  [순수, {text, language} 반환]
    → onInsert(text, language)
[SectionTextarea] editorRef.current.insertCodeBlock(text, language)
[TiptapEditor] editor.chain().focus().insertContent(codeBlock + paragraph)
    → onChange(editorMarkdown(...)) → draft.sections[id] 갱신 (마크다운 fence)
    → 제출 시 각 build*IssueBody가 fence를 트래커별 코드블럭으로 변환
```

로그 데이터 출처는 `useEditorStore`(네트워크·콘솔). 삽입 결과는 섹션 마크다운 문자열에 녹아들 뿐, 새 상태·스토리지·메시지 없음.

## 인터페이스 설계

```ts
// logToCodeBlock.ts — object 반환(language 전달용)
export function serializeNetworkRequest(req: NetworkRequest): { text: string; language?: string };
export function serializeConsoleEntry(entry: ConsoleEntry): { text: string; language?: string };
// text: 코드블럭 안에 들어갈 순수 텍스트(펜스·백틱 없음). language: JSON 정렬 성공 시 "json", 아니면 undefined.

// TiptapEditor.tsx
export interface TiptapEditorHandle {
  insertImageFile: (file: File) => void;
  insertCodeBlock: (text: string, language?: string) => void; // 신규
}

// NetworkLogContent.tsx (기존 props에 추가)
onActiveChange?: (id: string | null) => void;

// ConsoleLogContent.tsx (기존 props에 추가 — 콘솔은 선택 상태가 없어 3개 필요)
selectable?: boolean;
selectedId?: string | null;
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

// notion-api.ts — export 승격
export function richText(content: string): NotionRichTextInput[];
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
- 헤더 라인: `${method} ${path} → ${status} ${statusText}` (path는 `networkLogPath(req.url)` — 실제 경로 `src/lib/network-log-path.ts`, 시그니처 `networkLogPath(url: string)`. 파싱 실패 시 원본 url 반환).
- **pending·status 0 방어**: `phase==="pending"`이면 status 대신 `(pending)`, status 0/statusText 공백이면 status 표기를 생략해 `→ 0 undefined` 방지.
- payload/response: body가 string이면 JSON 정렬 시도(실패 시 raw), descriptor면 라벨 한 줄, 없으면 섹션 생략.
- 각 body 섹션 16384 chars(문자) 초과 시 자르고 `…(truncated)`. (문자 기준 — 트래커·Notion 한도가 char 기준이라 정합. byte 아님.)
- WS: 헤더 라인만 (`WS ${url} → 101`), body 섹션 없음.
- 언어 태그: 정렬 성공(JSON) 시 `"json"`, 아니면 `undefined`.

콘솔:
```
[error] Uncaught TypeError: x is not a function
  at foo (app.js:12:3)
  at bar (app.js:34:5)
```
- `[${level}] ${args}` + level이 error이고 stack 있으면 개행 후 stack. `language` 없음.
- args도 16384 chars 초과 시 truncate(거대 객체 로깅 대비).

## 기존 패턴 준수

- **store가 sidepanel/tabs를 import하지 않는다**: 직렬화 로직은 `sidepanel/lib/`에 순수 함수로 둔다(store 오염 방지 원칙 — `initialJiraFields` 선례). `SectionTextarea`(tabs)만 이걸 소비.
- **i18n ko/en 동시 갱신**: 새 키는 양쪽 동시 추가. PostToolUse 훅이 대칭 검사.
- **테스트 우선**: 신규 순수 함수(`serializeNetworkRequest`/`serializeConsoleEntry`)와 변경 함수(`richText`)는 `/tdd interface`로 테스트 먼저.
- **다이얼로그 레이아웃 관례**: `NetworkLogPreviewDialog`의 사이즈·클래스(80vw×80vh, rounded-3xl, gap-5, p-6) 따름.
- **비침습 prop 추가**: content 컴포넌트의 신규 prop은 전부 optional. 기존 호출부(SubTab·PreviewDialog 각 2곳) 무변경.
- **아이콘 버튼 접근성**: 신규/재구성 아이콘 버튼은 `TooltipIconButton`(DESIGN.md §13).

## 대안 검토

- **A. content 컴포넌트에 selectable 모드 prop 추가(채택)**: 필터·검색·행 렌더·상세 패널 100% 재사용. 최소 침습(콜백/optional prop). 사용자가 응답을 상세 패널로 확인 후 삽입 가능.
- **B. 선택 전용 경량 리스트 새로 작성(기각)**: 행 렌더·필터·상세를 다시 짜야 해 중복·드리프트. 상세 패널 없어 삽입 전 응답 확인 불가.
- **다중 선택(기각)**: 1회성 삽입 모델과 어긋나고 상태 배열이 늘어 결합도↑. 단일 선택이 삽입=액션 1:1로 단순.
- **status 기반 자동 첨부(기각)**: "200인데 FAILED" 케이스를 놓쳐 범용성 없음. 사람이 고르는 단일 선택이 근본 해법.
- **삽입을 markdown 문자열 파싱으로 처리(기각)**: tiptap-markdown이 `insertContent`에서 마크다운을 파싱하지 않음. ProseMirror `codeBlock` 노드 직접 삽입이 확실.
- **v1 네트워크 전용으로 축소(기각)**: 콘솔 selectable이 비대칭 비용이나, 콘솔 에러 인용도 실사용 가치가 커 유지. 비대칭은 selectable 스펙 명시(ring 하이라이트)로 흡수.

## 위험 요소

- **커서 위치**: 에디터를 한 번도 포커스 안 한 상태에서 버튼을 누르면 선택 위치가 문서 시작일 수 있다. `.focus()`가 마지막 선택을 복원하지만 최초엔 시작 위치 삽입 가능 → 허용(사용자가 이후 이동). 회귀 아님.
- **Notion 청킹 회귀**: `richText`는 모든 블록 공통 경로 → 기존 짧은 텍스트 동작이 안 바뀌는지(단일 청크 = 기존과 동형 배열) 테스트로 고정. 빈 문자열 `[]` 반환 유지.
- **Notion `language` 무검증(기존 잠재 리스크)**: `markdownToNotionBlocks:75`가 fence lang을 무검증 전달 → 유효 enum 밖이면 400. 이 기능은 `"json"`/`undefined`(→"plain text")만 방출해 **둘 다 유효**하므로 안전하나, 별건 리스크로 인지.
- **Asana language 소실**: Asana는 fence를 `<pre>`로만 변환해 언어 하이라이트가 소실되나 코드 원문은 보존(모노스페이스 렌더). 기능상 문제 없음.
- **body descriptor 다양성**: `NetworkRequestBody` union 5종(string/truncated/binary/stream/omitted) 전부 직렬화 분기 필요. 누락 시 `[object Object]` 노출 → 테스트로 전 케이스 커버.
- **콘솔 selectable 조화**: 기존 `isActive`(activeId/영상sync 기반 하이라이트, `:186`)와 새 `selectedId` 하이라이트가 충돌하지 않게. 다이얼로그엔 activeTs 없어 isActive는 항상 false → 실질 충돌 낮으나 ring 신호로 분리.
- **큰 응답 성능**: 16K slice는 즉시. 문제 없음.
- **e2e 판정**: tiptap 마크다운을 e2e가 직접 못 읽음(`.ProseMirror` 셀렉터 부재). 삽입 결과는 **preview 전환 후 `preview-section-*` toContainText**로 판정. 다이얼로그 행 선택은 기존 `[data-entry-id]` 관례 사용. 캔버스·드래그 아님.
