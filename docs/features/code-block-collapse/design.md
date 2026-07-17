# 코드블럭 접기/펼치기 — 기술 설계

## 개요

접기는 **마크다운 아래층이 아니라 DOM 위층**에서만 산다. 마크다운·ProseMirror 문서 모델은 한 글자도 안 바뀌고, 두 표면이 각자 렌더한 `<pre>`를 공통 wrapper로 감싸 페이드 레이어와 pill 버튼을 얹는다. 표면별로 DOM 소유자가 달라서(preview = React `dangerouslySetInnerHTML`, 에디터 = ProseMirror) **부착 메커니즘은 둘로 갈리지만, 그 아래 판정 로직·DOM 셸·CSS·라벨은 단일 출처를 공유**한다.

```
                    ┌─────────────────────────────────────┐
                    │  lib/codeCollapse.ts   (순수: 줄 수·임계값)
                    │  lib/codeCollapseShell.ts (vanilla DOM 셸)
                    │  components/code-collapse.css (표면 무관 클래스)
                    └───────────────┬─────────────────────┘
                    ┌───────────────┴───────────────┐
        preview: 렌더 후 DOM 순회              에디터: ProseMirror NodeView
   hooks/useCodeCollapse.ts (useEffect)   TiptapEditor.tsx의 CodeBlockCollapse 확장
   → IssuePreviewView / DocSectionBody    → props.nodeViews.codeBlock + props.decorations
```

**단일 출처 원칙을 이번엔 특히 빡세게 잡는다.** POSTMORTEM 2026-07-16("팔레트를 단일 출처로 승격했다는 주석이 거짓인 채 머지됨")이 정확히 이 파일 계열(`highlightJson.ts`)에서 터졌다. 임계값 `15`는 TS 상수 한 곳에만 존재하고 CSS는 그 값을 custom property로 **주입받는다** — CSS에 `15`를 리터럴로 적으면 두 번째 출처가 생긴다.

## 변경 범위

### 새 파일

#### `src/sidepanel/lib/codeCollapse.ts`
접기 판정의 순수 코어. node 트랙 단위 테스트 대상.

- `CODE_COLLAPSE_LINE_THRESHOLD = 15` — **임계값의 유일한 출처.**
- `countCodeLines(text)` — 줄 수. markdown-it은 `<code>` 본문 끝에 `\n`을 하나 붙이고 ProseMirror의 `node.textContent`는 안 붙이므로, **후행 개행 1개를 제거한 뒤** 센다. 두 표면이 같은 블럭에 다른 숫자를 내면 안 된다.
- `shouldCollapseCode(lineCount)` — `lineCount > CODE_COLLAPSE_LINE_THRESHOLD`.

#### `src/sidepanel/lib/codeCollapseShell.ts`
wrapper·fade·pill DOM을 만드는 vanilla 팩토리. React와 ProseMirror 양쪽에서 쓰므로 프레임워크 비의존.

- `createCodeCollapseShell(pre, labels)` → `CodeCollapseShell`
- 넘겨받은 `pre`를 wrapper 안으로 옮기고 fade·toggle을 붙인다. wrapper를 **문서 어디에 넣을지는 호출자 책임**(preview는 원래 `pre` 자리에, NodeView는 자기 `dom`으로).

#### `src/sidepanel/hooks/useCodeCollapse.ts`
preview 전용 React 훅. `dangerouslySetInnerHTML`이 그린 정적 HTML을 렌더 후 순회한다.

#### `src/sidepanel/components/code-collapse.css`
표면 무관 클래스 선택자(`.code-collapse*`)만 담는다.

> **import 주체는 `codeCollapseShell.ts`다.** 이 저장소는 전역 CSS 엔트리 없이 소비 컴포넌트가 상대경로로 co-located import한다(`doc-section-body.css` ← `DocSectionBody.tsx:10` **및** `IssuePreviewView.tsx:8` — 후자가 log-viewer 번들로 CSS를 나르는 유일한 경로). `TiptapEditor.tsx`에서만 import하면 preview·log-viewer가 무스타일 셸(안 잘림·페이드 없음·pill 상시 노출)을 얻는다. **DOM을 만드는 모듈이 자기 CSS를 side-effect import하면** 세 표면이 자동 커버되고 "import 주체"가 두 번째 출처가 될 여지도 없다. `globals.css` 경유는 log-viewer가 누락되므로 금지. (`.ts` 모듈의 CSS side-effect import는 저장소 선례가 없는 **신규 관례**다 — 위 근거로 의도적 도입.)

> **왜 기존 두 CSS에 나눠 쓰지 않는가**: `doc-section-body.css`와 `tiptap-editor.css`는 `pre` 규칙이 이미 **앞 6개 선언이 동일하게** 복제돼 있다(각각 :84, :106 — tiptap-editor.css만 v1.6.1의 `white-space: pre`가 하나 더 있다). 그 관례를 따라 접기 CSS도 복제하면 ~25줄 × 2의 두 번째 출처가 생긴다 — 팔레트 POSTMORTEM이 난 자리와 같은 실수다. 우리가 **자체 wrapper 클래스를 새로 도입하므로 표면 prefix 없이 선택자가 성립**한다 → 파일 하나로 끝난다. 기존 `pre` 규칙 복제는 이 기능과 무관하니 손대지 않는다(외과적 범위).

#### `src/sidepanel/lib/__tests__/codeCollapse.test.ts` · `src/sidepanel/components/__tests__/DocSectionBody.test.tsx`
테스트 계획은 `tasks.md` 참조.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/components/IssuePreviewView.tsx` | preview 본문 렌더(사이드패널 + **log-viewer 공용**). 모든 문구를 `labels` prop으로 받아 i18n 비의존 | `IssuePreviewViewLabels`에 `expandCode`/`collapseCode` 추가. `PreviewSectionBody`(:138)에서 `useCodeCollapse` ref 부착 |
| `src/sidepanel/components/DocSectionBody.tsx` | DraftDetailDialog의 섹션 본문 렌더. `useT()` 직접 사용 | `MarkdownBody`(:48, `dangerouslySetInnerHTML`은 :100)에 `useCodeCollapse` ref 부착. 라벨은 `useT()`로 자체 조달 |
| `src/sidepanel/components/TiptapEditor.tsx` | tiptap 에디터. `JsonCodeHighlight` 확장이 이미 codeBlock을 다룸 | `CodeBlockCollapse` 확장 추가 + `extensions` 배열(:206~)에 등록. **`DraftingPanel`·`DraftEditDialog` 두 에디터에 동시 적용된다** |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 사이드패널 preview. `IssuePreviewView`에 labels 주입(`labels={{`는 :375) | 새 라벨 2개를 `useT()`로 전달 |
| `src/log-viewer/App.tsx` | logs.html의 Report 탭. `IssuePreviewView`에 labels 주입(`labels={{`는 :155) | 새 라벨 2개를 log-viewer `t`로 전달 |
| `src/i18n/namespaces/logs.ts` | 로그 문구 ko/en. **log-viewer 복제 사전의 drift 검사 대상** | `codeBlock.expand`·`codeBlock.collapse` 추가 |
| `src/log-viewer/i18n.ts` | log-viewer 전용 **복제 사전**(`koDict`/`enDict`) | 같은 키 2개 추가 |
| `src/log-viewer/__tests__/i18n.test.ts` | 복제 사전 drift 검사 | 대조 대상에 `editor` 네임스페이스 추가 (아래 참조) |

> ⚠ **i18n 격리의 진짜 이유** (근거 정정): "컴포넌트가 `useT()`를 부르면 log-viewer 번들이 깨진다"는 **틀렸다.** `vite.log-viewer.config.ts:11`의 alias가 `"@/i18n" → "./src/log-viewer/i18n.ts"`로 갈아끼우고 그 파일이 `useT`를 export하므로 빌드는 된다 — 반례가 이미 있다(`Section.tsx:5`가 `useT`를 직접 부르고 `IssuePreviewView.tsx:5`가 그 Section을 import하며 정상 동작). **진짜 이유는 키 네임스페이스 불일치다**: 사이드패널의 `common.untitled` vs log-viewer의 `logViewer.report.untitled`. `useT()`를 직접 부르면 한쪽 표면에서 **raw 키가 화면에 뜬다.** `labels` prop이 그 격리다. 결정과 시그니처는 그대로 두되 근거는 이걸로 읽을 것.

> ⚠ **키를 `logs.ts`에 두는 이유 + drift 검사 확장.** `src/log-viewer/__tests__/i18n.test.ts:94-102`의 복제 사전 drift 검사는 **`logs` 네임스페이스만 대조한다**(`import { logs } from "../../i18n/namespaces/logs"`, `Object.keys(koDict).filter(k => k in logs.ko)`). `editor.ts`에 넣으면 `k in logs.ko`가 false라 **이 키들의 drift가 영원히 무방비**가 된다 — 위험 6이 지목한 POSTMORTEM 2026-06-28의 처방("복제본은 늘 대조 테스트로 묶는다")을 정면으로 비껴간다. 그래서 **키는 `logs.ts`에 두어 기존 검사에 자동으로 걸리게 하고**(코드 0줄 추가), **동시에 검사 대상에 `editor` 네임스페이스를 추가**해 앞으로 어느 쪽에 넣어도 사각지대가 없게 만든다.

## 데이터 흐름

접기는 **상태 저장소를 하나도 안 만든다.** Zustand·`chrome.storage`·draft 어디에도 안 들어간다.

```
[에디터]  NodeView 인스턴스의 로컬 필드 `expanded: boolean`
          → PM이 노드가 살아있는 한 NodeView 인스턴스를 유지하므로
            이게 곧 "이 블럭"의 정체성. 위치 매핑·id 속성이 필요 없다.
          → 커서가 블럭에 진입하면 expanded = true로 **승격**(단방향, 되돌리지 않음)
          → setContent(외부 value 변경)로 노드가 재생성되면 NodeView도 재생성 → 초기값(접힘)

[preview] wrapper DOM의 `data-collapsed` 속성
          → html 문자열이 바뀌면 React가 innerHTML을 통째로 갈아끼우고
            useEffect가 재실행돼 셸을 다시 만든다 → 초기값(접힘)
```

두 화면이 서로의 접힘 상태를 모른다(시나리오 A-5). 이건 버그가 아니라 비목표("영속 상태를 만들지 않는다")의 귀결이고, 형제 UI(`Section.tsx:67`·`JsonTreeViewer.tsx:68`)와 동일한 관용구다.

> **`expanded`는 단방향으로만 켜진다.** 커서 진입(`is-editing`)·pill 클릭 둘 다 `expanded = true`를 만들고, 끄는 건 pill 클릭뿐이다. `update(lineCount)`는 줄 수만 갱신하고 `expanded`를 절대 안 건드린다 — 그래서 임계값을 오르내려도 펼침이 유지된다(PRD 엣지 케이스 표). **사용자 의도를 시스템이 뒤집지 않는다**가 이 필드의 유일한 규칙이다.

**마크다운 흐름은 이 기능과 완전히 분리된다:**

```
tiptap 문서 모델 ──getMarkdown()──> 마크다운 ──> 8개 트래커 빌더
       │                                    └──> renderMarkdown() ──> buildIssueHtml() ──> 클립보드/리포트
       │                                                     │
       └─ NodeView는 DOM만 바꾼다                            └─ preview DOM ──(렌더 후)──> 접기 셸 부착
          (tiptap-markdown은 DOM이 아니라                        ↑ 여기서 처음 접기가 개입
           문서 모델에서 직렬화한다)
```

두 화살표가 **접기 부착점보다 먼저 갈라진다** — 이게 "마크다운 왕복이 안 깨진다"의 구조적 근거다. 주석이 아니라 회귀 테스트로 박는다(tasks.md Task 8).

## 인터페이스 설계

```ts
// src/sidepanel/lib/codeCollapse.ts
export const CODE_COLLAPSE_LINE_THRESHOLD = 15;
export function countCodeLines(text: string): number;
export function shouldCollapseCode(lineCount: number): boolean;

// src/sidepanel/lib/codeCollapseShell.ts
export interface CodeCollapseLabels {
  expand: (lines: number) => string;  // "펼치기 (38줄)"
  collapse: string;                   // "접기"
}

export interface CodeCollapseShell {
  readonly wrapper: HTMLDivElement;
  /** pill 버튼. NodeView의 stopEvent가 "pill에서 난 이벤트만 stop" 판정에 쓴다. */
  readonly toggle: HTMLButtonElement;
  /** 줄 수 갱신 → collapsible 여부·pill 라벨 재계산 (에디터에서 타이핑마다 호출).
   *  expanded는 건드리지 않는다 — 임계값을 오르내려도 사용자 의도가 유지된다. */
  update(lineCount: number): void;
  setExpanded(expanded: boolean): void;
  /** pill 클릭으로 상태가 바뀔 때 호출. NodeView가 자기 로컬 expanded를 따라잡는 용도.
   *  preview는 셸의 DOM 속성이 곧 상태라 안 쓴다. */
  onToggle?: (expanded: boolean) => void;
  /** toggle의 click 리스너 해제 + wrapper unwrap(pre를 원래 자리로 복원).
   *  unwrap이 필요한 이유: React cleanup 시점에 wrapper가 아직 DOM에 붙어 있을 수 있고
   *  (StrictMode의 mount→cleanup→mount는 innerHTML을 재설정하지 않는다),
   *  그 상태로 재부착하면 셸이 중첩된다. 위험 10 참조. */
  destroy(): void;
}

/** `pre`를 wrapper 안으로 이동시키고 fade·toggle을 붙인다. wrapper 배치는 호출자 책임. */
export function createCodeCollapseShell(
  pre: HTMLElement,
  labels: CodeCollapseLabels,
): CodeCollapseShell;

// src/sidepanel/hooks/useCodeCollapse.ts
/** html이 바뀔 때마다 root 안의 모든 `pre`에 접기 셸을 (재)부착한다. */
export function useCodeCollapse(
  html: string,
  labels: CodeCollapseLabels,
): React.RefObject<HTMLDivElement>;

// src/sidepanel/components/IssuePreviewView.tsx
export interface IssuePreviewViewLabels {
  untitled: string;
  copyMarkdown: string;
  copied: string;
  emptyValue: string;
  envTitle: string;
  expandCode: (lines: number) => string;  // 신규
  collapseCode: string;                   // 신규
}
```

> `expandCode`가 문자열이 아니라 함수인 이유: 줄 수는 런타임에 DOM에서 나오는데 `IssuePreviewView`는 i18n을 못 쓴다(위 ⚠). 템플릿 함수로 받는 게 log-viewer 격리를 유지하는 최소 수단이다.

### 생성되는 DOM (두 표면 동일)

```html
<div class="code-collapse" data-collapsible="true" data-collapsed="true"
     style="--code-collapse-lines: 15" data-testid="code-collapse">
  <pre id="code-collapse-pre-3"><code class="language-json">…</code></pre>
  <div class="code-collapse-fade" aria-hidden="true" contenteditable="false"></div>
  <button type="button" class="code-collapse-toggle" aria-expanded="false"
          aria-controls="code-collapse-pre-3" contenteditable="false"
          data-lines="38" data-testid="code-collapse-toggle">펼치기 (38줄)</button>
</div>
```

- `--code-collapse-lines`를 **JS가 `CODE_COLLAPSE_LINE_THRESHOLD`로 주입**한다. CSS는 `max-height: calc(var(--code-collapse-lines) * 1.5em + …)`로 받아 쓴다 → 임계값 출처는 TS 하나.
- `data-collapsible="false"`(15줄 이하)면 CSS가 fade·toggle을 `display:none`, `max-height:none`으로 만든다. 셸은 항상 만들고 속성으로만 끈다 — 에디터에서 타이핑으로 줄 수가 임계값을 오르내릴 때 DOM을 만들었다 부쉈다 하지 않기 위해서다.
- **`contenteditable="false"`가 fade·toggle에 필수다.** NodeView의 `dom`(= wrapper)은 `.ProseMirror`(contenteditable=true) 안에 산다. 없으면 pill 텍스트("펼치기 (38줄)")가 편집 가능 영역으로 취급돼 커서가 들어가거나 셀렉션에 포함되고, **contenteditable 내부 `<button>`은 브라우저별로 Tab 포커스가 도달하지 않는다** → `:focus-visible` 규칙과 성공 기준(키보드 도달)이 통째로 무력화된다. `ignoreMutation`/`stopEvent`로는 못 막는다. preview 표면은 contenteditable이 아니라 무해하므로 **두 표면 동일 DOM**을 유지한 채 셸이 항상 붙인다.
- pill 라벨은 **`textContent`로만** 쓴다(`innerHTML` 금지). 값이 i18n 문자열 + number라 실위험은 낮지만 셸이 DOM을 만드는 유일한 지점이므로 여기서 못박는다.
- `data-lines`는 줄 수의 **기계 판정용 출처**다. 라벨 텍스트는 locale에 따라 변하고 jsdom 테스트는 `useT`를 키 반환으로 모킹하므로(tasks.md Task 8), 줄 수를 텍스트로 단언할 수 없다.
- `aria-controls`가 토글과 `pre`를 잇는다. `pre`의 id는 셸이 인스턴스마다 유일하게 발급한다.

### CSS 규칙 (`code-collapse.css`)

```css
.code-collapse { position: relative; }

/* pre는 line-height: 1.5, padding: 1em (doc-section-body.css:84 / tiptap-editor.css:106 —
   앞 6개 선언 동일, tiptap만 white-space: pre 추가).
   em은 pre 자신의 font-size 기준이라 줄 수 × 1.5em이 정확히 그만큼의 줄이 된다.
   Tailwind preflight가 box-sizing: border-box를 걸므로(globals.css:4 / log-viewer/styles.css:1)
   max-height가 padding 상하를 모두 포함한다 → 2em = 1em(top) + 1em(bottom)을 더해야
   콘텐츠 영역이 정확히 15줄이 된다. + 0.75em = 16번째 줄의 절반을 남겨 "더 있다"를 드러낸다.
   (2em만 더하면 딱 15.0줄 = 16번째 줄이 0px 보인다. padding 상수는 반드시 CSS 원본에서
   재확인할 것 — 초안이 0.625em/0.75em으로 잘못 베껴 이 공식 전체가 무효였던 전력이 있다.)
   + 10px = 가로 스크롤바 항. globals.css의 ::-webkit-scrollbar(height: 10px)는 overlay가
   아니라 gutter라 오버플로 블럭에선 콘텐츠를 10px 더 잘라먹는다 — 이 기능의 주 타깃(긴 로그
   가로 오버플로)이 정확히 그 케이스라 상수로 더한다. 오버플로 없는 블럭은 16번째 줄이 약간
   더 보이는 쪽을 수용 (CSS만으로 오버플로 유무를 분기할 수 없다).
   overflow는 shorthand 금지 — 기존 pre 규칙의 overflow-x: auto를 덮어 긴 줄을 못 읽게 된다.
   logToCodeBlock의 truncate()는 개행 보존 절삭이지만 minified body는 개행이 없어
   한 줄 16KB로 들어온다 — 실재하는 케이스다. */
.code-collapse[data-collapsible="true"][data-collapsed="true"] pre {
  max-height: calc(var(--code-collapse-lines) * 1.5em + 2em + 0.75em + 10px);
  overflow-y: hidden;
}

/* pre 배경과 같은 토큰 → 다크모드 자동 대응 (DESIGN.md §3: semantic 토큰이면 dark: variant 불요) */
.code-collapse-fade {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 2.25rem;   /* 코드 2줄분(12px × 1.5 × 2 = 36px). em은 pre가 아니라 wrapper가 상속한
                        주변 폰트 기준이라 표면마다 덮는 줄 수가 흔들린다 — rem으로 못박는다 */
  pointer-events: none;
  border-radius: 0 0 0.375rem 0.375rem;
  background: linear-gradient(to bottom, transparent, hsl(var(--muted)));
}
.code-collapse:not([data-collapsible="true"][data-collapsed="true"]) .code-collapse-fade {
  display: none;
}

/* 사이즈는 저장소의 텍스트 버튼 관용구 = OriginFilterBar.tsx:27 / NetworkLogContent.tsx:620의
   h-7 px-2.5 text-[13px] font-normal. rounded-full은 안 쓴다 — DESIGN.md §6의 pill은
   "스위치 thumb·pill 배지·아바타" 규정이고 rounded-full 텍스트 버튼 선례는 0건이다.
   (레퍼런스는 둥근 pill이지만 관용구 일치를 택했다.) */
.code-collapse-toggle {
  position: absolute;
  bottom: 0.75rem;                            /* 스크롤바 밴드(하단 10px)와 안 겹치게 */
  left: 50%;
  transform: translateX(-50%);
  height: 1.75rem;                            /* h-7 */
  border-radius: 0.375rem;                    /* rounded-md */
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));              /* DESIGN.md §10: idle은 foreground, muted 금지 */
  padding: 0 0.625rem;                        /* px-2.5 */
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms;                  /* DESIGN.md §8: hover류 transition 관용(기본 150ms — 300ms는 다이얼로그 관용) */
}
.code-collapse[data-collapsible="false"] .code-collapse-toggle { display: none; }
.code-collapse:hover .code-collapse-toggle,
.code-collapse-toggle:focus-visible { opacity: 1; }

/* opacity만으로는 "보이기만 하고 포커스된 티가 안 나는" 상태가 된다.
   DESIGN.md는 --ring이 --border와 같은 값이라 링이 잘 안 보인다고 경고하므로 offset으로 띄운다. */
.code-collapse-toggle:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

/* 에디터 전용: 커서가 블럭 안에 있는 동안 pill·페이드를 치운다 (PRD 시나리오 B).
   pre의 max-height는 여기서 안 건드린다 — 커서 진입이 expanded를 승격시키므로
   data-collapsed="false"가 이미 접힘을 풀어준 상태다. 그래서 특이도 싸움이 없다. */
.code-collapse.is-editing .code-collapse-fade,
.code-collapse.is-editing .code-collapse-toggle { display: none; }
```

## 에디터 부착: 왜 NodeView이고, 왜 새 의존성이 없는가

**의존성 0.** `package.json`에 `@tiptap/extension-code-block`이 없다(StarterKit에 번들). 그런데 CodeBlock 확장을 `extend()`할 필요가 없다 — ProseMirror의 `nodeViews`는 **아무 플러그인이나 `props`로 제공할 수 있다.** 그래서 기존 `JsonCodeHighlight`와 나란히 `Extension.create({ addProseMirrorPlugins })` 하나만 추가하면 된다. StarterKit 재구성도, 새 패키지도 없다.

**이건 추정이 아니라 소스로 확인된 사실이다** (tiptap 3.23.4 기준):

- `prosemirror-view@1.41.8/dist/index.js:5874-5884`의 `buildNodeViews`가 `someProp("nodeViews", add)`로 `_props` → `directPlugins` → `state.plugins` 순으로 훑고, `add`가 `undefined`를 반환해 **short-circuit 없이 전부 병합**한다.
- `@tiptap/extension-code-block@3.23.4`에 **`addNodeView`가 0건** → `extensionManager.nodeViews`에 `codeBlock` 키가 없다 → 충돌 없이 플러그인 엔트리가 이긴다.

> **기존 주석과의 관계.** `TiptapEditor.tsx:94-95`에 `// NodeView 없이 inline decoration이면 편집·커서에 무해.`가 있다 — 코드베이스가 같은 codeBlock에 대해 NodeView를 의도적으로 회피한 흔적이고, 이 설계는 그걸 뒤집는다. **모순은 아니다**: 그 주석은 `JsonCodeHighlight`가 하이라이팅을 위해 NodeView를 쓸 필요가 없다는 뜻이고, inline decoration은 `contentDOM` 안에 렌더되므로 별도 플러그인이 제공하는 NodeView와 공존한다. 다만 NodeView가 "편집·커서"에 개입할 여지가 있다는 그 주석의 경계심은 유효하다 → 위험 2·3이 그걸 육안 확인으로 받는다. 구현 시 이 주석이 후임자에게 오해를 남기지 않도록 함께 갱신한다(Task 4).

```ts
// TiptapEditor.tsx — JsonCodeHighlight 바로 아래
const CodeBlockCollapse = Extension.create({
  name: "codeBlockCollapse",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: codeCollapseKey,
      props: {
        nodeViews: { codeBlock: (node) => new CodeCollapseNodeView(node) },
        decorations(state) { /* Decoration.node(from, to, { class: "is-editing" }, { isEditing: true }) — attrs가 CSS 클래스, spec이 NodeView 판정 키 */ },
      },
    })];
  },
});
```

**커서 자동 펼침**: PM은 node decoration의 `attrs`를 NodeView의 바깥 `dom`(= 우리 wrapper)에 자동으로 얹어주고, 같은 decoration이 NodeView의 `update(node, decorations)`로도 들어온다. 그래서 "선택이 이 codeBlock에 걸쳐 있으면"이라는 decoration 하나 — `Decoration.node(from, to, { class: "is-editing" }, { isEditing: true })` — 만 계산하면:

1. wrapper에 클래스가 붙어 **CSS가 pill·페이드를 치우고**,
2. `update()`가 그 decoration을 보고 `expanded`를 **true로 승격**한다(단방향 — 커서가 나가도 안 되돌린다, PRD 시나리오 B-3).

접힘 풀기를 CSS가 아니라 `expanded`가 담당하므로 `.is-editing pre { max-height: none }` 같은 규칙이 필요 없고, **특이도 싸움도 생기지 않는다.**

> ⚠ **`attrs`와 `spec`은 별개 인자다** — `Decoration.node(from, to, attrs, spec)`에서 wrapper에 클래스를 얹는 건 3번째 인자 `attrs`이고, NodeView가 읽는 `d.spec`은 4번째 인자다(미전달 시 빈 객체). attrs에만 `class`를 넣으면 CSS(pill·페이드 숨김)는 붙는데 `expanded` 승격이 **조용히 실패**한다 — 자동 펼침 없이 "커서는 40줄, 화면은 15줄"이 부분 재현된다. 반드시 spec에 `isEditing: true`를 함께 넘기고 판정은 spec 키로 한다.

**NodeView 본체:**

```ts
class CodeCollapseNodeView {
  dom: HTMLElement;         // shell.wrapper
  contentDOM: HTMLElement;  // <code>
  private shell: CodeCollapseShell;
  private expanded = false;

  constructor(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    const pre = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    if (node.attrs.language) this.contentDOM.className = `language-${node.attrs.language}`;
    pre.appendChild(this.contentDOM);
    this.shell = createCodeCollapseShell(pre, editorCollapseLabels());
    this.shell.onToggle = (next) => { this.expanded = next; };
    this.dom = this.shell.wrapper;
    this.shell.update(countCodeLines(node.textContent));
    this.syncEditing(decorations);
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    if (node.type.name !== "codeBlock") return false;
    this.shell.update(countCodeLines(node.textContent));  // expanded는 안 건드린다
    this.syncEditing(decorations);
    return true;   // 노드를 재생성하지 않음 → expanded 로컬 상태·NodeView 인스턴스 유지
  }

  // 커서 진입은 펼침을 승격시키기만 한다 — 이탈해도 되돌리지 않는다.
  private syncEditing(decorations: readonly Decoration[]) {
    const editing = decorations.some((d) => d.spec?.isEditing);
    if (editing && !this.expanded) {
      this.expanded = true;
      this.shell.setExpanded(true);
    }
  }

  // fade·toggle은 contentDOM 밖이다 — PM이 자기 DOM이 훼손됐다고 오해하지 않게 막는다.
  ignoreMutation(m: MutationRecord) { return !this.contentDOM.contains(m.target); }
  // pill에서 난 이벤트만 stop — 조건을 넓게 잡으면 pre 빈 영역(패딩·짧은 줄 우측 여백) 클릭의
  // 커서 배치까지 삼켜 시나리오 B(블럭 안 클릭 → 커서)가 텍스트 밖 클릭에서 무반응이 된다.
  stopEvent(e: Event) { return this.shell.toggle.contains(e.target as Node); }

  destroy() { this.shell.destroy(); }
}
```

`ignoreMutation` / `stopEvent`가 NodeView의 전형적 함정이다. 빠뜨리면 pill 클릭이 커서 점프를 일으키거나 PM이 DOM을 통째로 다시 그려 접힘이 튄다 → 위험 요소 참조.

**라벨 조달**: NodeView는 vanilla라 훅을 못 쓴다. `src/i18n/index.ts`가 모듈 레벨 `t`를 export하므로 `editorCollapseLabels()`가 호출 시점마다 `t("codeBlock.expand", { count })`를 부른다 → 에디터 재생성 없이 현재 locale을 따른다. (한계 — 수용: locale 전환 시 **이미 떠 있는** pill 라벨은 다음 `update()`까지 stale하고, 노드 `language` attr이 바뀌어도 `contentDOM` className은 constructor 이후 안 갱신된다. 둘 다 실사용 빈도가 낮다.)

## preview 부착: `dangerouslySetInnerHTML` 컨테이너를 직접 만져도 되는 이유

React는 `dangerouslySetInnerHTML` 노드의 **자식을 reconcile하지 않는다.** `__html` 문자열이 바뀔 때 innerHTML을 통째로 재설정할 뿐이다. 그래서:

- 우리가 effect에서 `pre`를 wrapper로 감싸도 React가 그걸 되돌리지 않는다.
- `html`이 바뀌면 React가 innerHTML을 갈아끼워 우리 셸이 통째로 사라지고, 같은 dep(`[html]`)의 effect가 재실행돼 다시 붙는다. 고아 리스너는 사라진 노드와 함께 GC된다(그래도 cleanup에서 `destroy()`를 부른다).

**단, effect가 자기 출력에 대해 idempotent해야 한다.** `sidepanel/main.tsx:45`·`log-viewer/main.tsx:45` 둘 다 StrictMode이고, React 18은 mount → cleanup → **mount를 innerHTML 재설정 없이** 반복한다. 가드가 없으면 2회차 `querySelectorAll("pre")`가 **이미 wrapper 안에 있는 같은 `pre`**를 찾아 다시 감싼다 → wrapper 중첩·fade 2개·pill 2개. dev에서 100% 재현한다. POSTMORTEM 2026-07-16(useReproPrefill) 항목이 정확히 이걸 경고한다 — "'StrictMode 한정' 분류를 의심하라 … StrictMode 발견은 dev 비용이 아니라 **prod 재실행 경로의 리허설**". 그래서 **가드(`closest`)와 `destroy()`의 unwrap을 둘 다** 둔다.

```ts
export function useCodeCollapse(html: string, labels: CodeCollapseLabels) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const shells = Array.from(root.querySelectorAll("pre")).flatMap((pre) => {
      if (pre.closest(".code-collapse")) return [];         // StrictMode 재실행 시 중첩 방지
      const anchor = document.createComment("");
      pre.replaceWith(anchor);                              // 원래 자리를 잡아둔다
      const shell = createCodeCollapseShell(pre, labelsRef.current);
      anchor.replaceWith(shell.wrapper);
      shell.update(countCodeLines(pre.textContent ?? ""));
      return [shell];
    });
    return () => { for (const s of shells) s.destroy(); };   // destroy()가 pre를 원래 자리로 복원
  }, [html]);

  return rootRef;
}
```

**`useMemo`는 최적화가 아니라 정확성 요건이다.** `IssuePreviewView.tsx:167`이 `renderMarkdown(section.value)`를 렌더마다 인라인 호출하고 `PreviewSectionBody`는 memo가 아니다. 그래서 `copied` state(`:54`, 1.5초 타이머)가 토글되기만 해도 트리가 재렌더 → **매번 새 html identity** → `[html]` dep이 변해 **모든 셸이 파괴·재생성되고 펼침 상태가 리셋된다.** 마크다운을 복사했을 뿐인데 펼쳐둔 블럭이 도로 접히는 증상이다. → `renderMarkdown(section.value)`를 `useMemo`로 뽑아 훅의 dep으로 넘긴다. `DocSectionBody`는 이미 `html`을 `useMemo`로 갖고 있다(:95).

## 기존 패턴 준수

- **테스트 2트랙** (CLAUDE.md): 판정은 순수 함수 → `codeCollapse.test.ts`(node). 접힘/펼침 전이는 렌더가 좌우 → `DocSectionBody.test.tsx`(jsdom + user-event). 전제 3 덕에 레이아웃 측정이 없어 jsdom으로 잡힌다.
- **i18n 동시 갱신** (CLAUDE.md): `src/i18n/`을 Edit하면 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다 — ko/en을 **같은 커밋에서** 넣어야 통과한다. log-viewer 복제 사전은 이 훅이 안 잡으니 `logs.ts` 배치 + drift 검사로 묶는다(위 ⚠).
- **DESIGN.md**: semantic 토큰(`--muted`/`--border`/`--background`/`--foreground`/`--ring`)만 써서 다크모드 자동 대응, `dark:` variant 0. pill 사이즈·모양은 저장소 텍스트 버튼 관용구(`h-7 px-2.5 text-[13px]` + `rounded-md`)를 따른다. idle 색은 `foreground`. hover는 transition.
- **hover 노출 선례**: `src/log-viewer/components/IssueTitleOverlay.tsx:13`(그라데이션 + `group-hover:opacity-100`)·`src/sidepanel/tabs/TrimTimeline.tsx:110`의 관용구를 plain CSS로 옮긴 것이다(wrapper·pill이 vanilla DOM이라 유틸리티 클래스를 쓸 자리가 없다). **다만 "같은 관용구"는 아니다** — `TrimTimeline`은 `pointer-events-none` 장식이고, `IssueTitleOverlay.tsx:20`의 issueKey `<a>`(opacity-0 → group-hover + pointer-events 복원)가 유일한 인터랙티브 hover-reveal 선례지만 포커스·키보드 고려는 없다. hover로 나타나는 인터랙티브 **`<button>`** 선례는 0건이다. 그래서 `contenteditable="false"`·`:focus-visible` 링·`aria-controls`를 선례보다 더 얹는다. 이건 관용구 답습이 아니라 확장이다.
- **주석 최소화** (CLAUDE.md): WHY가 비자명한 곳만 — `ignoreMutation`/`stopEvent`의 존재 이유, 후행 개행 제거, CSS var 주입 이유.

## 대안 검토

### A. `renderMarkdown`에 접기 마크업을 직접 넣는다 — ❌ 채택 불가

가장 단순해 보이지만 `buildIssueHtml()`이 같은 함수를 쓴다(`buildIssueMarkdown.ts:319`, 내부의 `renderMarkdown(content)` 호출은 :403). 클립보드 HTML과 logs.html 리포트에 pill 버튼이 그대로 딸려 나간다. **기능이 아니라 데이터 오염이다.**

### B. `<details>`/체크박스 CSS 해킹으로 JS 없이 — ❌

`<details>`는 마크업이 마크다운 렌더러에서 나와야 하는데 그건 A와 같은 문제다. 순수 CSS로는 줄 수를 셀 수 없어 "38 lines" 라벨이 불가능하고, 페이드·pill 위치도 `<summary>` 기본 동작과 싸워야 한다.

### C. 에디터를 `Decoration.widget`으로 (NodeView 회피) — ❌

widget은 codeBlock의 **인라인 콘텐츠 흐름 안**에 들어간다. pill을 하단 중앙에 절대 배치하려면 `pre`가 `position: relative`여야 하는데, `pre`는 `overflow-x: auto`라 **pill이 가로 스크롤과 함께 따라 움직인다.** wrapper 없이는 스크롤 컨테이너 바깥에 앵커를 둘 수 없다 → NodeView가 필요한 진짜 이유.

### D. 에디터 접힘 상태를 플러그인 state + 위치 매핑으로 — ❌ (당초 유력했으나 기각)

`tr.mapping.map(pos)`로 위치를 추적하는 PM 표준 패턴이지만, NodeView 인스턴스 자체가 이미 노드 수명과 동일한 정체성을 제공한다. 위치 매핑은 노드 삭제·`setContent` 시 유효성 검증 코드를 추가로 요구한다. **NodeView 로컬 필드가 더 적은 코드로 더 정확하다.**

### E. px(`scrollHeight`) 측정으로 접기 판정 — ❌

`pre`에 줄바꿈이 없다는 전제 3 덕에 줄 수와 높이가 1:1이라 px 측정이 주는 정보가 0이다. 대신 jsdom이 `scrollHeight`를 0으로 줘서 **테스트 가능성만 잃는다.** `ResizeObserver` 배선도 따라붙는다.

### F. preview도 React 컴포넌트로 렌더(markdown-it → React 트리) — ❌

`dangerouslySetInnerHTML`을 걷어내고 파서 결과를 React 엘리먼트로 매핑해야 한다. 두 preview 표면 + 새 파서 의존성 + XSS 테스트 전면 재작성. 접기 하나를 위해 렌더 파이프라인을 갈아엎는 건 외과적 범위를 한참 넘는다.

### G. 임계값을 CSS에 리터럴 `15`로 — ❌

`max-height: 24.5em`을 CSS에 박으면 TS 상수와 두 출처가 된다. 한쪽만 고치면 "pill은 떴는데 안 잘림"/"잘렸는데 pill이 없음"이 조용히 난다. custom property 주입은 한 줄 비용으로 이 계열을 원천 차단한다 — 팔레트 POSTMORTEM의 교훈.

## 위험 요소

| # | 위험 | 완화 |
|---|---|---|
| 1 | ~~플러그인 `props.nodeViews`가 tiptap v3에서 안 먹을 가능성~~ → **소스로 해소됨.** `prosemirror-view@1.41.8`의 `buildNodeViews`가 플러그인까지 훑고 `@tiptap/extension-code-block@3.23.4`엔 `addNodeView`가 0건이라 충돌이 없다 | 스파이크 불필요. 위험 2와 함께 육안 확인으로 충분. **폴백은 하나뿐**: `StarterKit.configure({ codeBlock: false })` + `@tiptap/extension-code-block` 추가(의존성 1개 증가). (당초 적어둔 `useEditor({ nodeViews })`는 **존재하지 않는 API**다 — `EditorOptions`의 키가 아니고, `editorProps.nodeViews`로 우회해도 `@tiptap/core@3.23.4/dist/index.js:5082-5094`가 `...editorProps` 뒤에 자기 `nodeViews`를 놓아 클로버하며 `createNodeViews()`(:5107-5115)가 마운트 시 `setProps`로 재클로버한다.) |
| 2 | **`JsonCodeHighlight`의 inline decoration이 NodeView에서 깨짐.** 두 플러그인이 같은 codeBlock을 건드린다 | Task 4 검증 항목에 명시 — JSON 로그 삽입 후 보라/빨강 토큰 색이 그대로인지 실제 Chrome에서 확인. inline deco는 `contentDOM` 안에 렌더되므로 이론상 무해하나 **반드시 눈으로 본다** |
| 3 | **`ignoreMutation`/`stopEvent` 누락** → pill 클릭이 커서를 점프시키거나, PM이 wrapper를 이물질로 보고 DOM을 재구성해 접힘이 튄다 | 두 메서드를 처음부터 구현 + `contenteditable="false"`(위험 11). **e2e로 승격**(Task 9 시나리오 7): PM은 click보다 먼저 mousedown에서 selection을 잡으므로 jsdom+user-event로 재현이 안 된다. POSTMORTEM 2026-07-04(Radix Tabs pointerdown)이 정확히 같은 부류이고 결론이 "`pnpm test` 2645개·자체 검증 에이전트 전부 통과, **e2e만** 잡아냈다"였다. 수동 체크리스트만으론 부족하다 |
| 4 | **`.ProseMirror > *` 마진 규칙**(`tiptap-editor.css:18`)의 직접 자식이 `pre`에서 wrapper로 바뀐다 | **참으로 확인됨** — 마진은 wrapper에 그대로 걸리고 `.ProseMirror pre`는 후손 선택자라 계속 매치. 시각 회귀만 수동 확인(`doc-section-body.css:2`도 동일) |
| 5 | **preview 셸이 `logCards`/`media`/`attachments` 슬롯의 `pre`까지 감쌈** | `useCodeCollapse`의 root는 `.doc-section-body` 컨테이너 내부로 한정 — 슬롯은 그 바깥 형제다. Task 3 검증에서 확인 |
| 6 | **log-viewer 사전 갱신 누락·drift** → Report 탭 pill이 `codeBlock.expand` 원시 키로 뜨거나 ko/en `{count}` 오타가 조용히 배포된다. `locales.test.ts` 훅은 `src/i18n/`만 보고 이 복제본은 안 본다 | **테스트로 묶는다**(grep·육안이 아니라): 키를 `logs.ts`에 두어 `log-viewer/__tests__/i18n.test.ts:94-102`의 기존 drift 검사에 자동으로 걸리게 하고, 그 검사의 대조 대상에 `editor` 네임스페이스도 추가한다(Task 7). POSTMORTEM 2026-06-28의 처방이 "복제본은 늘 대조 테스트로 묶는다"였고 2026-07-16이 그 처방을 다시 밟아 터진 사례다 |
| 7 | **후행 개행 처리를 한쪽만 하면** 같은 로그가 에디터 `(41줄)`, preview `(42줄)`로 보인다 | `countCodeLines`가 두 표면의 유일한 진입점. 단위 테스트에 두 입력 형태(후행 `\n` 유/무)를 모두 넣는다 |
| 8 | **접힘이 마크다운으로 샘** — 이 기능의 최대 리스크 | 구조적으로 차단됨(데이터 흐름 참조)되, 믿지 말고 Task 8에서 골든 회귀 테스트로 박는다 |
| 9 | `data-collapsible="false"`인 짧은 블럭도 wrapper div가 하나 늘어난다 | 시각·기능 영향 0. wrapper 재생성을 피하려는 의도적 선택 |
| 10 | **StrictMode에서 셸이 중첩된다** — effect가 자기 출력에 대해 idempotent하지 않으면 mount→cleanup→mount 재실행이 wrapper 안의 `pre`를 다시 감싼다. dev 100% 재현 | `pre.closest(".code-collapse")` 가드 + `destroy()`의 unwrap 둘 다. POSTMORTEM 2026-07-16(useReproPrefill) 항목이 "StrictMode 발견은 prod 재실행 경로의 리허설"이라고 경고한 그 자리다 |
| 11 | **`contenteditable="false"` 누락** → 에디터에서 pill 텍스트가 편집 영역으로 취급되고, contenteditable 내부 `<button>`은 브라우저별로 **Tab 포커스가 안 간다** → 키보드 도달 요구사항 무력화 | fade·toggle 둘 다에 `contenteditable="false"`. `ignoreMutation`/`stopEvent`로는 못 막는 별개 문제다. Task 4 체크리스트의 Tab 항목이 이걸 잡는다 |
| 12 | **preview `html`을 `useMemo`로 안 뽑으면** `copied` 토글(1.5초 타이머)만으로 셸이 전부 재생성돼 **펼침이 리셋**된다 | 정확성 요건으로 취급 — "최적화"로 읽고 생략하면 안 된다(preview 부착 섹션 참조) |
