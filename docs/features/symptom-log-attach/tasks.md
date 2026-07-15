# 발생 현상 로그 첨부 — 구현 태스크

## 선행 조건

- 새 의존성 없음. shadcn `Dialog`/`Tabs`/`Button`/`ButtonGroup` 이미 사용 중.
- 새 권한·env·OAuth·외부 API 없음. 코어밸류(데이터 직행) 무영향 — 삽입은 클라이언트 내 텍스트 조작.

## 태스크

### Task 1: 순수 직렬화 함수 (테스트 먼저)
- **변경 대상**: `src/sidepanel/lib/logToCodeBlock.ts` (신규), `src/sidepanel/lib/__tests__/logToCodeBlock.test.ts` (신규)
- **작업 내용**:
  - `serializeNetworkRequest(req: NetworkRequest): { text: string; language?: string }`
    - 헤더 라인 `${method} ${path} → ${status} ${statusText}` (path: `networkLogPath(req)`).
    - WebSocket(`req.webSocket` 존재)이면 헤더 라인만 반환(`WS ${url} → ${status}`), body 섹션 없음.
    - `requestBody`가 있으면 `--- payload ---` + 직렬화, `responseBody`가 있으면 `--- response ---` + 직렬화. 없으면 각 섹션 생략.
    - body 직렬화 헬퍼: string이면 JSON 정렬(`JSON.parse`→`stringify(_, null, 2)`, 실패 시 raw), descriptor면 라벨(`[truncated 5MB/1MB]`·`[binary image/png 2MB]`·`[stream text/event-stream]`·`[omitted: memory-cap]`).
    - 16KB(16384자) 초과 body는 자르고 `…(truncated)`.
    - `language`: 두 body 중 하나라도 JSON 정렬 성공 시 `"json"`, 아니면 `undefined`.
  - `serializeConsoleEntry(entry: ConsoleEntry): { text: string; language?: string }`
    - `[${level}] ${args}` + level==="error" && stack이면 개행 후 stack. `language` 없음.
- **검증**:
  - [ ] `pnpm test logToCodeBlock` 통과
  - [ ] 케이스: JSON body 정렬 / non-JSON raw / GET(body 없음) / truncated·binary·stream·omitted descriptor 4종 / 16KB 초과 truncate / WS 헤더만 / 콘솔 error+stack / 콘솔 비-error(stack 미포함)

### Task 2: TiptapEditor 핸들에 코드블럭 삽입
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**:
  - `TiptapEditorHandle`(`:86`)에 `insertCodeBlock(text: string, language?: string): void` 추가.
  - `useImperativeHandle`(`:249`)에 구현: `editor?.chain().focus().insertContent([{ type: "codeBlock", attrs: { language: language ?? null }, content: text ? [{ type: "text", text }] : [] }, { type: "paragraph" }]).run()`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) 삽입 후 에디터에 코드블럭 렌더, 뒤 문단으로 커서 이동 가능
  - [ ] (수동) `onChange` 마크다운에 ```` ```lang ```` fence 출력 확인

### Task 3: content 컴포넌트에 선택 노출
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`, `src/sidepanel/components/ConsoleLogContent.tsx`
- **작업 내용**:
  - **NetworkLogContent**: optional `onActiveChange?: (id: string | null) => void` 추가. 내부 `handleSelect`에서 activeId 변경 시 호출(기존 master-detail 선택 그대로 재사용).
  - **ConsoleLogContent**: user-click 선택이 없으므로(현재 행은 expand 토글만), optional `selectable?: boolean` + `selectedId?: string | null` + `onActiveChange?: (id) => void` 추가. `selectable`일 때 행 클릭 = 선택(하이라이트 + `onActiveChange` 호출) + 기존 expand 유지(선택된 행은 펼쳐 args/stack 확인). 미공급 시 기존 동작 완전 동일(비침습).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 SubTab·PreviewDialog(콜백 미공급)에서 동작·렌더 무변경 확인
  - [ ] (컴포넌트 테스트 가능하면) selectable 모드에서 행 클릭 시 onActiveChange 호출 — `*.test.tsx`

### Task 4: LogInsertDialog 신규
- **변경 대상**: `src/sidepanel/components/LogInsertDialog.tsx` (신규)
- **작업 내용**:
  - Props: `{ open, onOpenChange, requests, entries, syncBaseMs?, onInsert }` (design.md 시그니처).
  - shadcn `Dialog` + `DialogHeader`(title) + 상단 `Tabs`(network/console) + 하단 각 탭에 `NetworkLogContent`/`ConsoleLogContent`(selectable) + `DialogFooter`(닫기·삽입).
  - 상태: `tab`, `activeNetworkId`, `activeConsoleId`. 현재 탭 선택 id 있을 때만 삽입 버튼 활성.
  - 삽입: 선택 로그를 `serializeNetworkRequest`/`serializeConsoleEntry`로 직렬화 → `onInsert(text, language)` → `onOpenChange(false)`.
  - 레이아웃: `NetworkLogPreviewDialog` 관례(80vw×80vh, rounded-3xl, gap-5, p-6).
  - `data-testid`: 다이얼로그·탭·삽입 버튼(e2e용).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) 탭 전환·행 선택·삽입 버튼 활성/비활성 동작

### Task 5: SectionTextarea에 버튼 연결
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx` (`SectionTextarea`, `:653`)
- **작업 내용**:
  - `isParagraph` 분기 `action` 슬롯(Camera·ImagePlus 옆)에 로그 첨부 버튼 추가(모든 문단 섹션).
  - 로컬 `useState`로 다이얼로그 open 관리. `useEditorStore`에서 `networkLog`·`consoleLog` 구독.
  - 로그 둘 다 비면 버튼 `disabled`.
  - `<LogInsertDialog>` 렌더: requests/entries 주입, `onInsert={(text, lang) => editorRef.current?.insertCodeBlock(text, lang)}`.
  - 아이콘: lucide 적절한 것(예: `FileCode`/`ScrollText`) — DESIGN.md 아이콘 컨벤션.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) 발생 현상·기대 결과·비고 섹션 각각에서 버튼 → 다이얼로그 → 삽입 동작
  - [ ] (수동) 로그 없을 때 버튼 비활성

### Task 6: Notion 코드블럭 청킹 픽스 (테스트 먼저)
- **변경 대상**: `src/background/notion-api.ts` (`richText`, `:366`), `src/background/__tests__/notion-api.test.ts` (있으면 추가, 없으면 신규)
- **작업 내용**:
  - `richText(content)`를 2000자 청크 배열로 분할(design.md 코드). 빈 문자열 `[]` 유지.
- **검증**:
  - [ ] `pnpm test notion-api` 통과
  - [ ] 케이스: 빈 문자열 → `[]` / 2000자 이하 → 단일 원소(기존과 동일) / 2001자 → 2원소 / 16KB → 8원소
  - [ ] (수동) 2000자 초과 코드블럭 포함 리포트를 Notion 제출 → 400 없이 성공

### Task 7: i18n 키 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`, `src/i18n/namespaces/logs.ts` (배치는 기존 관례 따름)
- **작업 내용** (키명 예시 — 구현 시 기존 네이밍 관례 확인):
  - 버튼 tooltip: `draft.attachLog` ("로그 첨부" / "Attach log")
  - 다이얼로그 title: `logInsert.dialog.title`
  - 탭 라벨: 기존 `networkLog.*`/`consoleLog.*` 재사용 가능하면 재사용, 아니면 `logInsert.tab.network`/`.console`
  - 삽입 버튼: `common.insert` (없으면 신규, "삽입" / "Insert")
  - payload/response 구분자는 코드 상수(비-i18n, 영문 고정 — 코드블럭 내부 텍스트)
- **검증**:
  - [ ] `src/i18n/__tests__/locales.test.ts` 통과 (PostToolUse 훅 자동)
  - [ ] ko/en 키 대칭

## 테스트 계획

- **단위 테스트**:
  - `logToCodeBlock.test.ts`: Task 1 검증 케이스 전부 (네트워크 body 분기·descriptor 5종·truncate·WS·콘솔 stack).
  - `notion-api.test.ts`: `richText` 청킹 경계값.
- **컴포넌트 테스트(*.test.tsx, 선택)**: ConsoleLogContent selectable 모드 행 클릭 → onActiveChange. NetworkLogContent onActiveChange.
- **e2e 시나리오** (`/e2e-write` 입력):
  - "발생 현상 섹션의 로그 첨부 버튼을 누르면 로그 삽입 다이얼로그가 열린다."
  - "네트워크 탭에서 요청 행을 선택하고 삽입을 누르면 다이얼로그가 닫히고 발생 현상 에디터에 코드블럭이 추가된다."
  - "네트워크·콘솔 로그가 모두 없으면 로그 첨부 버튼이 비활성이다."
- **수동 테스트** (자동화 불가):
  - Notion에 2000자 초과 코드블럭 포함 리포트 실제 제출 → 400 없이 성공(외부 API).
  - Jira·GitHub·Linear·GitLab·Asana·ClickUp·Slack 각각 삽입된 코드블럭 렌더 시각 확인.
  - 삽입 후 코드블럭 편집·삭제 자유로운지.

## 구현 순서 권장

1. **Task 1**(직렬화) + **Task 6**(Notion 청킹) — 서로 독립, 순수 함수/테스트라 병렬 가능. 먼저 착수.
2. **Task 2**(TiptapEditor 핸들) — 독립, 병렬 가능.
3. **Task 3**(content 선택 노출) — 독립, 병렬 가능.
4. **Task 4**(LogInsertDialog) — Task 1·3 의존.
5. **Task 5**(SectionTextarea 연결) — Task 2·4 의존.
6. **Task 7**(i18n) — Task 4·5와 함께(키가 정해지는 시점).

## 가이드 영향

사용자 노출 신규 UX(발생 현상 섹션 로그 첨부 버튼·삽입 다이얼로그). 구현 후 `/guide`로 갱신:
- `guide/ko`·`guide/en`의 리포트 작성/로그 관련 페이지 — 로그를 본문에 코드블럭으로 삽입하는 방법 추가. 정확한 파일은 `guide/AUTHORING.md` IA 확인 후 결정(리포트 작성 또는 로그 섹션).
