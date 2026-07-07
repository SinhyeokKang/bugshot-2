import { useEffect, useState } from "react";
import CodeMirror, {
  Decoration,
  EditorView,
  Facet,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@uiw/react-codemirror";
import { css, cssLanguage } from "@codemirror/lang-css";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { useSettingsUiStore } from "@/store/settings-ui-store";

// lang-css의 값 완성이 약해 흔한 값을 커스텀 소스로 보강. 선언부(콜론 뒤)에서만 제안.
const VALUE_HINTS = [
  "initial",
  "inherit",
  "unset",
  "auto",
  "none",
  "block",
  "inline-block",
  "flex",
  "inline-flex",
  "grid",
  "center",
  "flex-start",
  "flex-end",
  "space-between",
  "absolute",
  "relative",
  "fixed",
  "sticky",
  "hidden",
  "visible",
  "bold",
  "normal",
  "pointer",
  "transparent",
  "currentColor",
  "red",
  "blue",
  "green",
  "black",
  "white",
];

const cssValueCompletion = cssLanguage.data.of({
  autocomplete: (context: {
    pos: number;
    explicit: boolean;
    state: EditorView["state"];
    matchBefore: (re: RegExp) => { from: number; to: number; text: string } | null;
  }) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    if (!/:[^;{}]*$/.test(before)) return null;
    const word = context.matchBefore(/[\w-]+/);
    if (!word && !context.explicit) return null;
    return {
      from: word ? word.from : context.pos,
      options: VALUE_HINTS.map((label) => ({ label, type: "constant" })),
      validFor: /^[\w-]*$/,
    };
  },
});

// 섹션 자체가 에디터처럼 보이도록: 배경 투명(섹션 bg 노출)·보더/아웃라인 제거,
// 폰트는 DOM Tree Dialog와 통일(앱 기본 Pretendard·13px). 라인랩 없음 → 가로 스크롤.
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  // 섹션 패딩을 에디터 내부로 — 가로 스크롤 시 콘텐츠가 가장자리까지 흐르게.
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.7", padding: "12px 0" },
  ".cm-content": { fontFamily: "inherit", padding: "0 16px 0 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    paddingLeft: "16px",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
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

// CSS-wide 키워드는 색상 아님(swatch 제외). 색상 후보 정규식 — hex / color·var 함수 / 단어.
const CSS_WIDE = new Set(["inherit", "initial", "unset", "revert"]);
const COLOR_RE =
  /#(?:[0-9a-fA-F]{3,4}){1,2}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|var)\([^)]*\)|\b[a-zA-Z]+\b/g;

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
  const list = [];
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
      if (CSS_WIDE.has(val.toLowerCase())) continue;
      const pos = from + m.index;
      const line = doc.lineAt(pos);
      const before = doc.sliceString(line.from, pos);
      if (!before.includes(":") || line.text.includes("{")) continue;
      // 리터럴 색은 그대로. var(--x) 토큰은 그 선언 prop의 computed(resolve된) 색으로.
      let color: string | null = null;
      if (val.includes("var(")) {
        const prop = line.text.slice(0, line.text.indexOf(":")).trim();
        const c = computed[prop];
        if (c && CSS.supports("color", c)) color = c;
      } else if (CSS.supports("color", val)) {
        color = val;
      }
      if (!color) continue;
      list.push(
        Decoration.widget({ widget: new SwatchWidget(color), side: -1 }).range(
          pos,
        ),
      );
    }
  }
  return Decoration.set(list, true);
}

const decoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export default function CssCodeMirror({
  value,
  onChange,
  onFocus,
  onBlur,
  computed,
}: {
  value: string;
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  computed?: Record<string, string>;
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

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      theme={dark ? "dark" : "light"}
      extensions={[
        css(),
        cssValueCompletion,
        editorTheme,
        syntaxHighlighting(dark ? cssHighlightDark : cssHighlightLight),
        computedFacet.of(computed ?? {}),
        decoPlugin,
      ]}
      minHeight="6rem"
      // indentWithTab=false로 Tab이 들여쓰기 대신 포커스 이탈 — 키보드 트랩 방지.
      indentWithTab={false}
      basicSetup={{ foldGutter: false }}
      spellCheck={false}
    />
  );
}
