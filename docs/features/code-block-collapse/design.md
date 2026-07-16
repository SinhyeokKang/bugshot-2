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

> **왜 기존 두 CSS에 나눠 쓰지 않는가**: `doc-section-body.css`와 `tiptap-editor.css`는 `pre` 규칙이 이미 거의 동일하게 복제돼 있다(각각 :81, :103). 그 관례를 따라 접기 CSS도 복제하면 ~25줄 × 2의 두 번째 출처가 생긴다 — 팔레트 POSTMORTEM이 난 자리와 같은 실수다. 우리가 **자체 wrapper 클래스를 새로 도입하므로 표면 prefix 없이 선택자가 성립**한다 → 파일 하나로 끝난다. 기존 `pre` 규칙 복제는 이 기능과 무관하니 손대지 않는다(외과적 범위).

#### `src/sidepanel/lib/__tests__/codeCollapse.test.ts` · `src/sidepanel/components/__tests__/DocSectionBody.test.tsx`
테스트 계획은 `tasks.md` 참조.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/components/IssuePreviewView.tsx` | preview 본문 렌더(사이드패널 + **log-viewer 공용**). 모든 문구를 `labels` prop으로 받아 i18n 비의존 | `IssuePreviewViewLabels`에 `expandCode`/`collapseCode` 추가. `SectionBody`(:164)에서 `useCodeCollapse` ref 부착 |
| `src/sidepanel/components/DocSectionBody.tsx` | DraftDetailDialog의 섹션 본문 렌더. `useT()` 직접 사용 | `MarkdownBody`(:97)에 `useCodeCollapse` ref 부착. 라벨은 `useT()`로 자체 조달 |
| `src/sidepanel/components/TiptapEditor.tsx` | tiptap 에디터. `JsonCodeHighlight` 확장이 이미 codeBlock을 다룸 | `CodeBlockCollapse` 확장 추가 + `extensions` 배열에 등록 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 사이드패널 preview. `IssuePreviewView`에 labels 주입(:373) | 새 라벨 2개를 `useT()`로 전달 |
| `src/log-viewer/App.tsx` | logs.html의 Report 탭. `IssuePreviewView`에 labels 주입(:151) | 새 라벨 2개를 log-viewer `t`로 전달 |
| `src/i18n/namespaces/editor.ts` | 에디터·초안 문구 ko/en | `codeBlock.expand`·`codeBlock.collapse` 추가 |
| `src/log-viewer/i18n.ts` | log-viewer 전용 **복제 사전**(`koDict`/`enDict`) | 같은 키 2개 추가 |

> ⚠ **i18n이 두 곳인 이유를 잊지 말 것.** `IssuePreviewView`는 사이드패널과 log-viewer 번들이 공유하는데, log-viewer는 `src/i18n/`을 안 쓰고 자체 flat 사전을 쓴다. 그래서 컴포넌트가 `useT()`를 직접 부르면 log-viewer 번들이 깨진다 — 지금의 `labels` prop 구조가 그 격리다. POSTMORTEM 2026-06-28이 이 복제의 drift를 이미 한 번 잡았다. **`preview.copyMarkdown`을 추가할 때 두 사전을 다 고쳐야 하는 것과 똑같이, 여기도 두 곳이다.**

## 데이터 흐름

접기는 **상태 저장소를 하나도 안 만든다.** Zustand·`chrome.storage`·draft 어디에도 안 들어간다.

```
[에디터]  NodeView 인스턴스의 로컬 필드 `expanded: boolean`
          → PM이 노드가 살아있는 한 NodeView 인스턴스를 유지하므로
            이게 곧 "이 블럭"의 정체성. 위치 매핑·id 속성이 필요 없다.
          → setContent(외부 value 변경)로 노드가 재생성되면 NodeView도 재생성 → 초기값(접힘)

[preview] wrapper DOM의 `data-collapsed` 속성
          → html 문자열이 바뀌면 React가 innerHTML을 통째로 갈아끼우고
            useEffect가 재실행돼 셸을 다시 만든다 → 초기값(접힘)
```

두 화면이 서로의 접힘 상태를 모른다(시나리오 A-5). 이건 버그가 아니라 비목표("영속 상태를 만들지 않는다")의 귀결이다.

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
  /** 줄 수 갱신 → collapsible 여부·pill 라벨 재계산 (에디터에서 타이핑마다 호출) */
  update(lineCount: number): void;
  setExpanded(expanded: boolean): void;
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
  <pre><code class="language-json">…</code></pre>
  <div class="code-collapse-fade" aria-hidden="true"></div>
  <button type="button" class="code-collapse-toggle" aria-expanded="false"
          data-testid="code-collapse-toggle">펼치기 (38줄)</button>
</div>
```

- `--code-collapse-lines`를 **JS가 `CODE_COLLAPSE_LINE_THRESHOLD`로 주입**한다. CSS는 `max-height: calc(var(--code-collapse-lines) * 1.5em + …)`로 받아 쓴다 → 임계값 출처는 TS 하나.
- `data-collapsible="false"`(15줄 이하)면 CSS가 fade·toggle을 `display:none`, `max-height:none`으로 만든다. 셸은 항상 만들고 속성으로만 끈다 — 에디터에서 타이핑으로 줄 수가 임계값을 오르내릴 때 DOM을 만들었다 부쉈다 하지 않기 위해서다.

### CSS 규칙 (`code-collapse.css`)

```css
.code-collapse { position: relative; }

/* pre의 line-height: 1.5, padding-top: 0.625em (doc-section-body.css:81 / tiptap-editor.css:103).
   em은 pre 자신의 font-size 기준이라 줄 수 × 1.5em이 정확히 그만큼의 줄이 된다.
   + 0.75em = 다음 줄의 절반을 남겨 "더 있다"를 드러낸다(레퍼런스와 동일). */
.code-collapse[data-collapsible="true"][data-collapsed="true"] pre {
  max-height: calc(var(--code-collapse-lines) * 1.5em + 0.625em + 0.75em);
  overflow: hidden;
}

/* pre 배경과 같은 토큰 → 다크모드 자동 대응 (DESIGN.md §3: semantic 토큰이면 dark: variant 불요) */
.code-collapse-fade {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 3em;
  pointer-events: none;
  border-radius: 0 0 0.375rem 0.375rem;
  background: linear-gradient(to bottom, transparent, hsl(var(--muted)));
}
.code-collapse:not([data-collapsible="true"][data-collapsed="true"]) .code-collapse-fade {
  display: none;
}

.code-collapse-toggle {
  position: absolute;
  bottom: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 9999px;                      /* DESIGN.md §6 pill */
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));              /* DESIGN.md §10: idle은 foreground, muted 금지 */
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;                         /* text-xs */
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms;                  /* DESIGN.md §8: hover류는 transition */
}
.code-collapse[data-collapsible="false"] .code-collapse-toggle { display: none; }
.code-collapse:hover .code-collapse-toggle,
.code-collapse-toggle:focus-visible { opacity: 1; }

/* 에디터 전용: 커서가 블럭 안에 있으면 방해물 없이 전체를 보여준다 (PRD 시나리오 B) */
.code-collapse.is-editing pre { max-height: none; overflow-x: auto; }
.code-collapse.is-editing .code-collapse-fade,
.code-collapse.is-editing .code-collapse-toggle { display: none; }
```

## 에디터 부착: 왜 NodeView이고, 왜 새 의존성이 없는가

**의존성 0.** `package.json`에 `@tiptap/extension-code-block`이 없다(StarterKit에 번들). 그런데 CodeBlock 확장을 `extend()`할 필요가 없다 — ProseMirror의 `nodeViews`는 **아무 플러그인이나 `props`로 제공할 수 있다**(PM의 `customNodeViews()`가 `view.someProp("nodeViews", …)`로 플러그인까지 훑는다). 그래서 기존 `JsonCodeHighlight`와 나란히 `Extension.create({ addProseMirrorPlugins })` 하나만 추가하면 된다. StarterKit 재구성도, 새 패키지도 없다.

```ts
// TiptapEditor.tsx — JsonCodeHighlight 바로 아래
const CodeBlockCollapse = Extension.create({
  name: "codeBlockCollapse",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: codeCollapseKey,
      props: {
        nodeViews: { codeBlock: (node) => new CodeCollapseNodeView(node) },
        decorations(state) { /* 선택이 걸친 codeBlock에 class: "is-editing" */ },
      },
    })];
  },
});
```

**커서 자동 펼침을 상태 동기화 없이 푸는 법**: PM은 node decoration의 `attrs`를 NodeView의 바깥 `dom`(= 우리 wrapper)에 자동으로 얹어준다. 그래서 "선택이 이 codeBlock에 걸쳐 있으면 `class: "is-editing"`" 이라는 decoration 하나만 계산하면, wrapper에 클래스가 붙고 **나머지는 위의 CSS가 처리한다.** NodeView ↔ 플러그인 간 상태 동기화 코드가 0줄이다.

**NodeView 본체:**

```ts
class CodeCollapseNodeView {
  dom: HTMLElement;         // shell.wrapper
  contentDOM: HTMLElement;  // <code>
  private shell: CodeCollapseShell;

  constructor(node: ProseMirrorNode) {
    const pre = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    if (node.attrs.language) this.contentDOM.className = `language-${node.attrs.language}`;
    pre.appendChild(this.contentDOM);
    this.shell = createCodeCollapseShell(pre, editorCollapseLabels());
    this.dom = this.shell.wrapper;
    this.shell.update(countCodeLines(node.textContent));
  }

  update(node: ProseMirrorNode) {
    if (node.type.name !== "codeBlock") return false;
    this.shell.update(countCodeLines(node.textContent));
    return true;   // 노드를 재생성하지 않음 → expanded 로컬 상태·NodeView 인스턴스 유지
  }

  // fade·toggle은 contentDOM 밖이다 — PM이 자기 DOM이 훼손됐다고 오해하지 않게 막는다.
  ignoreMutation(m: MutationRecord) { return !this.contentDOM.contains(m.target); }
  // pill 클릭을 PM이 선택 변경으로 가로채지 않게 한다.
  stopEvent(e: Event) { return this.shell.wrapper !== e.target && !this.contentDOM.contains(e.target as Node); }

  destroy() { this.shell.destroy(); }
}
```

`ignoreMutation` / `stopEvent`가 NodeView의 전형적 함정이다. 빠뜨리면 pill 클릭이 커서 점프를 일으키거나 PM이 DOM을 통째로 다시 그려 접힘이 튄다 → 위험 요소 참조.

**라벨 조달**: NodeView는 vanilla라 훅을 못 쓴다. `src/i18n/index.ts`가 모듈 레벨 `t`를 export하므로 `editorCollapseLabels()`가 호출 시점마다 `t("codeBlock.expand", { count })`를 부른다 → 에디터 재생성 없이 현재 locale을 따른다.

## preview 부착: `dangerouslySetInnerHTML` 컨테이너를 직접 만져도 되는 이유

React는 `dangerouslySetInnerHTML` 노드의 **자식을 reconcile하지 않는다.** `__html` 문자열이 바뀔 때 innerHTML을 통째로 재설정할 뿐이다. 그래서:

- 우리가 effect에서 `pre`를 wrapper로 감싸도 React가 그걸 되돌리지 않는다.
- `html`이 바뀌면 React가 innerHTML을 갈아끼워 우리 셸이 통째로 사라지고, 같은 dep(`[html]`)의 effect가 재실행돼 다시 붙는다. 고아 리스너는 사라진 노드와 함께 GC된다(그래도 cleanup에서 `destroy()`를 부른다).

```ts
export function useCodeCollapse(html: string, labels: CodeCollapseLabels) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const shells = Array.from(root.querySelectorAll("pre")).map((pre) => {
      const anchor = document.createComment("");
      pre.replaceWith(anchor);                              // 원래 자리를 잡아둔다
      const shell = createCodeCollapseShell(pre, labelsRef.current);
      anchor.replaceWith(shell.wrapper);
      shell.update(countCodeLines(pre.textContent ?? ""));
      return shell;
    });
    return () => { for (const s of shells) s.destroy(); };
  }, [html]);

  return rootRef;
}
```

`IssuePreviewView`의 `SectionBody`는 `renderMarkdown(section.value)`를 인라인 호출(:167)하므로 `useMemo`로 뽑아 훅의 dep으로 넘긴다. `DocSectionBody`는 이미 `html`을 `useMemo`로 갖고 있다(:95).

## 기존 패턴 준수

- **테스트 2트랙** (CLAUDE.md): 판정은 순수 함수 → `codeCollapse.test.ts`(node). 접힘/펼침 전이는 렌더가 좌우 → `DocSectionBody.test.tsx`(jsdom + user-event). 전제 3 덕에 레이아웃 측정이 없어 jsdom으로 잡힌다.
- **i18n 동시 갱신** (CLAUDE.md): `src/i18n/`을 Edit하면 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다 — ko/en을 **같은 커밋에서** 넣어야 통과한다. log-viewer 복제 사전은 이 훅이 안 잡으니 수동으로 챙긴다.
- **DESIGN.md**: semantic 토큰(`--muted`/`--border`/`--background`/`--foreground`)만 써서 다크모드 자동 대응, `dark:` variant 0. pill은 `rounded-full` + text-xs, idle 색은 `foreground`. hover는 transition.
- **hover 노출 선례**: `IssueTitleOverlay.tsx:13`(그라데이션 + `group-hover:opacity-100`)·`TrimTimeline.tsx:110`과 같은 관용구를, Tailwind가 아닌 plain CSS로 옮긴 것뿐이다(wrapper·pill이 vanilla DOM이라 유틸리티 클래스를 쓸 자리가 없다).
- **주석 최소화** (CLAUDE.md): WHY가 비자명한 곳만 — `ignoreMutation`/`stopEvent`의 존재 이유, 후행 개행 제거, CSS var 주입 이유.

## 대안 검토

### A. `renderMarkdown`에 접기 마크업을 직접 넣는다 — ❌ 채택 불가

가장 단순해 보이지만 `buildIssueHtml()`이 같은 함수를 쓴다(`buildIssueMarkdown.ts:403`). 클립보드 HTML과 logs.html 리포트에 pill 버튼이 그대로 딸려 나간다. **기능이 아니라 데이터 오염이다.**

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

`max-height: 23.875em`을 CSS에 박으면 TS 상수와 두 출처가 된다. 한쪽만 고치면 "pill은 떴는데 안 잘림"/"잘렸는데 pill이 없음"이 조용히 난다. custom property 주입은 한 줄 비용으로 이 계열을 원천 차단한다 — 팔레트 POSTMORTEM의 교훈.

## 위험 요소

| # | 위험 | 완화 |
|---|---|---|
| 1 | **플러그인 `props.nodeViews`가 tiptap v3에서 안 먹을 가능성.** PM 코어는 `someProp`으로 플러그인을 훑으므로 동작해야 하지만, tiptap이 editor 레벨 `nodeViews`를 따로 관리할 여지가 있다 | Task 4에서 **가장 먼저** 실제 Chrome으로 확인. 안 먹으면 폴백 2개: `useEditor({ nodeViews })` 옵션, 또는 `StarterKit.configure({ codeBlock: false })` + `@tiptap/extension-code-block` 추가(의존성 1개 증가) |
| 2 | **`JsonCodeHighlight`의 inline decoration이 NodeView에서 깨짐.** 두 플러그인이 같은 codeBlock을 건드린다 | Task 4 검증 항목에 명시 — JSON 로그 삽입 후 보라/빨강 토큰 색이 그대로인지 실제 Chrome에서 확인. inline deco는 `contentDOM` 안에 렌더되므로 이론상 무해하나 **반드시 눈으로 본다** |
| 3 | **`ignoreMutation`/`stopEvent` 누락** → pill 클릭이 커서를 점프시키거나, PM이 wrapper를 이물질로 보고 DOM을 재구성해 접힘이 튄다 | 두 메서드를 처음부터 구현. Task 4 수동 체크리스트에 "pill 클릭 후 커서가 안 움직인다" 포함 |
| 4 | **`.ProseMirror > *` 마진 규칙**(`tiptap-editor.css:18`)의 직접 자식이 `pre`에서 wrapper로 바뀐다 | 마진은 wrapper에 그대로 걸리고 `.ProseMirror pre`는 후손 선택자라 계속 매치. 시각 회귀만 수동 확인(`doc-section-body.css:2`도 동일) |
| 5 | **preview 셸이 `logCards`/`media`/`attachments` 슬롯의 `pre`까지 감쌈** | `useCodeCollapse`의 root는 `.doc-section-body` 컨테이너 내부로 한정 — 슬롯은 그 바깥 형제다. Task 3 검증에서 확인 |
| 6 | **log-viewer 사전 갱신 누락** → Report 탭 pill이 `codeBlock.expand` 원시 키로 뜬다. `locales.test.ts` 훅은 `src/i18n/`만 보고 이 복제본은 안 본다 | Task 7을 별도 태스크로 분리. 수동 체크리스트에 logs.html Report 탭 포함. POSTMORTEM 2026-06-28의 재발 지점 |
| 7 | **후행 개행 처리를 한쪽만 하면** 같은 로그가 에디터 `(41줄)`, preview `(42줄)`로 보인다 | `countCodeLines`가 두 표면의 유일한 진입점. 단위 테스트에 두 입력 형태(후행 `\n` 유/무)를 모두 넣는다 |
| 8 | **접힘이 마크다운으로 샘** — 이 기능의 최대 리스크 | 구조적으로 차단됨(데이터 흐름 참조)되, 믿지 말고 Task 8에서 골든 회귀 테스트로 박는다 |
| 9 | `data-collapsible="false"`인 짧은 블럭도 wrapper div가 하나 늘어난다 | 시각·기능 영향 0. wrapper 재생성을 피하려는 의도적 선택 |
