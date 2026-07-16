import { useEffect, useMemo, useState } from "react";
import CodeMirror, {
  Decoration,
  EditorState,
  EditorView,
  Facet,
  Transaction,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
  type DecorationSet,
  type Range,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { css, cssLanguage } from "@codemirror/lang-css";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import type { Token } from "@/types/picker";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { findTokenValue, isInternalToken } from "./tokenUtils";
import { PROP_CATEGORY } from "./propMetadata";
import { valueHintsFor } from "./propValues";
import { rightHintText } from "./valueFormat";
import {
  filterTokensByQuery,
  flattenTokenGroups,
  groupTokensByFamily,
  matchRange,
  tokenFamilyPrefixes,
} from "./tokenSuggest";
import { swatchColorFor } from "./cssSwatch";
import { selectorLineChangeFilter } from "./selectorLock";

// 1행(선택자 줄)은 편집 잠금 — 가려진 `{`가 훼손되면 parseCssBlock이 깨진다. 선택·커서 이동·복사는 허용.
// changeFilter로 1행만 protected range 처리 → 1행 변경만 드롭되고 본문 변경(전체 삭제 포함)은 통과.
// 단 uiw의 value 동기화(전체 doc 교체)엔 userEvent가 없다 — 보호를 걸면 본문이 통째로 날아간다.
const lockSelectorLine = EditorState.changeFilter.of((tr) =>
  selectorLineChangeFilter({
    hasUserEvent: tr.annotation(Transaction.userEvent) !== undefined,
    firstLineTo: tr.startState.doc.lineAt(0).to,
  }),
);

// lang-css의 값 완성이 약해(속성 무관 generic 덤프) 흔한 값을 커스텀 소스로 보강.
// 열거형 속성이 아닐 때(color·length 등)의 generic 폴백 — 선언부(콜론 뒤)에서만 제안.
const GENERIC_VALUE_HINTS = [
  "initial",
  "inherit",
  "unset",
  "auto",
  "none",
  "bold",
  "normal",
  "transparent",
  "currentColor",
  "red",
  "blue",
  "green",
  "black",
  "white",
];

// 커서가 걸친 선언의 속성명 — 현재 세그먼트(마지막 `;` 이후)의 콜론 앞.
function propBeforeCursor(before: string): string {
  const seg = before.slice(before.lastIndexOf(";") + 1);
  const colon = seg.indexOf(":");
  return colon < 0 ? "" : seg.slice(0, colon).trim().toLowerCase();
}

const cssValueCompletion = cssLanguage.data.of({
  autocomplete: (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    if (!/:[^;{}]*$/.test(before)) return null;
    const word = context.matchBefore(/[\w-]+/);
    if (!word && !context.explicit) return null;
    // 속성별 값이 있으면 그것만(+CSS-wide) boost로 lang-css generic 덤프 위에 올린다.
    const specific = valueHintsFor(propBeforeCursor(before));
    const labels = specific ?? GENERIC_VALUE_HINTS;
    return {
      from: word ? word.from : context.pos,
      options: labels.map((label, i) => ({
        label,
        type: "constant",
        ...(specific ? { boost: labels.length - i } : {}),
      })),
      validFor: /^[\w-]*$/,
    };
  },
});

// var(--…) 안에서 페이지 디자인 토큰을 제안 — 편집 패널(ValueCombobox)과 동일 데이터(store tokens)·
// 동일 규칙(category 우선 + family 우선 + LIKE 매칭, tokenSuggest 공유). 선택 시 var()를 닫아준다.
function makeTokenCompletion(tokens: Token[]) {
  const usable = tokens.filter((tk) => !isInternalToken(tk.name));
  return cssLanguage.data.of({
    autocomplete: (context: CompletionContext) => {
      if (!usable.length) return null;
      const line = context.state.doc.lineAt(context.pos);
      const colon = line.text.indexOf(":");
      if (colon < 0 || line.text.includes("{")) return null;
      const rel = context.pos - line.from;
      // 커서가 걸친 var(--name) 토큰의 이름(--…) 영역을 찾는다(이름 안 또는 바로 뒤).
      // regex가 최소 `--`를 요구하므로 var( 직후(--를 아직 안 친 상태)만으론 안 잡힌다.
      const RE = /var\(\s*(--[\w-]*)/g;
      let m: RegExpExecArray | null;
      let nameStartRel = -1;
      let nameEndRel = -1;
      let fullName = "";
      while ((m = RE.exec(line.text))) {
        const g = m[1] ?? "";
        const s = m.index + m[0].length - g.length;
        const e = s + g.length;
        if (rel >= s && rel <= e) {
          nameStartRel = s;
          nameEndRel = e;
          fullName = g;
          break;
        }
      }
      if (nameStartRel < 0) return null;
      // 편집 탭처럼 현재 토큰의 family를 항상 앞에 노출. 커서 앞 prefix로만 좁힌다(클릭=빈 prefix=family 전체).
      const prefix = line.text.slice(nameStartRel, rel);
      const prop = line.text.slice(0, colon).trim();
      const prefixes = tokenFamilyPrefixes(fullName ? [fullName] : [], usable);
      const ordered = flattenTokenGroups(
        groupTokensByFamily(usable, PROP_CATEGORY[prop], prefixes),
      );
      const filtered = filterTokensByQuery(ordered, prefix);
      if (!filtered.length) return null;
      return {
        // 이름 전체(nameStart..nameEnd)를 교체 대상으로 → 기존 토큰 클릭 후 선택 시 통째로 바뀐다.
        from: line.from + nameStartRel,
        to: line.from + nameEndRel,
        filter: false,
        getMatch: (c: Completion) => matchRange(c.label, prefix),
        options: filtered.map((tk) => ({
          label: tk.name,
          detail: tk.value,
          apply: (view: EditorView, _c: Completion, aFrom: number, aTo: number) => {
            const closed = view.state.sliceDoc(aTo, aTo + 1) === ")";
            const insert = closed ? tk.name : `${tk.name})`;
            view.dispatch({
              changes: { from: aFrom, to: aTo, insert },
              selection: { anchor: aFrom + tk.name.length + 1 },
            });
          },
        })),
      };
    },
  });
}

// 자동완성 드롭다운: 아이콘 컬럼은 끄고(값 완성은 `:` 뒤에서만 떠 문맥이 곧 구분), 색 값 옵션
// (red/#fff…)·색 토큰(--color-*)엔 좌측 미리보기 칩. 비색 옵션엔 투명 스페이서로 label 정렬 유지.
function makeSwatchCompletion(tokens: Token[]) {
  return autocompletion({
    icons: false,
    addToOptions: [
      {
        position: 20,
        render: (completion: Completion) => {
          let color = swatchColorFor(completion.label);
          if (!color && completion.label.startsWith("--")) {
            const v = findTokenValue(tokens, completion.label);
            if (v) color = swatchColorFor(v);
          }
          if (!color) return null; // 색 아니면 셀 없음(shadcn TokenItem 조건부 swatch와 동일)
          const span = document.createElement("span");
          span.className = "cm-completionSwatch";
          span.style.backgroundColor = color;
          return span;
        },
      },
    ],
  });
}

// 섹션 자체가 에디터처럼 보이도록: 배경 투명(섹션 bg 노출)·보더/아웃라인 제거,
// 폰트는 DOM Tree Dialog와 통일(앱 기본 Pretendard·13px). 라인랩 없음 → 가로 스크롤.
// 프리셋(oneDark 등) 없이 배경·텍스트·캐럿·거터·선택색을 전부 semantic 토큰으로 지정 —
// 라이트/다크가 같은 구성으로 자동 대응(액센트만 cssHighlightLight/Dark). 라인랩 없음 → 가로 스크롤.
const editorTheme = EditorView.theme({
  // flex:1 로 wrapper(flex-col)를 가득 채운다 — height:100%는 flex-grow 높이 기준에서 resolve 안 됨.
  "&": {
    backgroundColor: "transparent",
    color: "hsl(var(--foreground))",
    fontSize: "13px",
    flex: "1 1 0",
    minHeight: "0",
  },
  "&.cm-focused": { outline: "none" },
  // 섹션 패딩을 에디터 내부로 — 가로 스크롤 시 콘텐츠가 가장자리까지 흐르게.
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.7",
    padding: "12px 0",
    overflow: "auto",
  },
  // 본문 우측 패딩(가로 스크롤 여백). 좌측은 gutter가 소유 → 0.
  ".cm-content": {
    fontFamily: "inherit",
    padding: "0 16px 0 0",
    caretColor: "hsl(var(--foreground))",
  },
  // CM 코어 기본 `.cm-line`(0 2px 0 6px)을 제거 — 가로 패딩은 gutter/content가 전담.
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "hsl(var(--foreground))" },
  "& .cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(59, 130, 246, 0.28)",
  },
  // 행 번호 컬럼 — 좌 여백(패널 px-4=16px)은 gutters가, 번호↔본문 간격은 gutterElement가 소유.
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    paddingLeft: "16px",
    paddingRight: "0",
    color: "hsl(var(--muted-foreground))",
  },
  // CM 코어 기본(0 3px 0 5px)을 우리 값으로 덮음. right=번호↔본문 간격(knob).
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 0",
    minWidth: "1.5rem",
    textAlign: "right",
  },
  // 선언 콜론 뒤 간격 — property↔value indent 강화(knob).
  ".cm-decl-colon": { paddingRight: "4px" },
  // 선언/닫는 줄 들여쓰기 — 번호↔선택자 간격(gutterElement 12px)만큼 property를 밀어넣음(knob).
  ".cm-body-indent": { paddingLeft: "12px" },
  // 행 hover·focus(활성 줄) 시 배경 살짝 진하게 — muted 토큰 저알파로 라이트/다크 자동 대응.
  // 본문·번호(gutter)가 별도 컬럼이라 hover는 컬럼별 독립. 활성 줄은 CM이 양 컬럼을 동기화.
  ".cm-line:hover": { backgroundColor: "hsl(var(--muted) / 0.4)" },
  ".cm-lineNumbers .cm-gutterElement:hover": {
    backgroundColor: "hsl(var(--muted) / 0.4)",
  },
  ".cm-activeLine": { backgroundColor: "hsl(var(--muted) / 0.55)" },
  ".cm-activeLineGutter": { backgroundColor: "hsl(var(--muted) / 0.55)" },
  ".cm-color-swatch": {
    display: "inline-block",
    width: "0.85em",
    height: "0.85em",
    marginRight: "0.35em",
    verticalAlign: "-0.12em",
    border: "1px solid rgba(128,128,128,0.4)",
    borderRadius: "2px",
    boxSizing: "border-box",
  },
  // 완성된 var(--토큰) 이름 — 편집 탭 TokenChip과 동일(회색 --muted 배경, border 없음). hover 시 원시값 툴팁.
  ".cm-var-token": {
    backgroundColor: "hsl(var(--muted))",
    borderRadius: "4px",
    padding: "0 4px",
    boxDecorationBreak: "clone",
    cursor: "pointer",
  },
  // 잘못된 선언 — 유효 property와 같은 앰버지만 취소선으로 "미적용" 신호.
  // 하이라이트 색은 안쪽 span에 직접 걸려 상속으론 못 덮으므로 `*`로 자손까지 !important.
  ".cm-invalid-decl, .cm-invalid-decl *": { color: "#b45309 !important" },
  ".cm-invalid-decl": {
    textDecoration: "line-through",
    textDecorationColor: "#b45309",
  },
  ".dark & .cm-invalid-decl, .dark & .cm-invalid-decl *": {
    color: "#fbbf24 !important",
  },
  ".dark & .cm-invalid-decl": { textDecorationColor: "#fbbf24" },
  // 자동완성 combobox — shadcn Popover/Command 규율(popover 표면·accent 선택·matched 강조)로 통일.
  // 색상 토큰(--popover 등)은 사이드패널 DOM에서 resolve돼 라이트/다크 자동 대응.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid hsl(var(--border))",
    borderRadius: "calc(var(--radius) - 2px)",
    backgroundColor: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    boxShadow:
      "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    fontFamily: "inherit",
    overflow: "hidden",
    padding: "4px",
  },
  // 2-class 셀렉터로 CM 기본(.cm-tooltip.cm-tooltip-autocomplete > ul { monospace })를 덮어 앱 Pretendard로.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "15rem",
  },
  // 2-class로 CM 기본(.cm-tooltip.cm-tooltip-autocomplete > ul > li { padding:1px 3px })를 이겨야 flex/padding이 먹힘.
  // 편집 패널 CommandItem/TokenItem과 통일: flex + gap-2 + px-2 py-1.5. font-size는 에디터 본문(13px)과 맞춤.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "calc(var(--radius) - 4px)",
    fontSize: "13px",
    lineHeight: "1.25rem",
    color: "hsl(var(--popover-foreground))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "hsl(var(--accent))",
    color: "hsl(var(--accent-foreground))",
  },
  ".cm-completionLabel": {
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 매칭 텍스트 강조(bold) 제거 — 입력하는 곳이라 선택 강조 불필요.
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "inherit",
    color: "inherit",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    flexShrink: "0",
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontStyle: "normal",
    fontSize: "11px",
    color: "hsl(var(--muted-foreground))",
  },
  // 값 미리보기 칩 — TokenItem처럼 색 옵션에만(비색은 셀 없음). li gap이 간격을 소유.
  ".cm-completionSwatch": {
    display: "inline-block",
    width: "0.75rem",
    height: "0.75rem",
    flexShrink: "0",
    borderRadius: "3px",
    border: "1px solid rgba(128,128,128,0.4)",
    boxSizing: "border-box",
  },
  // 토큰 hover 툴팁 — 앱 Tooltip(bg-primary/text-primary-foreground) 규율. 외곽 .cm-tooltip 기본 테두리 제거.
  ".cm-tooltip.cm-tooltip-hover": {
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-token-tooltip": {
    backgroundColor: "hsl(var(--primary))",
    color: "hsl(var(--primary-foreground))",
    borderRadius: "calc(var(--radius) - 2px)",
    padding: "4px 10px",
    fontSize: "12px",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  },
});

// selector 계열(태그·class·id·pseudo·attr) 파랑, property 앰버. 나머지 값 토큰은 preset 유지.
const SELECTOR_TAGS = [
  t.tagName,
  t.className,
  t.labelName,
  t.constant(t.className),
  t.attributeName,
];
const cssHighlightLight = HighlightStyle.define([
  { tag: SELECTOR_TAGS, color: "#1d4ed8" },
  { tag: t.propertyName, color: "#b45309" },
]);
const cssHighlightDark = HighlightStyle.define([
  { tag: SELECTOR_TAGS, color: "#60a5fa" },
  { tag: t.propertyName, color: "#fbbf24" },
]);

// 색상 후보 정규식 — hex / color·var 함수 / 단어. CSS-wide 키워드 제외·유효성은 swatchColorFor가 담당.
const COLOR_RE =
  /#(?:[0-9a-fA-F]{3,4}){1,2}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|var)\([^)]*\)|\b[a-zA-Z]+\b/g;
// 완성된(닫힌) var(--토큰) 참조의 커스텀 프로퍼티 이름만 캡처 — 네트워크 로그 하이라이트처럼 배경 칠해 "완성 토큰" 신호.
const VAR_TOKEN_RE = /var\(\s*(--[\w-]+)\s*\)/g;

// 토큰(var(--x)) 색은 sidepanel에서 resolve 불가 → 요소의 computed(이미 resolve된 값) 참조.
const computedFacet = Facet.define<
  Record<string, string>,
  Record<string, string>
>({ combine: (v) => v[0] ?? {} });

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(other: SwatchWidget) {
    return other.color === this.color;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-color-swatch";
    span.style.backgroundColor = this.color;
    return span;
  }
}

// { } 표시 truncate(데이터엔 유지 — 파싱용) + 값이 색상이면 좌측 인라인 swatch.
function buildDecos(view: EditorView): DecorationSet {
  const list: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const full = doc.toString();

  const open = full.indexOf("{");
  if (open >= 0) {
    const start = open > 0 && full[open - 1] === " " ? open - 1 : open;
    list.push(Decoration.replace({}).range(start, open + 1));
  }
  // inline replace는 줄바꿈을 못 넘으므로 `}` 문자만 숨긴다(마지막 빈 줄은 무해).
  const close = full.lastIndexOf("}");
  if (close >= 0) list.push(Decoration.replace({}).range(close, close + 1));

  const computed = view.state.facet(computedFacet);
  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    let m: RegExpExecArray | null;
    COLOR_RE.lastIndex = 0;
    while ((m = COLOR_RE.exec(text))) {
      const val = m[0];
      const pos = from + m.index;
      const line = doc.lineAt(pos);
      const before = doc.sliceString(line.from, pos);
      if (!before.includes(":") || line.text.includes("{")) continue;
      // 리터럴 색은 swatchColorFor(CSS-wide 제외 + 유효성). var(--x) 토큰은 그 선언 prop의 computed(resolve된) 색으로.
      let color: string | null = null;
      if (val.includes("var(")) {
        const prop = line.text.slice(0, line.text.indexOf(":")).trim();
        const c = computed[prop];
        if (c && CSS.supports("color", c)) color = c;
      } else {
        color = swatchColorFor(val);
      }
      if (!color) continue;
      list.push(
        Decoration.widget({ widget: new SwatchWidget(color), side: -1 }).range(
          pos,
        ),
      );
    }

    let vm: RegExpExecArray | null;
    VAR_TOKEN_RE.lastIndex = 0;
    while ((vm = VAR_TOKEN_RE.exec(text))) {
      const nameStart = from + vm.index + vm[0].indexOf(vm[1]);
      const nameEnd = nameStart + vm[1].length;
      const line = doc.lineAt(nameStart);
      const before = doc.sliceString(line.from, nameStart);
      if (!before.includes(":") || line.text.includes("{")) continue;
      list.push(Decoration.mark({ class: "cm-var-token" }).range(nameStart, nameEnd));
    }
  }

  // body/닫는 줄(선택자 줄 제외)을 line decoration으로 들여쓰고, 선언 콜론 뒤 간격을 넓힌다.
  if (open >= 0) {
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = doc.lineAt(pos);
        if (line.from > open && !line.text.includes("{")) {
          // 선택자 줄을 뺀 모든 줄(선언·닫는 `}`·빈 줄) 들여쓰기 — 번호↔선택자 간격만큼 property를 밀어넣음.
          list.push(Decoration.line({ class: "cm-body-indent" }).range(line.from));
          const ci = line.text.indexOf(":");
          if (ci >= 0) {
            const c = line.from + ci;
            list.push(Decoration.mark({ class: "cm-decl-colon" }).range(c, c + 1));
          }
        }
        pos = line.to + 1;
      }
    }
  }

  if (open >= 0) list.push(...collectInvalidDeclMarks(view, open));
  return Decoration.set(list, true);
}

// 잘못된 선언(값이 `;`로 안 닫혀 lezer가 declaration 대신 TagName=선택자로 파싱한 이름)을 앰버+취소선으로.
// 블록 밖 진짜 선택자와 구분하려 `{` 안쪽(node.from > open) TagName만 마킹 — "속성인데 적용 안 됨" 신호.
function collectInvalidDeclMarks(
  view: EditorView,
  open: number,
): Range<Decoration>[] {
  const marks: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "TagName" && node.from > open) {
          marks.push(
            Decoration.mark({ class: "cm-invalid-decl" }).range(
              node.from,
              node.to,
            ),
          );
        }
      },
    });
  }
  return marks;
}

const decoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecos(view);
    }
    update(u: ViewUpdate) {
      // 트리 변경(백그라운드 파스 완료)도 반영 — 잘못된 선언 취소선이 파스 지연으로 stale되지 않게.
      if (
        u.docChanged ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      )
        this.decorations = buildDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// 커서가 값(콜론 뒤) 컨텍스트일 때만 자동완성을 연다 — 속성/선택자/빈 곳엔 안 띄워 방해를 줄인다.
function startInValueIfContext(view: EditorView) {
  if (!view.hasFocus) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const before = view.state.sliceDoc(line.from, pos);
  if (/:[^;{}]*$/.test(before)) startCompletion(view);
}

// 자동완성을 타이핑(삽입)뿐 아니라 커서 이동(클릭·방향키)·focus·삭제(backspace)에도 연다.
// 소스가 문맥(값/var)에 안 맞으면 no-op. 문서 변경(토큰 수락·타이핑)에는 재발동하지 않아 선택 직후
// 콤보박스가 다시 열리지 않는다. 타이머를 ViewPlugin이 소유해 destroy 시 정리(언마운트 후 실행 방지).
const autoActivate = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    // 클릭이 커서를 잡은 뒤 평가하도록 다음 틱에 한 번만 — 이전 예약은 덮어써 중복/누수 방지.
    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => startInValueIfContext(this.view), 0);
    }
    update(u: ViewUpdate) {
      if (!u.view.hasFocus) return;
      const deleted = u.transactions.some(
        (tr) =>
          tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward"),
      );
      // 순수 커서 이동(클릭·방향키): 문맥 벗어나면 no-op. 문서 변경(수락·타이핑)엔 재발동 안 함.
      const cursorMoved = u.selectionSet && !u.docChanged;
      if (deleted || cursorMoved) this.schedule();
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
  {
    // 키보드(Tab) 진입용 — 클릭/방향키는 update(selectionSet)가 잡는다.
    eventHandlers: {
      focus() {
        this.schedule();
      },
    },
  },
);

// var(--토큰) hover 시 편집 패널 ValueHint(rightHintText)와 동일 로직으로 매핑된 원시값을 툴팁으로.
function makeTokenHover(tokens: Token[]) {
  return hoverTooltip((view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos);
    if (line.text.includes("{")) return null;
    VAR_TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_TOKEN_RE.exec(line.text))) {
      const name = m[1];
      const nameStart = line.from + m.index + m[0].indexOf(name);
      const nameEnd = nameStart + name.length;
      if (pos < nameStart || pos > nameEnd) continue;
      const colon = line.text.indexOf(":");
      if (colon < 0) return null;
      const prop = line.text.slice(0, colon).trim();
      const computed = view.state.facet(computedFacet);
      const hint = rightHintText(
        PROP_CATEGORY[prop],
        computed[prop] ?? "",
        findTokenValue(tokens, name),
        false,
      );
      if (!hint) return null;
      return {
        pos: nameStart,
        end: nameEnd,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-token-tooltip";
          dom.textContent = hint;
          return { dom };
        },
      };
    }
    return null;
  });
}

export default function CssCodeMirror({
  value,
  onChange,
  onFocus,
  onBlur,
  computed,
  tokens,
}: {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  computed?: Record<string, string>;
  tokens?: Token[];
}) {
  const theme = useSettingsUiStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  // theme==="system"일 때 OS 다크모드 토글에 반응(useThemeEffect와 동일 규율).
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMqChange = () => setSystemDark(mq.matches);
    setSystemDark(mq.matches);
    mq.addEventListener("change", onMqChange);
    return () => mq.removeEventListener("change", onMqChange);
  }, [theme]);
  const dark = theme === "dark" || (theme === "system" && systemDark);

  const tokenCompletion = useMemo(
    () => makeTokenCompletion(tokens ?? []),
    [tokens],
  );
  const swatchCompletion = useMemo(
    () => makeSwatchCompletion(tokens ?? []),
    [tokens],
  );
  const tokenHover = useMemo(() => makeTokenHover(tokens ?? []), [tokens]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      // 프리셋(light/dark) 미사용 — 배경·텍스트·액센트를 editorTheme·cssHighlight로 직접 통제해
      // 라이트/다크를 동일 구성으로 맞춘다. dark는 액센트 하이라이트 선택에만 쓰인다.
      theme="none"
      extensions={[
        lockSelectorLine,
        css(),
        cssValueCompletion,
        tokenCompletion,
        swatchCompletion,
        autoActivate,
        tokenHover,
        editorTheme,
        syntaxHighlighting(dark ? cssHighlightDark : cssHighlightLight),
        computedFacet.of(computed ?? {}),
        decoPlugin,
      ]}
      // 코드 뷰는 사이드패널을 가득 채운다 — wrapper를 flex 컨테이너로, .cm-editor가 flex-1로 채움.
      className="flex min-h-0 flex-1 flex-col"
      // indentWithTab=false로 Tab이 들여쓰기 대신 포커스 이탈 — 키보드 트랩 방지.
      indentWithTab={false}
      // 자동완성은 makeSwatchCompletion으로 직접 구성(icons:false + 미리보기 칩) → basicSetup 기본 끔.
      basicSetup={{ foldGutter: false, autocompletion: false }}
      spellCheck={false}
    />
  );
}
