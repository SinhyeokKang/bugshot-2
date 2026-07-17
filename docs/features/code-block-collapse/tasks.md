# 코드블럭 접기/펼치기 — 구현 태스크

## 선행 조건

- **새 의존성 없음.** `@tiptap/pm`(설치됨)의 `Plugin`/`PluginKey`/`Decoration`/`DecorationSet`은 `TiptapEditor.tsx:14-15`가 이미 import한다. NodeView는 플러그인 `props.nodeViews`로 제공하므로 `@tiptap/extension-code-block` 추가가 **불필요**하다 — 이건 소스로 확인된 사실이다(design.md 위험 1). tiptap 실제 버전은 **3.23.4**.
- 새 권한·env·외부 API 없음. `manifest.config.ts` 무변경 → `docs/privacy.*` 트리거 아님.
- shadcn 컴포넌트 설치 없음(pill은 vanilla DOM이라 `Button`을 못 쓴다).
- 착수 전 `docs/POSTMORTEM.md`에서 아래 4건을 읽고 온다: 2026-07-16 팔레트 단일 출처 거짓, 2026-06-28 log-viewer 사전 drift, 2026-07-14 포인터/레이아웃은 단위 테스트로 못 잡음, **2026-07-04 Radix Tabs pointerdown(단위 2645개 green인데 e2e만 잡음 — Task 9 시나리오 7의 근거)**. POSTMORTEM 2026-07-16(useReproPrefill) 항목의 StrictMode 경고도 Task 3에 직결된다. (POSTMORTEM은 최신순 prepend라 하드 라인 참조가 썩는다 — 날짜+제목으로 인용.)

---

## 태스크

### Task 1: 판정 코어 + 단위 테스트 (TDD)

- **변경 대상**: `src/sidepanel/lib/codeCollapse.ts` (신규), `src/sidepanel/lib/__tests__/codeCollapse.test.ts` (신규)
- **작업 내용**: `/tdd interface` 모드로 **테스트 먼저**. `CODE_COLLAPSE_LINE_THRESHOLD = 15`, `countCodeLines(text)`, `shouldCollapseCode(lineCount)`. `countCodeLines`는 후행 개행 **1개만** 제거 후 `\n`으로 센다(markdown-it은 붙이고 ProseMirror는 안 붙인다 — design.md 위험 7).
- **검증**:
  - [ ] `countCodeLines("a\nb")` = 2, `countCodeLines("a\nb\n")` = 2 (두 표면이 같은 숫자)
  - [ ] `countCodeLines("a\nb\n\n")` = 3 (의도적 빈 줄은 살린다 — 후행 개행은 1개만 제거)
  - [ ] `countCodeLines("")` = 1, `countCodeLines("a")` = 1
  - [ ] `shouldCollapseCode(15)` = false, `shouldCollapseCode(16)` = true (PRD 엣지 케이스 표)
  - [ ] `pnpm test` 통과

### Task 2: DOM 셸 + CSS

- **변경 대상**: `src/sidepanel/lib/codeCollapseShell.ts` (신규), `src/sidepanel/components/code-collapse.css` (신규)
- **작업 내용**: `createCodeCollapseShell(pre, labels)` — design.md "생성되는 DOM" 그대로. `--code-collapse-lines`를 `CODE_COLLAPSE_LINE_THRESHOLD`로 주입(CSS에 `15` 리터럴 금지). `update(lineCount)`가 `data-collapsible`·`data-lines`·pill 라벨 갱신(**`expanded`는 절대 안 건드림**), `setExpanded`가 `data-collapsed`·`aria-expanded`·라벨 갱신 + `onToggle` 통지. fade·toggle에 **`contenteditable="false"`**, toggle에 `aria-controls`(+`pre`에 유일 id 발급). 라벨은 **`textContent`로만** 설정. `destroy()`는 click 리스너 해제 **+ wrapper unwrap**(pre를 원래 자리로 복원 — StrictMode 재부착 시 중첩 방지). **`code-collapse.css`는 이 파일이 side-effect import한다**(design.md의 import 주체 노트 — `globals.css` 경유 금지). CSS는 design.md 블록 그대로.
- **검증**:
  - [ ] `grep -n "15" src/sidepanel/components/code-collapse.css` → 0건 (임계값 단일 출처)
  - [ ] `grep -rn "dark:" src/sidepanel/components/code-collapse.css` → 0건 (semantic 토큰만 — DESIGN.md §3)
  - [ ] `grep -n "overflow" src/sidepanel/components/code-collapse.css` → `overflow-y` 만, `overflow:` shorthand 0건 (기존 `overflow-x: auto`를 덮으면 안 됨)
  - [ ] `grep -n "data-testid" src/sidepanel/lib/codeCollapseShell.ts` → `code-collapse`·`code-collapse-toggle` 2건 (**e2e 시나리오 전부가 이 셀렉터에 걸려 있다** — 빠뜨리면 Task 9에서야 발견된다)
  - [ ] `grep -n "contenteditable" src/sidepanel/lib/codeCollapseShell.ts` → 2건 (fade + toggle)
  - [ ] `grep -n "code-collapse.css" src/sidepanel/lib/codeCollapseShell.ts` → 1건 (세 표면 자동 커버)
  - [ ] `pnpm typecheck` 통과

### Task 3: preview 부착 (훅 + 두 표면)

- **변경 대상**: `src/sidepanel/hooks/useCodeCollapse.ts` (신규), `src/sidepanel/components/DocSectionBody.tsx`, `src/sidepanel/components/IssuePreviewView.tsx`
- **작업 내용**: design.md의 `useCodeCollapse` 구현 — **`pre.closest(".code-collapse")` 가드 필수**(StrictMode 중첩 방지, design.md 위험 10). `DocSectionBody.MarkdownBody`(:48)는 기존 `html` useMemo(:95)를 dep으로 넘기고 라벨은 `useT()`로 조달. `IssuePreviewView.PreviewSectionBody`(:138)는 `renderMarkdown(section.value)`(:167)를 **`useMemo`로 뽑고**(최적화가 아니라 정확성 요건 — 안 하면 `copied` 토글마다 펼침이 리셋된다) 라벨은 **`labels` prop으로** 받는다(`useT()` 절대 금지 — 키 네임스페이스가 달라 raw 키가 화면에 뜬다). `IssuePreviewViewLabels`에 `expandCode`/`collapseCode` 추가.
- **검증**:
  - [ ] `grep -n "useT\|@/i18n" src/sidepanel/components/IssuePreviewView.tsx` → 0건 (log-viewer 격리 유지)
  - [ ] `grep -n "closest" src/sidepanel/hooks/useCodeCollapse.ts` → 1건 (StrictMode 가드)
  - [ ] **dev 서버에서 preview를 열어 wrapper가 1겹인지 확인** — StrictMode 중첩은 `pnpm test`가 못 잡고 dev에서 100% 재현된다
  - [ ] `logCards`/`media`/`attachments` 슬롯의 `pre`가 안 감싸진다 (훅 root가 `.doc-section-body` 컨테이너 내부로 한정 — design.md 위험 5)
  - [ ] `pnpm typecheck` — `PreviewPanel.tsx`·`log-viewer/App.tsx` 두 호출부가 labels 누락으로 **타입 에러가 나야 정상**(Task 6·7이 채운다)

### Task 4: 에디터 부착 (NodeView) — ⚠ 최고 위험

- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**: `JsonCodeHighlight` 아래에 `CodeCollapseNodeView` 클래스 + `CodeBlockCollapse` 확장 추가, `extensions` 배열(:206~)에 등록. design.md "에디터 부착" 그대로 — `ignoreMutation`/`stopEvent` 필수, `syncEditing`이 `expanded`를 **단방향 승격**만 한다(이탈 시 재접힘 없음). `decorations`는 선택이 걸친 codeBlock에 `class: "is-editing"`. 라벨은 모듈 레벨 `t`(`@/i18n`).
- **함께 갱신**: `TiptapEditor.tsx:94-95`의 `// NodeView 없이 inline decoration이면 편집·커서에 무해.` 주석 — 이제 같은 codeBlock에 NodeView가 붙으므로 후임자에게 오해를 남긴다. 두 플러그인이 공존하는 이유(inline deco는 `contentDOM` 안)를 반영해 고친다.
- **작업 순서**: 위험 1은 소스로 해소됐으므로(design.md) **스파이크 없이 바로 구현**한다. 폴백이 필요해지면 `StarterKit.configure({ codeBlock: false })` + `@tiptap/extension-code-block` 하나뿐이다.
- **검증** (⚠ **실제 Chrome 필수** — 아래 전부 jsdom·단위로 못 잡는다). **두 에디터 모두에서 확인**: `DraftingPanel` + `DraftEditDialog`(섹션 연필 버튼 — 다이얼로그의 낮은 높이에서도 접힘이 정상인지):
  - [ ] `pnpm build` 후 언팩 로드 → 40줄 JSON 로그 삽입 → 에디터에서 15줄로 접힘 + 페이드
  - [ ] **16번째 줄의 절반이 실제로 보인다** (border-box calc 검증 — 0px면 `+2em` padding 항 누락, 가로 오버플로 블럭에서만 안 보이면 `+10px` 스크롤바 항 누락 — design.md CSS 주석)
  - [ ] **JSON 하이라이팅이 그대로다** (보라 key / 빨강 string) — design.md 위험 2
  - [ ] pill 클릭 → 펼침. **커서가 안 움직인다** — design.md 위험 3 (e2e 시나리오 7이 자동으로도 잡는다)
  - [ ] 접힌 블럭 안 클릭 → 자동 펼침 + pill·페이드 사라짐. **커서를 밖으로 빼도 펼침 유지** + pill이 `접기`로 복귀 (PRD 시나리오 B-3)
  - [ ] **Tab 키로 pill에 포커스가 도달한다** + 포커스 링이 보인다 (`contenteditable="false"` 검증 — design.md 위험 11)
  - [ ] pill 텍스트에 커서가 안 들어간다 / 드래그 셀렉션에 안 섞인다
  - [ ] 블럭 내용을 15줄 이하로 지움 → pill·페이드 사라짐. 다시 늘림 → pill 줄 수 갱신 (PRD 엣지 케이스 표)
  - [ ] **펼친 상태 → 14줄로 줄임 → 20줄로 늘림 → 펼친 채로 돌아온다** (`update()`가 `expanded` 불간섭 — PRD 엣지 케이스 표)
  - [ ] 코드블럭 2개 → 각각 독립 토글
  - [ ] 접힘 상태에서 긴 줄이 **가로 스크롤된다** (`overflow-y: hidden` 검증)
  - [ ] 접힘/펼침 어느 상태에서든 preview 본문이 정상 (마크다운 무오염 육안 확인)

### Task 5: i18n 키 (ko/en)

- **변경 대상**: `src/i18n/namespaces/logs.ts`
- **작업 내용**: `"codeBlock.expand"` — ko `"펼치기 ({count}줄)"` / en `"Expand ({count} lines)"`, `"codeBlock.collapse"` — ko `"접기"` / en `"Collapse"`. ko/en을 **같은 편집으로** 넣는다(PostToolUse 훅이 `locales.test.ts`를 자동 실행해 불일치면 차단). count는 항상 ≥16이라 en 복수형 `(s)` 관용구가 불필요하다.
- **왜 `editor.ts`가 아니라 `logs.ts`인가**: `log-viewer/__tests__/i18n.test.ts:94-102`의 복제 사전 drift 검사가 **`logs` 네임스페이스만 대조한다**(`Object.keys(koDict).filter(k => k in logs.ko)`). `editor.ts`에 두면 이 키들의 ko/en drift가 영원히 무방비다 — design.md 위험 6. `logs.ts` 배치는 **코드 0줄로** 기존 검사에 걸린다.
- **검증**:
  - [ ] 저장 시 i18n 훅 자동 통과 (ko/en 키 대칭 + `{count}` 토큰 일치)
  - [ ] 기존 `logInsert.*`가 아닌 `codeBlock.*` prefix — 로그 전용이 아니라 모든 코드블럭이므로 (prd.md 전제 2)
  - [ ] `common.collapse`("접기")·`editor.dom.collapse`가 이미 존재하지만 **재사용하지 않는다** — 표면별 라벨 수명이 다르고, `codeBlock.expand`가 `{count}`로 짝을 이뤄야 해서 한 네임스페이스에 모으는 게 낫다. (문구 중복은 감수)

### Task 6: 사이드패널 preview 라벨 주입

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: `IssuePreviewView` labels(`labels={{`는 :375)에 `expandCode: (lines) => t("codeBlock.expand", { count: lines })`, `collapseCode: t("codeBlock.collapse")` 추가.
- **검증**: [ ] `pnpm typecheck` 통과 / [ ] Preview 탭 pill 라벨이 ko·en 모두 정상

### Task 7: log-viewer 사전 + 라벨 주입 + drift 검사 확장 (⚠ 자동 검사 사각지대)

- **변경 대상**: `src/log-viewer/i18n.ts`, `src/log-viewer/App.tsx`, `src/log-viewer/__tests__/i18n.test.ts`
- **작업 내용**:
  - `koDict`/`enDict`에 Task 5와 **같은 키·같은 문구** 2개 추가. `App.tsx`의 labels(`labels={{`는 :155)에 Task 6과 같은 형태로 주입.
  - **`i18n.test.ts:94-102`의 drift 검사 대조 대상에 `editor` 네임스페이스 추가.** 지금은 `logs`만 본다. Task 5가 키를 `logs.ts`에 두어 당장은 걸리지만, 앞으로 누가 `editor.ts`에 넣어도 사각지대가 없게 만든다. **이 확장은 현재 log-viewer dict와 `editor` 네임스페이스의 교집합이 0키라 당장은 no-op(장래 방어용)이다** — 지금 무는 건 어디까지나 기존 `logs` 대조다.
- **왜 별도 태스크인가**: log-viewer는 `src/i18n/`을 안 쓰는 복제 사전이라 **PostToolUse 훅이 이 파일을 안 본다.** 빠뜨리면 Report 탭에 원시 키가 뜬다. POSTMORTEM 2026-06-28이 잡은 drift의 재발 지점이고, 그 처방("복제본은 늘 대조 테스트로 묶는다")을 **grep·육안이 아니라 테스트로** 이행하는 게 이 태스크의 핵심이다.
- **검증**:
  - [ ] `grep -n "codeBlock.expand\|codeBlock.collapse" src/log-viewer/i18n.ts` → 4건(ko 2 + en 2)
  - [ ] **일부러 `enDict`의 `{count}`를 `{n}`으로 바꿔보면 테스트가 빨개진다** — 이 변조가 확인하는 건 **기존 `logs` 대조**가 codeBlock 키를 실제로 무는지다(`editor` 확장 분기는 교집합 0키라 이 변조로는 실행되지 않는다 — 위 작업 내용 참조)
  - [ ] `pnpm test` 통과
  - [ ] `pnpm build` → logs.html 다운로드 → Report 탭에서 pill 라벨 정상 (원시 키 아님)

### Task 8: 마크다운 무오염 회귀 테스트 — 이 기능의 핵심 안전망

- **변경 대상**: `src/sidepanel/lib/__tests__/renderMarkdown.test.ts`, `src/sidepanel/components/__tests__/DocSectionBody.test.tsx` (신규)
- **작업 내용**:
  - `renderMarkdown.test.ts`: 16줄 이상 ` ```json ` 블럭을 렌더해도 출력에 `code-collapse`·`펼치기`·`button`이 **없다**고 단언. `buildIssueHtml`이 이 함수를 쓰므로 이게 곧 클립보드·트래커 본문 무오염 증명이다(design.md 데이터 흐름).
  - `DocSectionBody.test.tsx`(jsdom + user-event): 20줄 블럭 → `data-collapsed="true"`, **pill의 `data-lines`가 `"20"`** → pill 클릭 → `data-collapsed="false"` + `aria-expanded="true"` + 라벨이 `codeBlock.collapse`. 10줄 블럭 → `data-collapsible="false"`, pill 없음. 코드블럭 2개 렌더 → 두 `pre`의 id가 서로 다르고 각 pill의 `aria-controls`가 자기 `pre` id와 매칭(셸의 "인스턴스마다 유일 id 발급" 단언).
  - **라벨은 키로 단언한다.** 기존 tsx 트랙 3건(`ConsoleLogContent`/`NetworkLogContent`/`CcMultiCombobox.test.tsx`)이 전부 `vi.mock("@/i18n", () => ({ useT: () => (key) => key, … }))`로 모킹하므로 실제 렌더 결과는 `codeBlock.collapse`다. `접기`로 단언하면 처음부터 실패하고, 모킹을 빼면 `useT`가 `useSettingsUiStore`(zustand persist)를 구독해 chrome.storage에 닿는다. **줄 수는 라벨 텍스트가 아니라 `data-lines`로 잡는다** — 키 모킹 하에선 `{count}` 보간이 안 일어나기 때문이다. 실제 ko/en 문구는 `locales.test.ts`(Task 5)와 e2e(Task 9)가 맡는다.
- **검증**:
  - [ ] 접기 코드를 되돌리면(임시) `renderMarkdown` 단언이 여전히 통과 — 즉 이 테스트가 **접기 도입과 무관하게** 마크다운 경로를 지킨다
  - [ ] `pnpm test` 통과

### Task 9: e2e

- **변경 대상**: `e2e/fixtures/extension.ts`, `e2e/code-block-collapse.spec.ts` (신규), `e2e/COVERAGE.md`
- **작업 내용**: fixture 서버에 **긴 JSON 엔드포인트** 추가 — 현재 `/e2e-json*`의 응답은 `{"note":"zqxbodyneedle"}`(`e2e/fixtures/extension.ts:43`)이고, `serializeBody`가 `JSON.stringify(…, null, 2)`로 펼쳐도(`src/sidepanel/lib/logToCodeBlock.ts:43`) **헤더 포함 5줄**이라 임계값 15에 못 미친다. `/e2e-bigjson*`가 pretty-print 시 30줄 이상 나오는 본문을 주도록 분기 추가. `log-insert.spec.ts`의 흐름(로그 적재 → freeform → 삽입 다이얼로그 → preview)을 따르고 `README.md`·`COVERAGE.md` 갱신.
- **⚠ 픽스처 본문 설계 함정 2개**:
  - `maskBody`가 `token`·`access_token`·`api_key` 같은 키를 `"***"`로 치환한다(`src/content/network-recorder-helpers.ts:69-75`) → 이 키들을 쓰면 값이 마스킹돼 혼란스럽다.
  - `maskJsonBody`는 **depth > 10에서 원본을 반환**한다(:50) → 30줄을 깊은 중첩으로 만들면 안 된다. **배열 원소로 늘리는 게 안전하다.**
  - 나머지 상한은 여유다(`BODY_CAP` 3MB, `MAX_CHARS` 16384).
- **검증**: [ ] `pnpm build:e2e && pnpm test:e2e` green + 1회 재실행 green

---

## 테스트 계획

### 단위 테스트 (node 트랙, `*.test.ts`)
- `codeCollapse.test.ts` — Task 1 검증 항목.
- `renderMarkdown.test.ts` — Task 8의 무오염 단언 추가.

### 렌더 테스트 (jsdom 트랙, `*.test.tsx`)
- `DocSectionBody.test.tsx` — Task 8. **전제 3(줄 수 = 높이) 덕에 성립한다**: 접기 판정에 레이아웃 측정이 없어 jsdom이 `scrollHeight`를 0으로 줘도 무관하다. px 측정으로 갔다면 이 트랙 전체가 불가능했다.
- 에디터(NodeView)는 **이 트랙으로 못 잡는다** — ProseMirror가 jsdom에서 NodeView를 온전히 안 그린다. Task 4의 수동 체크리스트가 유일한 안전망.

### e2e 시나리오 (`/e2e-write` 입력 — 스크립트 판정 가능한 문장만)
1. 30줄 이상 네트워크 로그를 본문에 삽입하고 preview로 가면, 코드블럭 wrapper에 `data-collapsed="true"`가 붙는다.
2. 그 코드블럭에 hover한 뒤 pill(`code-collapse-toggle`)을 클릭하면 `data-collapsed="false"`로 바뀌고 pill 텍스트가 `접기`/`Collapse`로 바뀐다. (셸은 짧은 블럭에도 상시 생성되고 에디터·preview가 같은 `data-testid`를 공유하므로, 단언은 **preview 섹션 컨테이너 내부 + `data-collapsible="true"`인 wrapper**로 스코프를 한정하고 텍스트 단언의 로케일 전제를 spec에 명시한다.)
3. 다시 클릭하면 `data-collapsed="true"`로 되돌아온다.
4. pill의 `aria-expanded`가 `data-collapsed`와 반대로 따라간다.
5. 15줄 이하 로그(`/e2e-json`)를 삽입하면 wrapper에 `data-collapsible="false"`가 붙고 pill이 안 보인다.
6. 16줄 이상 블럭을 삽입해 **에디터에서 pill로 펼침/접힘을 토글한 뒤** `마크다운 복사`를 눌러도 클립보드 텍스트에 `펼치기`·`code-collapse`가 없다. **필수** — 클립보드 payload 단언 선례가 이미 2건 있고(`e2e/freeform-draft.spec.ts:29-53`, `e2e/logview/log-viewer.spec.ts:97-104`), Task 8의 `renderMarkdown` 단언은 **NodeView 부착 상태의 `getMarkdown()` 직렬화** 축을 못 덮으므로 이 시나리오가 그 축의 유일한 자동 검증이다.
7. **에디터에서 접힌 코드블럭의 pill을 클릭해도 커서 위치가 안 바뀐다** (`stopEvent` 회귀 — design.md 위험 3). PM은 click보다 먼저 mousedown에서 selection을 잡으므로 **jsdom+user-event로는 재현이 안 된다**. POSTMORTEM 2026-07-04(Radix Tabs pointerdown)이 같은 부류였고 `pnpm test` 2645개가 전부 통과한 채 e2e만 잡아냈다 — 그래서 수동 체크리스트에 두지 않고 여기로 승격했다.

> **판정 가능한 이유**: 접힘을 `data-collapsed` 속성으로 표현했기 때문이다. `max-height`·페이드·hover 페이드인은 시각 판정이라 e2e가 못 본다 — 하지만 **상태 전이는 속성으로 전부 잡힌다.** Playwright는 `opacity: 0`을 visible로 치므로 hover 없이도 pill 클릭이 가능하나, 시나리오 2는 실제 hover를 넣어 관용구를 지킨다.

### 수동 테스트 (Chrome — 자동화 불가분만)
- [ ] Task 4의 에디터 체크리스트 전부 (NodeView·커서·하이라이팅 상호작용) — **`DraftingPanel`·`DraftEditDialog` 두 에디터**
- [ ] **다크모드**에서 페이드가 `pre` 배경과 이음매 없이 이어진다 (라이트=slate / 다크=neutral 비대칭 팔레트 — DESIGN.md §2)
- [ ] 접힌 높이가 정확히 15줄 + 16번째 줄 절반 (레퍼런스 스크린샷 대조 — border-box calc 검증)
- [ ] hover 시 pill 페이드인, 이탈 시 페이드아웃
- [ ] Tab 키로 pill에 포커스 → hover 없이 보이고 **포커스 링이 보인다**(`--ring`이 `--border`와 같은 값이라 링이 흐릴 수 있음 — DESIGN.md 경고)
- [ ] 긴 줄이 **접힘 상태에서도 가로 스크롤된다**
- [ ] **preview를 dev(StrictMode)에서 열어 wrapper가 1겹** (design.md 위험 10)
- [ ] **`DraftDetailDialog`(DocSectionBody)에서 접힘 높이·페이드 이음매·pill 위치 정상** — 다이얼로그의 좁은 높이. 5개 표면 중 이 목록에 빠져 있던 유일한 표면(jsdom은 상태 전이만 잡고 시각은 못 잡는다)
- [ ] logs.html Report 탭 pill (Task 7) + **탭을 옮겼다 와도 접힘이 유지된다**(언마운트 없음 — PRD 목표의 수명 차이)

## 구현 순서 권장

```
Task 1 (코어·TDD)
   └─> Task 2 (셸·CSS)
          ├─> Task 3 (preview 부착) ──┬─> Task 6 (사이드패널 라벨)  ← Task 5 필요
          │                            └─> Task 7 (log-viewer)      ← Task 5 필요
          └─> Task 4 (에디터 NodeView) ⚠ 최고 위험 (스파이크는 불필요)
Task 5 (i18n)  — Task 1~2와 병렬 가능
Task 8 (회귀 테스트) — Task 3·4 후
Task 9 (e2e) — 전부 후
```

- **스파이크는 이제 불필요하다.** 위험 1(플러그인 `props.nodeViews`)이 소스로 해소돼(design.md) 범위가 바뀔 여지가 없다. Task 4는 여전히 최고 위험이지만 그건 구현 난이도(NodeView 함정)이지 설계 불확실성이 아니다.
- Task 5는 독립적이라 언제든 — 단 **Task 3·4의 라벨 육안 검증 전에는 완료**돼 있어야 한다(키 부재면 raw 키가 떠서 육안 확인이 오염된다). Task 6·7은 Task 3이 만든 타입 에러를 해소하는 짝이라 함께 처리한다.
- Task 3과 Task 4는 서로 독립 — 병렬 가능.

## 가이드 영향

사용자 노출 UX 변경이라 갱신 필요. 작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다. 구현 후 `/guide`로 처리.

- **로그를 이슈 본문에 넣기** 페이지 (ko·en) — 삽입된 로그가 길면 자동으로 접히고, 코드블럭에 마우스를 올려 `펼치기 (N줄)`로 전체를 볼 수 있다는 설명 추가. `/guide`가 `guide/ko`·`guide/en`에서 로그 삽입을 다루는 실제 페이지 경로를 확인해 반영한다(이 기능의 직전 작업인 `symptom-log-attach`가 만든 문단 옆).
- 새 페이지 추가는 없다 — 기존 로그 삽입 설명에 한 문단.
