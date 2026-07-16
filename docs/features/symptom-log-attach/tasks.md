# 발생 현상 로그 삽입 — 구현 태스크

## 선행 조건

- 새 의존성 없음. shadcn `Dialog`/`Tabs`/`Button`/`ButtonGroup` 이미 사용 중. `TooltipIconButton` 존재(공용 합성).
- 새 권한·env·OAuth·외부 API 없음. 코어밸류(데이터 직행) 무영향 — 삽입은 클라이언트 내 텍스트 조작. 단 **캡처 로그 원문을 트래커 본문에 노출**하는 새 동작이라 privacy 문서 갱신 대상(Task 8).

## 태스크

### Task 1: 순수 직렬화 함수 (테스트 먼저)
- **변경 대상**: `src/sidepanel/lib/logToCodeBlock.ts` (신규), `src/sidepanel/lib/__tests__/logToCodeBlock.test.ts` (신규)
- **작업 내용**:
  - `serializeNetworkRequest(req: NetworkRequest): { text: string; language?: string }`
    - 헤더 라인 `${method} ${path} → ${status} ${statusText}` (path: `networkLogPath(req.url)` — 실제 경로 `src/lib/network-log-path.ts`, 시그니처 `networkLogPath(url: string)`).
    - **pending·status 0 방어**: `phase==="pending"`이면 status 자리에 `(pending)`, status가 0이거나 statusText 공백이면 표기 방어(`→ 0 undefined` 금지).
    - WebSocket(`req.webSocket` 존재)이면 헤더 라인만(`WS ${url} → ${status}`), body 섹션 없음.
    - `requestBody` 있으면 `--- payload ---` + 직렬화, `responseBody` 있으면 `--- response ---` + 직렬화. 없으면 각 섹션 생략.
    - body 직렬화 헬퍼: string이면 JSON 정렬(`JSON.parse`→`stringify(_, null, 2)`, 실패 시 raw), descriptor면 라벨(`[truncated 5MB/1MB]`·`[binary image/png 2MB]`·`[stream text/event-stream]`·`[omitted: memory-cap]`).
    - 16384 chars(문자) 초과 body는 자르고 `…(truncated)`.
    - `language`: 두 body 중 하나라도 JSON 정렬 성공 시 `"json"`, 아니면 `undefined`.
  - `serializeConsoleEntry(entry: ConsoleEntry): { text: string; language?: string }`
    - `[${level}] ${args}` + level==="error" && stack이면 개행 후 stack. `language` 없음.
    - args도 16384 chars 초과 시 truncate.
- **검증**:
  - [x] `pnpm test logToCodeBlock` 통과
  - [x] 케이스: JSON body 정렬 / non-JSON raw / GET(body 없음) / truncated·binary·stream·omitted descriptor 4종 / 16K 초과 truncate / **pending 요청 / status 0 요청** / WS 헤더만 / 콘솔 error+stack / **콘솔 error-no-stack** / 콘솔 비-error(stack 미포함) / **콘솔 거대 args truncate**

### Task 2: TiptapEditor 핸들에 코드블럭 삽입
- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**:
  - `TiptapEditorHandle`(`:86`)에 `insertCodeBlock(text: string, language?: string): void` 추가.
  - `useImperativeHandle`(`:249`)에 구현: `editor?.chain().focus().insertContent([{ type: "codeBlock", attrs: { language: language ?? null }, content: text ? [{ type: "text", text }] : [] }, { type: "paragraph" }]).run()`.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (수동) 삽입 후 에디터에 코드블럭 렌더, 뒤 문단으로 커서 이동 가능
  - [ ] (수동, **게이트**) `getMarkdown()` 결과에 ```` ```json ```` fence + language가 실제로 출력되는지 눈으로 1회 확인(tiptap-markdown 내부 동작)

### Task 3: content 컴포넌트에 선택 노출
- **변경 대상**: `src/sidepanel/components/NetworkLogContent.tsx`, `src/sidepanel/components/ConsoleLogContent.tsx`
- **작업 내용**:
  - **NetworkLogContent**: optional `onActiveChange?: (id: string | null) => void` 추가. `activeId`에 `useEffect`를 걸어 발화(초기값·scroll `onFound`·`handleSelect` 전 경로 커버). 기존 master-detail 선택 재사용.
  - **ConsoleLogContent**: 표시 전용(행 클릭=expand만, activeId는 영상sync 파생)이므로 `selectable?: boolean` + `selectedId?: string | null` + `onActiveChange?` 3개 추가. `selectable`일 때: 행 클릭 = 선택(selectedId 설정 + onActiveChange) + expand 이중 동작, 재클릭은 접기(선택 유지). 선택 하이라이트는 **`ring-2 ring-primary` 계열**(배경 아님 — 레벨 틴트·sync 하이라이트와 경합 방지). 미공급 시 기존 동작 완전 동일(비침습).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] 기존 SubTab·PreviewDialog(콜백 미공급)에서 동작·렌더 무변경 확인 — 각 호출부 2곳
  - [x] (컴포넌트 테스트 `*.test.tsx`) NetworkLogContent 행 클릭 → onActiveChange 호출 / ConsoleLogContent selectable 모드 행 클릭 → onActiveChange 호출 **+ ring 하이라이트가 뜬다 + 선택·expand 이중 동작**

### Task 4: LogInsertDialog 신규
- **변경 대상**: `src/sidepanel/components/LogInsertDialog.tsx` (신규)
- **작업 내용**:
  - Props: `{ open, onOpenChange, requests, entries, syncBaseMs?, onInsert }` (design.md 시그니처).
  - shadcn `Dialog` + `DialogHeader`(title = "본문에 삽입" 계열) + 상단 `Tabs`(network/console) + 하단 `NetworkLogContent`/`ConsoleLogContent`(selectable) + `DialogFooter`(닫기·삽입).
  - 상태: `tab`, `activeNetworkId`, `activeConsoleId`. 현재 탭 선택 id 있을 때만 삽입 버튼 활성.
  - 삽입: 선택 로그를 `serializeNetworkRequest`/`serializeConsoleEntry`로 직렬화 → `onInsert(text, language)` → `onOpenChange(false)`. **삽입 후 toast 없음**(사용자 결정).
  - 레이아웃: `NetworkLogPreviewDialog` 관례(80vw×80vh, rounded-3xl, gap-5, p-6).
  - `data-testid`: 다이얼로그 루트 `log-insert-dialog`(e2e 스코프), 탭·삽입 버튼도 부착.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (수동) 탭 전환·행 선택·삽입 버튼 활성/비활성 동작
  - [ ] (수동, **폭 게이트**) 사이드패널 폭에서 Tabs 추가로 세로/가로 압박이 수용 가능한지 실측

### Task 5: SectionTextarea 버튼 연결 + ButtonGroup/TooltipIconButton 재구성
- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx` (`SectionTextarea`, `:653`)
- **작업 내용**:
  - `isParagraph` 분기 `action`을 `ButtonGroup`으로 감싸고 tiptap 삽입 버튼 3개를 **`[로그 | 캡처 | 업로드]`** 순서로 담는다(모든 문단 섹션). 아코디언 chevron은 Section이 `{action}` 뒤에 자동 렌더 → `[로그|캡처|업로드] [▾]`. Section 무변경.
  - **세 버튼 전부 `TooltipIconButton`으로 통일**(DESIGN.md §13, `IssueTab:482` 선례). 기존 Camera·ImagePlus의 `title`-only 레거시도 이 재구성 시 승급.
  - `import { ButtonGroup } from "@/components/ui/button-group"`, `TooltipIconButton`.
  - 로그 버튼: 아이콘 `FileCode`, `aria-label`/툴팁 "로그 삽입"(`draft.insertLog`), `data-testid="section-log-insert-${section.id}"`.
  - 로컬 `useState`로 다이얼로그 open 관리. `useEditorStore`에서 `networkLog`·`consoleLog` 구독. 로그 둘 다 비면 로그 버튼만 `ariaDisabled`(TooltipIconButton 잠금, 툴팁 유지). 캡처·업로드는 유지.
  - `<LogInsertDialog>` 렌더: requests/entries 주입, `onInsert={(text, lang) => editorRef.current?.insertCodeBlock(text, lang)}`.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] (수동) `[로그|캡처|업로드]`가 세그먼트로 묶이고 chevron은 분리 렌더, 세 버튼 툴팁 노출
  - [ ] (수동) 발생 현상·기대 결과·비고 섹션 각각에서 로그 버튼 → 다이얼로그 → 삽입 동작
  - [ ] (수동) 기존 캡처·업로드 동작 무회귀
  - [ ] (수동) 로그 없을 때 로그 버튼만 비활성(툴팁 유지), 캡처·업로드는 활성

### Task 6: Notion 코드블럭 청킹 픽스 + export (테스트 먼저)
- **변경 대상**: `src/background/notion-api.ts` (`richText`, `:366`), `src/background/__tests__/notion-api.test.ts`
- **작업 내용**:
  - `richText`를 **export**(단위 테스트 대상)하고, content를 2000자 청크 배열로 분할(design.md 코드). 빈 문자열 `[]` 유지.
- **검증**:
  - [x] `pnpm test notion-api` 통과
  - [x] 케이스: 빈 문자열 → `[]` / 2000자 이하 → 단일 원소(기존과 동형) / 2001자 → 2원소 / 16384자 → 9원소
  - [ ] (수동) 2000자 초과 코드블럭 포함 리포트를 Notion 제출 → 400 없이 성공

### Task 7: i18n 키 (ko/en 동시)
- **변경 대상**: `src/i18n/namespaces/issue.ts`, `src/i18n/namespaces/logs.ts` (배치는 기존 관례 확인 후)
- **작업 내용** (키명 예시 — 구현 시 기존 네이밍 관례 확인):
  - 버튼 tooltip: `draft.insertLog` ("로그 삽입" / "Insert log") — 기존 "로그 첨부"(logs.html)와 구분되는 라벨.
  - 다이얼로그 title / 삽입 버튼: `logInsert.dialog.title`, `logInsert.insert`("본문에 삽입"/"Insert")
  - 탭 라벨: 기존 `networkLog.*`/`consoleLog.*` 재사용 가능하면 재사용, 아니면 `logInsert.tab.*`
  - payload/response 구분자는 코드 상수(비-i18n, 영문 고정 — 코드블럭 내부 텍스트)
- **검증**:
  - [x] `src/i18n/__tests__/locales.test.ts` 통과 (PostToolUse 훅 자동)
  - [x] ko/en 키 대칭

### Task 8: privacy 문서 갱신
- **변경 대상**: `docs/privacy.ko.md`, `docs/privacy.en.md` (ko 원본 + en 번역 동시, 상단 시행일 포함)
- **작업 내용**: 캡처된 네트워크/콘솔 로그를 사용자가 골라 이슈 본문에 코드블럭으로 삽입하는 새 동작 + 마스킹 범위(token/password/secret만) + 그 외 원문 노출은 사용자 확인 후 삽입임을 반영.
- **검증**:
  - [x] ko/en 본문·시행일 동시 갱신, 내용 일치
  - [ ] `/push` privacy 신선도 검사 통과 예상

## 테스트 계획

- **단위 테스트**:
  - `logToCodeBlock.test.ts`: Task 1 검증 케이스 전부(네트워크 body 분기·descriptor 5종·truncate·pending/status0·WS·콘솔 stack/no-stack/거대args).
  - `notion-api.test.ts`: `richText` 청킹 경계값(빈/2000/2001/16384).
- **컴포넌트 테스트(*.test.tsx)**: NetworkLogContent onActiveChange. ConsoleLogContent selectable(행 클릭 → onActiveChange + ring 하이라이트 + 선택/expand 이중동작).
- **e2e 시나리오** (`/e2e-write` 입력, 판정 셀렉터 명시):
  - "발생 현상 섹션의 로그 삽입 버튼(`section-log-insert-description`)을 누르면 로그 삽입 다이얼로그(`log-insert-dialog`)가 열린다."
  - "네트워크 탭에서 요청 행(`[data-entry-id]`)을 선택하고 삽입을 누르면 다이얼로그가 닫히고, preview 전환 시 `preview-section-description`가 삽입된 요청 텍스트(예 `POST /`)를 포함한다." (tiptap 마크다운은 e2e가 직접 못 읽으므로 preview 렌더로 판정. 다이얼로그 내 재사용 content testid는 `log-insert-dialog` 스코프로 특정.)
  - "네트워크·콘솔 로그가 모두 없으면 로그 삽입 버튼이 비활성이다."
- **수동 테스트** (자동화 불가):
  - Notion에 2000자 초과 코드블럭 포함 리포트 실제 제출 → 400 없이 성공(외부 API).
  - Jira·GitHub·Linear·GitLab·Asana·ClickUp·Slack 각각 삽입된 코드블럭 렌더 시각 확인(Asana는 언어 하이라이트 소실·원문 보존 예상).
  - 삽입 후 코드블럭 편집·삭제 자유로운지.
  - 사이드패널 폭에서 섹션 헤더 4컨트롤 압박 실측.

## 구현 순서 권장

1. **Task 1**(직렬화) + **Task 6**(Notion 청킹/export) — 서로 독립, 순수 함수/테스트라 병렬. 먼저 착수.
2. **Task 2**(TiptapEditor 핸들) — 독립, 병렬 가능.
3. **Task 3**(content 선택 노출) — 독립, 병렬 가능.
4. **Task 4**(LogInsertDialog) — Task 1·3 의존.
5. **Task 5**(SectionTextarea 연결) — Task 2·4 의존.
6. **Task 7**(i18n) — Task 4·5와 함께.
7. **Task 8**(privacy) — 독립, 언제든.

## 가이드 영향

사용자 노출 신규 UX(문단 섹션 로그 삽입 버튼·삽입 다이얼로그). 구현 후 `/guide`로 갱신:
- `guide/ko`·`guide/en`의 리포트 작성/로그 관련 페이지 — 로그를 본문에 코드블럭으로 삽입하는 방법 추가. 정확한 파일은 `guide/AUTHORING.md` IA 확인 후 결정.

## Privacy 영향

**있음** — 캡처된 로그 원문을 트래커 본문 평문으로 노출하는 새 동작. `docs/privacy.{ko,en}.md` 갱신 필요(Task 8). CLAUDE.md 문서 신선도 규칙의 "기존 권한을 새 목적으로 쓰거나 새 노출 동작 추가" 트리거에 해당.
