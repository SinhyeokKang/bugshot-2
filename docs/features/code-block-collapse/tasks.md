# 코드블럭 접기/펼치기 — 구현 태스크

## 선행 조건

- **새 의존성 없음.** `@tiptap/pm`(설치됨)의 `Plugin`/`PluginKey`/`Decoration`/`DecorationSet`은 `TiptapEditor.tsx:14-15`가 이미 import한다. NodeView는 플러그인 `props.nodeViews`로 제공하므로 `@tiptap/extension-code-block` 추가가 **불필요**하다(design.md 위험 1의 폴백에서만 필요).
- 새 권한·env·외부 API 없음. `manifest.config.ts` 무변경 → `docs/privacy.*` 트리거 아님.
- shadcn 컴포넌트 설치 없음(pill은 vanilla DOM이라 `Button`을 못 쓴다).
- 착수 전 `docs/POSTMORTEM.md`에서 아래 3건을 읽고 온다: 2026-07-16 팔레트 단일 출처 거짓, 2026-06-28 log-viewer 사전 drift, 2026-07-14 포인터/레이아웃은 단위 테스트로 못 잡음.

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
- **작업 내용**: `createCodeCollapseShell(pre, labels)` — design.md "생성되는 DOM" 그대로. `--code-collapse-lines`를 `CODE_COLLAPSE_LINE_THRESHOLD`로 주입(CSS에 `15` 리터럴 금지). `update(lineCount)`가 `data-collapsible`·pill 라벨 갱신, `setExpanded`가 `data-collapsed`·`aria-expanded`·라벨 갱신. toggle의 `click` 리스너는 `destroy()`에서 해제. CSS는 design.md 블록 그대로.
- **검증**:
  - [ ] `grep -n "15" src/sidepanel/components/code-collapse.css` → 0건 (임계값 단일 출처)
  - [ ] `grep -rn "dark:" src/sidepanel/components/code-collapse.css` → 0건 (semantic 토큰만 — DESIGN.md §3)
  - [ ] `pnpm typecheck` 통과

### Task 3: preview 부착 (훅 + 두 표면)

- **변경 대상**: `src/sidepanel/hooks/useCodeCollapse.ts` (신규), `src/sidepanel/components/DocSectionBody.tsx`, `src/sidepanel/components/IssuePreviewView.tsx`
- **작업 내용**: design.md의 `useCodeCollapse` 구현. `DocSectionBody.MarkdownBody`(:97)는 기존 `html` useMemo(:95)를 dep으로 넘기고 라벨은 `useT()`로 조달. `IssuePreviewView.SectionBody`(:164)는 `renderMarkdown(section.value)`(:167)를 `useMemo`로 뽑고 라벨은 **`labels` prop으로** 받는다(`useT()` 절대 금지 — log-viewer 번들이 깨진다). `IssuePreviewViewLabels`에 `expandCode`/`collapseCode` 추가.
- **검증**:
  - [ ] `grep -n "useT\|@/i18n" src/sidepanel/components/IssuePreviewView.tsx` → 0건 (log-viewer 격리 유지)
  - [ ] `pnpm typecheck` — `PreviewPanel.tsx`·`log-viewer/App.tsx` 두 호출부가 labels 누락으로 **타입 에러가 나야 정상**(Task 6·7이 채운다)

### Task 4: 에디터 부착 (NodeView) — ⚠ 최고 위험

- **변경 대상**: `src/sidepanel/components/TiptapEditor.tsx`
- **작업 내용**: `JsonCodeHighlight` 아래에 `CodeCollapseNodeView` 클래스 + `CodeBlockCollapse` 확장 추가, `extensions` 배열(:216 근처)에 등록. design.md "에디터 부착" 그대로 — `ignoreMutation`/`stopEvent` 필수. `decorations`는 선택이 걸친 codeBlock에 `class: "is-editing"`. 라벨은 모듈 레벨 `t`(`@/i18n`).
- **작업 순서**: **플러그인 `props.nodeViews`가 먹는지부터 확인**하고(design.md 위험 1) 안 되면 폴백으로 갈아탄 뒤 나머지를 짠다. 이 확인 없이 아래를 다 짜면 헛수고가 된다.
- **검증** (⚠ **실제 Chrome 필수** — 아래 전부 jsdom·단위로 못 잡는다):
  - [ ] `pnpm build` 후 언팩 로드 → 40줄 JSON 로그 삽입 → 에디터에서 15줄로 접힘 + 페이드
  - [ ] **JSON 하이라이팅이 그대로다** (보라 key / 빨강 string) — design.md 위험 2
  - [ ] pill 클릭 → 펼침. **커서가 안 움직인다** — design.md 위험 3
  - [ ] 접힌 블럭 안 클릭 → 자동 펼침 + pill·페이드 사라짐. 커서 밖으로 → 다시 접힘 (PRD 시나리오 B)
  - [ ] 블럭 내용을 15줄 이하로 지움 → pill·페이드 사라짐. 다시 늘림 → pill 줄 수 갱신 (PRD 엣지 케이스 표)
  - [ ] 코드블럭 2개 → 각각 독립 토글
  - [ ] 접힘/펼침 어느 상태에서든 Preview 탭 본문이 정상 (마크다운 무오염 육안 확인)

### Task 5: i18n 키 (ko/en)

- **변경 대상**: `src/i18n/namespaces/editor.ts`
- **작업 내용**: `"codeBlock.expand"` — ko `"펼치기 ({count}줄)"` / en `"Expand ({count} lines)"`, `"codeBlock.collapse"` — ko `"접기"` / en `"Collapse"`. ko/en을 **같은 편집으로** 넣는다(PostToolUse 훅이 `locales.test.ts`를 자동 실행해 불일치면 차단). count는 항상 ≥16이라 en 복수형 `(s)` 관용구가 불필요하다.
- **검증**:
  - [ ] 저장 시 i18n 훅 자동 통과 (ko/en 키 대칭 + `{count}` 토큰 일치)
  - [ ] 기존 `logInsert.*`가 아닌 `codeBlock.*` prefix — 로그 전용이 아니라 모든 코드블럭이므로 (prd.md 전제 2)

### Task 6: 사이드패널 preview 라벨 주입

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`
- **작업 내용**: `IssuePreviewView` labels(:373~)에 `expandCode: (lines) => t("codeBlock.expand", { count: lines })`, `collapseCode: t("codeBlock.collapse")` 추가.
- **검증**: [ ] `pnpm typecheck` 통과 / [ ] Preview 탭 pill 라벨이 ko·en 모두 정상

### Task 7: log-viewer 사전 + 라벨 주입 (⚠ 자동 검사 사각지대)

- **변경 대상**: `src/log-viewer/i18n.ts`, `src/log-viewer/App.tsx`
- **작업 내용**: `koDict`/`enDict`에 Task 5와 **같은 키·같은 문구** 2개 추가. `App.tsx:151`의 labels에 Task 6과 같은 형태로 주입.
- **왜 별도 태스크인가**: log-viewer는 `src/i18n/`을 안 쓰는 복제 사전이라 **PostToolUse 훅이 이 파일을 안 본다.** 빠뜨리면 Report 탭에 원시 키가 뜬다. POSTMORTEM 2026-06-28이 잡은 drift의 재발 지점.
- **검증**:
  - [ ] `grep -n "codeBlock.expand\|codeBlock.collapse" src/log-viewer/i18n.ts` → 4건(ko 2 + en 2)
  - [ ] `pnpm build` → logs.html 다운로드 → Report 탭에서 pill 라벨 정상 (원시 키 아님)

### Task 8: 마크다운 무오염 회귀 테스트 — 이 기능의 핵심 안전망

- **변경 대상**: `src/sidepanel/lib/__tests__/renderMarkdown.test.ts`, `src/sidepanel/components/__tests__/DocSectionBody.test.tsx` (신규)
- **작업 내용**:
  - `renderMarkdown.test.ts`: 16줄 이상 ` ```json ` 블럭을 렌더해도 출력에 `code-collapse`·`펼치기`·`button`이 **없다**고 단언. `buildIssueHtml`이 이 함수를 쓰므로 이게 곧 클립보드·트래커 본문 무오염 증명이다(design.md 데이터 흐름).
  - `DocSectionBody.test.tsx`(jsdom + user-event): 20줄 블럭 → `data-collapsed="true"`, pill 텍스트에 `20` 포함 → pill 클릭 → `data-collapsed="false"` + 라벨 `접기`. 10줄 블럭 → `data-collapsible="false"`, pill 없음.
- **검증**:
  - [ ] 접기 코드를 되돌리면(임시) `renderMarkdown` 단언이 여전히 통과 — 즉 이 테스트가 **접기 도입과 무관하게** 마크다운 경로를 지킨다
  - [ ] `pnpm test` 통과

### Task 9: e2e

- **변경 대상**: `e2e/fixtures/extension.ts`, `e2e/code-block-collapse.spec.ts` (신규), `e2e/COVERAGE.md`
- **작업 내용**: fixture 서버에 **긴 JSON 엔드포인트** 추가 — 현재 `/e2e-json*`는 `{"note":"zqxbodyneedle"}` 한 줄짜리라(`e2e/README.md:51`) 접기 임계값에 한참 못 미친다. `/e2e-bigjson*`가 pretty-print 시 30줄 이상 나오는 본문을 주도록 분기 추가(`serializeBody`가 `JSON.stringify(…, null, 2)`로 펼치므로 중첩 객체 몇 개면 충분). `log-insert.spec.ts`의 흐름(로그 적재 → freeform → 삽입 다이얼로그 → preview)을 따르고 `README.md`·`COVERAGE.md` 갱신.
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
2. 그 코드블럭에 hover한 뒤 pill(`code-collapse-toggle`)을 클릭하면 `data-collapsed="false"`로 바뀌고 pill 텍스트가 `접기`/`Collapse`로 바뀐다.
3. 다시 클릭하면 `data-collapsed="true"`로 되돌아온다.
4. pill의 `aria-expanded`가 `data-collapsed`와 반대로 따라간다.
5. 15줄 이하 로그(`/e2e-json`)를 삽입하면 wrapper에 `data-collapsible="false"`가 붙고 pill이 안 보인다.
6. 접힘/펼침 어느 상태에서 `마크다운 복사`를 눌러도 클립보드 텍스트에 `펼치기`·`code-collapse`가 없다. *(가능하면 — 클립보드 권한이 걸리면 Task 8 단위 테스트로 대체)*

> **판정 가능한 이유**: 접힘을 `data-collapsed` 속성으로 표현했기 때문이다. `max-height`·페이드·hover 페이드인은 시각 판정이라 e2e가 못 본다 — 하지만 **상태 전이는 속성으로 전부 잡힌다.** Playwright는 `opacity: 0`을 visible로 치므로 hover 없이도 pill 클릭이 가능하나, 시나리오 2는 실제 hover를 넣어 관용구를 지킨다.

### 수동 테스트 (Chrome — 자동화 불가분만)
- [ ] Task 4의 에디터 체크리스트 전부 (NodeView·커서·하이라이팅 상호작용)
- [ ] **다크모드**에서 페이드가 `pre` 배경과 이음매 없이 이어진다 (라이트=slate / 다크=neutral 비대칭 팔레트 — DESIGN.md §2)
- [ ] 접힌 높이가 정확히 15줄 + 다음 줄 절반 (레퍼런스 스크린샷 대조)
- [ ] hover 시 pill 페이드인, 이탈 시 페이드아웃
- [ ] Tab 키로 pill에 포커스 → hover 없이 보인다(`:focus-visible`)
- [ ] 긴 줄이 접힘 상태에선 잘리고, 펼치면 가로 스크롤된다
- [ ] logs.html Report 탭 pill (Task 7)

## 구현 순서 권장

```
Task 1 (코어·TDD)
   └─> Task 2 (셸·CSS)
          ├─> Task 3 (preview 부착) ──┬─> Task 6 (사이드패널 라벨)  ← Task 5 필요
          │                            └─> Task 7 (log-viewer)      ← Task 5 필요
          └─> Task 4 (에디터 NodeView) ⚠ 위험 1을 최우선 확인
Task 5 (i18n)  — Task 1~2와 병렬 가능
Task 8 (회귀 테스트) — Task 3·4 후
Task 9 (e2e) — 전부 후
```

- **Task 4를 먼저 스파이크하는 것도 합리적**이다. 플러그인 `props.nodeViews`가 안 먹으면 폴백(의존성 1개 추가)이 필요해 범위가 바뀐다 — Task 2~3을 다 짠 뒤 알게 되는 것보다 낫다.
- Task 5는 독립적이라 언제든. Task 6·7은 Task 3이 만든 타입 에러를 해소하는 짝이라 함께 처리한다.
- Task 3과 Task 4는 서로 독립 — 병렬 가능.

## 가이드 영향

사용자 노출 UX 변경이라 갱신 필요. 작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다. 구현 후 `/guide`로 처리.

- **로그를 이슈 본문에 넣기** 페이지 (ko·en) — 삽입된 로그가 길면 자동으로 접히고, 코드블럭에 마우스를 올려 `펼치기 (N줄)`로 전체를 볼 수 있다는 설명 추가. `/guide`가 `guide/ko`·`guide/en`에서 로그 삽입을 다루는 실제 페이지 경로를 확인해 반영한다(이 기능의 직전 작업인 `symptom-log-attach`가 만든 문단 옆).
- 새 페이지 추가는 없다 — 기존 로그 삽입 설명에 한 문단.
